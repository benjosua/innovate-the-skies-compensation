<script lang="ts">
	import type { PageData } from './$types';
	import type {
		Claim,
		ParseClaimResponse,
		VerifyFlightResponse
	} from '$lib/types';

	let { data }: { data: PageData } = $props();

	// --- State ---
	let claims = $state<Claim[]>(data.claims);
	let selectedId = $state<string | null>(data.claims[0]?.id ?? null);
	let parsing = $state(false);
	let verifying = $state(false);
	let actionTaken = $state<'approve' | 'reject' | null>(null);
	let draftReply = $state('');

	// Derived selected claim
	let selected = $derived(claims.find((c) => c.id === selectedId) ?? null);

	// --- Helpers ---
	function formatTime(iso: string) {
		const d = new Date(iso);
		return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
	}

	function formatDate(iso: string) {
		const d = new Date(iso);
		return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
	}

	function varianceClass(minutes: number) {
		if (minutes >= 180) return 'text-red-700 font-semibold';
		if (minutes >= 60) return 'text-amber-700 font-semibold';
		if (minutes > 0) return 'text-amber-600';
		return 'text-green-700';
	}

	function statusCodeLabel(code: string) {
		const map: Record<string, string> = {
			DL: 'DL — Delayed',
			CD: 'CD — Cancelled',
			OT: 'OT — On Time',
			LD: 'LD — Landed',
			'—': '—'
		};
		return map[code] ?? code;
	}

	// --- Actions ---
	async function parseClaim() {
		if (!selected) return;
		parsing = true;
		actionTaken = null;
		draftReply = '';

		try {
			const res = await fetch('/api/parse-claim', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ emailText: selected.rawEmail })
			});
			const result: ParseClaimResponse = await res.json();
			if (result.success) {
				claims = claims.map((c) =>
					c.id === selected!.id ? { ...c, extracted: result.data, flightStatus: undefined } : c
				);
			}
		} finally {
			parsing = false;
		}
	}

	async function verifyFlight() {
		if (!selected?.extracted) return;
		verifying = true;

		try {
			const res = await fetch('/api/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					flightNumber: selected.extracted.flightNumber,
					date: selected.extracted.date
				})
			});
			const result: VerifyFlightResponse = await res.json();
			if (result.success) {
				claims = claims.map((c) =>
					c.id === selected!.id ? { ...c, flightStatus: result.data } : c
				);
			}
		} finally {
			verifying = false;
		}
	}

	function buildDraftReply(decision: 'approve' | 'reject') {
		if (!selected) return '';
		const fs = selected.flightStatus;
		const ex = selected.extracted;
		const passengerFirst = selected.passenger.split(', ').reverse().join(' ');

		if (decision === 'approve') {
			return `Dear ${passengerFirst},

Thank you for contacting Lufthansa Customer Relations regarding your recent travel experience.

We have reviewed your claim for flight ${ex?.flightNumber ?? '[FLIGHT]'} on ${ex?.date ?? '[DATE]'} and confirmed the disruption via our Operations Systems.

${fs?.eu261Verdict ?? ''}

In accordance with EU Regulation 261/2004, we are pleased to confirm that you are entitled to compensation of €${fs?.compensationAmount ?? '—'}.

You will receive a separate communication with the payment details within 14 business days.

We sincerely apologise for the inconvenience caused and thank you for your patience.

Kind regards,
Lufthansa Customer Relations`;
		} else {
			return `Dear ${passengerFirst},

Thank you for contacting Lufthansa Customer Relations.

We have carefully reviewed your claim for flight ${ex?.flightNumber ?? '[FLIGHT]'} on ${ex?.date ?? '[DATE]'}.

Having examined our operational records, we have determined that the disruption was caused by extraordinary circumstances beyond our control, as defined under Article 5(3) of EU Regulation 261/2004. Accordingly, we are unable to provide statutory compensation in this instance.

However, we remain committed to your satisfaction and encourage you to contact us if you have further questions.

Kind regards,
Lufthansa Customer Relations`;
		}
	}

	function takeAction(decision: 'approve' | 'reject') {
		actionTaken = decision;
		draftReply = buildDraftReply(decision);
	}

	function resolveCase() {
		if (!selected) return;
		const newStatus = actionTaken === 'approve' ? 'approved' : 'rejected';
		claims = claims.map((c) =>
			c.id === selected!.id
				? { ...c, status: newStatus as Claim['status'], draftReply }
				: c
		);
		// Move to next pending
		const nextPending = claims.find((c) => c.status === 'pending' && c.id !== selected!.id);
		selectedId = nextPending?.id ?? null;
		actionTaken = null;
		draftReply = '';
	}
</script>

<div class="flex h-screen flex-col overflow-hidden font-sans text-[13px] text-slate-800">
	<!-- HEADER -->
	<header class="flex shrink-0 items-center justify-between bg-[#05164D] px-5 py-2.5 text-white">
		<div class="flex items-center gap-4">
			<span class="text-[11px] font-bold uppercase tracking-widest text-sky-300">Lufthansa</span>
			<span class="text-[11px] text-white/40">|</span>
			<span class="text-[11px] font-medium uppercase tracking-wider text-white/80"
				>Customer Resolution Center</span
			>
		</div>
		<div class="flex items-center gap-5 text-[11px] text-white/60">
			<span
				>Queue: <strong class="text-white"
					>{claims.filter((c) => c.status === 'pending').length}</strong
				></span
			>
			<span
				>Processed: <strong class="text-white"
					>{claims.filter((c) => c.status !== 'pending').length}</strong
				></span
			>
			<span class="text-white/30">|</span>
			<span class="text-white/50">Agent: J. Weber</span>
		</div>
	</header>

	<!-- MAIN LAYOUT -->
	<div class="flex min-h-0 flex-1">
		<!-- LEFT: QUEUE PANE -->
		<aside class="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
			<div
				class="border-b border-slate-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400"
			>
				Incoming Queue
			</div>
			<ul class="flex-1 overflow-y-auto">
				{#each claims as claim (claim.id)}
					<li>
						<button
							onclick={() => {
								selectedId = claim.id;
								actionTaken = null;
								draftReply = '';
							}}
							class="w-full border-b border-slate-100 px-3 py-2.5 text-left transition-colors
                {selectedId === claim.id
								? 'border-l-2 border-l-[#05164D] bg-slate-50'
								: 'border-l-2 border-l-transparent hover:bg-slate-50/60'}
                {claim.status !== 'pending' ? 'opacity-50' : ''}"
						>
							<div class="flex items-center justify-between">
								<span class="font-medium text-slate-700">{claim.passenger}</span>
								<span class="flex items-center gap-1">
									{#if claim.slaBreached}
										<span class="h-1.5 w-1.5 rounded-full bg-red-500" title="SLA Breached"></span>
									{:else}
										<span class="h-1.5 w-1.5 rounded-full bg-green-500" title="Within SLA"></span>
									{/if}
								</span>
							</div>
							<div class="mt-0.5 flex items-center justify-between text-[11px] text-slate-400">
								<span class="font-mono">{claim.pnr}</span>
								<span>{formatTime(claim.receivedAt)}</span>
							</div>
							{#if claim.flightStatus}
								{@const fs = claim.flightStatus}
								<div class="mt-1.5 flex items-center gap-1.5">
									{#if fs.eu261Eligible}
										<span class="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
											EU261
										</span>
									{/if}
									<span class="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
										{fs.overallStatusCode}
									</span>
									{#if fs.legs?.[1]?.varianceMinutes > 0}
										<span class="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700">
											{fs.legs[1].varianceLabel}
										</span>
									{:else if fs.legs?.[1]?.varianceMinutes < 0}
										<span class="rounded bg-green-50 px-1.5 py-0.5 font-mono text-[10px] text-green-700">
											{fs.legs[1].varianceLabel}
										</span>
									{/if}
								</div>
							{/if}
							{#if claim.status !== 'pending'}
								<div
									class="mt-0.5 text-[10px] uppercase tracking-wide {claim.status === 'approved'
										? 'text-green-600'
										: 'text-red-500'}"
								>
									{claim.status}
								</div>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		</aside>

		<!-- RIGHT: WORKSPACE -->
		{#if selected}
			<main class="flex min-h-0 flex-1 flex-col overflow-y-auto bg-slate-50">
				<!-- Case header bar -->
				<div
					class="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 py-2.5"
				>
					<div class="flex items-center gap-3">
						<span class="font-mono text-[11px] font-semibold text-slate-500">{selected.id}</span>
						<span class="text-slate-300">|</span>
						<span class="font-medium text-slate-700">{selected.passenger}</span>
						<span class="text-slate-300">|</span>
						<span class="font-mono text-[11px] text-slate-500">{selected.pnr}</span>
					</div>
					<div class="flex items-center gap-1.5 text-[11px] text-slate-400">
						<span>{formatDate(selected.receivedAt)}</span>
						<span>{formatTime(selected.receivedAt)}</span>
						{#if selected.slaBreached}
							<span
								class="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700"
								>SLA BREACHED</span
							>
						{/if}
					</div>
				</div>

				<div class="flex flex-1 flex-col gap-3 p-5">
					<!-- SECTION 1: AI EXTRACTION -->
					<section class="rounded border border-slate-200 bg-white">
						<div class="flex items-center justify-between border-b border-slate-100 px-4 py-2">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-slate-400"
								>Case Details &amp; AI Extraction</span
							>
							<button
								onclick={parseClaim}
								disabled={parsing}
								class="rounded border border-[#05164D] bg-white px-3 py-1 text-[11px] font-medium text-[#05164D] transition-colors hover:bg-[#05164D] hover:text-white disabled:opacity-40"
							>
								{parsing ? 'Parsing...' : 'Parse with Gemini'}
							</button>
						</div>

						<div class="grid grid-cols-2 divide-x divide-slate-100">
							<!-- Extracted key-value grid -->
							<div class="p-4">
								{#if selected.extracted}
									{@const ex = selected.extracted}
									<dl class="grid grid-cols-2 gap-x-4 gap-y-3">
										<div>
											<dt class="text-[10px] uppercase tracking-wider text-slate-400">Flight</dt>
											<dd class="font-mono text-[13px] font-semibold text-slate-800">
												{ex.flightNumber}
											</dd>
										</div>
										<div>
											<dt class="text-[10px] uppercase tracking-wider text-slate-400">Date</dt>
											<dd class="font-mono text-[13px] text-slate-800">{ex.date}</dd>
										</div>
										<div>
											<dt class="text-[10px] uppercase tracking-wider text-slate-400">Reason</dt>
											<dd class="text-[13px] font-semibold text-slate-800">{ex.reason}</dd>
										</div>
										<div>
											<dt class="text-[10px] uppercase tracking-wider text-slate-400">Confidence</dt>
											<dd
												class="text-[13px] font-medium capitalize {ex.confidence === 'high'
													? 'text-green-700'
													: ex.confidence === 'medium'
														? 'text-amber-700'
														: 'text-red-700'}"
											>
												{ex.confidence}
											</dd>
										</div>
										{#if ex.origin}
											<div>
												<dt class="text-[10px] uppercase tracking-wider text-slate-400">Origin</dt>
												<dd class="font-mono text-[13px] text-slate-800">{ex.origin}</dd>
											</div>
										{/if}
										{#if ex.destination}
											<div>
												<dt class="text-[10px] uppercase tracking-wider text-slate-400">Destination</dt>
												<dd class="font-mono text-[13px] text-slate-800">{ex.destination}</dd>
											</div>
										{/if}
									</dl>
								{:else}
									<p class="text-[12px] italic text-slate-400">
										Click "Parse with Gemini" to extract structured data from the email.
									</p>
								{/if}
							</div>

							<!-- Raw email -->
							<div class="p-4">
								<div class="mb-1.5 text-[10px] uppercase tracking-wider text-slate-400">
									Raw Customer Email
								</div>
								<pre
									class="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-600">{selected.rawEmail}</pre>
							</div>
						</div>
					</section>

					<!-- SECTION 2: SYSTEM OF RECORD -->
					<section class="rounded border border-slate-200 bg-white">
						<div class="flex items-center justify-between border-b border-slate-100 px-4 py-2">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-slate-400"
								>System of Record — Operations API</span
							>
							<button
								onclick={verifyFlight}
								disabled={verifying || !selected.extracted}
								class="rounded border border-[#05164D] bg-white px-3 py-1 text-[11px] font-medium text-[#05164D] transition-colors hover:bg-[#05164D] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
							>
								{verifying ? 'Querying...' : 'Query Operations API'}
							</button>
						</div>

						<div class="p-4">
							{#if verifying}
								<div class="space-y-2">
									{#each [1, 2] as _}
										<div class="h-8 animate-pulse rounded bg-slate-100"></div>
									{/each}
								</div>
							{:else if selected.flightStatus}
								{@const fs = selected.flightStatus}
								<table class="w-full border-collapse text-[12px]">
									<thead>
										<tr class="border-b border-slate-200">
											<th
												class="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400"
												>Metric</th
											>
											<th
												class="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400"
												>Scheduled</th
											>
											<th
												class="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400"
												>Actual</th
											>
											<th
												class="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400"
												>Variance</th
											>
											<th
												class="pb-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400"
												>Status Code</th
											>
										</tr>
									</thead>
									<tbody>
										{#each (fs.legs ?? []) as leg}
											<tr class="border-b border-slate-100">
												<td class="py-2 font-medium text-slate-700">{leg.label}</td>
												<td class="py-2 font-mono text-slate-600">{leg.scheduled}</td>
												<td class="py-2 font-mono text-slate-600">{leg.actual}</td>
												<td class="py-2 font-mono {varianceClass(leg.varianceMinutes)}"
													>{leg.varianceLabel}</td
												>
												<td class="py-2 font-mono text-slate-600"
													>{statusCodeLabel(leg.statusCode)}</td
												>
											</tr>
										{/each}
										<tr>
											<td class="py-2 font-medium text-slate-700">Overall Flight</td>
											<td class="py-2 text-slate-400">—</td>
											<td class="py-2 text-slate-400">—</td>
											<td class="py-2 text-slate-400">—</td>
											<td class="py-2 font-mono text-slate-600"
												>{fs.overallStatusCode} — {fs.overallStatus}</td
											>
										</tr>
									</tbody>
								</table>

								<div class="mt-3 border-t border-slate-100 pt-3">
									<p
										class="text-[12px] {fs.eu261Eligible
											? 'text-green-700'
											: 'text-red-700'}"
									>
										<strong>SYSTEM VERDICT:</strong>
										{fs.eu261Verdict}
										{#if fs.compensationAmount}
											<span class="ml-2 font-mono">— €{fs.compensationAmount} per passenger</span>
										{/if}
									</p>
								</div>
							{:else}
								<p class="text-[12px] italic text-slate-400">
									{#if !selected.extracted}
										Parse the email first to extract flight details.
									{:else}
										Click "Query Operations API" to retrieve live flight status.
									{/if}
								</p>
							{/if}
						</div>
					</section>

					<!-- SECTION 3: RESOLUTION -->
					<section class="rounded border border-slate-200 bg-white">
						<div class="border-b border-slate-100 px-4 py-2">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-slate-400"
								>Resolution &amp; Action</span
							>
						</div>

						<div class="p-4">
							{#if selected.status !== 'pending'}
								<p
									class="text-[12px] font-medium {selected.status === 'approved'
										? 'text-green-700'
										: 'text-red-600'}"
								>
									Case resolved — {selected.status.toUpperCase()}
								</p>
							{:else}
								<div class="flex gap-2">
									<button
										onclick={() => takeAction('approve')}
										disabled={!selected.flightStatus}
										class="rounded px-4 py-1.5 text-[12px] font-medium transition-colors
                      {actionTaken === 'approve'
											? 'bg-[#05164D] text-white'
											: 'border border-[#05164D] bg-white text-[#05164D] hover:bg-[#05164D] hover:text-white'}
                      disabled:cursor-not-allowed disabled:opacity-40"
									>
										Approve &amp; Draft Reply
									</button>
									<button
										onclick={() => takeAction('reject')}
										disabled={!selected.flightStatus}
										class="rounded px-4 py-1.5 text-[12px] font-medium transition-colors
                      {actionTaken === 'reject'
											? 'border border-slate-600 bg-slate-600 text-white'
											: 'border border-slate-400 bg-white text-slate-600 hover:bg-slate-100'}
                      disabled:cursor-not-allowed disabled:opacity-40"
									>
										Reject &amp; Draft Reply
									</button>
								</div>

								{#if actionTaken}
									<div class="mt-3">
										<div class="mb-1 text-[10px] uppercase tracking-wider text-slate-400">
											Draft Reply — {actionTaken === 'approve' ? 'Approval' : 'Rejection'}
										</div>
										<textarea
											bind:value={draftReply}
											rows={12}
											class="w-full rounded border border-slate-200 bg-slate-50 p-2.5 font-mono text-[11px] leading-relaxed text-slate-700 outline-none focus:border-[#05164D]"
										></textarea>
										<div class="mt-2 flex justify-end">
											<button
												onclick={resolveCase}
												class="rounded bg-[#05164D] px-5 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#06297a]"
											>
												Resolve Case
											</button>
										</div>
									</div>
								{/if}
							{/if}
						</div>
					</section>
				</div>
			</main>
		{:else}
			<main class="flex flex-1 items-center justify-center bg-slate-50 text-slate-400">
				<p class="text-[12px]">Select a case from the queue to begin.</p>
			</main>
		{/if}
	</div>
</div>
