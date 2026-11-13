import { tex, dvi2svg, BrowserResourceLoader } from "isomorphic-tikzjax";
import { checkSource, checkSvgSize } from "./contract.ts";

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; source: string; resourcesUrl: string }>) => void) | null;
  postMessage(value: unknown): void;
};
let loader: BrowserResourceLoader | undefined;
let resourceUrl: string | undefined;
worker.onmessage = async ({ data }) => {
  try {
    checkSource("tikz", data.source);
    const url = new URL(data.resourcesUrl);
    if (url.origin !== new URL(import.meta.url).origin) throw new Error("TeX resources must be local plugin assets.");
    if (!loader || resourceUrl !== url.href) { resourceUrl = url.href; loader = new BrowserResourceLoader(url.href); }
    const dvi = await tex(data.source, { showConsole: false }, loader);
    const raw = await dvi2svg(dvi, { disableSanitize: true, embedFontCss: false });
    const svg = /^<svg\b/.test(raw) && (raw.match(/<svg\b/g) ?? []).length === 1 && !/<\/svg\s*>/.test(raw) ? raw + "</svg>" : raw;
    checkSvgSize(svg);
    worker.postMessage({ id: data.id, svg });
  } catch (error) {
    worker.postMessage({ id: data.id, error: error instanceof Error ? error.message : "TeX rendering failed." });
  }
};
