import * as fs from "node:fs/promises";
import { Type } from "typebox";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute, type ImageFileResult } from "../tool-execute.ts";
import { resolveSourcePath } from "./fs-shared.ts";
import { detectSupportedImageMimeTypeFromFile, processImage } from "../image-processing/index.ts";


const MAX_LINES = 2000;
const MAX_BYTES = 50 * 1024;

const readInput = Type.Object({
	path: Type.String({ minLength: 1, description: "Path to the file to read (relative or absolute)" }),
	offset: Type.Optional(Type.Integer({ minimum: 1, description: "Line number to start reading from (1-indexed)" })),
	limit: Type.Optional(Type.Integer({ minimum: 1, description: "Maximum number of lines to read" })),
});

function formatSize(bytes: number): string {
	return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${bytes}B`;
}

function readTextSlice(text: string, offset: number | undefined, limit: number | undefined): string {
	const allLines = text.split("\n");
	const totalLines = allLines.length;
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	if (startLine >= totalLines) {
		throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
	}
	let selected = allLines.slice(startLine, limit !== undefined ? startLine + limit : totalLines);
	let truncatedBy: "lines" | "bytes" | null = null;
	if (selected.length > MAX_LINES) {
		selected = selected.slice(0, MAX_LINES);
		truncatedBy = "lines";
	}
	if (Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
		while (selected.length > 0 && Buffer.byteLength(selected.join("\n"), "utf-8") > MAX_BYTES) {
			selected.pop();
		}
		truncatedBy = "bytes";
	}
	if (truncatedBy === null) {
		const remaining = totalLines - (startLine + selected.length);
		if (remaining > 0) {
			return `${selected.join("\n")}\n\n[${remaining} more lines in file. Use offset=${startLine + selected.length + 1} to continue.]`;
		}
		return selected.join("\n");
	}
	const endLineDisplay = startLine + selected.length;
	const reason =
		truncatedBy === "lines" ? `${MAX_LINES} line limit` : `${formatSize(MAX_BYTES)} limit`;
	return `${selected.join("\n")}\n\n[Showing lines ${startLine + 1}-${endLineDisplay} of ${totalLines} (${reason}). Use offset=${endLineDisplay + 1} to continue.]`;
}

export type ReadModel = Pick<Model<Api>, "input" | "inputLimits">;

export function createReadTool(model?: ReadModel): AgentTool<typeof readInput> {
	return {
		name: "read",
		label: "read",
		description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp, bmp). Images are sent as attachments. For text files, output is truncated to 2000 lines or 50.0KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete. File access settings and protected-location denials apply; use ls without a path to discover allowed folders when restricted.`,
		parameters: readInput,
		execute: serverExecute("read", readInput, async ({ path: rawPath, offset, limit }, { signal }): Promise<string | ImageFileResult> => {
			const absolute = resolveSourcePath(rawPath);
			const mime = await detectSupportedImageMimeTypeFromFile(absolute);
			const buffer = await fs.readFile(absolute, { signal });
			if (mime) {
				const processed = await processImage(buffer, mime, { resizeOptions: model?.inputLimits?.images?.resize });
				signal?.throwIfAborted();
				const note = processed.ok
					? [`Read image file [${processed.mimeType}]`, ...processed.hints]
					: [`Read image file [${mime}]`, processed.message];
				if (model && !model.input.includes("image")) {
					note.push("[Current model does not support images. The image will be omitted from this request.]");
				}
				return {
					text: note.join("\n"),
					...(processed.ok ? { images: [{ data: processed.data, mimeType: processed.mimeType }] } : {}),
				};
			}
			return readTextSlice(buffer.toString("utf-8"), offset, limit);
		}),
	};
}

export const readTool = createReadTool();
