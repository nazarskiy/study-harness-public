"use client";

import { ChevronRight } from "@/components/ui/icons";
import type { ArtifactPartProps } from "@/src/core";


interface ToolCallPart {
	type: string;
	state: string;
	toolCallId: string;
	input?: unknown;
	output?: unknown;
	errorText?: string;
}

function headlineArg(tool: string, input: unknown): string {
	const inp = (input ?? {}) as Record<string, unknown>;
	if (tool === "read" || tool === "ls" || tool === "show_image") {
		const p = typeof inp.path === "string" && inp.path.length > 0 ? inp.path : "~";
		return p;
	}
	if (typeof inp.pattern === "string") return inp.pattern;
	if (tool === "list_propositions" && typeof inp.session === "string" && inp.session.length > 0) {
		return inp.session;
	}
	return "";
}

function outputText(output: unknown): string | null {
	if (output == null) return null;
	if (typeof output === "string") return output;
	if (typeof output === "object" && "text" in (output as Record<string, unknown>)) {
		const o = output as { text?: unknown; images?: unknown[] };
		const text = typeof o.text === "string" ? o.text : null;
		const n = Array.isArray(o.images) ? o.images.length : 0;
		return n > 0 ? `${text ?? ""}\n[${n} image${n > 1 ? "s" : ""} attached to the model]`.trim() : text;
	}
	try {
		return JSON.stringify(output, null, 2);
	} catch {
		return String(output);
	}
}

export function ToolCallCard({ part }: ArtifactPartProps) {
	const p = part as ToolCallPart;
	const tool = p.type.replace(/^tool-/, "");
	const arg = headlineArg(tool, p.input);
	const out = outputText(p.output);
	const failed = p.state === "output-error" || typeof p.errorText === "string";
	return (
		<details
			data-testid="tool-call-card"
			data-tool={tool}
			className="group my-1 w-full max-w-2xl select-none"
		>
			<summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
				<span className={`font-extrabold ${failed ? "text-error" : ""}`}>
					{tool}
				</span>
				{arg && <span className="truncate">{arg}</span>}
				<ChevronRight className="size-3 shrink-0 opacity-50 transition-transform group-open:rotate-90" />
			</summary>
			<div className="mt-2 space-y-2 rounded-xl border-2 bg-card p-3 text-xs">
				{p.input != null && (
					<div>
						<div className="mb-1 font-extrabold text-muted-foreground">
							Input
						</div>
						<pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
							{JSON.stringify(p.input, null, 2)}
						</pre>
					</div>
				)}
				{typeof p.errorText === "string" ? (
					<div>
						<div className="mb-1 font-extrabold text-muted-foreground">
							Error
						</div>
						<pre className="whitespace-pre-wrap break-all font-mono text-xs text-error">
							{p.errorText}
						</pre>
					</div>
				) : out != null ? (
					<div>
						<div className="mb-1 font-extrabold text-muted-foreground">
							Output
						</div>
						<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed">
							{out}
						</pre>
					</div>
				) : (
					p.state !== "output-available" && (
						<div className="text-muted-foreground italic">running…</div>
					)
				)}
			</div>
		</details>
	);
}
