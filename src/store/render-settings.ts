
import fs from "node:fs";
import path from "node:path";
import { RENDER_SETTINGS_FILE } from "../../config.ts";
import { DEFAULT_RENDER_SETTINGS, sanitizeRenderSettings, type GraphRenderSettings } from "../core/render-settings.ts";
import { assertGraphFormat, ensureGraphFormat } from "./graph-format.ts";
import { writeFileAtomicSync } from "./atomic-write.ts";

export function readRenderSettings(): GraphRenderSettings | null {
	assertGraphFormat();
	let raw: string;
	try {
		raw = fs.readFileSync(RENDER_SETTINGS_FILE, "utf-8");
	} catch {
		return null;
	}
	try {
		return sanitizeRenderSettings(JSON.parse(raw));
	} catch {
		return null;
	}
}

export function writeRenderSettings(raw: unknown): GraphRenderSettings {
	const settings = sanitizeRenderSettings(raw);
	fs.mkdirSync(path.dirname(RENDER_SETTINGS_FILE), { recursive: true });
	ensureGraphFormat();
	writeFileAtomicSync(RENDER_SETTINGS_FILE, JSON.stringify(settings, null, "\t"), { allowInPlaceFallback: true });
	return settings;
}

export { DEFAULT_RENDER_SETTINGS };
