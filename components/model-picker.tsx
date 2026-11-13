"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatSettings, ModelCatalogEntry, ModelCatalogResponse, ModelsSettings, UserSettings } from "@/src/core";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { CpuIcon, ChevronDownIcon, CheckIcon } from "@/components/ui/icons";
import { prettyModel } from "@/components/usage-format";
import { ModelMenuList } from "@/components/settings/model-menu";
import { composeSlotModel } from "@/components/settings/agent-section";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { isInputShortcutScopeEligible } from "@/components/plugin-input-focus";
import { Hint } from "@/components/ui/hint";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { useModelCatalog } from "@/components/model-catalog";
export { useModelCatalog } from "@/components/model-catalog";
import { defaultOrderLevel, populateLevel, THINKING_LABEL } from "@/components/thinking-default";

export function catalogLimits(catalog: Pick<ModelCatalogResponse, "models">): Map<string, number> {
	return new Map(catalog.models.flatMap((m) => m.contextWindow === null ? [] : [[`${m.provider}:${m.id}`, m.contextWindow] as const]));
}

export function ModelControl({ chatId, onModelChange }: { chatId?: string; onModelChange?: (model: string | undefined) => void }) {
	const { catalog, refresh } = useModelCatalog();
	const [models, setModels] = useState<ModelsSettings | undefined>();
	const [session, setSession] = useState<{ settings?: ChatSettings }>();
	const [open, setOpen] = useState<"model" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const interactions = useInteractionLayers();

	const readRecord = useCallback(() => {
		if (chatId) {
			fetch(`/api/chats/${chatId}`)
				.then((r) => { if (!r.ok) throw new Error(`session read failed: ${r.status}`); return r.json() as Promise<{ settings?: ChatSettings }>; })
				.then((body) => setSession({ settings: body.settings }))
				.catch(() => {
				});
		}
		fetch("/api/settings")
			.then((r) => r.json() as Promise<{ settings: { models?: ModelsSettings } | null }>)
			.then((body) => setModels(body.settings?.models ?? undefined))
			.catch(() => {
			});
	}, [chatId]);

	useEffect(() => {
		readRecord();
	}, [readRecord]);

	useSettingsSaved((section) => {
		if (section === "models") readRecord();
	});

	const strong = models?.strong;
	const override: ChatSettings | undefined = chatId
		? session ? {
				model: session.settings?.model ?? strong?.model,
				thinkingLevel: session.settings?.thinkingLevel ?? strong?.thinkingLevel,
			} : undefined
		: strong;
	const effectiveId = override?.model?.id;
	const effectiveProvider = override?.model?.provider;
	useEffect(() => {
		onModelChange?.(effectiveProvider && effectiveId ? `${effectiveProvider}:${effectiveId}` : undefined);
	}, [effectiveProvider, effectiveId, onModelChange]);
	const storedLevel = override?.thinkingLevel;
	const entry = catalog?.models.find(
		(m) => m.id === effectiveId && m.provider === effectiveProvider,
	);
	const levels = entry?.supportedLevels ?? [];
	const effectiveLevel = storedLevel ?? (entry ? defaultOrderLevel(levels) : undefined);

	useEffect(() => {
		if (open === null) return;
		const onPointerDown = (e: PointerEvent) => {
			const popup = interactions.getTopLayer();
			if (popup?.kind !== "popup" || !containerRef.current?.contains(popup.anchorRef?.current ?? null) || !interactions.isElementEligible(popup.rootRef.current)) return;
			const t = e.target as Element;
			if (t instanceof Element && t.closest("[data-owlly-menu]")) return;
			if (containerRef.current && !containerRef.current.contains(t)) {
				setOpen(null);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
		};
	}, [open, interactions]);

	const save = useCallback(
		async (next: ModelsSettings) => {
			setError(null);
			setSaving(true);
			try {
				const res = await fetch("/api/settings/models", {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(next),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: string };
					setError(body.error ?? `settings rejected (${res.status})`);
					return;
				}
				const stored = (
					(await res.json().catch(() => null)) as { settings?: UserSettings } | null
				)?.settings?.models;
				setModels(stored ?? next);
				notifySettingsSaved("models");
			} catch {
				setError("Could not reach the server — try again.");
			} finally {
				setSaving(false);
			}
		},
		[],
	);

	const saveChat = useCallback(
		async (next: ChatSettings) => {
			setError(null);
			setSaving(true);
			try {
				const res = await fetch(`/api/chats/${chatId}/settings`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(next),
				});
				if (!res.ok) {
					const body = (await res.json().catch(() => ({}))) as { error?: string };
					setError(body.error ?? `settings rejected (${res.status})`);
					return;
				}
				const stored = (await res.json().catch(() => null)) as { settings?: ChatSettings } | null;
				setSession({ settings: stored?.settings ?? next });
			} catch {
				setError("Could not reach the server — try again.");
			} finally {
				setSaving(false);
			}
		},
		[chatId],
	);

	const apply = useCallback(
		(provider: string, id: string, level: ThinkingLevel | undefined) => {
			if (saving) return;
			if (chatId) {
				void saveChat({ model: { provider, id }, thinkingLevel: level });
			} else {
				void save(composeSlotModel(models, "strong", provider, id, level ?? ""));
			}
		},
		[chatId, models, save, saveChat, saving],
	);

	useEffect(() => {
		const onOpenPicker = () => {
			if (!isInputShortcutScopeEligible(containerRef.current, interactions)) return;
			setOpen("model");
			setError(null);
			refresh();
		};
		window.addEventListener("owlly:kbd-open-model-picker", onOpenPicker);
		return () => window.removeEventListener("owlly:kbd-open-model-picker", onOpenPicker);
	}, [refresh, interactions]);

	useEffect(() => {
		const onCycleThinking = () => {
			if (!isInputShortcutScopeEligible(containerRef.current, interactions)) return;
			if (levels.length === 0) return;
			const idx = effectiveLevel === undefined ? -1 : levels.indexOf(effectiveLevel);
			const next = levels[(idx + 1) % levels.length];
			if (next === undefined) return;
			apply(effectiveProvider ?? "", effectiveId ?? "", next);
		};
		window.addEventListener("owlly:kbd-cycle-thinking", onCycleThinking);
		return () => window.removeEventListener("owlly:kbd-cycle-thinking", onCycleThinking);
	}, [levels, effectiveLevel, effectiveProvider, effectiveId, apply, interactions]);

	const pickModel = (m: ModelCatalogEntry) => {
		const nextLevel = populateLevel(storedLevel, m.supportedLevels);
		apply(m.provider, m.id, nextLevel);
	};

	const openMenu = (kind: "model") => {
		setOpen((o) => (o === kind ? null : kind));
		setError(null);
		if (kind === "model") refresh();
	};

	return (
		<div ref={containerRef} className="relative ml-auto min-w-0" data-testid="model-control">
			<Hint label="Choose model and reasoning" action="open-model-picker" side="top">
				<button type="button" data-testid="stats-model" onClick={() => openMenu("model")}
					aria-expanded={open === "model"} aria-haspopup="dialog"
					className="flex max-w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:border-secondary hover:bg-muted">
					<CpuIcon aria-hidden className="size-4 shrink-0 text-secondary" />
					<span className="min-w-0"><span className="block truncate text-xs font-extrabold text-foreground">{effectiveId ? prettyModel(effectiveId) : "Choose a model"}</span>
						<span className="block truncate text-[10px] text-muted-foreground">{effectiveProvider ?? "Connect a provider"}{effectiveLevel ? ` · ${THINKING_LABEL[effectiveLevel] ?? effectiveLevel}` : ""}</span></span>
					<ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
				</button>
			</Hint>
			{open === "model" && (
				<MenuShell anchorRef={containerRef} testid="model-menu" onClose={() => { setOpen(null); return "closed"; }} preferredSide="up"
					menuClass="flex w-[25rem] max-w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-2xl border-2 bg-card p-3 text-xs shadow-xl">
					<section role="dialog" aria-label="Model and reasoning" className="contents" aria-busy={saving}>
					<div className="mb-3"><h2 className="text-sm font-extrabold text-foreground">Model & reasoning</h2><p className="mt-1 text-muted-foreground">{chatId ? "Customize this session" : "Choose the default for new sessions"}</p></div>
					{error && <div role="alert" className="mb-2 rounded-lg bg-error-soft p-2 text-error">{error}</div>}
					<ModelMenuList models={catalog?.models} effectiveId={effectiveId} effectiveProvider={effectiveProvider} onPick={pickModel} disabled={saving}
						footer={catalog && catalog.models.length === 0 ? "No models yet — connect a provider in Settings" : undefined} />
					<div className="mt-3 shrink-0 border-t pt-3" data-testid="model-reasoning">
						<div className="mb-2 font-extrabold text-foreground">Reasoning effort</div>
						{levels.length > 0 ? <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reasoning effort">
							{levels.map((level) => <button key={level} type="button" data-testid={`thinking-option-${level}`} aria-pressed={level === effectiveLevel} disabled={saving}
								onClick={() => apply(effectiveProvider ?? "", effectiveId ?? "", level)}
								className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 font-bold transition-colors ${level === effectiveLevel ? "border-secondary bg-secondary-soft text-secondary" : "border-border text-muted-foreground hover:bg-muted"}`}>
								{level === effectiveLevel && <CheckIcon aria-hidden className="size-3" />}{THINKING_LABEL[level] ?? level}
							</button>)}
						</div> : <p className="text-muted-foreground">{effectiveId ? "This model manages its own reasoning." : "Select a model to see its reasoning options."}</p>}
					</div>
					</section>
				</MenuShell>
			)}
		</div>
	);
}
