"use client";

import { useRef } from "react";
import { Loader2Icon, PaperclipIcon } from "@/components/ui/icons";
import { Hint } from "@/components/ui/hint";
import { useAttachmentUploads } from "@/components/file-path-drop-zone";

export function AttachFilesButton({ editorRef }: { editorRef?: React.RefObject<HTMLDivElement | null> }) {
	const picker = useRef<HTMLInputElement>(null);
	const target = useRef<HTMLElement | null>(null);
	const attachments = useAttachmentUploads();
	return (
		<div className="relative shrink-0">
			<input ref={picker} type="file" multiple hidden data-testid="attachment-picker" onChange={event => {
				const files = Array.from(event.currentTarget.files ?? []);
				event.currentTarget.value = "";
				void attachments.upload(files, target.current);
			}} />
			<Hint label={attachments.uploading ? "Uploading attachments…" : "Attach files (up to 25 MB)"}>
				<button
					type="button"
					aria-label="Attach files"
					disabled={attachments.uploading}
					aria-busy={attachments.uploading}
					onClick={event => {
						target.current = attachments.findTarget(event.currentTarget, editorRef?.current);
						if (!target.current) { attachments.reportError("Open a message or answer box before attaching files."); return; }
						picker.current?.click();
					}}
					data-testid="attach-files"
					className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl text-muted-foreground transition-colors hover:bg-accent hover:text-secondary disabled:cursor-default disabled:opacity-40"
				>
					{attachments.uploading ? <Loader2Icon aria-hidden className="size-5 animate-spin" /> : <PaperclipIcon aria-hidden className="size-5" />}
				</button>
			</Hint>
		</div>
	);
}
