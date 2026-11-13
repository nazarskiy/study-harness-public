import * as fs from "node:fs";
import * as path from "node:path";
import { standardFontsDir } from "./pdf-ops";
import { svgImageSource } from "../../../lib/svg-image-source";


export interface DemoRunResult {
	consoleErrors: string[];
	pageErrors: string[];
	failedRequests: string[];
	probeResult?: unknown;
	ok: boolean;
}

export interface RunDemoOptions {
	settleMs?: number;
	probe?: string;
}

export interface RenderSvgOptions {
	nativeOnly?: boolean;
	width?: number;
	height?: number;
}

export interface RenderPdfOptions {
	dpi?: number;
}

export interface RenderedPdfPage {
	page: number;
	png: Buffer;
}

export interface HeadlessApi {
	available(): boolean;
	unavailableReason(): string | null;
	runDemo(html: string, opts?: RunDemoOptions): Promise<DemoRunResult>;
	renderSvg(svg: string, opts?: RenderSvgOptions): Promise<Buffer>;
	renderPdfPages(pdfPath: string, pages: number[], opts?: RenderPdfOptions): Promise<RenderedPdfPage[]>;
}

export const headlessOverride: { current?: HeadlessApi } = {};

export function getHeadless(): HeadlessApi {
	return headlessOverride.current ?? realHeadless;
}


const CHROME_CANDIDATES = [
	...(process.platform === "win32" ? [
		path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
		path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
		...(process.env.LOCALAPPDATA ? [path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")] : []),
	] : []),
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
];

export function resolveChromeExecutablePath(): string | null {
	const candidates = [process.env.CHROME_PATH, ...CHROME_CANDIDATES].filter(
		(p): p is string => typeof p === "string" && p.length > 0,
	);
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
		}
	}
	return null;
}

const NO_CHROME_MESSAGE =
	"No render engine available: no system Chrome/Chromium was found. " +
	"Install Google Chrome or set CHROME_PATH to a Chrome executable. " +
	"(Verification is mandatory — demos are never delivered untested.)";


async function withBrowserPage<T>(fn: (page: import("puppeteer-core").Page) => Promise<T>): Promise<T> {
	const puppeteer = (await import("puppeteer-core")).default;
	const executablePath = resolveChromeExecutablePath();
	const browser = await puppeteer.launch({
		headless: true,
		...(executablePath ? { executablePath } : { channel: "chrome" as const }),
		args: ["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
	});
	try {
		const page = await browser.newPage();
		return await fn(page);
	} finally {
		await browser.close().catch(() => {});
	}
}


const ISOLATED_PAGE_SCHEMES = new Set(["http:", "https:", "data:", "blob:", "about:"]);

export function isIsolatedPageRequestAllowed(url: string): boolean {
	try {
		return ISOLATED_PAGE_SCHEMES.has(new URL(url).protocol);
	} catch {
		return false;
	}
}

type IsolatedPage = Pick<
	import("puppeteer-core").Page,
	"url" | "goto" | "setContent" | "setRequestInterception" | "on" | "off"
>;

class IsolatedPageCleanupError extends Error {}

export async function loadIsolatedPage(page: IsolatedPage, html: string): Promise<() => Promise<void>> {
	const onRequest = (request: import("puppeteer-core").HTTPRequest) => {
		const decision = isIsolatedPageRequestAllowed(request.url()) ? request.continue() : request.abort("accessdenied");
		void decision.catch(() => {});
	};
	let retirement: Promise<void> | undefined;
	const cleanup = () => retirement ??= (async () => {
		try {
			await page.goto("about:blank", { timeout: 5_000 });
			await page.setRequestInterception(false);
			page.off("request", onRequest);
		} catch (error) {
			throw new IsolatedPageCleanupError("Could not retire the untrusted browser document", { cause: error });
		}
	})();
	try {
		page.on("request", onRequest);
		await page.setRequestInterception(true);
		if (page.url() !== "about:blank") await page.goto("about:blank", { timeout: 5_000 });
		await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
		return cleanup;
	} catch (err) {
		await cleanup();
		throw err;
	}
}


async function runDemo(html: string, opts: RunDemoOptions = {}): Promise<DemoRunResult> {
	return withBrowserPage(page => runDemoOnPage(page, html, opts));
}

export async function runDemoOnPage(page: import("puppeteer-core").Page, html: string, opts: RunDemoOptions = {}): Promise<DemoRunResult> {
	const settleMs = opts.settleMs ?? 2000;
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const failedRequests: string[] = [];
	let probeResult: unknown;
	let probed = false;

	const onConsole = (msg: import("puppeteer-core").ConsoleMessage) => {
		if (msg.type() === "error") consoleErrors.push(msg.text());
	};
	const onError = (err: unknown) => pageErrors.push(err instanceof Error ? err.message : String(err));
	const onFailed = (req: import("puppeteer-core").HTTPRequest) => failedRequests.push(`${req.url()} (${req.failure()?.errorText ?? "failed"})`);
	page.on("console", onConsole);
	page.on("pageerror", onError);
	page.on("requestfailed", onFailed);
	try {
		let cleanup: (() => Promise<void>) | undefined;
		try {
			cleanup = await loadIsolatedPage(page, html);
			await new Promise((resolve) => setTimeout(resolve, settleMs));
			if (opts.probe) {
				try {
					probeResult = await page.evaluate(opts.probe);
				} catch (err) {
					pageErrors.push(`probe failed: ${err instanceof Error ? err.message : String(err)}`);
				}
				probed = true;
			}
		} catch (err) {
			if (err instanceof IsolatedPageCleanupError) throw err;
			pageErrors.push(err instanceof Error ? err.message : String(err));
		} finally {
			await cleanup?.();
		}
	} finally {
		page.off("console", onConsole);
		page.off("pageerror", onError);
		page.off("requestfailed", onFailed);
	}

	return {
		consoleErrors,
		pageErrors,
		failedRequests,
		...(probed ? { probeResult } : {}),
		ok: consoleErrors.length === 0 && pageErrors.length === 0 && failedRequests.length === 0,
	};
}


function svgViewport(svg: string, opts: RenderSvgOptions): { width: number; height: number } {
	if (opts.width && opts.height) return { width: opts.width, height: opts.height };
	const width = Number(svg.match(/\bwidth\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	const height = Number(svg.match(/\bheight\s*=\s*"?(\d+(?:\.\d+)?)/)?.[1]);
	return {
		width: Math.ceil(Number.isFinite(width) && width > 0 ? width : 900),
		height: Math.ceil(Number.isFinite(height) && height > 0 ? height : 700),
	};
}

export function providerSafePng(png: Buffer): Buffer {
	const SIG_LEN = 8;
	if (png.length < SIG_LEN + 12 || png.subarray(0, SIG_LEN).toString("hex") !== "89504e470d0a1a0a") return png;
	const parts: Array<{ type: string; data: Buffer }> = [];
	let off = SIG_LEN;
	while (off + 12 <= png.length) {
		const len = png.readUInt32BE(off);
		if (off + 12 + len > png.length) break;
		parts.push({ type: png.subarray(off + 4, off + 8).toString("ascii"), data: png.subarray(off + 8, off + 8 + len) });
		off += 12 + len;
	}
	const idats = parts.filter((p) => p.type === "IDAT");
	if (idats.length < 2) return png;
	const merged = Buffer.concat(idats.map((p) => p.data));
	let emittedIdat = false;
	const out: Buffer[] = [png.subarray(0, SIG_LEN)];
	for (const p of parts) {
		if (p.type !== "IDAT") out.push(chunk(p.type, p.data));
		else if (!emittedIdat) {
			out.push(chunk("IDAT", merged));
			emittedIdat = true;
		}
	}
	return Buffer.concat(out);
}

function chunk(type: string, data: Buffer): Buffer {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

function crc32(buf: Buffer): number {
	let c = ~0;
	for (const byte of buf) {
		c ^= byte;
		for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
	}
	return ~c >>> 0;
}

async function renderSvg(svg: string, opts: RenderSvgOptions = {}): Promise<Buffer> {
	const { width } = svgViewport(svg, opts);
	const { Resvg } = await import("@resvg/resvg-js");
	const resvg = new Resvg(opts.nativeOnly ? svg : svgImageSource(svg), {
		fitTo: { mode: "width", value: width },
		font: { loadSystemFonts: true },
		background: "#ffffff",
	});
	return providerSafePng(resvg.render().asPng());
}


export const MAX_PDF_CANVAS_PIXELS = 16_000_000;
export const MAX_PDF_CANVAS_SIDE = 8192;

export function pdfCanvasGeometry(baseWidth: number, baseHeight: number, dpi: number): {
	scale: number;
	width: number;
	height: number;
} {
	if (![baseWidth, baseHeight].every((n) => Number.isFinite(n) && n > 0)) {
		throw new Error("PDF page dimensions must be finite and positive");
	}
	if (!Number.isFinite(dpi) || dpi <= 0 || dpi / 72 === 0) {
		throw new Error("PDF render DPI must be finite and positive");
	}
	let scale = Math.min(dpi / 72, MAX_PDF_CANVAS_SIDE / baseWidth, MAX_PDF_CANVAS_SIDE / baseHeight);
	const area = (baseWidth * scale) * (baseHeight * scale);
	if (area > MAX_PDF_CANVAS_PIXELS) scale *= Math.sqrt(MAX_PDF_CANVAS_PIXELS / area);
	const dimensions = (s: number) => ({
		width: Math.max(1, Math.ceil(baseWidth * s)),
		height: Math.max(1, Math.ceil(baseHeight * s)),
	});
	const fits = ({ width, height }: { width: number; height: number }) =>
		width <= MAX_PDF_CANVAS_SIDE && height <= MAX_PDF_CANVAS_SIDE && width * height <= MAX_PDF_CANVAS_PIXELS;
	if (!fits(dimensions(scale))) {
		let low = 0;
		let high = scale;
		for (let i = 0; i < 64; i++) {
			const mid = low + (high - low) / 2;
			if (fits(dimensions(mid))) low = mid;
			else high = mid;
		}
		scale = low;
	}
	if (scale <= 0 || baseWidth * scale === 0 || baseHeight * scale === 0) {
		throw new Error("PDF page dimensions cannot be rendered at a positive scale");
	}
	return { scale, ...dimensions(scale) };
}

async function renderPdfPages(
	pdfPath: string,
	pages: number[],
	opts: RenderPdfOptions = {},
): Promise<RenderedPdfPage[]> {
	const dpi = opts.dpi ?? 150;
	if (!Number.isFinite(dpi) || dpi <= 0 || dpi / 72 === 0) {
		throw new Error("PDF render DPI must be finite and positive");
	}
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const { createCanvas } = await import("@napi-rs/canvas");
	const data = new Uint8Array(fs.readFileSync(path.resolve(pdfPath)));
	const loadingTask = pdfjs.getDocument({ data, standardFontDataUrl: standardFontsDir(), verbosity: 0 });
	const doc = await loadingTask.promise;
	try {
		const out: RenderedPdfPage[] = [];
		for (const pageNo of pages) {
			if (pageNo < 1 || pageNo > doc.numPages) continue;
			const pg = await doc.getPage(pageNo);
			const base = pg.getViewport({ scale: 1 });
			const geometry = pdfCanvasGeometry(base.width, base.height, dpi);
			const vp = pg.getViewport({ scale: geometry.scale });
			const canvas = createCanvas(geometry.width, geometry.height);
			const ctx = canvas.getContext("2d");
			await pg.render({
				canvasContext: ctx as unknown as CanvasRenderingContext2D,
				canvas: canvas as unknown as HTMLCanvasElement,
				viewport: vp,
			}).promise;
			out.push({
				page: pageNo,
				png: providerSafePng(canvas.toBuffer("image/png")),
			});
		}
		return out;
	} finally {
		await loadingTask.destroy().catch(() => {});
	}
}


export const realHeadless: HeadlessApi = {
	available() {
		return resolveChromeExecutablePath() !== null;
	},
	unavailableReason() {
		return resolveChromeExecutablePath() === null ? NO_CHROME_MESSAGE : null;
	},
	runDemo,
	renderSvg,
	renderPdfPages,
};
