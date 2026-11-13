"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { HostDialog } from "@/components/host-dialog";

export const EXTRACTION_RETRY_LINE = "An extraction is running — try again when the activity dock drains.";

export function DeleteNodeBody({
	nodes,
	folders = [],
	busy,
	failure,
	onClose,
	onRun,
	renderFrame,
}: {
	nodes: { id: string; name: string }[];
	folders?: { id: string; name: string }[];
	busy: boolean;
	failure: { code: string; error: string } | null;
	onClose: () => void;
	onRun: () => void;
	renderFrame?: (frame: ReactElement<{ children: ReactNode }>) => ReactNode;
}) {
	const frame = (
		<div
			role="dialog"
			aria-modal="true"
			aria-label="Delete node"
			data-testid="delete-node-dialog"
			onClick={(e) => e.stopPropagation()}
			className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-3xl border-2 bg-card p-6 shadow-2xl"
		>
			<h2 className="text-xl font-black text-destructive">
				{folders.length > 0 ? (nodes.length > 0 ? "Delete nodes and remove empty folders?" : "Remove empty folders?") : nodes.length === 1 ? "Delete node?" : `Delete ${nodes.length} nodes?`}
			</h2>
			{ }
			<div className="mt-1.5">
				{nodes.length === 1 ? (
					<code data-testid="node-name-code" className="font-mono text-sm text-foreground">
						{nodes[0]?.name}
					</code>
				) : (
					<code data-testid="node-names-code" className="font-mono text-sm text-foreground">
						{nodes.slice(0, 8).map((n) => n.name).join(", ")}
						{nodes.length > 8 ? `, and ${nodes.length - 8} more` : ""}
					</code>
				)}
			</div>
			{folders.length > 0 && <p className="mt-2 text-sm" data-testid="folder-removal-names">Empty folders: {folders.map((f) => f.name).join(", ")}</p>}
			{nodes.length > 0 && <p className="mt-2 text-sm text-muted-foreground" data-testid="node-permanence-line">
				{nodes.length === 1
					? "This permanently deletes the node — this cannot be undone."
					: `This permanently deletes all ${nodes.length} nodes — this cannot be undone.`}
			</p>}
			<p className="mt-2 text-xs text-muted-foreground" data-testid="folder-removal-explanation">
				{folders.length > 0 ? "Only the named empty folders are removed. " : ""}Sessions, imported source records, and non-empty folders are kept.
			</p>
			{failure && (
				<div
					role="alert"
					data-testid="node-delete-failure"
					className="mt-3 rounded-lg border-2 border-border px-3 py-2 text-xs"
				>
					<span className="text-foreground">
						{failure.code === "extraction_running" ? EXTRACTION_RETRY_LINE : failure.error}
					</span>
					<button
						type="button"
						data-testid="node-delete-retry"
						onClick={onRun}
						disabled={busy}
						className="ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
					>
						Try again
					</button>
				</div>
			)}
			<div className="mt-4 flex justify-end gap-2">
				<button
					type="button"
					data-testid="node-delete-cancel"
					onClick={onClose}
					disabled={busy}
					className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-card px-4 text-sm font-extrabold text-foreground shadow-[0_3px_0_var(--border)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-muted active:translate-y-[3px] active:shadow-none disabled:opacity-40"
				>
					Cancel
				</button>
				<button
					type="button"
					data-testid="node-delete-confirm"
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

export function DeleteNodeDialog({
	nodes,
	folders = [],
	onRemoveFolder,
	onFoldersDeleted,
	onClose,
	onDeleted,
}: {
	nodes: { id: string; name: string }[] | null;
	folders?: { id: string; name: string }[];
	onRemoveFolder?: (id: string) => Promise<void>;
	onFoldersDeleted?: (ids: string[]) => void;
	onClose: () => void;
	onDeleted: (nodeIds: string[], graphRevision: number) => void;
}) {
	const [busy, setBusy] = useState(false);
	const hasItems = Boolean(nodes?.length || folders.length);
	const [failure, setFailure] = useState<{ code: string; error: string } | null>(null);

	useEffect(() => {
		if (!hasItems) {
			setBusy(false);
			setFailure(null);
		}
	}, [hasItems]);

	const run = async () => {
		if (!hasItems || busy) return;
		setBusy(true);
		setFailure(null);
		const dead: string[] = [];
		const removedFolders: string[] = [];
		let revision = 0;
		try {
			for (const n of nodes ?? []) {
				const res = await fetch(`/api/graph/nodes/${encodeURIComponent(n.id)}`, { method: "DELETE" });
				const body = (await res.json()) as {
					error?: string;
					code?: string;
					graphRevision?: number;
				};
				if (!res.ok) {
					setFailure({ code: body.code ?? "error", error: body.error ?? `Delete failed (${res.status})` });
					setBusy(false);
					if (dead.length > 0) onDeleted(dead, revision);
					return;
				}
				dead.push(n.id);
				revision = body.graphRevision ?? revision;
			}
			for (const folder of folders) {
				if (!onRemoveFolder) throw new Error("Folder removal is unavailable.");
				await onRemoveFolder(folder.id);
				removedFolders.push(folder.id);
			}
			if (removedFolders.length > 0) onFoldersDeleted?.(removedFolders);
			onDeleted(dead, revision);
		} catch (error) {
			setFailure({ code: "network", error: folders.length > 0 && error instanceof Error ? error.message : "Delete failed — network error. Try again." });
			if (removedFolders.length > 0) onFoldersDeleted?.(removedFolders);
			setBusy(false);
			if (dead.length > 0) onDeleted(dead, revision);
		}
	};

	if (!hasItems) return null;

	return <DeleteNodeBody
				nodes={nodes ?? []}
				folders={folders}
				busy={busy}
				failure={failure}
				onClose={onClose}
				onRun={() => void run()}
				renderFrame={(frame) => <HostDialog open frame={frame} onClose={() => {
					if (busy) return "blocked";
					onClose(); return "closed";
				}} backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-black/45" }}>{frame.props.children}</HostDialog>}
			/>;
}
