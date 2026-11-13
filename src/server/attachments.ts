import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../../config.ts";
import { attachmentSelectionError, type UploadedAttachment } from "../../lib/attachment-limits.ts";
import { resolveSourcePath } from "../agent/tools/fs-shared.ts";

export class AttachmentUploadError extends Error {
	constructor(message: string, readonly status = 400) { super(message); }
}

export function createAttachmentStore(directory: string) {
	return {
		async save(files: readonly File[], signal?: AbortSignal): Promise<UploadedAttachment[]> {
			const error = attachmentSelectionError(files);
			if (error) throw new AttachmentUploadError(error, files.length ? 413 : 400);
			for (const file of files) {
				if (!file.name || file.name === "." || file.name === ".." || /[\\/\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(file.name) || Buffer.byteLength(file.name) > 255) {
					throw new AttachmentUploadError("A filename is invalid. Rename that file and select it again.");
				}
			}
			signal?.throwIfAborted();
			await fs.mkdir(directory, { recursive: true, mode: 0o700 });
			if (!(await fs.lstat(directory)).isDirectory()) throw new AttachmentUploadError("The attachment storage folder is unavailable.", 500);
			const root = await fs.realpath(directory);
			const destination = path.join(root, randomUUID());
			try {
				for (const [index, file] of files.entries()) resolveSourcePath(path.join(destination, String(index), file.name));
			} catch {
				throw new AttachmentUploadError(`These attachments cannot be read with the current File access settings. Allow ${directory} in Settings → Agent → Tools → File access, or choose another file.`, 403);
			}
			const staged = await fs.mkdtemp(path.join(root, ".upload-"));
			try {
				for (const [index, file] of files.entries()) {
					signal?.throwIfAborted();
					const folder = path.join(staged, String(index));
					await fs.mkdir(folder, { mode: 0o700 });
					await fs.writeFile(path.join(folder, file.name), new Uint8Array(await file.arrayBuffer()), { flag: "wx", mode: 0o600, signal });
				}
				signal?.throwIfAborted();
				await fs.rename(staged, destination);
				return files.map((file, index) => ({ name: file.name, size: file.size, path: path.join(destination, String(index), file.name) }));
			} finally { await fs.rm(staged, { recursive: true, force: true }); }
		},
	};
}

export const attachmentStore = createAttachmentStore(path.join(PATHS.data, "attachments"));
