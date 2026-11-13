"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { WaypointsIcon } from "@/components/ui/icons";
import { Hint } from "@/components/ui/hint";
import { IMPORT_ACCEPT } from "@/lib/notes-import-limits.ts";
import { useInteractionLayer, useInteractionLayers } from "@/components/interaction-layers";
import { INTERACTION_LAYER_Z_BASE } from "@/components/host-dialog";
import { createNotesImportQueue, EMPTY_IMPORT_QUEUE, notesPath } from "./notes-import-queue";

export { MAX_IMPORT_BYTES } from "@/lib/notes-import-limits.ts";
export { notesPath } from "./notes-import-queue";

export interface NotesImportResult {
	requestIndex: number;
	filePath: string;
	ok: boolean;
	outcome: "completed" | "failed" | "partial" | "aborted" | "busy";
	stats?: { nodes: number; chains?: number; droppedChains?: number };
	error?: string;
	code?: string;
	missing?: string[];
	provider?: string;
	slots?: string[];
	notice?: string;
}

export function parseNotesImportResults(body: unknown, files: readonly File[]): NotesImportResult[] {
	const invalid = () => new Error("Invalid import response. Check the knowledge map before retrying.");
	if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results) || body.results.length !== files.length) throw invalid();
	const seen = new Set<number>();
	for (const raw of body.results) {
		if (!raw || typeof raw !== "object") throw invalid();
		const r = raw as NotesImportResult;
		if (!Number.isInteger(r.requestIndex) || r.requestIndex < 0 || r.requestIndex >= files.length || seen.has(r.requestIndex) || r.filePath !== notesPath(files[r.requestIndex]!)) throw invalid();
		seen.add(r.requestIndex);
		if (!["completed", "failed", "partial", "aborted", "busy"].includes(r.outcome) || typeof r.ok !== "boolean" || r.ok !== (r.outcome === "completed")) throw invalid();
		if (r.stats !== undefined && (!r.stats || typeof r.stats !== "object" || !Number.isFinite(r.stats.nodes) || r.stats.nodes < 0 || (r.stats.chains !== undefined && (!Number.isFinite(r.stats.chains) || r.stats.chains < 0)))) throw invalid();
		if (r.ok && !r.stats) throw invalid();
		if (!r.ok && typeof r.error !== "string") throw invalid();
		for (const field of ["error", "code", "provider", "notice"] as const) if (r[field] !== undefined && typeof r[field] !== "string") throw invalid();
		for (const field of ["missing", "slots"] as const) if (r[field] !== undefined && (!Array.isArray(r[field]) || !r[field]!.every((v) => typeof v === "string"))) throw invalid();
	}
	return body.results as NotesImportResult[];
}

export async function postNotesImport(files: readonly File[]): Promise<NotesImportResult[]> {
	const form = new FormData();
	for (const file of files) {
		form.append("files", file);
		form.append("paths", notesPath(file));
	}
	const response = await fetch("/api/graph/import", { method: "POST", body: form });
	let body: unknown;
	try { body = await response.json(); }
	catch { throw new Error("Invalid import response. Check the knowledge map before retrying."); }
	if (!response.ok) {
		const detail = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? `: ${body.error}` : "";
		throw new Error(`Import request failed (HTTP ${response.status})${detail}${/[.!?]$/.test(detail) ? "" : "."} Check the knowledge map before retrying.`);
	}
	return parseNotesImportResults(body, files);
}

const pageImportQueue = createNotesImportQueue(postNotesImport);
export function useNotesImport(callbacks: { onStart?: () => void; onFinish?: () => void } = {}) {
	const snapshot = useSyncExternalStore(pageImportQueue.subscribe, pageImportQueue.getSnapshot, () => EMPTY_IMPORT_QUEUE);
	const latest = useRef(callbacks);
	latest.current = callbacks;
	const seenCompletion = useRef(snapshot.completion);
	useEffect(() => {
		if (seenCompletion.current !== snapshot.completion) {
			seenCompletion.current = snapshot.completion;
			latest.current.onFinish?.();
		}
	}, [snapshot.completion]);
	return {
		errors: snapshot.errors, notices: snapshot.notices, importing: snapshot.importing,
		onImportFiles: (files: FileList | null) => {
			if (!files || files.length === 0) return;
			latest.current.onStart?.();
			pageImportQueue.append(Array.from(files));
		},
	};
}

export function NotesImportControl({ importing, onImportFiles }: { importing: boolean; onImportFiles: (files: FileList | null) => void }) {
	const filesRef = useRef<HTMLInputElement>(null);
	const folderRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const hintId = useId();
	const onChange = (event: ChangeEvent<HTMLInputElement>) => {
		onImportFiles(event.target.files);
		event.target.value = "";
	};
	const rootRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const interactions = useInteractionLayers();
	const popupLayer = useInteractionLayer({ kind: "popup", enabled: open, rootRef: panelRef, anchorRef: rootRef,
		onClose: () => { setOpen(false); return "closed"; } });
	const choices = [["Files", filesRef], ["Folder", folderRef]] as const;
	return (
		<div ref={rootRef} className="relative shrink-0 rounded-2xl border-2 bg-card p-1 shadow-[0_3px_0_var(--border)]"
			onBlur={(event) => { if (interactions.isElementEligible(panelRef.current) && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
			<input ref={filesRef} type="file" multiple accept={IMPORT_ACCEPT} className="hidden" onChange={onChange} />
			<input ref={folderRef} type="file" {...{ webkitdirectory: "" }} className="hidden" onChange={onChange} />
			<Hint label="Extract files into the knowledge map" side="bottom">
				<button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu" data-testid="import-notes"
					className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-extrabold text-foreground transition-colors hover:bg-accent">
					<WaypointsIcon className="size-4 text-secondary" />{importing ? "Extracting…" : "Extract files…"}
				</button>
			</Hint>
			{open && (
				<div ref={panelRef} role="menu" aria-label="Extract files into the knowledge map" aria-describedby={hintId} style={{ zIndex: INTERACTION_LAYER_Z_BASE + popupLayer.order }} className="absolute right-0 top-full mt-1 w-52 rounded-2xl border-2 bg-popover p-1.5 shadow-xl">
					<div role="none"><p id={hintId} className="px-3 py-2 text-xs font-semibold leading-relaxed text-muted-foreground">For lessons, attach material to a session instead.</p></div>
					{choices.map(([label, input]) => <button key={label} type="button" role="menuitem" className="block w-full rounded-xl px-3 py-2 text-left text-sm font-bold hover:bg-accent"
						onClick={() => { setOpen(false); input.current?.click(); }}>{label}</button>)}
				</div>
			)}
		</div>
	);
}

export function NotesImportErrors({ errors }: { errors: readonly string[] }) {
	return <>{errors.map((error, i) => <p key={i} role="alert" className="max-w-full whitespace-pre-wrap break-words text-xs text-error">{error}</p>)}</>;
}
export function NotesImportNotices({ notices }: { notices: readonly string[] }) {
	return <>{notices.map((notice, i) => <p key={i} role="status" className="max-w-full whitespace-pre-wrap break-words text-xs text-muted-foreground">{notice}</p>)}</>;
}
