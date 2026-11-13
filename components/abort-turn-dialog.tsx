"use client";

import type { ReactElement, ReactNode } from "react";
import { HostDialog } from "@/components/host-dialog";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";


export type AbortMode = "turn" | "question" | "problem";

const COPY: Record<AbortMode, { title: string; line: string; action: string }> = {
	turn: {
		title: "Abort this turn?",
		line: "The partial answer stays in the transcript.",
		action: "Abort",
	},
	question: {
		title: "Dismiss this question?",
		line: "Skipped — the teacher moves on without it.",
		action: "Dismiss",
	},
	problem: {
		title: "Discard this problem?",
		line: "The problem is dropped — no solution is revealed.",
		action: "Discard",
	},
};

export function AbortTurnBody({
	mode,
	onClose,
	onConfirm,
	busy = false,
	renderFrame,
}: {
	mode: AbortMode;
	onClose: () => void;
	onConfirm: () => void;
	busy?: boolean;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
}) {
	const backdropDismiss = useBackdropDismiss(onClose);
	const copy = COPY[mode];
	const frame = (
			<div
				className="mx-4 w-full max-w-sm rounded-3xl border-2 bg-card p-6 shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="text-xl font-black text-card-foreground" data-testid="abort-turn-title">
					{copy.title}
				</h2>
				<p className="mt-1.5 text-xs text-muted-foreground" data-testid="abort-turn-line">
					{copy.line}
					{busy && mode !== "turn" ? " The working turn stops too." : ""}
				</p>
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						data-testid="abort-turn-cancel"
						onClick={onClose}
						className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-card px-4 text-sm font-extrabold text-foreground shadow-[0_3px_0_var(--border)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-muted active:translate-y-[3px] active:shadow-none"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid="abort-turn-confirm"
						onClick={onConfirm}
						className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-destructive px-4 text-sm font-extrabold text-white shadow-[0_4px_0_var(--destructive-shade)] transition-[transform,box-shadow] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-none"
					>
						{copy.action}
					</button>
				</div>
			</div>
	);
	if (renderFrame) return renderFrame(frame);
	return <div role="dialog" aria-modal="true" aria-label={copy.title} data-testid="abort-turn-dialog"
		className="fixed inset-0 z-50 flex items-center justify-center bg-black/45"
		{...backdropDismiss}>{frame}</div>;
}

export function AbortTurnDialog({
	mode,
	onClose,
	onConfirm,
	busy = false,
}: {
	mode: AbortMode | null;
	onClose: () => void;
	onConfirm: (mode: AbortMode) => void;
	busy?: boolean;
}) {
	if (mode === null) return null;
	return <AbortTurnBody mode={mode} onClose={onClose} onConfirm={() => onConfirm(mode)} busy={busy}
		renderFrame={(frame) => <HostDialog open frame={frame} aria-label={COPY[mode].title}
			onClose={() => { onClose(); return "closed"; }}
			backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-black/45", "data-testid": "abort-turn-dialog" }}>
			{frame.props.children}
		</HostDialog>} />;
}
