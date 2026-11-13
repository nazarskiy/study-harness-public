"use client";

import { ChevronRight } from "@/components/ui/icons";
import { OwlBusy } from "@/components/owl/owl-busy";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { toolActivityLabel } from "@/src/core";
import type { ArtifactPartProps } from "@/src/core";

interface StreamingToolPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
}

export function LiveToolCard({ part }: ArtifactPartProps) {
	const p = part as StreamingToolPart;
	const tool = p.type.replace(/^tool-/, "");
	const inp = (p.input ?? {}) as Record<string, unknown>;
	let arg = "";
	if (typeof inp.path === "string" && inp.path) arg = inp.path;
	else if (typeof inp.pattern === "string" && inp.pattern) arg = inp.pattern;
	else if (typeof inp.session === "string" && inp.session) arg = inp.session;

	const hasInput = p.input != null && Object.keys(inp).length > 0;

	return (
		<details
			data-testid="live-tool-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
				<OwlBusy label={`${toolActivityLabel(tool)} — live`} />
				<Shimmer duration={1} className="text-xs">
					{toolActivityLabel(tool)}
				</Shimmer>
				{arg && <span className="truncate">{arg}</span>}
				<ChevronRight className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="mt-2 rounded-xl border-2 bg-card p-3 text-xs">
				<div className="mb-1 font-extrabold text-muted-foreground">Input (streaming)</div>
				<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
					{hasInput ? JSON.stringify(p.input, null, 2) : "…"}
				</pre>
			</div>
		</details>
	);
}
