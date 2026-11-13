import { attachmentSelectionError, type UploadedAttachment } from "@/lib/attachment-limits";

export async function uploadAttachmentFiles(files: readonly File[], signal: AbortSignal, request: typeof fetch = fetch): Promise<UploadedAttachment[]> {
	const selectionError = attachmentSelectionError(files);
	if (selectionError) throw new Error(selectionError);
	const form = new FormData();
	for (const file of files) form.append("files", file);
	const response = await request("/api/attachments", { method: "POST", body: form, signal });
	const body = await response.json().catch(() => null) as { error?: string; attachments?: UploadedAttachment[] } | null;
	if (!response.ok) throw new Error(body?.error ?? "Upload failed. Try selecting the files again.");
	if (!Array.isArray(body?.attachments) || body.attachments.length !== files.length || body.attachments.some(file => typeof file.path !== "string" || !file.path)) {
		throw new Error("The upload response was incomplete. Try selecting the files again.");
	}
	return body.attachments;
}
