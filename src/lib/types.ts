export interface Claim {
	id: string;
	receivedAt: string; // ISO timestamp
	passenger: string; // "Last, First"
	pnr: string;
	rawEmail: string;
	slaBreached: boolean;
	status: 'pending' | 'approved' | 'rejected' | 'resolved';
	extracted?: ExtractedData;
	flightStatus?: FlightStatusData;
	draftReply?: string;
}

export interface ExtractedData {
	flightNumber: string; // e.g. "LH400"
	date: string; // YYYY-MM-DD
	reason: 'DELAY' | 'CANCELLATION' | 'DENIED_BOARDING' | 'UNKNOWN';
	origin?: string;
	destination?: string;
	confidence: 'high' | 'medium' | 'low';
}

export interface FlightLeg {
	label: string;
	scheduled: string;
	actual: string;
	varianceMinutes: number;
	varianceLabel: string;
	statusCode: string;
}

export interface FlightStatusData {
	flightNumber: string;
	date: string;
	overallStatus: string;
	overallStatusCode: string;
	legs: FlightLeg[];
	eu261Eligible: boolean;
	eu261Verdict: string;
	compensationAmount?: number; // EUR
}

export type ParseClaimResponse =
	| { success: true; data: ExtractedData }
	| { success: false; error: string };

export type VerifyFlightResponse =
	| { success: true; data: FlightStatusData }
	| { success: false; error: string };
