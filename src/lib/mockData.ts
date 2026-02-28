import type { Claim } from './types';

export const mockClaims: Claim[] = [
	{
		id: 'CASE-2026-0891',
		receivedAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
		passenger: 'Müller, Andreas',
		pnr: 'XYZ891',
		slaBreached: false,
		status: 'pending',
		rawEmail: `From: andreas.mueller@example.de
Subject: Compensation Claim - Flight LH404 - 2026-02-28

Dear Lufthansa Customer Relations,

I am writing to formally request compensation under EU Regulation 261/2004
for the significant delay I experienced on flight LH404 on February 28th, 2026.

My booking reference is XYZ891. I was scheduled to depart Frankfurt (FRA)
at 17:15 and arrive at New York JFK at 20:10 local time. However, our
departure was delayed by over three hours due to what was announced as a
technical defect on the aircraft.

This disruption caused me to miss a critical business meeting, resulting
in demonstrable financial losses. Given the delay exceeded 3 hours at
arrival, I believe I am entitled to €600 under EU261.

I have attached my boarding pass and booking confirmation.

Yours sincerely,
Andreas Müller`
	},
	{
		id: 'CASE-2026-0892',
		receivedAt: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
		passenger: 'Schmidt, Petra',
		pnr: 'ABC123',
		slaBreached: false,
		status: 'pending',
		rawEmail: `From: p.schmidt@webmail.com
Subject: Flight LH110 delayed - need compensation - 2026-02-28

Hello,

My flight LH110 from Frankfurt (FRA) to Munich (MUC) scheduled
for February 28th 2026 was significantly delayed. I received
no adequate assistance during the wait at the airport.

PNR: ABC123

The flight was scheduled to depart at 15:15 but departed late.
I missed a connecting train and a pre-paid hotel booking. I am claiming
statutory compensation under EU Regulation 261/2004.

Please process this at your earliest convenience.

Best,
Petra Schmidt`
	},
	{
		id: 'CASE-2026-0893',
		receivedAt: new Date(Date.now() - 1000 * 60 * 67).toISOString(),
		passenger: 'Johnson, Claire',
		pnr: 'LMN456',
		slaBreached: true,
		status: 'pending',
		rawEmail: `From: claire.j@globalmail.io
Subject: RE: Denied boarding LH1040 - FRA to CDG - 28 February 2026

To Whom It May Concern,

This is my second email as I have not received a response to my initial
claim filed three weeks ago (ticket ref: LMN456).

On February 28, 2026, I was involuntarily denied boarding on flight LH1040
from Frankfurt (FRA) to Paris Charles de Gaulle (CDG) due to overbooking.
The gate agent confirmed the flight was oversold. I was offered a voucher
of €75, which I did not accept as it does not reflect my legal entitlement.

For a flight distance of approximately 480km, I am entitled to €250 under
Article 7 of Regulation EC 261/2004. I am also seeking reimbursement of
€42 for a meal I had to purchase while waiting for the next available flight.

Please escalate this immediately.

Regards,
Claire Johnson`
	},
	{
		id: 'CASE-2026-0894',
		receivedAt: new Date(Date.now() - 1000 * 60 * 95).toISOString(),
		passenger: 'Novak, Jan',
		pnr: 'PQR789',
		slaBreached: true,
		status: 'pending',
		rawEmail: `From: jan.novak@posta.cz
Subject: Zpozden let / Delayed flight LH1397 Praha-Frankfurt 28.02.2026

Dear Sir or Madam,

I am writing regarding flight LH1397 from Prague (PRG) to Frankfurt (FRA)
on February 28, 2026. My booking reference is PQR789.

The flight was delayed significantly. Departure was scheduled at 15:10
but we did not depart on time. No meal vouchers were provided during
the wait despite multiple requests to airport staff.

I request compensation of €250 per EU Regulation 261/2004 and reimbursement
of €23.50 for food and beverages I purchased at the airport.

I look forward to your reply.

Jan Novák`
	},
	{
		id: 'CASE-2026-0895',
		receivedAt: new Date(Date.now() - 1000 * 60 * 142).toISOString(),
		passenger: 'Ferreira, Sofia',
		pnr: 'DEF321',
		slaBreached: true,
		status: 'pending',
		rawEmail: `From: sofia.ferreira@correio.pt
Subject: Compensation Claim - Delayed flight LH910 - Frankfurt to London - 2026-02-28

Good afternoon,

I am submitting a claim for a delayed departure on February 28, 2026.
I was booked on LH910 from Frankfurt (FRA) to London Heathrow (LHR)
under single booking reference DEF321.

The flight was scheduled to depart at 15:10 but departed late, causing
me to miss a connecting service and arrive at my final destination
several hours behind schedule.

Given the disruption on a flight distance exceeding 1,500 km,
I believe I am entitled to compensation of €400 per passenger
under EU Regulation 261/2004. I am travelling alone.

I have all relevant documentation available.

Kind regards,
Sofia Ferreira`
	}
];
