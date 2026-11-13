
import type { AppearanceSettings } from "../core";
import { readSettings } from "../store/settings.ts";

export function readAppearanceBoot(): AppearanceSettings | undefined {
	return readSettings()?.appearance;
}
