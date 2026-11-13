import path from "node:path";
import { Worker } from "node:worker_threads";
import {
	IMAGE_RESIZE_WORKER_RESPONSE_TYPE,
	resizeImageInProcess,
	type ResizeImageWorkerResponse,
} from "./resize-core.mjs";
import type { ModelImageResizeOptions, ResizedImage } from "./types.ts";

function isResizeImageWorkerResponse(value: unknown): value is ResizeImageWorkerResponse {
	return value !== null && typeof value === "object" && "type" in value && value.type === IMAGE_RESIZE_WORKER_RESPONSE_TYPE;
}

async function resizeImageInWorker(workerPath: string, inputBytes: Uint8Array, mimeType: string, options?: ModelImageResizeOptions): Promise<ResizedImage | null> {
	const worker = new Worker(workerPath);
	try {
		const inputBytesForWorker = new Uint8Array(inputBytes);
		return await new Promise((resolve, reject) => {
			let settled = false;
			const settle = (result: ResizedImage | null) => {
				if (settled) return;
				settled = true;
				resolve(result);
			};
			const fail = (error: Error) => {
				if (settled) return;
				settled = true;
				reject(error);
			};
			worker.on("message", (message: unknown) => {
				if (!isResizeImageWorkerResponse(message)) return;
				if ("error" in message) fail(new Error(message.error));
				else settle(message.result);
			});
			worker.once("error", fail);
			worker.once("exit", (code) => {
				if (!settled) fail(new Error(`Image resize worker exited with code ${code}`));
			});
			worker.postMessage({ inputBytes: inputBytesForWorker, mimeType, options }, [inputBytesForWorker.buffer]);
		});
	} finally {
		void worker.terminate().catch(() => undefined);
	}
}

export async function resizeImage(inputBytes: Uint8Array, mimeType: string, options?: ModelImageResizeOptions): Promise<ResizedImage | null> {
	const workerPath = path.join(process.cwd(), "src/agent/image-processing/resize-worker.mjs");
	try {
		return await resizeImageInWorker(workerPath, inputBytes, mimeType, options);
	} catch {
		return resizeImageInProcess(inputBytes, mimeType, options);
	}
}

export function formatDimensionNote(result: ResizedImage): string | undefined {
	if (!result.wasResized) return undefined;
	const scale = result.originalWidth / result.width;
	return `[Image: original ${result.originalWidth}x${result.originalHeight}, displayed at ${result.width}x${result.height}. Multiply coordinates by ${scale.toFixed(2)} to map to original image.]`;
}
