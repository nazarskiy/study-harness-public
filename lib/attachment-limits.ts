export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENT_BODY_BYTES = 26 * 1024 * 1024;

export interface UploadedAttachment {
	name: string;
	path: string;
	size: number;
}

export function attachmentSelectionError(files: readonly Pick<File, "size">[]): string | undefined {
	if (!files.length) return "Select at least one file.";
	if (files.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_BYTES) return "Attachments are too large. Select up to 25 MB at a time.";
}
