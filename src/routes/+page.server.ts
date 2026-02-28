import type { PageServerLoad } from './$types';
import type { Claim } from '$lib/types';
import { env } from '$env/dynamic/private';

const BASE_URL = 'https://api.lufthansa.com/v1';

// Hub airports to scan for delayed departures
const HUB_AIRPORTS = ['FRA', 'MUC', 'DUS'];

// Fallback routes used only if no delayed flights are found at hubs
const FALLBACK_ROUTES = [
	{ origin: 'FRA', dest: 'JFK' },
	{ origin: 'FRA', dest: 'LHR' },
	{ origin: 'MUC', dest: 'LHR' }
];

const PASSENGER_NAMES = [
	{ display: 'Müller, Andreas', email: 'andreas.mueller@example.de', lang: 'de' },
	{ display: 'Schmidt, Petra', email: 'p.schmidt@webmail.com', lang: 'de' },
	{ display: 'Johnson, Claire', email: 'claire.j@globalmail.io', lang: 'en' },
	{ display: 'Novak, Jan', email: 'jan.novak@posta.cz', lang: 'cz' },
	{ display: 'Ferreira, Sofia', email: 'sofia.ferreira@correio.pt', lang: 'pt' }
];

const PNR_POOL = ['XYZ891', 'ABC123', 'LMN456', 'PQR789', 'DEF321'];

async function getLHToken(): Promise<string> {
	const body = new URLSearchParams({
		client_id: env.LH_CLIENT_ID ?? '',
		client_secret: env.LH_CLIENT_SECRET ?? '',
		grant_type: 'client_credentials'
	});
	const res = await fetch(`${BASE_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});
	const data = await res.json();
	if (!data.access_token) throw new Error('LH auth failed: ' + JSON.stringify(data));
	return data.access_token;
}

interface RawFlight {
	flightNumber: string;
	origin: string;
	dest: string;
	depScheduled: string; // local datetime string from API
	statusCode: string; // FlightStatus code: NA, LD, DP, FE, CD, etc.
	depTimeStatusCode: string; // Departure TimeStatus code: OT, DL, FE, NI, NO
}

// Scan all departures from a hub airport starting at 06:00 today,
// return only flights with DL (delayed) or CD (cancelled) departure status.
async function getDelayedDepartures(token: string, airport: string, date: string): Promise<RawFlight[]> {
	const fromDateTime = `${date}T06:00`;
	const res = await fetch(
		`${BASE_URL}/operations/flightstatus/departures/${airport}/${fromDateTime}?limit=100`,
		{ headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } }
	);
	if (!res.ok) return [];
	const data = await res.json();
	const raw = data?.FlightStatusResource?.Flights?.Flight;
	if (!raw) return [];
	const list: any[] = Array.isArray(raw) ? raw : [raw];
	return list
		.filter((f) => f.Departure?.TimeStatus?.Code === 'DL' || f.FlightStatus?.Code === 'CD')
		.map((f) => ({
			flightNumber: f.MarketingCarrier.AirlineID + f.MarketingCarrier.FlightNumber,
			origin: f.Departure.AirportCode,
			dest: f.Arrival.AirportCode,
			depScheduled: f.Departure.ScheduledTimeLocal?.DateTime ?? '',
			statusCode: f.FlightStatus?.Code ?? 'NA',
			depTimeStatusCode: f.Departure?.TimeStatus?.Code ?? 'NA'
		}));
}

// Fallback: grab a few scheduled flights from a specific route
async function getRouteFlights(token: string, origin: string, dest: string, date: string): Promise<RawFlight[]> {
	const res = await fetch(`${BASE_URL}/operations/flightstatus/route/${origin}/${dest}/${date}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	if (!res.ok) return [];
	const data = await res.json();
	const raw = data?.FlightStatusResource?.Flights?.Flight;
	if (!raw) return [];
	const list = Array.isArray(raw) ? raw : [raw];
	return list.map((f: any) => ({
		flightNumber: f.MarketingCarrier.AirlineID + f.MarketingCarrier.FlightNumber,
		origin: f.Departure.AirportCode,
		dest: f.Arrival.AirportCode,
		depScheduled: f.Departure.ScheduledTimeLocal?.DateTime ?? '',
		statusCode: f.FlightStatus?.Code ?? 'NA',
		depTimeStatusCode: f.Departure?.TimeStatus?.Code ?? 'NA'
	}));
}

function parseDateTime(dt: string | undefined): string {
	if (!dt) return 'N/A';
	const d = new Date(dt);
	if (isNaN(d.getTime())) return dt;
	return d.toISOString().slice(11, 16) + 'Z';
}

function minutesBetween(scheduled: string | undefined, actual: string | undefined): number {
	if (!scheduled || !actual) return 0;
	const s = new Date(scheduled).getTime();
	const a = new Date(actual).getTime();
	if (isNaN(s) || isNaN(a)) return 0;
	return Math.round((a - s) / 60000);
}

function formatVariance(minutes: number): string {
	if (minutes === 0) return 'On time';
	const sign = minutes > 0 ? '+' : '';
	const h = Math.floor(Math.abs(minutes) / 60);
	const m = Math.abs(minutes) % 60;
	if (h === 0) return `${sign}${minutes}m`;
	return `${sign}${h}h ${m}m`;
}

function calcEU261(arrivalDelayMinutes: number, flightStatusCode: string, arrTimeStatusCode?: string) {
	const isCancelled = flightStatusCode === 'CD';
	const delayHours = arrivalDelayMinutes / 60;
	if (isCancelled) return { eligible: true, verdict: 'EU261 ELIGIBLE — CANCELLATION', amount: 600 };
	if (delayHours >= 3) return { eligible: true, verdict: 'EU261 ELIGIBLE — Delay > 3 hours', amount: 600 };
	if (arrivalDelayMinutes === 0 && arrTimeStatusCode === 'DL') {
		return { eligible: false, verdict: 'DELAY IN PROGRESS — arrival not yet confirmed', amount: undefined };
	}
	return { eligible: false, verdict: 'NOT ELIGIBLE — Delay < 3 hours', amount: undefined };
}

async function fetchFlightStatus(token: string, flightNumber: string, date: string): Promise<import('$lib/types').FlightStatusData | null> {
	const res = await fetch(`${BASE_URL}/operations/flightstatus/${flightNumber}/${date}`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	if (!res.ok) return null;
	const apiData = await res.json();
	const flightRaw = Array.isArray(apiData.FlightStatusResource?.Flights?.Flight)
		? apiData.FlightStatusResource.Flights.Flight[0]
		: apiData.FlightStatusResource?.Flights?.Flight;
	if (!flightRaw) return null;

	const dep = flightRaw.Departure;
	const arr = flightRaw.Arrival;
	const flightStatusCode = flightRaw.FlightStatus?.Code ?? 'NA';

	const depBestTime = dep?.ActualTimeUTC?.DateTime ?? dep?.EstimatedTimeUTC?.DateTime;
	const arrBestTime = arr?.ActualTimeUTC?.DateTime ?? arr?.EstimatedTimeUTC?.DateTime;
	const depVariance = minutesBetween(dep?.ScheduledTimeUTC?.DateTime, depBestTime);
	const arrVariance = minutesBetween(arr?.ScheduledTimeUTC?.DateTime, arrBestTime);
	const arrIsEstimated = !arr?.ActualTimeUTC?.DateTime && !!arr?.EstimatedTimeUTC?.DateTime;

	const { eligible, verdict, amount } = calcEU261(arrVariance, flightStatusCode, arr?.TimeStatus?.Code);

	return {
		flightNumber,
		date,
		overallStatus: flightRaw.FlightStatus?.Definition ?? 'Unknown',
		overallStatusCode: flightStatusCode,
		legs: [
			{
				label: `Departure (${dep?.AirportCode ?? '—'})`,
				scheduled: parseDateTime(dep?.ScheduledTimeUTC?.DateTime),
				actual: parseDateTime(depBestTime),
				varianceMinutes: depVariance,
				varianceLabel: formatVariance(depVariance),
				statusCode: dep?.TimeStatus?.Code ?? '—'
			},
			{
				label: `Arrival (${arr?.AirportCode ?? '—'})${arrIsEstimated ? ' (est.)' : ''}`,
				scheduled: parseDateTime(arr?.ScheduledTimeUTC?.DateTime),
				actual: parseDateTime(arrBestTime),
				varianceMinutes: arrVariance,
				varianceLabel: formatVariance(arrVariance),
				statusCode: arr?.TimeStatus?.Code ?? '—'
			}
		],
		eu261Eligible: eligible,
		eu261Verdict: verdict,
		compensationAmount: amount
	};
}

function buildClaimEmail(
	flight: RawFlight,
	pnr: string,
	passenger: (typeof PASSENGER_NAMES)[number],
	date: string
): string {
	const depTime = flight.depScheduled.slice(11, 16) || 'scheduled time';
	const isLanded = ['LD', 'FE'].includes(flight.statusCode);
	const isDeparted = flight.statusCode === 'DP';
	const situationLine = isLanded
		? `The flight has since landed. However, I experienced a significant disruption.`
		: isDeparted
			? `The flight has departed but I am still awaiting confirmation of arrival times.`
			: `The flight is scheduled today and I want to document this claim proactively.`;

	return `From: ${passenger.email}
Subject: Compensation Claim - Flight ${flight.flightNumber} - ${date}

Dear Lufthansa Customer Relations,

I am writing to formally request compensation under EU Regulation 261/2004
for disruption I experienced on flight ${flight.flightNumber} on ${date}.

My booking reference is ${pnr}. I was scheduled to depart ${flight.origin}
at ${depTime} and arrive at ${flight.dest}. ${situationLine}

The disruption caused significant inconvenience and I believe I may be
entitled to compensation under EU261 depending on the actual arrival delay.

I have attached my boarding pass and booking confirmation.

Yours sincerely,
${passenger.display.split(', ').reverse().join(' ')}`;
}

export const load: PageServerLoad = async () => {
	// Try seeded claims first (generated by scripts/seed-claims.ts)
	try {
		const { default: seed } = await import('$lib/seededClaims.json', { assert: { type: 'json' } });
		if (seed?.claims?.length) {
			return { claims: seed.claims as Claim[] };
		}
	} catch {
		// seed file not present yet — fall through to live API
	}

	// Live API fallback
	if (!env.LH_CLIENT_ID || !env.LH_CLIENT_SECRET) {
		throw new Error(
			'No Lufthansa API credentials configured. Please run:\n' +
				'  npx tsx scripts/seed-claims.ts\n' +
				'or set LH_CLIENT_ID and LH_CLIENT_SECRET environment variables.'
		);
	}

	const today = new Date().toISOString().slice(0, 10);

	try {
		const token = await getLHToken();

		const hubResults = await Promise.all(
			HUB_AIRPORTS.map((airport) => getDelayedDepartures(token, airport, today))
		);
		const delayed = dedupe(hubResults.flat());

		let nonDelayed: RawFlight[] = [];
		if (delayed.length < 5) {
			const routeResults = await Promise.all(
				FALLBACK_ROUTES.map((r) => getRouteFlights(token, r.origin, r.dest, today))
			);
			nonDelayed = dedupe(routeResults.flat()).filter(
				(f) => !delayed.find((d) => d.flightNumber === f.flightNumber)
			);
		}

		const picks = [...delayed, ...nonDelayed].slice(0, 5);

		const flightStatusMap = new Map<string, import('$lib/types').FlightStatusData | null>();
		await Promise.all(
			picks
				.filter((f) => f.depTimeStatusCode === 'DL' || ['LD', 'DP', 'FE'].includes(f.statusCode))
				.map(async (f) => {
					const status = await fetchFlightStatus(token, f.flightNumber, today);
					flightStatusMap.set(f.flightNumber, status);
				})
		);

		const claims: Claim[] = picks.map((flight, i) => ({
			id: `CASE-${today.slice(0, 4)}-${String(900 + i + 1).padStart(4, '0')}`,
			receivedAt: new Date(Date.now() - 1000 * 60 * (10 + i * 25)).toISOString(),
			passenger: PASSENGER_NAMES[i % PASSENGER_NAMES.length].display,
			pnr: PNR_POOL[i % PNR_POOL.length],
			slaBreached: i >= 2,
			status: 'pending',
			rawEmail: buildClaimEmail(
				flight,
				PNR_POOL[i % PNR_POOL.length],
				PASSENGER_NAMES[i % PASSENGER_NAMES.length],
				today
			),
			flightStatus: flightStatusMap.get(flight.flightNumber) ?? undefined
		}));

		return { claims };
	} catch (err) {
		console.error('LH API error:', err);
		throw new Error(
			'Failed to fetch live data. Please run:\n' +
				'  npx tsx scripts/seed-claims.ts\n' +
				'to generate seeded data from the Lufthansa API.'
		);
	}
};

function dedupe(flights: RawFlight[]): RawFlight[] {
	const seen = new Set<string>();
	return flights.filter((f) => {
		if (seen.has(f.flightNumber)) return false;
		seen.add(f.flightNumber);
		return true;
	});
}
