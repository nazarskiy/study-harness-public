"use client";

import type { CompactionDetails } from "@/src/core";

export interface CompactionDividerData {
	content: string;
	details: CompactionDetails;
}

export function CompactionMomentDivider({ data: _data }: { data: CompactionDividerData }) {
	return (
		<div className="flex w-full items-center justify-center py-1">
			<span data-testid="compaction-divider" className="px-1.5 text-xs text-muted-foreground/70">
				Context compacted
			</span>
		</div>
	);
}

export function CompactionCutDivider({ data }: { data: CompactionDividerData }) {
	const kTok = data.details.tokensBefore > 0 ? ` · ${Math.round(data.details.tokensBefore / 1000)}k tok` : "";
	return (
		<div data-testid="compaction-cut-divider" className="my-4 flex w-full items-center gap-3">
			<span className="h-0 flex-1 border-t-2 border-dotted border-border" aria-hidden />
			<span className="rounded-full border-2 border-border px-2.5 py-0.5 text-xs font-extrabold text-muted-foreground">
				History compacted{kTok}
			</span>
			<span className="h-0 flex-1 border-t-2 border-dotted border-border" aria-hidden />
		</div>
	);
}
