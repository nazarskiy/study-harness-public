import type { ImageContent } from "@earendil-works/pi-ai";
import type { PluginQuestionOccurrence } from "./plugin-questions.ts";
import { clonePluginQuestionJson } from "./plugin-questions.ts";

export type PluginSubmissionOccurrence = Readonly<PluginQuestionOccurrence>;
export interface PluginSubmissionContent {
	readonly text: string;
	readonly images: readonly Readonly<ImageContent>[];
}
export interface PluginSubmissionImages {
	readonly answer?: readonly Readonly<ImageContent>[];
	readonly thinking?: readonly Readonly<ImageContent>[];
	readonly readingThinking?: readonly Readonly<ImageContent>[];
}
export interface PluginProblemSubmissionImages {
	readonly submission?: readonly Readonly<ImageContent>[];
	readonly thinking?: readonly Readonly<ImageContent>[];
}
const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Submission must contain objects");
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
	if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Error("Unexpected or missing submission fields");
}
function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
export function preparePluginSubmissionImage(value: unknown): Readonly<ImageContent> {
	const item = object(clonePluginQuestionJson(value));
	keys(item, ["type", "data", "mimeType"]);
	if (item.type !== "image" || typeof item.mimeType !== "string" || !imageMimeTypes.has(item.mimeType) || typeof item.data !== "string" || !item.data.length || !base64.test(item.data)) throw new Error("Submission images require PNG, JPEG, WebP or GIF native base64 image blocks");
	if ((item.data.endsWith("==") && (alphabet.indexOf(item.data.at(-3)!) & 15) !== 0) || (item.data.endsWith("=") && !item.data.endsWith("==") && (alphabet.indexOf(item.data.at(-2)!) & 3) !== 0)) throw new Error("Submission image data must be canonical base64");
	return Object.freeze({ type: "image", data: item.data, mimeType: item.mimeType });
}
function imageList(value: unknown): readonly Readonly<ImageContent>[] {
	if (!Array.isArray(value)) throw new Error("Submission images must be an array");
	return value.map(preparePluginSubmissionImage);
}
export function validatePluginSubmissionImageArray(value: unknown): ImageContent[] {
	return imageList(clonePluginQuestionJson(value)).map(image => ({ ...image }));
}
export function validatePluginSubmissionImages(value: unknown): PluginSubmissionImages {
	return preparePluginSubmissionImages(value);
}
export function preparePluginSubmissionImages(value: unknown): PluginSubmissionImages {
	const item = object(clonePluginQuestionJson(value));
	keys(item, ["answer", "thinking", "readingThinking"], []);
	const result: Record<string, readonly Readonly<ImageContent>[]> = {};
	for (const key of ["answer", "thinking", "readingThinking"] as const) {
		if (!Object.hasOwn(item, key)) continue;
		const images = imageList(item[key]);
		if (images.length) result[key] = images;
	}
	return freeze(result);
}
export function preparePluginProblemSubmissionImages(value: unknown): PluginProblemSubmissionImages {
	const item = object(clonePluginQuestionJson(value));
	keys(item, ["submission", "thinking"], []);
	const result: Record<string, readonly Readonly<ImageContent>[]> = {};
	for (const key of ["submission", "thinking"] as const) if (Object.hasOwn(item, key)) {
		const images = imageList(item[key]);
		if (images.length) result[key] = images;
	}
	return freeze(result);
}
