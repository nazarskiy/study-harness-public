"use client";

import { MonitorIcon, MoonIcon, SunIcon } from "@/components/ui/icons";
import {
	EXTRACTION_CHUNK_TOKENS_FLOOR,
	resolveSettings,
	THEME_PREFERENCES,
	type AppearanceSettings,
	type GraphSettings,
	type ThemePreference,
} from "@/src/core";
import { Owl } from "@/components/owl/owl";
import { cn } from "@/lib/utils";
import { useAppearance } from "./appearance.tsx";
import { CommitInput, SettingsRow, Toggle } from "./controls.tsx";

const THEME_LABEL: Record<ThemePreference, string> = { light: "Light", dark: "Dark", system: "System" };
const THEME_ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

function ThemeSwatch({ mode }: { mode: "light" | "dark" }) {
	return (
		<div className={cn(mode, "flex h-full flex-1 items-end justify-center gap-1.5 bg-background p-2")}>
			<Owl mood="neutral" size={36} animated={false} />
			<div className="mb-1 flex flex-1 flex-col gap-1">
				<span className="h-1.5 w-4/5 rounded-full bg-foreground/70" />
				<span className="h-1.5 w-3/5 rounded-full bg-muted-foreground/50" />
				<span className="mt-1 h-3 w-1/2 rounded-md bg-primary" />
			</div>
		</div>
	);
}

export function AppearanceSection({
	appearance,
	onSectionChange,
}: {
	appearance: AppearanceSettings | undefined;
	onSectionChange: (next: AppearanceSettings) => boolean | Promise<boolean>;
}) {
	const { appearance: resolved } = useAppearance();
	return (
		<>
			<div role="radiogroup" aria-label="Theme" data-testid="theme-picker" className="grid grid-cols-3 gap-3">
				{THEME_PREFERENCES.map((pref) => {
					const Icon = THEME_ICON[pref];
					const active = resolved.mode === pref;
					return (
						<button
							key={pref}
							type="button"
							role="radio"
							aria-checked={active}
							data-testid={`theme-${pref}`}
							onClick={() => onSectionChange({ ...appearance, mode: pref })}
							className={cn(
								"group overflow-hidden rounded-2xl border-2 text-left transition-all active:translate-y-0.5",
								active
									? "border-secondary shadow-[0_4px_0_var(--secondary-shade)]"
									: "border-border shadow-[0_4px_0_var(--border)] hover:bg-muted",
							)}
						>
							<div className="flex h-20 overflow-hidden">
								{pref === "system" ? (
									<>
										<ThemeSwatch mode="light" />
										<ThemeSwatch mode="dark" />
									</>
								) : (
									<ThemeSwatch mode={pref} />
								)}
							</div>
							<div className="flex items-center gap-2 border-t-2 border-border bg-card px-3 py-2">
								<Icon className={cn("size-4", active ? "text-secondary" : "text-muted-foreground")} />
								<span className="text-sm font-extrabold">{THEME_LABEL[pref]}</span>
							</div>
						</button>
					);
				})}
			</div>
			<SettingsRow label="Lesson text size" hint={`${resolved.proseFontSize}px`} testid="row-prose-size">
				<CommitInput
					type="number"
					value={String(appearance?.proseFontSize ?? "")}
					placeholder="17"
					ariaLabel="prose font size"
					testid="input-prose-size"
					onCommit={(v) => {
						if (v === "") return onSectionChange({ ...appearance, proseFontSize: undefined });
						const n = Number(v);
						if (!Number.isFinite(n)) return false;
						return onSectionChange({ ...appearance, proseFontSize: Math.min(24, Math.max(12, Math.round(n))) });
					}}
				/>
			</SettingsRow>
		</>
	);
}

export function GraphSection({
	graph,
	onSectionChange,
}: {
	graph: GraphSettings | undefined;
	onSectionChange: (next: GraphSettings) => boolean | Promise<boolean>;
}) {
	const resolved = resolveSettings(graph === undefined ? null : { version: 1, graph }).graph;
	return (
		<>
			{
}
			<SettingsRow label="Extraction" hint="Off = the knowledge map stops growing" testid="graph-row-enabled">
				<Toggle
					checked={graph?.enabled ?? true}
					label="extraction enabled"
					onChange={(on) =>
						onSectionChange({ ...graph, enabled: on })
					}
				/>
			</SettingsRow>
			{
}
			<SettingsRow label="Map rendering" hint="Off = the Knowledge map page shows the chains view" testid="graph-row-rendering">
				<Toggle
					checked={graph?.rendering ?? true}
					label="map rendering enabled"
					onChange={(on) => onSectionChange({ ...graph, rendering: on })}
				/>
			</SettingsRow>
			<SettingsRow
				label="Extraction chunk budget"
				hint={`${resolved.extractionChunkTokens} tok`}
				testid="graph-row-chunk-tokens"
			>
				<CommitInput
					type="number"
					value={String(graph?.extractionChunkTokens ?? "")}
					placeholder={String(resolved.extractionChunkTokens)}
					ariaLabel="extraction chunk budget"
					testid="input-chunk-tokens"
					onCommit={(v) => {
						if (v === "") {
							return onSectionChange({ ...graph, extractionChunkTokens: undefined });
						}
						const n = Number(v);
						if (!Number.isFinite(n) || n <= 0) return false;
						return onSectionChange({
							...graph,
							extractionChunkTokens: Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.round(n)),
						});
					}}
				/>
			</SettingsRow>
		</>
	);
}
