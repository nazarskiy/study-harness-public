"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
	FACTORY_SETTINGS,
	resolveThemeMode,
	type AppearanceSettings,
	type RenderedMode,
	type ThemePreference,
} from "@/src/core";

export function resolveAppearance(delta: AppearanceSettings | undefined) {
	const f = FACTORY_SETTINGS.appearance;
	return {
		mode: (delta?.mode ?? f.mode) as ThemePreference,
		proseFontSize: delta?.proseFontSize ?? f.proseFontSize,
	};
}

interface AppearanceContextValue {
	appearance: ReturnType<typeof resolveAppearance>;
	delta: AppearanceSettings | undefined;
	resolvedMode: RenderedMode;
	onAppearanceChange: (delta: AppearanceSettings | undefined) => void;
}

const AppearanceContext = createContext<AppearanceContextValue>({
	appearance: resolveAppearance(undefined),
	delta: undefined,
	resolvedMode: "light",
	onAppearanceChange: () => {},
});

export function useAppearance() {
	return useContext(AppearanceContext);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function systemPrefersDark(): boolean {
	return typeof window !== "undefined" && window.matchMedia(DARK_QUERY).matches;
}

export function AppearanceProvider({
	children,
	initialAppearance,
}: {
	children: React.ReactNode;
	initialAppearance: AppearanceSettings | undefined;
}) {
	const [delta, setDelta] = useState<AppearanceSettings | undefined>(initialAppearance);
	const appearance = useMemo(() => resolveAppearance(delta), [delta]);
	const [prefersDark, setPrefersDark] = useState(systemPrefersDark);

	useEffect(() => {
		if (appearance.mode !== "system") return;
		const mq = window.matchMedia(DARK_QUERY);
		const onChange = () => setPrefersDark(mq.matches);
		onChange();
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, [appearance.mode]);

	const resolvedMode = resolveThemeMode(appearance.mode, prefersDark);

	useLayoutEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", resolvedMode === "dark");
		root.classList.toggle("light", resolvedMode === "light");
		root.dataset.owllyTheme = appearance.mode;
		root.style.setProperty("--ow-prose-size", `${appearance.proseFontSize}px`);
	}, [resolvedMode, appearance.mode, appearance.proseFontSize]);

	const onAppearanceChange = useCallback((next: AppearanceSettings | undefined) => setDelta(next), []);

	const value = useMemo(
		() => ({ appearance, delta, resolvedMode, onAppearanceChange }),
		[appearance, delta, resolvedMode, onAppearanceChange],
	);
	return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}
