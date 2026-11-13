"use client";

import { Owl } from "@/components/owl/owl";
import { useEffect, useRef, useState } from "react";
import { HostDialog } from "@/components/host-dialog";
import { useInteractionLayers } from "@/components/interaction-layers";
import type React from "react";
import { type ModelCatalogEntry, type ModelSlotName, type ModelsSettings, CUSTOM_PROVIDER } from "@/src/core";
import { prettyModel } from "@/components/usage-format";
import { ModelMenuList } from "@/components/settings/model-menu";
import { MenuShell } from "@/components/menu-shell";
import { notifySettingsSaved, useSettingsSaved } from "@/components/settings-signal";
import { useModelCatalog } from "@/components/model-catalog";
import { savedSlotsConfigured } from "@/components/setup-cta";
import { Hint } from "@/components/ui/hint";
import { type ProviderKeyInfo, CUSTOM_PROVIDER_INFO, CustomEndpointSetup } from "@/components/settings/keys-section";
import { ProviderMenuList } from "@/components/settings/model-menu";
import { ChatGPTBackgroundAccess } from "@/components/settings/chatgpt-connection";
import { NativeSubscriptionBackgroundAccess, SubscriptionConnections } from "@/components/settings/subscription-connections";
import { defaultOrderLevel, populateLevel, THINKING_LABEL } from "@/components/thinking-default";
import { ThinkingMenuList } from "@/components/settings/model-menu";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";

const SLOT_META: Record<ModelSlotName, { label: string; roster: string }> = {
	strong: { label: "Strong", roster: "Prober, teacher" },
	cheap: { label: "Cheap", roster: "Researcher, demo builder, extractor, auditor" },
	vision: { label: "Vision", roster: "Visual maker + PDF reader" },
};
const SLOT_ORDER: readonly ModelSlotName[] = ["strong", "cheap", "vision"];

interface ModelsBody {
	models: ModelCatalogEntry[];
	providers: { id: string; keyPresent: boolean }[];
	slots?: Record<ModelSlotName, { model: { provider: string; id: string }; thinkingLevel?: ThinkingLevel } | null>;
}

export function setupStage(
	providers: { id: string; keyPresent: boolean }[] | null,
): "loading" | "keys" | "pickers" {
	if (providers === null) return "loading";
	return providers.some((p) => p.keyPresent) ? "pickers" : "keys";
}

type ModelSelection = Pick<ModelCatalogEntry, "provider" | "id">;

export function prefillFromSlots(
	models: ModelCatalogEntry[],
	slots: Record<ModelSlotName, { model: { provider: string; id: string } } | null> | undefined,
): Partial<Record<ModelSlotName, ModelSelection>> {
	const pre: Partial<Record<ModelSlotName, ModelSelection>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = slots?.[slot];
		const entry = pin?.model
			? models.find((m) => m.provider === pin.model!.provider && m.id === pin.model!.id)
			: undefined;
		if (pin?.model) pre[slot] = entry ?? pin.model;
	}
	return pre;
}

export function prefillLevelFromPin(
	entry: ModelCatalogEntry,
	pin: { thinkingLevel?: ThinkingLevel } | null | undefined,
): ThinkingLevel {
	return populateLevel(pin?.thinkingLevel, entry.supportedLevels);
}

export function SetupKeysBody({
	providers,
	provider,
	value,
	saving,
	error,
	menuOpen,
	onToggleMenu,
	onCloseMenu,
	onPick,
	onValue,
	onSave,
	menuAnchor,
	isCustom,
	onCustomSaved,
}: {
	providers: ProviderKeyInfo[] | undefined;
	provider: ProviderKeyInfo | null;
	value: string;
	saving: boolean;
	error: string | null;
	menuOpen: boolean;
	onToggleMenu: () => void;
	onCloseMenu?: () => void;
	onPick: (p: ProviderKeyInfo) => void;
	onValue: (v: string) => void;
	onSave: () => void;
	menuAnchor: React.RefObject<HTMLDivElement | null>;
	isCustom?: boolean;
	onCustomSaved?: () => void;
}) {
	return (
		<div className="flex flex-col gap-3 px-6 py-5" data-testid="setup-stage-keys">
			<p className="text-xs text-muted-foreground">
				Choose your AI provider and paste its API key. You’ll pick your models next.
			</p>
			<div className="flex flex-col gap-2">
				<div ref={menuAnchor} className="relative max-w-96">
					<button
						type="button"
						aria-label="Provider"
						data-testid="setup-key-provider"
						aria-expanded={menuOpen}
						onClick={onToggleMenu}
						className="flex h-9 w-full items-center gap-1 rounded-xl border-2 border-input bg-card px-2.5 text-sm font-bold text-foreground transition-colors hover:border-secondary"
					>
						<span className="min-w-0 flex-1 truncate text-left">{provider ? provider.label : "Pick a provider…"}</span>
						<span aria-hidden className="text-muted-foreground">
							▾
						</span>
					</button>
					{menuOpen && (
						<MenuShell
							anchorRef={menuAnchor}
							testid="setup-key-provider-menu"
							onClose={() => { onCloseMenu?.(); return "closed"; }}
							preferredSide="down"
							align="left"
							menuClass="flex w-[22rem] flex-col rounded-xl border-2 border-border bg-card p-2 text-xs shadow-xl"
						>
							<ProviderMenuList providers={providers ?? []} onPick={onPick} />
						</MenuShell>
					)}
				</div>
				{provider && (isCustom ? <CustomEndpointSetup onSaved={onCustomSaved ?? onSave} /> : (
					<div className="flex max-w-96 flex-col gap-2">
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={value}
								onChange={(e) => onValue(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && value.trim()) onSave();
								}}
								placeholder="Paste key…"
								aria-label={`${provider.label} key`}
								data-testid="setup-key-input"
								disabled={saving}
								autoFocus
								className="h-9 min-w-0 flex-1 rounded-xl border-2 border-input bg-card px-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
							/>
							<button
								type="button"
								onClick={onSave}
								disabled={saving || !value.trim()}
								data-testid="setup-key-save"
								className="shrink-0 cursor-pointer rounded-xl bg-secondary px-4 py-2 text-xs font-extrabold text-secondary-foreground shadow-[0_3px_0_var(--secondary-shade)] transition-[transform,box-shadow] duration-100 active:translate-y-[3px] active:shadow-none disabled:shadow-none disabled:cursor-not-allowed disabled:opacity-40"
							>
								{saving ? "Saving…" : "Save key"}
							</button>
						</div>
					</div>
				))}
				{error && (
					<p role="alert" data-testid="setup-key-error" className="text-xs text-error">
						{error}
					</p>
				)}
			</div>
			<div className="mt-2 border-t-2 pt-4"><h3 className="mb-3 text-sm font-extrabold text-muted-foreground">Subscriptions</h3><SubscriptionConnections setup /></div>
		</div>
	);
}

function prefillLevels(body: ModelsBody | undefined): Partial<Record<ModelSlotName, ThinkingLevel>> {
	const levels: Partial<Record<ModelSlotName, ThinkingLevel>> = {};
	for (const slot of SLOT_ORDER) {
		const pin = body?.slots?.[slot];
		const entry = body?.models.find((m) => m.provider === pin?.model.provider && m.id === pin.model.id);
		if (pin?.thinkingLevel !== undefined) levels[slot] = pin.thinkingLevel;
		else if (entry) levels[slot] = prefillLevelFromPin(entry, pin);
	}
	return levels;
}

interface SetupDialogProps {
	open: boolean;
	onClose: () => void;
	onDone: (models: ModelsSettings) => void;
}

export function SetupDialog(props: SetupDialogProps) {
	return props.open ? <OpenSetupDialog {...props} /> : null;
}

function OpenSetupDialog({ onClose, onDone }: SetupDialogProps) {
	const controller = useInteractionLayers();
	const { catalog, failed, refresh } = useModelCatalog();
	const providerStageSeen = useRef(false);
	const connectionCloseRequested = useRef(false);
	const [picked, setPicked] = useState(() => prefillFromSlots(catalog?.models ?? [], catalog?.slots));
	const [levels, setLevels] = useState(() => prefillLevels(catalog));
	const editedSlots = useRef(new Set<ModelSlotName>());
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [openMenu, setOpenMenu] = useState<{ slot: ModelSlotName; kind: "model" | "thinking" } | null>(null);
	const [keyProviders, setKeyProviders] = useState<ProviderKeyInfo[] | undefined>(undefined);
	const [keyProvider, setKeyProvider] = useState<ProviderKeyInfo | null>(null);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [keyMenuOpen, setKeyMenuOpen] = useState(false);
	const keyTriggerRef = useRef<HTMLDivElement>(null);

	const [keysTick, setKeysTick] = useState(0);
	useSettingsSaved((section) => {
		if (section === "keys") setKeysTick((t) => t + 1);
	});

	useEffect(() => {
		let cancelled = false;
		fetch("/api/keys")
			.then((r) => r.json())
			.then((b: { providers?: ProviderKeyInfo[] }) => { if (!cancelled) setKeyProviders(b.providers ?? []); })
			.catch(() => { if (!cancelled) setKeyProviders([]); });
		return () => { cancelled = true; };
	}, [keysTick]);

	useEffect(() => {
		if (!catalog) return;
		const pre = prefillFromSlots(catalog.models, catalog.slots);
		const preLevels = prefillLevels(catalog);
		setPicked((prev) => {
			const next = { ...prev };
			for (const slot of SLOT_ORDER) if (!editedSlots.current.has(slot)) {
				if (pre[slot]) next[slot] = pre[slot]; else delete next[slot];
			}
			return next;
		});
		setLevels((prev) => {
			const next = { ...prev };
			for (const slot of SLOT_ORDER) if (!editedSlots.current.has(slot)) {
				if (preLevels[slot] !== undefined) next[slot] = preLevels[slot]; else delete next[slot];
			}
			return next;
		});
	}, [catalog]);

	const stage = setupStage(catalog?.providers ?? null);
	const closeAfterConnection = stage === "pickers" && providerStageSeen.current && savedSlotsConfigured(catalog?.slots);
	useEffect(() => {
		if (stage === "keys") providerStageSeen.current = true;
		if (closeAfterConnection && !connectionCloseRequested.current) {
			connectionCloseRequested.current = true;
			onClose();
		}
	}, [stage, closeAfterConnection, onClose]);

	useEffect(() => {
		const onPointerDown = (e: PointerEvent) => {
			if (!(e.target instanceof Element)) return;
			const t = e.target;
			if (keyMenuOpen && controller.isElementEligible(document.querySelector('[data-testid="setup-key-provider-menu"]'))) {
				if (t.closest("[data-owlly-menu]") || t.closest('[data-testid="setup-key-provider"]')) return;
				setKeyMenuOpen(false);
			}
			if (openMenu === null) return;
			const menuTestid = openMenu.kind === "model" ? `setup-menu-${openMenu.slot}` : `setup-thinking-menu-${openMenu.slot}`;
			if (!controller.isElementEligible(document.querySelector(`[data-testid="${menuTestid}"]`))) return;
			const triggerTestid =
				openMenu.kind === "model" ? `setup-trigger-${openMenu.slot}` : `setup-thinking-${openMenu.slot}`;
			if (t.closest("[data-owlly-menu]") || t.closest(`[data-testid="${triggerTestid}"]`)) return;
			setOpenMenu(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [controller, openMenu, keyMenuOpen]);

	if (closeAfterConnection) return null;

	const allPicked = SLOT_ORDER.every((s) => picked[s]);

	async function saveKey() {
		if (!keyProvider || keySaving) return;
		if (!keyValue.trim()) return;
		setKeySaving(true);
		setKeyError(null);
		const res = await fetch(`/api/keys/${encodeURIComponent(keyProvider.envVar)}`, {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ value: keyValue }),
					}).catch(() => null);
		setKeySaving(false);
		if (!res || !res.ok) {
			const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
			setKeyError(res ? (body?.error ?? `Save failed (${res.status})`) : "Save failed. Check your connection and try again.");
			return;
		}
		setKeyProvider(null);
		setKeyValue("");
		notifySettingsSaved("keys");
	}

	async function save() {
		if (!allPicked || saving) return;
		setSaving(true);
		setError(null);
		const models: ModelsSettings = {};
		for (const slot of SLOT_ORDER) {
			const level = levels[slot];
			models[slot] = {
				...(catalog?.slots[slot]?.cacheRetention !== undefined ? { cacheRetention: catalog.slots[slot]!.cacheRetention } : {}),
				model: { provider: picked[slot]!.provider, id: picked[slot]!.id },
				...(level ? { thinkingLevel: level } : {}),
			};
		}
		const res = await fetch("/api/settings/models", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(models),
		}).catch(() => null);
		if (!res || !res.ok) {
			setSaving(false);
			setError(res ? `Save failed: ${(await res.json().catch(() => ({}))).error ?? res.status}` : "Save failed. Check your connection and try again.");
			return;
		}
		notifySettingsSaved("models");
		onDone(models);
	}

	const keysBody = <SetupKeysBody
		providers={keyProviders ? [...keyProviders, CUSTOM_PROVIDER_INFO] : undefined}
		provider={keyProvider}
		value={keyValue}
		saving={keySaving}
		error={keyError}
		menuOpen={keyMenuOpen}
		menuAnchor={keyTriggerRef}
		isCustom={keyProvider?.id === CUSTOM_PROVIDER.id}
		onCustomSaved={() => { setKeyProvider(null); notifySettingsSaved("keys"); }}
		onToggleMenu={() => setKeyMenuOpen((v) => !v)}
		onCloseMenu={() => setKeyMenuOpen(false)}
		onPick={(p) => { setKeyProvider(p); setKeyMenuOpen(false); setKeyError(null); }}
		onValue={setKeyValue}
		onSave={() => void saveKey()}
	/>;

	return <HostDialog open onClose={() => { onClose(); return "closed"; }} aria-label="Set up your models"
		backdropProps={{ className: "fixed inset-0 z-50 flex items-center justify-center bg-black/45", "data-testid": "setup-backdrop" }}
		frame={<div data-testid="setup-dialog"
			className="settings-dialog-pop flex max-h-[88vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-3xl border-2 border-border bg-card shadow-2xl"
			onClick={(e) => e.stopPropagation()} />}>
				<header className="flex shrink-0 items-center gap-4 border-b-2 border-border bg-secondary-soft px-6 py-4">
					<Owl mood="waving" size={64} />
					<h2 className="text-2xl font-black tracking-tight">Set up your models</h2>
					<Hint label="Close" binding="escape" side="left">
<button
						type="button"
						aria-label="Close setup"
						data-testid="setup-close"
						onClick={onClose}
						className="ml-auto flex size-10 cursor-pointer items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
					>
						✕
					</button>
</Hint>
				</header>

				{failed && (
					<p role="alert" data-testid="setup-catalog-error" className="px-6 py-3 text-sm text-foreground">
						Model catalog could not be loaded. Check the connection and retry. <button type="button" data-testid="setup-retry" className="underline" onClick={refresh}>Retry</button>
					</p>
				)}
				{stage === "loading" ? (
					!failed && <p data-testid="setup-stage-loading" role="status" className="px-6 py-5 text-xs text-muted-foreground">Loading models…</p>
				) : stage === "keys" ? (
					<div className="flex flex-col px-6 py-5">{keysBody}</div>
				) : (
					<div className="flex flex-col gap-4 overflow-y-auto px-6 py-5" data-testid="setup-stage-pickers">
						<p className="text-xs text-muted-foreground">
							Pick the model for each tier. All three are required before chats can start.
						</p>
						{SLOT_ORDER.map((slot) => {
							const entry = picked[slot];
							const level = levels[slot];
							const metadata = catalog?.models.find((m) => m.id === entry?.id && m.provider === entry.provider);
							const levelsForEntry = metadata?.supportedLevels ?? (entry ? Object.keys(THINKING_LABEL) : []);
							const available = catalog?.models ?? (failed ? [] : undefined);
							const slotCatalog = slot === "vision"
								? available?.filter((m) => m.input.includes("image") || m.provider === CUSTOM_PROVIDER.id)
								: available;
							return (
								<div key={slot} data-testid={`setup-slot-${slot}`} className="flex flex-col gap-1.5">
									<span className="flex items-center gap-1.5">
										<span className="text-base font-extrabold text-foreground">{SLOT_META[slot].label}</span>
										{!catalog?.slots?.[slot]?.model && !picked[slot] && (
											<span
												data-testid={`setup-needed-${slot}`}
												className="rounded-full bg-muted px-2 py-0.5 text-xs font-extrabold text-muted-foreground"
											>
												needed
											</span>
										)}
									</span>
									<span className="text-xs text-muted-foreground/70">{SLOT_META[slot].roster}</span>
									{slot !== "strong" && <><ChatGPTBackgroundAccess provider={entry?.provider} /><NativeSubscriptionBackgroundAccess provider={entry?.provider} /></>}
									<div className="flex items-center gap-2">
										<div className="relative flex-1">
											<Hint label={entry ? `${entry.provider}:${entry.id}` : "Pick a model…"}>
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} model`}
												data-testid={`setup-trigger-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "model"}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "model" ? null : { slot, kind: "model" })}
												className="flex h-9 min-w-40 w-full items-center gap-1 rounded-xl border-2 border-input bg-card px-2.5 text-sm font-bold text-foreground transition-colors hover:border-secondary"
											>
												<span className="min-w-0 flex-1 truncate">{entry ? prettyModel(entry.id) : "Pick a model…"}</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											</Hint>
											{
}
											{openMenu?.slot === slot && openMenu.kind === "model" && (
												<MenuShell
													anchorTestid={`setup-trigger-${slot}`}
													testid={`setup-menu-${slot}`}
													onClose={() => { setOpenMenu(null); return "closed"; }}
													preferredSide="down"
													align="left"
													menuClass="flex w-[22rem] flex-col rounded-xl border-2 border-border bg-card p-2 text-xs shadow-xl"
												>
													<ModelMenuList
														models={slotCatalog}
														effectiveId={entry?.id}
														effectiveProvider={entry?.provider}
														vision={slot === "vision"}
														onPick={(m) => {
															editedSlots.current.add(slot);
															setPicked((prev) => ({ ...prev, [slot]: m }));
															setLevels((prev) => ({
																...prev,
																[slot]: populateLevel(prev[slot], m.supportedLevels),
															}));
															setOpenMenu(null);
														}}
														footer={slotCatalog && slotCatalog.length === 0 && slot === "vision" ? "No image-capable models. Add a provider key with access to a vision model." : undefined}
													/>
												</MenuShell>
											)}
										</div>
										{
}
										<div className="relative">
											<button
												type="button"
												aria-label={`${SLOT_META[slot].label} thinking`}
												data-testid={`setup-thinking-${slot}`}
												aria-expanded={openMenu?.slot === slot && openMenu.kind === "thinking"}
												disabled={!entry}
												onClick={() => setOpenMenu(openMenu?.slot === slot && openMenu.kind === "thinking" ? null : { slot, kind: "thinking" })}
												className="flex h-9 w-24 items-center gap-1 rounded-xl border-2 border-input bg-card px-2.5 text-sm font-bold text-foreground transition-colors hover:border-secondary disabled:cursor-not-allowed disabled:opacity-40"
											>
												<span className="min-w-0 flex-1 truncate text-left">
													{entry ? (level ? THINKING_LABEL[level] ?? level : "…") : "—"}
												</span>
												<span aria-hidden className="text-muted-foreground">
													▾
												</span>
											</button>
											{openMenu?.slot === slot && openMenu.kind === "thinking" && (
												<MenuShell
													anchorTestid={`setup-thinking-${slot}`}
													testid={`setup-thinking-menu-${slot}`}
													onClose={() => { setOpenMenu(null); return "closed"; }}
													preferredSide="down"
													align="left"
													menuClass="flex w-44 flex-col gap-0.5 rounded-xl border-2 border-border bg-card p-2 text-xs shadow-xl"
												>
													<ThinkingMenuList
														levels={levelsForEntry.map(String)}
														effectiveLevel={level}
														onPick={(lv) => {
															editedSlots.current.add(slot);
															setLevels((prev) => ({ ...prev, [slot]: lv as ThinkingLevel }));
															setOpenMenu(null);
														}}
													/>
												</MenuShell>
											)}
										</div>
									</div>
								</div>
							);
						})}
						<div className="flex items-center gap-3">
							<button
								type="button"
								data-testid="setup-save"
								disabled={!allPicked || saving}
								onClick={() => void save()}
								className="rounded-lg border-2 border-border bg-background px-3 py-1.5 text-sm font-bold text-foreground transition-colors hover:border-secondary disabled:cursor-not-allowed disabled:opacity-40"
							>
								{saving ? "Saving…" : "Save models"}
							</button>
							{error && <p className="text-xs text-error">{error}</p>}
						</div>
					</div>
				)}
		</HostDialog>;
}
