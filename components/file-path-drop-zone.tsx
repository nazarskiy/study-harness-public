"use client";

import { FileSymlinkIcon,Loader2Icon,XIcon } from "@/components/ui/icons";
import { usePathname } from "next/navigation";
import { createContext,useCallback,useContext,useEffect,useRef,useState } from "react";
import { uploadAttachmentFiles } from "./attachment-upload";
import { isInteractionScopeEligible } from "./interaction-focus";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { INSERT_FILE_PATHS_EVENT } from "./path-input";

interface AttachmentUploads {
	uploading: boolean;
	isUploading(): boolean;
	reportError(message: string): void;
	findTarget(source?: HTMLElement | null, preferred?: HTMLElement | null): HTMLElement | null;
	upload(files: readonly File[], target: HTMLElement | null): Promise<boolean>;
}

const AttachmentContext = createContext<AttachmentUploads>({ uploading: false, isUploading: () => false, reportError: () => {}, findTarget: () => null, upload: async () => false });
export function useAttachmentUploads() { return useContext(AttachmentContext); }

export function FilePathDropZone({ children, className, onContentRoot }: {
	children: React.ReactNode;
	className?: string;
	onContentRoot?: (element: HTMLElement | null) => void;
}) {
	const root = useRef<HTMLElement>(null);
	const lastEditor = useRef<HTMLElement | null>(null);
	const job = useRef<AbortController | null>(null);
	const controller = useOptionalInteractionLayers();
	const pathname = usePathname();
	const [uploading, setUploading] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [notice, setNotice] = useState("");
	const depth = useRef(0);
	useEffect(() => {
		onContentRoot?.(root.current);
		return () => { onContentRoot?.(null); };
	}, [onContentRoot]);
	useEffect(() => {
		setUploading(false); setNotice(""); lastEditor.current = null;
		return () => { job.current?.abort(); job.current = null; };
	}, [pathname]);
	const eligible = useCallback((element: HTMLElement | null): element is HTMLElement => !!element?.isConnected && element.hasAttribute("data-file-path-input") && !!root.current?.contains(element) && isInteractionScopeEligible(element, controller), [controller]);
	const findTarget = useCallback((source?: HTMLElement | null, preferred?: HTMLElement | null): HTMLElement | null => {
		if (eligible(preferred ?? null)) return preferred!;
		const direct = source?.closest<HTMLElement>("[data-file-path-input]") ?? null;
		if (eligible(direct)) return direct;
		const composer = source?.closest("[data-attachment-composer]");
		if (composer) return Array.from(composer.querySelectorAll<HTMLElement>("[data-file-path-input]")).find(eligible) ?? null;
		if (eligible(lastEditor.current)) return lastEditor.current;
		return Array.from(root.current?.querySelectorAll<HTMLElement>("[data-file-path-default]") ?? []).find(eligible) ?? null;
	}, [eligible]);
	const upload = useCallback(async (files: readonly File[], target: HTMLElement | null): Promise<boolean> => {
		if (!files.length) return false;
		if (job.current) { setNotice("Wait for the current upload to finish."); return false; }
		if (!eligible(target)) { setNotice("Open a message or answer box before attaching files."); return false; }
		const pending = new AbortController(); job.current = pending;
		setUploading(true); setNotice(`Uploading ${files.length === 1 ? files[0]!.name : `${files.length} files`}…`);
		try {
			const attachments = await uploadAttachmentFiles(files, pending.signal);
			pending.signal.throwIfAborted();
			if (!eligible(target)) throw new Error("The files were uploaded, but that input is no longer available. Select them again in the current message.");
			target.dispatchEvent(new CustomEvent(INSERT_FILE_PATHS_EVENT, { detail: attachments.map(file => file.path) }));
			setNotice("");
			return true;
		} catch (error) {
			if (!pending.signal.aborted) setNotice(error instanceof Error ? error.message : "Upload failed. Try again.");
			return false;
		} finally {
			if (job.current === pending) { job.current = null; setUploading(false); }
		}
	}, [eligible]);
	const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer.types).includes("Files");
	const clearDrag = () => { depth.current = 0; setDragging(false); };
	useEffect(() => {
		const preventOutsideNavigation = (event: DragEvent) => {
			if (Array.from(event.dataTransfer?.types ?? []).includes("Files") && event.target instanceof Node && !root.current?.contains(event.target)) event.preventDefault();
		};
		window.addEventListener("dragover", preventOutsideNavigation);
		window.addEventListener("drop", preventOutsideNavigation);
		return () => { window.removeEventListener("dragover", preventOutsideNavigation); window.removeEventListener("drop", preventOutsideNavigation); };
	}, []);
	return <AttachmentContext.Provider value={{ uploading, isUploading: () => job.current !== null, reportError: setNotice, findTarget, upload }}>
		<main ref={root} className={className} data-testid="file-path-drop-zone"
			onFocusCapture={event => { const editor = (event.target as HTMLElement).closest<HTMLElement>("[data-file-path-input]"); if (eligible(editor)) lastEditor.current = editor; }}
			onDragEnter={event => { if (hasFiles(event)) { event.preventDefault(); depth.current++; setDragging(true); } }}
			onDragOver={event => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
			onDragLeave={event => { if (hasFiles(event)) { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); } }}
			onDragEnd={clearDrag}
			onDrop={event => {
				if (event.defaultPrevented) { clearDrag(); return; }
				if (!hasFiles(event)) return;
				event.preventDefault(); event.stopPropagation(); clearDrag();
				if (Array.from(event.dataTransfer.items).some(item => item.webkitGetAsEntry?.()?.isDirectory)) { setNotice("Select individual files instead of folders."); return; }
				void upload(Array.from(event.dataTransfer.files), findTarget(event.target instanceof HTMLElement ? event.target : null));
			}}>
			{children}
			{dragging && <div data-testid="file-path-drop-indicator" className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 p-6 text-center backdrop-blur-sm">
				<div className="flex max-w-md flex-col items-center gap-3"><FileSymlinkIcon className="size-8 text-primary" aria-hidden /><span className="text-sm">Drop files to attach to your message</span></div>
			</div>}
			{notice && <div role="status" aria-live="polite" data-testid="attachment-status" className="absolute bottom-2 left-1/2 z-50 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-xl border-2 bg-card px-3 py-2 text-xs shadow-sm">
				{uploading && <Loader2Icon aria-hidden className="size-4 shrink-0 animate-spin" />}<span>{notice}</span>
				{!uploading && <button type="button" aria-label="Dismiss attachment notice" onClick={() => setNotice("")} className="shrink-0 rounded-lg p-1 hover:bg-accent"><XIcon className="size-3" aria-hidden /></button>}
			</div>}
		</main>
	</AttachmentContext.Provider>;
}
