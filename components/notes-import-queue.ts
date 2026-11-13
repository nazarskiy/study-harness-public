import { IMPORT_EXTENSIONS, MAX_IMPORT_BYTES, validNotesPath } from "@/lib/notes-import-limits";
import type { NotesImportResult } from "./notes-import";

export const notesPath = (file: File): string => file.webkitRelativePath || file.name;
const hiddenInFolder = (file: File): boolean => file.webkitRelativePath.split("/").slice(1).some((part) => part.startsWith("."));
const extensionLabel = (name: string): string => {
	const dot = name.lastIndexOf(".");
	return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : "no extension";
};
const unsupportedSummary = (extensions: readonly string[]): string =>
	`Skipped ${extensions.length} ${extensions.length === 1 ? "file that isn't" : "files that aren't"} text, Markdown, or PDF (${[...new Set(extensions)].join(", ")}).`;
const unsafeSummary = (count: number): string =>
	`Skipped ${count} ${count === 1 ? "file with a name" : "files with names"} the import can't use (e.g. a ':' in the name).`;
export interface ImportQueueSnapshot {
	importing: boolean;
	errors: string[];
	notices: string[];
	completion: number;
}
export const EMPTY_IMPORT_QUEUE: ImportQueueSnapshot = { importing: false, errors: [], notices: [], completion: 0 };

export function createNotesImportQueue(post: (files: readonly File[]) => Promise<NotesImportResult[]>) {
	const listeners = new Set<() => void>();
	const pending: { file: File; index: number }[] = [];
	const failures = new Map<number, string>();
	const notices = new Map<number, string>();
	let active = 0, sequence = 0;
	let snapshot = EMPTY_IMPORT_QUEUE;
	const ordered = (map: Map<number, string>) => [...map].sort(([a], [b]) => a - b).map(([, text]) => text);
	const publish = (completed = false) => {
		snapshot = { importing: active > 0 || pending.length > 0, errors: ordered(failures), notices: ordered(notices), completion: snapshot.completion + Number(completed) };
		for (const listener of [...listeners]) listener();
	};
	const send = async (file: File) => post([file]);
	function pump(): void {
		while (active < 3 && pending.length > 0) {
			const { file, index } = pending.shift()!;
			active++;
			void (async () => {
				try {
					const [r] = await send(file);
					if (!r) throw new Error("Invalid import response. Check the graph before retrying.");
					if (!r.ok) {
						const details = [r.provider, r.missing?.join(", "), r.slots?.join(", ")].filter(Boolean);
						failures.set(index, `${r.filePath}: ${r.error}${r.code ? `\n${[r.code, ...details].join(" — ")}` : ""}`);
					} else if (r.notice) notices.set(index, `${r.filePath}: ${r.notice}`);
				} catch (error) {
					failures.set(index, `${notesPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					active--;
					pump();
					publish(active === 0 && pending.length === 0);
				}
			})();
		}
	}
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		append(files: readonly File[]) {
			if (files.length === 0) return;
			if (!snapshot.importing) { failures.clear(); notices.clear(); sequence = 0; }
			const unsafe: number[] = [], unsupported: { index: number; extension: string }[] = [];
			for (const file of files) {
				const index = sequence++;
				const path = notesPath(file);
				if (file.webkitRelativePath && hiddenInFolder(file)) continue;
				if (!validNotesPath(path, file.name)) unsafe.push(index);
				else if (!IMPORT_EXTENSIONS.test(file.name)) unsupported.push({ index, extension: extensionLabel(file.name) });
				else if (file.size > MAX_IMPORT_BYTES) failures.set(index, `${path}: Too big. Max 25 MB.`);
				else pending.push({ file, index });
			}
			if (unsafe.length > 0) failures.set(unsafe[0]!, unsafeSummary(unsafe.length));
			if (unsupported.length > 0) failures.set(unsupported[0]!.index, unsupportedSummary(unsupported.map(({ extension }) => extension)));
			const hadWork = active > 0 || pending.length > 0;
			pump();
			publish(!hadWork);
		},
	};
}
