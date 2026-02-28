#!/usr/bin/env -S npx tsx

import { writeFileSync } from 'fs';
import { resolve } from 'path';

const BASE_URL = 'https://api.lufthansa.com/v1';
const HUB_AIRPORTS = ['FRA', 'MUC', 'DUS', 'HAM', 'BER', 'CGN'];

// Expand passenger pool so we don't have too many duplicates in a large dataset
const PASSENGER_NAMES = [
	{ display: 'Müller, Andreas', email: 'andreas.mueller@example.de' },
	{ display: 'Schmidt, Petra', email: 'p.schmidt@webmail.com' },
	{ display: 'Johnson, Claire', email: 'claire.j@globalmail.io' },
	{ display: 'Novak, Jan', email: 'jan.novak@posta.cz' },
	{ display: 'Ferreira, Sofia', email: 'sofia.ferreira@correio.pt' },
	{ display: 'Dubois, Lucas', email: 'ldubois@france.fr' },
	{ display: 'Rossi, Giulia', email: 'giulia.rossi@italia.it' },
	{ display: 'Kim, Min-jun', email: 'mj.kim@seoul.kr' }
];

// Configuration
const SCAN_HOURS_BACK = 72; // Look back over the last 3 days
const WINDOW_SIZE_HRS = 4; // API native chunk size
const DELAY_BETWEEN_CHUNKS_MS = 500; // Prevent 403 Rate Limit Exceeded

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getToken(): Promise<string> {
	const clientId = process.env.LH_CLIENT_ID;
	const clientSecret = process.env.LH_CLIENT_SECRET;
	const res = await fetch(`${BASE_URL}/oauth/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ client_id: clientId!, client_secret: clientSecret!, grant_type: 'client_credentials' }).toString()
	});
	const data = await res.json() as any;
	if (!data.access_token) throw new Error("Failed to get token: " + JSON.stringify(data));
	return data.access_token;
}

function minutesBetween(scheduled?: string, actual?: string): number {
	if (!scheduled || !actual) return 0;
	const diff = (new Date(actual).getTime() - new Date(scheduled).getTime()) / 60000;
	return isNaN(diff) ? 0 : Math.round(diff);
}

// Generate an array of ISO strings representing 4-hour chunks in the past
function generateTimeWindows(): string[] {
	const windows: string[] = [];
	const now = new Date();
	for (let i = WINDOW_SIZE_HRS; i <= SCAN_HOURS_BACK; i += WINDOW_SIZE_HRS) {
		const d = new Date(now.getTime() - i * 60 * 60 * 1000);
		windows.push(d.toISOString().slice(0, 16)); // YYYY-MM-DDTHH:mm
	}
	return windows;
}

async function getHighlyDelayedArrivals(token: string, airport: string, isoDateTime: string) {
	const res = await fetch(`${BASE_URL}/operations/flightstatus/arrivals/${airport}/${isoDateTime}?limit=100`, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
	});
	
	if (!res.ok) return [];
	const data = await res.json() as any;
	const raw = data?.FlightStatusResource?.Flights?.Flight;
	if (!raw) return [];
	
	const list: any[] = Array.isArray(raw) ? raw : [raw];
	const eu261Candidates: any[] = [];

	for (const f of list) {
		const arr = f.Arrival;
		const schedTime = arr?.ScheduledTimeUTC?.DateTime;
		const actualTime = arr?.ActualTimeUTC?.DateTime || arr?.EstimatedTimeUTC?.DateTime;
		const delayMins = minutesBetween(schedTime, actualTime);
		
		const isCancelled = f.FlightStatus?.Code === 'CD';
		const isDiverted = f.FlightStatus?.Code === 'DV'; 
		const isDelayed3Hours = delayMins >= 180;

		if (isCancelled || isDelayed3Hours || isDiverted) {
			eu261Candidates.push({
				flightNumber: f.MarketingCarrier.AirlineID + f.MarketingCarrier.FlightNumber,
				origin: f.Departure.AirportCode,
				dest: f.Arrival.AirportCode,
				scheduledDeparture: f.Departure?.ScheduledTimeLocal?.DateTime,
				scheduledArrival: schedTime,
				actualArrival: actualTime,
				delayMins: delayMins,
				statusCode: f.FlightStatus?.Code ?? 'NA',
				statusText: f.FlightStatus?.Definition ?? 'Unknown'
			});
		}
	}
	
	return eu261Candidates;
}

function buildEmail(flight: any, pnr: string, passenger: typeof PASSENGER_NAMES[number]): string {
	const date = flight.scheduledArrival?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
	const depTime = flight.scheduledDeparture?.slice(11, 16) ?? 'scheduled time';
	const isCancelled = flight.statusCode === 'CD';
	const delayHours = Math.floor(flight.delayMins / 60);
	const delayMinsRem = flight.delayMins % 60;
	const delayStr = delayHours > 0 ? `${delayHours} hour${delayHours > 1 ? 's' : ''} and ${delayMinsRem} minutes` : `${flight.delayMins} minutes`;

	const situation = isCancelled
		? `The flight was cancelled without adequate notice, causing me to miss onward connections and pre-paid arrangements at my destination.`
		: `The flight arrived approximately ${delayStr} late at ${flight.dest}, well beyond the 3-hour threshold for statutory compensation under EU261.`;

	return `From: ${passenger.email}
Subject: Compensation Claim - Flight ${flight.flightNumber} - ${date}

Dear Lufthansa Customer Relations,

I am writing to formally request compensation under EU Regulation 261/2004
for the disruption I experienced on flight ${flight.flightNumber} on ${date}.

My booking reference is ${pnr}. I was scheduled to depart ${flight.origin}
at ${depTime} and arrive at ${flight.dest}. ${situation}

${isCancelled
	? 'As the flight was cancelled, I am entitled to a full refund or re-routing and statutory compensation under Article 7.'
	: `Given the arrival delay exceeded 3 hours, I am entitled to compensation of €600 under Article 7 of EU Regulation 261/2004.`}

I have attached my boarding pass and booking confirmation for your review.

Yours sincerely,
${passenger.display.split(', ').reverse().join(' ')}`;
}

// Generate random PNRs to match the larger volume of flights
function generatePNR() {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let pnr = '';
	for (let i = 0; i < 6; i++) pnr += chars.charAt(Math.floor(Math.random() * chars.length));
	return pnr;
}

async function main() {
	console.log('Fetching Lufthansa API token...');
	const token = await getToken();

	const timeWindows = generateTimeWindows();
	console.log(`\nGenerated ${timeWindows.length} time windows. Scanning last ${SCAN_HOURS_BACK} hours...`);
	
	const allDelayedFlights: any[] = [];

	// Loop time windows sequentially to avoid rate limiting, but do hubs in parallel
	for (let i = 0; i < timeWindows.length; i++) {
		const isoTime = timeWindows[i];
		process.stdout.write(`\rScanning window ${i + 1}/${timeWindows.length} (${isoTime}) ...`);
		
		const hubResults = await Promise.all(HUB_AIRPORTS.map(a => getHighlyDelayedArrivals(token, a, isoTime)));
		allDelayedFlights.push(...hubResults.flat());
		
		await sleep(DELAY_BETWEEN_CHUNKS_MS); // Be nice to the API
	}
    
	// Deduplicate using Flight Number + Date (Because a flight number operates every day)
	const allUnique = Array.from(
		new Map(allDelayedFlights.map(item => [`${item.flightNumber}-${item.scheduledArrival?.slice(0,10)}`, item])).values()
	);

	// Cap cancelled flights at 2, rest should be delays
	const cancelled = allUnique.filter(f => f.statusCode === 'CD').slice(0, 2);
	const delayed = allUnique.filter(f => f.statusCode !== 'CD');
	const uniqueDelayed = [...delayed, ...cancelled];

	console.log(`\n\nFound ${allUnique.length} EU261 eligible flight(s) — using ${delayed.length} delayed + ${cancelled.length} cancelled.\n`);
	
	const claims = uniqueDelayed.map((flight, i) => {
		const passenger = PASSENGER_NAMES[i % PASSENGER_NAMES.length];
        
		if (i < 15) { // Only log the first 15 so we don't spam the console
			console.log(`  -> ${flight.flightNumber}: ${flight.origin} to ${flight.dest} | ${flight.statusText} (${flight.delayMins} min delay)`);
		} else if (i === 15) {
			console.log(`  -> ... and ${uniqueDelayed.length - 15} more`);
		}

		const pnr = generatePNR();
		return {
			id: `CASE-${flight.scheduledArrival?.slice(0, 4) || new Date().getFullYear()}-${String(900 + i + 1).padStart(4, '0')}`,
			receivedAt: new Date(Date.now() - 1000 * 60 * (10 + i * 25)).toISOString(),
			passenger: passenger.display,
			pnr,
			slaBreached: i % 3 === 0,
			status: 'pending',
			rawEmail: buildEmail(flight, pnr, passenger),
			flightStatus: {
				flightNumber: flight.flightNumber,
				overallStatus: flight.statusText,
				overallStatusCode: flight.statusCode,
				eu261Eligible: true,
				eu261Verdict: flight.statusCode === 'CD'
					? 'EU261 ELIGIBLE — CANCELLATION'
					: `EU261 ELIGIBLE — Delay > 3 hours`,
				compensationAmount: 600
			}
		};
	});

	const outPath = resolve(process.cwd(), 'src/lib/seededClaims.json');
	writeFileSync(outPath, JSON.stringify({ seededAt: new Date().toISOString(), claims }, null, 2));

	console.log(`\n✅ Written ${claims.length} EU261 claims to src/lib/seededClaims.json`);
}

main().catch((err) => { console.error(err); process.exit(1); });