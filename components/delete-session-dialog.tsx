"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { HostDialog } from "@/components/host-dialog";
import type { ChatDeleteMode, ChatListItem } from "@/src/core";

export const TRACES_COPY = {
	testid: "delete-traces",
	checkbox: "delete-traces-checkbox",
	title: "Also remove its graph traces",
	body: "This session’s topics, links, and events leave the knowledge map too. Topics other sessions or imported notes also cover survive; topics only this session created are removed entirely.",
};

export function DeleteSessionDialog({
	chat,
	onClose,
	onDeleted,
}: {
	chat: Pick<ChatListItem, "id" | "title"> | null;
	onClose: () => void;
	onDeleted: (id: string, mode: ChatDeleteMode, graphRevision: number) => void;
}) {
	const [traces, setTraces] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<{ code: string; error: string } | null>(null);

	useEffect(() => {
		if (!chat) {
			setTraces(false);
			setBusy(false);
			setFailure(null);
		}
	}, [chat]);

	const run = async () => {
		if (!chat || busy) return;
		const mode: ChatDeleteMode = traces ? "delete-nodes" : "preserve-graph";
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/chats/${chat.id}?mode=${mode}`, { method: "DELETE" });
			const body = (await res.json()) as {
				ok?: boolean;
				error?: string;
				code?: string;
				graphRevision?: number;
			};
			if (!res.ok) {
				setFailure({ code: body.code ?? "error", error: body.error ?? `Delete failed (${res.status})` });
				setBusy(false);
				return;
			}
			onDeleted(chat.id, mode, body.graphRevision ?? 0);
		} catch {
			setFailure({ code: "network", error: "Delete failed — network error. Try again." });
			setBusy(false);
		}
	};

	if (!chat) return null;

	return <DeleteSessionBody
				chat={chat}
				traces={traces}
				busy={busy}
				failure={failure}
				onTraces={(next) => setTraces(next)}
				onClose={onClose}
				onRun={() => void run()}
				renderFrame={(frame) => <HostDialog open frame={frame} onClose={() => {
					if (busy) return "blocked";
					onClose(); return "closed";
				}} backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-black/45" }}>{frame.props.children}</HostDialog>}
			/>;
}

export function DeleteSessionBody({
	chat,
	traces,
	busy,
	failure,
	onTraces,
	onClose,
	onRun,
	renderFrame,
}: {
	chat: Pick<ChatListItem, "id" | "title">;
	traces: boolean;
	busy: boolean;
	failure: { code: string; error: string } | null;
	onTraces: (next: boolean) => void;
	onClose: () => void;
	onRun: () => void;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
}) {
	const frame = (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete session"
			data-testid="delete-session-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-3xl border-2 bg-card p-6 shadow-2xl"
		>
			<h2 className="text-xl font-black text-destructive">Delete session?</h2>
			{ }
			<div className="mt-1.5">
				<code data-testid="session-name-code" className="font-mono text-sm text-foreground">
					{chat.title}
				</code>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				This permanently removes the session — its messages, background jobs, and extraction records. Everything
				it added to the knowledge map stays unless you check below. This cannot be undone.
			</p>
			<label
				data-testid={TRACES_COPY.testid}
				className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border-2 border-border px-4 py-3"
			>
				<input
					type="checkbox"
					data-testid={TRACES_COPY.checkbox}
					checked={traces}
					onChange={(e) => onTraces(e.target.checked)}
					disabled={busy}
					className="mt-0.5 size-4 shrink-0 accent-primary"
				/>
				<span className="min-w-0">
					<span className="block text-sm text-foreground">{TRACES_COPY.title}</span>
					<span className="mt-1 block text-xs text-muted-foreground">{TRACES_COPY.body}</span>
				</span>
			</label>
			{failure && (
				<div
					role="alert"
					data-testid="delete-failure"
					className="mt-3 rounded-lg border-2 border-border px-3 py-2 text-xs"
				>
					<span className="text-foreground">{failure.error}</span>
					<button
						type="button"
						data-testid="delete-retry"
						onClick={onRun}
						disabled={busy}
						className="ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			{
}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-card px-4 text-sm font-extrabold text-foreground shadow-[0_3px_0_var(--border)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-muted active:translate-y-[3px] active:shadow-none disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="delete-confirm"
					onClick={onRun}
					disabled={busy}
					className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-destructive px-4 text-sm font-extrabold text-white shadow-[0_4px_0_var(--destructive-shade)] transition-[transform,box-shadow] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-none disabled:opacity-40"
				>
					{busy ? "Deleting…" : "Delete"}
				</button>
			</div>
		</div>
	);
	return renderFrame ? renderFrame(frame) : frame;
}