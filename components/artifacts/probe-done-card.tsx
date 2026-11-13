"use client";

import { ChevronRightIcon, ClipboardCheckIcon } from "@/components/ui/icons";
import { ToolContentResponse } from "@/components/ai-elements/message";
import { parseProbeDoneInput, type ProbeDoneResult } from "@/src/core";

export function ProbeDoneCard({ part }: { part: { input?: unknown; output?: unknown; state?: unknown } }) {
	const output = part.output as ProbeDoneResult | undefined;
	const state = typeof part.state === "string" ? part.state : "";

	const input = parseProbeDoneInput(part.input);

	const assessment = input?.assessment;
	const strands = assessment && Array.isArray(assessment.strands) ? assessment.strands : null;

	const heading = <>
		<ClipboardCheckIcon className="size-3.5 text-primary" />
		<span className="min-w-0 truncate">Probe assessment</span>
	</>;
	const note = output && !output.ok ? <>
		The prober retried: {output.error}
	</> : state === "output-error" ? "The assessment was malformed — the prober retried with a corrected one."
		: !strands ? "Writing the assessment…" : null;

	if (note || !strands) return (
		<div data-testid="probe-done-card" className="my-3 rounded-xl border-2 bg-card/60 p-3">
			<div className="mb-2 flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
				{heading}
			</div>
			<p className="text-sm text-muted-foreground">{note}</p>
		</div>
	);

	return (
		<details data-testid="probe-done-card" className="group my-3 overflow-hidden rounded-xl border-2 bg-card/60">
			<summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl p-3 text-xs font-extrabold text-muted-foreground transition-colors hover:bg-accent group-open:rounded-b-none group-open:border-b [&::-webkit-details-marker]:hidden">
				{heading}
				<span className="ml-auto shrink-0 font-normal normal-case tracking-normal text-muted-foreground/70">
					{strands.length} strand{strands.length === 1 ? "" : "s"}
				</span>
				<ChevronRightIcon className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="divide-y">
				{strands.map((s, i) => (
					<div key={i} className="px-3 py-2">
						<ToolContentResponse className="text-sm font-medium">{s.strand}</ToolContentResponse>
						<ToolContentResponse className="mt-0.5 text-sm text-muted-foreground">{s.assessment}</ToolContentResponse>
					</div>
				))}
				{assessment?.summary && (
					<div className="px-3 py-2">
						<ToolContentResponse className="text-sm text-muted-foreground">{assessment.summary}</ToolContentResponse>
					</div>
				)}
			</div>
		</details>
	);
}
