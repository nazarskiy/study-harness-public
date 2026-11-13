"use client";

import { ToolContentResponse } from "@/components/ai-elements/message";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ArtifactPartProps } from "@/src/core";


import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ThinkingBlock } from "@/components/thinking-block";
import { usePopoverDismiss } from "@/components/popover-dismiss";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";
import { useInteractionLayers } from "@/components/interaction-layers";

let nodeNameMapPromise: Promise<Record<string, string>> | null = null;
function nodeNameMap(): Promise<Record<string, string>> {
	nodeNameMapPromise ??= fetch("/api/graph")
		.then((r) => (r.ok ? r.json() : { nodes: [] }))
		.then((g: { nodes?: Array<{ id?: unknown; name?: unknown }> }) =>
			Object.fromEntries(
				(g.nodes ?? [])
					.filter((n) => typeof n.id === "string")
					.map((n) => [n.id as string, typeof n.name === "string" ? (n.name as string) : (n.id as string)]),
			),
		)
		.catch(() => ({}));
	return nodeNameMapPromise;
}

export interface PracticeThinkingData {
	problemCallId: string;
	commit?: boolean;
	text: string;
	images?: readonly Readonly<import("@earendil-works/pi-ai").ImageContent>[];
}

export function ProblemCard({ part }: ArtifactPartProps) {
	const input = (part.input ?? {}) as { statement?: string };
	const statement = typeof input.statement === "string" ? input.statement : "";
	return (
		<div data-testid="problem-card" className="ow-card-enter my-1 rounded-2xl border-2 bg-card p-4">
			<div className="mb-2 inline-flex rounded-full bg-secondary-soft px-2.5 py-0.5 text-xs font-extrabold text-secondary">Problem</div>
			<div className="ow-prose text-[15px]">
				<ToolContentResponse>{statement}</ToolContentResponse>
			</div>
		</div>
	);
}

const OUTCOME_LABEL: Record<string, string> = {
	solved: "Solved",
	solvedWithHints: "Solved with hints",
	movedOn: "Moved on",
	surrendered: "Surrendered",
	dismissed: "Dismissed",
};

const OUTCOME_COLOR: Record<string, string | undefined> = {
	solved: "var(--ow-success)",
	solvedWithHints: "var(--ow-warning)",
	surrendered: "var(--ow-error)",
};

export function ConcludeCard({ part }: ArtifactPartProps) {
	const input = (part.input ?? {}) as { outcome?: string; verdict?: string; solutionReveal?: string };
	const outcome = typeof input.outcome === "string" ? input.outcome : "";
	const verdict = typeof input.verdict === "string" ? input.verdict : "";
	const reveal =
		typeof part.reveal === "string" ? part.reveal : typeof input.solutionReveal === "string" ? input.solutionReveal : "";

	if (outcome === "dismissed") {
		return (
			<div data-testid="conclude-card" className="my-1 px-1 text-sm text-muted-foreground/70">
				Problem dismissed.
			</div>
		);
	}

	return (
		<div data-testid="conclude-card" className="ow-card-enter relative my-1 rounded-2xl border-2 bg-card p-4">
			{
}
			<div className="mb-1 flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
				Concluded
				{(OUTCOME_LABEL[outcome] ?? "") !== "" && outcome !== "dismissed" && (
					<StatusBadge text={OUTCOME_LABEL[outcome] ?? ""} color={OUTCOME_COLOR[outcome]} />
				)}
			</div>
			{
}
			{verdict.length > 0 && (
				<div className="text-sm text-foreground/50">
					<ToolContentResponse>{verdict}</ToolContentResponse>
				</div>
			)}
			{
}
			{reveal.length > 0 && (
				<>
					<div className="my-3 border-t" />
					<div>
						<div className="mb-0.5 text-xs font-extrabold text-muted-foreground">Model solution</div>
						<div className="ow-prose text-[15px]">
							<ToolContentResponse>{reveal}</ToolContentResponse>
						</div>
					</div>
				</>
			)}
			<MetadataPopover
				concludeInput={input}
				problemInput={(part.problemInput ?? {}) as { mode?: unknown; target?: unknown }}
			/>
		</div>
	);
}

function MetadataPopover({
	concludeInput,
	problemInput,
}: {
	concludeInput: { outcome?: string; rung?: unknown; missClass?: unknown; retest?: unknown };
	problemInput: { mode?: unknown; target?: unknown };
}) {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const interactions = useInteractionLayers();
	const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
	const [names, setNames] = useState<Record<string, string> | null>(null);
	const targets = Array.isArray(problemInput.target)
		? problemInput.target.filter((t): t is string => typeof t === "string")
		: [];
	useEffect(() => {
		if (!open || targets.length === 0 || names) return;
		let alive = true;
		void nodeNameMap().then((m) => {
			if (alive) setNames(m);
		});
		return () => {
			alive = false;
		};
	}, [open, targets.length, names]);

	const popupLayer = usePopoverDismiss(rootRef, open, () => setOpen(false), { layerRootRef: panelRef });
	useEffect(() => {
		if (!open) return;
		const close = () => { if (interactions.isElementEligible(panelRef.current)) setOpen(false); };
		window.addEventListener("scroll", close, { capture: true, passive: true });
		return () => window.removeEventListener("scroll", close, { capture: true });
	}, [open, interactions]);

	const mode = typeof problemInput.mode === "string" ? problemInput.mode : "";
	const rung = typeof concludeInput.rung === "string" ? concludeInput.rung : "";
	const miss = typeof concludeInput.missClass === "string" ? concludeInput.missClass : "";
	const retest = typeof concludeInput.retest === "boolean" ? concludeInput.retest : undefined;
	const outcome = typeof concludeInput.outcome === "string" ? concludeInput.outcome : "";
	if (!mode && targets.length === 0 && !rung && !miss && retest === undefined) return null;

	return (
		<div ref={rootRef} className="relative mt-3">
			<button
				type="button"
				data-testid="metadata-toggle"
				ref={triggerRef}
				onClick={() => {
					setOpen((v) => {
						if (v) return false;
						const r = triggerRef.current?.getBoundingClientRect();
						if (r) {
							const left = Math.max(8, Math.min(r.left, window.innerWidth - 328));
							setAnchor({ top: r.bottom + 8, left });
						}
						return true;
					});
				}}
				aria-expanded={open}
				className="flex items-center gap-1 text-xs font-extrabold text-muted-foreground transition-colors hover:text-foreground"
			>
				Metadata
			</button>
			{open &&
				anchor &&
				createPortal(
					<div
						ref={panelRef}
						data-testid="metadata-box"
						style={{ position: "fixed", top: anchor.top, left: anchor.left, zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }}
						className="w-80 max-w-[calc(100vw-1rem)] rounded-2xl border-2 bg-card p-4 text-left shadow-lg"
					>
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
						<dt className="text-muted-foreground">Mode</dt>
						<dd className="font-bold">{mode || "—"}</dd>
						<dt className="text-muted-foreground">Targets</dt>
						<dd className="font-bold">
							{targets.length === 0 ? (
								"untagged"
							) : (
								<span>
									{targets.map((t, i) => (
										<span key={t}>
											{i > 0 && ", "}
											{names?.[t] ?? t}
										</span>
									))}
								</span>
							)}
						</dd>
						<dt className="text-muted-foreground">Outcome</dt>
						<dd className="font-bold">{outcome || "—"}</dd>
						<dt className="text-muted-foreground">Hint rung</dt>
						<dd className="font-bold">{rung || "none"}</dd>
						<dt className="text-muted-foreground">Miss class</dt>
						<dd className="font-bold">{miss || "none"}</dd>
						<dt className="text-muted-foreground">Retest</dt>
						<dd className="font-bold">{retest === undefined ? "—" : retest ? "yes" : "no"}</dd>
					</dl>
					</div>,
					interactions.getPortalContainer(triggerRef.current)!,
				)}
		</div>
	);
}

export function ThinkingCard({ data }: { data: PracticeThinkingData }) {
	return <ThinkingBlock testId="thinking-card" label="Your answer" text={data.text} images={data.images} defaultOpen />;
}
