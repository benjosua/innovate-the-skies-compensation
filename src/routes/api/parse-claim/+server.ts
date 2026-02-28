import { json } from '@sveltejs/kit';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const ExtractedDataSchema = z.object({
	flightNumber: z.string().describe('IATA flight number e.g. LH400'),
	date: z.string().describe('Flight date in YYYY-MM-DD format'),
	reason: z
		.enum(['DELAY', 'CANCELLATION', 'DENIED_BOARDING', 'UNKNOWN'])
		.describe('Primary reason for the EU261 claim'),
	origin: z.string().optional().describe('IATA departure airport code e.g. FRA'),
	destination: z.string().optional().describe('IATA arrival airport code e.g. JFK'),
	confidence: z
		.enum(['high', 'medium', 'low'])
		.describe('Confidence in extraction accuracy based on email clarity')
});

export const POST: RequestHandler = async ({ request }) => {
	const { emailText } = await request.json();

	if (!emailText || typeof emailText !== 'string') {
		return json({ success: false, error: 'Missing emailText' }, { status: 400 });
	}

	const google = createGoogleGenerativeAI({
		apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY ?? env.VITE_GEMINI_API_KEY
	});

	try {
		const { object } = await generateObject({
			model: google('gemini-2.0-flash'),
			schema: ExtractedDataSchema,
			prompt: `You are an airline customer relations AI. Extract the following structured data from this customer compensation email.

For the flight date: if the customer mentions a date like "November 1st, 2023" or "01.11.2023", convert it to YYYY-MM-DD format.
For the flight number: extract the IATA code (2-letter airline code + number), e.g. "LH400", "LH1234".
For reason: DELAY means the flight departed/arrived late, CANCELLATION means the flight was cancelled, DENIED_BOARDING means the passenger was refused to board.

Email text:
${emailText}`
		});

		return json({ success: true, data: object });
	} catch (err) {
		console.error('AI extraction error:', err);
		return json({ success: false, error: 'AI extraction failed' }, { status: 500 });
	}
};
