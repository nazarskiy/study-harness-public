
export type ThemeMode = "dark" | "light";
export type RenderedMode = ThemeMode;
export type ThemePreference = ThemeMode | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "light" || value === "dark" || value === "system";
}

export function resolveThemeMode(pref: ThemePreference, prefersDark: boolean): ThemeMode {
	if (pref === "system") return prefersDark ? "dark" : "light";
	return pref;
}
