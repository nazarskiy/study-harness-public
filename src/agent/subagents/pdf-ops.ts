import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { documentToMarkdown, type PdfPage } from "./pdf-markdown.ts";


export interface PdfPageInfo {
	page: number;
	text_length: number;
	image_count: number;
	math_density: number;
}

export interface PdfInfo {
	path: string;
	page_count: number;
	mean_text_length: number;
	pages: PdfPageInfo[];
}

async function loadPdfjs() {
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjs;
}

export function standardFontsDir(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "node_modules", "pdfjs-dist", "standard_fonts") + "/";
}

async function openDocument(filePath: string) {
	return openBytes(new Uint8Array(await fs.readFile(filePath)));
}

type PdfLoadingTask = Pick<import("pdfjs-dist/legacy/build/pdf.mjs").PDFDocumentLoadingTask, "promise" | "destroy">;
type PdfTaskLoader = (data: Uint8Array, signal?: AbortSignal) => PdfLoadingTask | Promise<PdfLoadingTask>;

async function loadBytes(data: Uint8Array, signal?: AbortSignal): Promise<PdfLoadingTask> {
	signal?.throwIfAborted();
	const pdfjs = await loadPdfjs();
	signal?.throwIfAborted();
	return pdfjs.getDocument({ data, standardFontDataUrl: standardFontsDir(), verbosity: 0 });
}

async function openBytes(data: Uint8Array, signal?: AbortSignal, loadTask: PdfTaskLoader = loadBytes) {
	signal?.throwIfAborted();
	const loadingTask = await loadTask(data, signal);
	let destruction: Promise<void> | undefined;
	const destroy = () => destruction ??= Promise.resolve().then(() => loadingTask.destroy()).finally(() => {
		signal?.removeEventListener("abort", onAbort);
	});
	const onAbort = () => { void destroy().catch(() => {}); };
	signal?.addEventListener("abort", onAbort, { once: true });
	if (signal?.aborted) onAbort();
	try {
		const doc = await loadingTask.promise;
		signal?.throwIfAborted();
		return { doc, task: { destroy } };
	} catch (error) {
		await destroy().catch(() => {});
		signal?.throwIfAborted();
		throw error;
	}
}

function itemsToText(items: unknown[]): string {
	let out = "";
	for (const it of items) {
		if (it && typeof it === "object" && "str" in (it as Record<string, unknown>)) {
			const str = (it as { str?: unknown }).str;
			if (typeof str === "string") out += str;
		}
	}
	return out;
}

function mathDensity(text: string): number {
	let mathChars = 0;
	for (const c of text) {
		const code = c.codePointAt(0)!;
		if (
			(code >= 0x2200 && code <= 0x22ff) ||
			(code >= 0x2100 && code <= 0x214f) ||
			(code >= 0x2190 && code <= 0x21ff) ||
			(code >= 0x27c0 && code <= 0x27ef) ||
			(code >= 0x2980 && code <= 0x29ff) ||
			(code >= 0x2a00 && code <= 0x2aff) ||
			(code >= 0x0370 && code <= 0x03ff) ||
			(code >= 0x1d400 && code <= 0x1d7ff) ||
			"∫∑∏√∂∇∞≈≠≤≥±×÷∈∉⊂⊃∪∩∧∨¬∀∃∅".includes(c)
		) {
			mathChars++;
		}
	}
	return mathChars / Math.max(text.length, 1);
}

export async function pdfProbe(filePath: string): Promise<void> {
	const { task } = await openDocument(filePath);
	await task.destroy();
}

export async function pdfInfo(filePath: string): Promise<PdfInfo> {
	const pdfjs = await loadPdfjs();
	const { doc } = await openDocument(filePath);
	const pages: PdfPageInfo[] = [];
	let totalText = 0;
	for (let i = 1; i <= doc.numPages; i++) {
		const page = await doc.getPage(i);
		const content = await page.getTextContent();
		const text = itemsToText(content.items as unknown[]);
		const ops = await page.getOperatorList();
		let imageCount = 0;
		for (const fn of ops.fnArray) {
			if (fn === pdfjs.OPS.paintImageXObject) imageCount++;
		}
		totalText += text.length;
		pages.push({
			page: i,
			text_length: text.length,
			image_count: imageCount,
			math_density: Math.round(mathDensity(text) * 10000) / 10000,
		});
	}
	return {
		path: filePath,
		page_count: doc.numPages,
		mean_text_length: Math.round(totalText / Math.max(doc.numPages, 1)),
		pages,
	};
}

export function parsePageSpec(spec: string, total: number): number[] {
	const trimmed = spec.trim().toLowerCase();
	if (trimmed === "all") return Array.from({ length: total }, (_, i) => i + 1);
	const pages = new Set<number>();
	for (const part of spec.split(",")) {
		const p = part.trim();
		if (!p) continue;
		if (p.includes("-")) {
			const [startRaw, endRaw] = p.split("-", 2) as [string, string];
			const start = Math.max(1, parseInt(startRaw, 10));
			const end = Math.min(total, parseInt(endRaw, 10));
			for (let pg = start; pg <= end; pg++) pages.add(pg);
		} else {
			const pg = parseInt(p, 10);
			if (pg >= 1 && pg <= total) pages.add(pg);
		}
	}
	return [...pages].sort((a, b) => a - b);
}

export type PdfConversion =
	| { kind: "converted"; pages: PdfPage[] }
	| { kind: "too-long"; pageCount: number }
	| { kind: "unreadable" };

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

export function createPdfConverter(loadTask: PdfTaskLoader = loadBytes) {
	return async (data: Uint8Array, maxPages: number, options?: { signal?: AbortSignal }): Promise<PdfConversion> => {
		const signal = options?.signal;
		let opened: Awaited<ReturnType<typeof openBytes>> | undefined;
		let result: PdfConversion | undefined;
		let failure: unknown;
		try {
			opened = await openBytes(data, signal, loadTask);
			signal?.throwIfAborted();
			result = opened.doc.numPages > maxPages
				? { kind: "too-long", pageCount: opened.doc.numPages }
				: { kind: "converted", pages: await documentToMarkdown(opened.doc, undefined, signal) };
		} catch (error) {
			failure = error;
		} finally {
			try {
				await opened?.task.destroy();
			} catch (error) {
				if (!signal?.aborted && !isAbortError(failure)) throw error;
			}
		}
		signal?.throwIfAborted();
		if (isAbortError(failure)) throw failure;
		return result ?? { kind: "unreadable" };
	};
}

const defaultPdfConverter = createPdfConverter();

export async function convertPdf(data: Uint8Array, maxPages: number, options?: { signal?: AbortSignal }): Promise<PdfConversion> {
	return defaultPdfConverter(data, maxPages, options);
}

function pageMarkdown(page: PdfPage): string {
	return page.kind === "text" ? page.markdown : "";
}

export async function pdfExtract(filePath: string, pageSpec: string): Promise<string> {
	const { doc } = await openDocument(filePath);
	const pages = parsePageSpec(pageSpec, doc.numPages);
	if (pages.length === 0) return "No pages selected — page spec matched nothing.";
	const converted = await documentToMarkdown(doc, pages);
	return converted.map((page) => `--- Page ${page.number} ---\n${pageMarkdown(page)}`).join("\n");
}

export interface PdfSearchHit {
	page: number;
	line: number;
	context: string;
}

export async function pdfSearch(
	filePath: string,
	query: string,
	opts?: { contextLines?: number; literal?: boolean },
): Promise<{ hits: PdfSearchHit[]; pageTexts: Map<number, string> }> {
	const contextLines = opts?.contextLines ?? 3;
	const { doc } = await openDocument(filePath);
	let pattern: RegExp;
	if (opts?.literal) {
		pattern = new RegExp(escapeRegex(query), "i");
	} else {
		try {
			pattern = new RegExp(query, "i");
		} catch (err) {
			throw new Error(`Invalid regex: ${(err as Error).message}`);
		}
	}
	const hits: PdfSearchHit[] = [];
	const pageTexts = new Map<number, string>();
	for (const page of await documentToMarkdown(doc)) {
		const i = page.number;
		const text = pageMarkdown(page);
		pageTexts.set(i, text);
		const lines = text.split("\n");
		for (let ln = 0; ln < lines.length; ln++) {
			if (!pattern.test(lines[ln]!)) continue;
			const start = Math.max(0, ln - contextLines);
			const end = Math.min(lines.length, ln + contextLines + 1);
			const context = lines
				.slice(start, end)
				.map((l, j) => `${start + j === ln ? ">>>" : "   "} ${l}`)
				.join("\n");
			hits.push({ page: i, line: ln + 1, context });
		}
	}
	return { hits, pageTexts };
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderDir(filePath: string): string {
	const abs = path.resolve(filePath);
	let h = 0x811c9dc5;
	for (let i = 0; i < abs.length; i++) {
		h ^= abs.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return path.join("/tmp", `ow-pdf-${h.toString(16).padStart(8, "0")}`);
}