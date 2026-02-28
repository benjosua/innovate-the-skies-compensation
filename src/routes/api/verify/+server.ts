import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { FlightStatusData, FlightLeg } from '$lib/types';
import { env } from '$env/dynamic/private';

const BASE_URL = 'https://api.lufthansa.com/v1';

async function getAuthToken(): Promise<string> {
	const body = new URLSearchParams();
	body.append('client_id', env.LH_CLIENT_ID ?? '');
	body.append('client_secret', env.LH_CLIENT_SECRET ?? '');
	body.append('grant_type', 'client_credentials');

	const response = await fetch(`${BASE_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: body.toString()
	});

	const data = await response.json();
	if (!data.access_token) throw new Error('Failed to get auth token');
	return data.access_token;
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

function calcEU261(arrivalDelayMinutes: number, flightStatusCode: string, arrTimeStatusCode?: string): { eligible: boolean; verdict: string; amount?: number } {
	const isCancelled = flightStatusCode === 'CD';
	const delayHours = arrivalDelayMinutes / 60;

	if (isCancelled) {
		return { eligible: true, verdict: 'EU261 ELIGIBLE — CANCELLATION', amount: 600 };
	}

	if (delayHours >= 3) {
		return { eligible: true, verdict: 'EU261 ELIGIBLE — Delay > 3 hours', amount: 600 };
	}

	// Flight still in air with a confirmed delay status but no actual arrival yet
	if (arrivalDelayMinutes === 0 && arrTimeStatusCode === 'DL') {
		return { eligible: false, verdict: 'DELAY IN PROGRESS — arrival not yet confirmed' };
	}

	return { eligible: false, verdict: 'NOT ELIGIBLE — Delay < 3 hours' };
}

export const POST: RequestHandler = async ({ request }) => {
	const { flightNumber, date } = await request.json();

	if (!flightNumber || !date) {
		return json({ success: false, error: 'Missing flightNumber or date' }, { status: 400 });
	}

	if (!env.LH_CLIENT_ID || !env.LH_CLIENT_SECRET) {
		return json({ success: false, error: 'Lufthansa API credentials not configured' }, { status: 503 });
	}

	const token = await getAuthToken();
	const url = `${BASE_URL}/operations/flightstatus/${flightNumber}/${date}`;

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});

	if (!response.ok) {
		const text = await response.text();
		return json({ success: false, error: `Lufthansa API error ${response.status}: ${text}` }, { status: response.status });
	}

	const apiData = await response.json();
	const flightRaw = Array.isArray(apiData.FlightStatusResource?.Flights?.Flight)
		? apiData.FlightStatusResource.Flights.Flight[0]
		: apiData.FlightStatusResource?.Flights?.Flight;

	if (!flightRaw) {
		return json({ success: false, error: 'No flight data returned' }, { status: 404 });
	}

	const dep = flightRaw.Departure;
	const arr = flightRaw.Arrival;
	const flightStatusCode = flightRaw.FlightStatus?.Code ?? 'NA';

	// Use actual time when available, fall back to estimated (e.g. flight still in air)
	const depBestTime = dep?.ActualTimeUTC?.DateTime ?? dep?.EstimatedTimeUTC?.DateTime;
	const arrBestTime = arr?.ActualTimeUTC?.DateTime ?? arr?.EstimatedTimeUTC?.DateTime;

	const depVariance = minutesBetween(dep?.ScheduledTimeUTC?.DateTime, depBestTime);
	const arrVariance = minutesBetween(arr?.ScheduledTimeUTC?.DateTime, arrBestTime);
	const arrIsEstimated = !arr?.ActualTimeUTC?.DateTime && !!arr?.EstimatedTimeUTC?.DateTime;

	const legs: FlightLeg[] = [
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
	];

	const { eligible, verdict, amount } = calcEU261(arrVariance, flightStatusCode, arr?.TimeStatus?.Code);

	const result: FlightStatusData = {
		flightNumber,
		date,
		overallStatus: flightRaw.FlightStatus?.Definition ?? 'Unknown',
		overallStatusCode: flightStatusCode,
		legs,
		eu261Eligible: eligible,
		eu261Verdict: verdict,
		compensationAmount: amount
	};

	return json({ success: true, data: result });
};
