"use client";

import { useEffect, useRef, useState } from "react";
import type { CacheRetention } from "@earendil-works/pi-ai";
import { CacheRetentionMenu, cacheRetentionLabel } from "./cache-retention-menu.tsx";
import { MenuShell } from "@/components/menu-shell";
import { useInteractionLayers } from "@/components/interaction-layers";
import { defaultOrderLevel, populateLevel } from "@/components/thinking-default";
import { useModelCatalog } from "@/components/model-catalog";
import { Hint } from "@/components/ui/hint";
import type React from "react";
import {
	COMPACTION_THRESHOLD_FLOOR,
	MODEL_SLOTS,
	resolveSettings,
	isFileAccessFolder,
	type AgentSettings,
	type CompactionSettings,
	type GraphSettings,
	type ModelSlotName,
	type ModelsSettings,
} from "@/src/core";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { prettyModel } from "@/components/usage-format";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsRow, SettingsMenuTrigger, Toggle, CommitInput } from "./controls.tsx";
import { ModelMenuList, ThinkingMenuList } from "./model-menu";
import { ChatGPTBackgroundAccess } from "./chatgpt-connection";
import { NativeSubscriptionBackgroundAccess } from "./subscription-connections";

const SLOT_META: Record<ModelSlotName, { label: string; roster: string }> = {
	strong: { label: "Strong", roster: "The main model for your sessions" },
	cheap: { label: "Cheap", roster: "The assistants that research, build demos, and grade your work" },
	vision: { label: "Vision", roster: "The assistants that draw and read PDFs" },
};

export const TOGGLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

const THINKING_LEVELS: readonly ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function composeTool(agent: AgentSettings | undefined, id: string, on: boolean): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, [id]: on } };
}

export function isFolderEntry(folder: string): boolean { return isFileAccessFolder(folder); }

export function composeFileRestriction(agent: AgentSettings | undefined, restricted: boolean): AgentSettings {
	return { ...agent, fileAccess: { restricted, folders: agent?.fileAccess?.folders ?? [] } };
}

export function composeAddFolder(agent: AgentSettings | undefined, folder: string): AgentSettings {
	const next = folder.trim();
	const folders = agent?.fileAccess?.folders ?? [];
	const restricted = agent?.fileAccess?.restricted ?? false;
	if (!isFolderEntry(next) || folders.includes(next)) return { ...agent, fileAccess: { restricted, folders } };
	return { ...agent, fileAccess: { restricted, folders: [...folders, next] } };
}

export function composeRemoveFolder(agent: AgentSettings | undefined, folder: string): AgentSettings {
	return { ...agent, fileAccess: { restricted: agent?.fileAccess?.restricted ?? false, folders: (agent?.fileAccess?.folders ?? []).filter((f) => f !== folder) } };
}

export function composeWorkerRequestConcurrency(
	agent: AgentSettings | undefined,
	value: string,
): { ok: true; settings: AgentSettings } | { ok: false; error: string } {
	const next = { ...agent };
	const draft = value.trim();
	if (draft === "") {
		delete next.workerRequestConcurrency;
		return { ok: true, settings: next };
	}
	const invalid = { ok: false as const, error: "Enter a positive, safely representable whole number." };
	const concurrency = Number(draft);
	if (!Number.isSafeInteger(concurrency) || concurrency <= 0) return invalid;
	const decimal = draft.match(/^\+?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i);
	if (!decimal) return invalid;
	const mantissa = decimal[1]!;
	const fractionalPlaces = mantissa.split(".")[1]?.length ?? 0;
	const coefficient = mantissa.replace(".", "");
	const trailingZeroes = coefficient.length - coefficient.replace(/0+$/, "").length;
	if (Number(decimal[2] ?? 0) - fractionalPlaces + trailingZeroes < 0) return invalid;
	next.workerRequestConcurrency = concurrency;
	return { ok: true, settings: next };
}

export function composeQuizMechanics(agent: AgentSettings | undefined, mechanics: "choice" | "free"): AgentSettings {
	return { ...agent, tools: { ...agent?.tools, explain: mechanics === "free" } };
}

export function composeGraphTools(agent: AgentSettings | undefined, on: boolean): AgentSettings {
	return { ...agent, graphTools: { enabled: on } };
}

export function composeSlotModel(
	models: ModelsSettings | undefined,
	slot: ModelSlotName,
	provider: string,
	id: string,
	thinking: string,
): ModelsSettings {
	const prev = models?.[slot];
	const next = { ...models };
	if (!provider && !id && !thinking) {
		delete next[slot];
		return next;
	}
	next[slot] = {
		...(prev?.cacheRetention !== undefined ? { cacheRetention: prev.cacheRetention } : {}),
		...(provider && id ? { model: { provider, id } } : prev?.model ? { model: prev.model } : {}),
		...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
	};
	return next;
}

export function composeSlotCacheRetention(models: ModelsSettings | undefined, slot: ModelSlotName, value: CacheRetention | undefined): ModelsSettings {
	const next = { ...models?.[slot] };
	if (value === undefined) delete next.cacheRetention;
	else next.cacheRetention = value;
	return { ...models, [slot]: next };
}

function MenuTrigger({
	value,
	emptyLabel,
	ariaLabel,
	testid,
	open,
	onClick,
	widthClass,
	disabled,
	hint,
}: {
	value: string;
	hint?: string;
	emptyLabel: string;
	ariaLabel: string;
	testid: string;
	open: boolean;
	onClick: () => void;
	widthClass: string;
	disabled?: boolean;
}) {
	const button = (
		<SettingsMenuTrigger
			value={value || emptyLabel}
			aria-label={ariaLabel}
			aria-expanded={open}
			data-testid={testid}
			onClick={() => {
				if (!disabled) onClick();
			}}
			unavailable={disabled}
			className={widthClass}
		/>
	);
	return hint ? <Hint label={hint}>{button}</Hint> : button;
}


export function AgentSection({
	agent,
	fileAccessError,
	models,
	graph,
	compaction,
	onSectionChange,
	onModelsChange,
	onCompactionChange,
}: {
	agent: AgentSettings | undefined;
	fileAccessError?: string | null;
	models: ModelsSettings | undefined;
	graph: GraphSettings | undefined;
	compaction: CompactionSettings | undefined;
	onSectionChange: (next: AgentSettings) => boolean | Promise<boolean>;
	onModelsChange: (next: ModelsSettings) => void;
	onCompactionChange: (next: CompactionSettings) => boolean | Promise<boolean>;
}) {
	const { catalog: body, failed: catalogFailed, refresh: refreshCatalog } = useModelCatalog();
	const catalog = body?.models;
	const slots = body?.slots;
	const [folderInput, setFolderInput] = useState("");
	const [folderError, setFolderError] = useState<string | null>(null);
	const [openMenu, setOpenMenu] = useState<{ target: ModelSlotName; kind: "model" | "thinking" | "cache" } | null>(null);
	const [advancedModels, setAdvancedModels] = useState(false);
	const [workerConcurrencyError, setWorkerConcurrencyError] = useState<string | null>(null);
	const menuAnchorRef = useRef<HTMLSpanElement>(null);
	const interactions = useInteractionLayers();

	useEffect(() => {
		if (openMenu === null) return;
		const onPointerDown = (e: PointerEvent) => {
			const testid = `slot-${openMenu.kind}-menu-${openMenu.target}`;
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>(`[data-testid="${testid}"]`))) return;
			const target = e.target as Node;
			if (menuAnchorRef.current?.contains(target)) return;
			if (target instanceof Element && target.closest("[data-owlly-menu]")) return;
			if (target instanceof Element && target.closest('[role="dialog"]')) {
				setOpenMenu(null);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [openMenu, interactions]);

	const resolvedAgent = resolveSettings(agent === undefined ? null : { version: 1, agent }).agent;
	const resolvedCompaction = resolveSettings(
		compaction === undefined ? null : { version: 1, compaction },
	).compaction;

	return (
		<>
			<SettingsGroup label="Models" testid="group-models">
				<button
					type="button"
					data-testid="models-advanced"
					aria-expanded={advancedModels}
					onClick={() => { setAdvancedModels(!advancedModels); setOpenMenu(null); }}
					className="mb-1 self-start text-xs text-muted-foreground hover:text-foreground"
				>{advancedModels ? "Hide advanced settings" : "Show advanced settings"}</button>
				{catalogFailed && <p role="alert" className="text-xs text-error">Model catalog could not be loaded. Check the connection and retry. <button type="button" className="underline" onClick={refreshCatalog}>Retry</button></p>}
				{MODEL_SLOTS.map((slot) => {
					const override = models?.[slot];
					const modelId = override?.model?.id ?? "";
					const provider = override?.model?.provider ?? "";
					const thinking = override?.thinkingLevel ?? "";
					const pin = slots?.[slot];
					const coord = override?.model ?? pin?.model;
					const chosen = coord ? catalog?.find((m) => m.id === coord.id && m.provider === coord.provider) : undefined;
					const levels = chosen ? chosen.supportedLevels : THINKING_LEVELS;
					const thisMenuOpen = openMenu?.target === slot ? openMenu.kind : null;
					return (
						<SettingsRow
							key={slot}
							label={SLOT_META[slot].label}
							hint={SLOT_META[slot].roster}
							testid={`slot-row-${slot}`}
						>
							{
}
							<span
								ref={thisMenuOpen ? menuAnchorRef : undefined}
								className={`relative flex items-center gap-2 ${advancedModels ? "shrink-0" : ""}`}
							>
								{slot !== "strong" && <><ChatGPTBackgroundAccess provider={coord?.provider} /><NativeSubscriptionBackgroundAccess provider={coord?.provider} /></>}
								<MenuTrigger
									value={modelId ? prettyModel(modelId) : ""}
									hint={modelId ? `${provider}:${modelId}` : undefined}
									emptyLabel="—"
									ariaLabel={`${SLOT_META[slot].label} model`}
									testid={`slot-model-${slot}`}
									open={thisMenuOpen === "model"}
									onClick={() => setOpenMenu(thisMenuOpen === "model" ? null : { target: slot, kind: "model" })}
									widthClass="min-w-20"
								/>
								<MenuTrigger
									value={thinking || (chosen ? defaultOrderLevel(levels) : "")}
									emptyLabel="—"
									ariaLabel={`${SLOT_META[slot].label} thinking`}
									testid={`slot-thinking-${slot}`}
									open={thisMenuOpen === "thinking"}
									onClick={() => setOpenMenu(thisMenuOpen === "thinking" ? null : { target: slot, kind: "thinking" })}
									widthClass="w-20"
								/>
								{advancedModels && <MenuTrigger
									value={cacheRetentionLabel(override?.cacheRetention)}
									emptyLabel="Cache: default"
									ariaLabel={`${SLOT_META[slot].label} cache retention`}
									testid={`slot-cache-${slot}`}
									open={thisMenuOpen === "cache"}
									disabled={!override?.model}
									onClick={() => setOpenMenu(thisMenuOpen === "cache" ? null : { target: slot, kind: "cache" })}
									widthClass="w-40"
								/>}
								{advancedModels && thisMenuOpen === "cache" && <MenuShell
									preferredSide="down"
									anchorTestid={`slot-cache-${slot}`}
									testid={`slot-cache-menu-${slot}`}
									onClose={() => { setOpenMenu(null); return "closed"; }}
									menuClass="flex w-80 flex-col gap-0.5 rounded-xl border-2 border-border bg-card p-2 text-xs shadow-xl"
								>
									<CacheRetentionMenu value={override?.cacheRetention} onPick={(value) => {
										onModelsChange(composeSlotCacheRetention(models, slot, value));
										setOpenMenu(null);
									}} />
								</MenuShell>}
								{thisMenuOpen === "model" && (
									<MenuShell
										preferredSide="down"
											anchorTestid={`slot-model-${slot}`}
										testid={`slot-model-menu-${slot}`}
										onClose={() => { setOpenMenu(null); return "closed"; }}
										menuClass="flex w-[22rem] flex-col rounded-xl border-2 border-border bg-card p-2 text-xs shadow-xl"
									>
										<ModelMenuList
											models={catalog ?? undefined}
											effectiveId={modelId}
											effectiveProvider={provider}
											vision={slot === "vision"}
											onPick={(entry) => {
												const next = populateLevel(thinking || undefined, entry.supportedLevels);
												onModelsChange(composeSlotModel(models, slot, entry.provider, entry.id, next));
												setOpenMenu(null);
											}}
											footer={
												catalog && catalog.length === 0
													? "No models — add a provider key in Keys"
													: "Runs every agent of this tier"
											}
										/>
									</MenuShell>
								)}
								{thisMenuOpen === "thinking" && (
									<MenuShell
										preferredSide="down"
											anchorTestid={`slot-thinking-${slot}`}
										testid={`slot-thinking-menu-${slot}`}
										onClose={() => { setOpenMenu(null); return "closed"; }}
										menuClass="flex w-44 flex-col gap-0.5 rounded-xl border-2 border-border bg-card p-2 text-xs shadow-xl"
									>
										<ThinkingMenuList
											levels={levels.map(String)}
											effectiveLevel={thinking || (chosen ? defaultOrderLevel(levels) : undefined)}
											onPick={(level) => {
												onModelsChange(composeSlotModel(models, slot, provider, modelId, level));
												setOpenMenu(null);
											}}
										/>
									</MenuShell>
								)}
							</span>
						</SettingsRow>
					);
				})}
				<SettingsRow
					label="Concurrent worker requests"
					hint="Maximum simultaneous background-worker model requests. Direct conversations are not limited."
					testid="worker-request-concurrency-row"
				>
					<div
						className="flex flex-col items-end gap-1"
						onChangeCapture={() => setWorkerConcurrencyError(null)}
						onBlurCapture={(event) => {
							if (event.target instanceof HTMLInputElement && event.target.validity.badInput) {
								event.stopPropagation();
								setWorkerConcurrencyError("Enter a positive, safely representable whole number.");
							}
						}}
					>
						<CommitInput
							type="number"
							min={1}
							step={1}
							value={String(agent?.workerRequestConcurrency ?? "")}
							placeholder={String(resolvedAgent.workerRequestConcurrency)}
							ariaLabel="Concurrent worker requests"
							testid="input-worker-request-concurrency"
							onCommit={(value) => {
								const next = composeWorkerRequestConcurrency(agent, value);
								setWorkerConcurrencyError(next.ok ? null : next.error);
								return next.ok ? onSectionChange(next.settings) : false;
							}}
						/>
						{workerConcurrencyError && <p role="alert" className="text-xs text-error">{workerConcurrencyError}</p>}
					</div>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="Tools" testid="group-tools">
				{
}
				{(() => {
					const graphOn = graph?.enabled ?? true;
					return (
						<SettingsRow
							label="Knowledge map tools"
							hint={graphOn ? "Lets the tutor consult your knowledge map between sessions" : "Knowledge map is disabled"}
							testid="graph-tools-row"
							dimmed={!graphOn}
						>
							<Toggle
								checked={agent?.graphTools?.enabled ?? true}
								disabled={!graphOn}
								label="knowledge map tools"
								onChange={(on) => onSectionChange(composeGraphTools(agent, on))}
							/>
						</SettingsRow>
					);
				})()}
				{
}
				{(() => {
					const free = agent?.tools?.explain === true;
					return (
						<SettingsRow
							label="Quizzing"
							hint="How both tutors check your understanding"
							testid="quiz-mechanics-row"
						>
							<div
								role="radiogroup"
								aria-label="Quizzing mechanics"
								className="flex rounded-lg border-2 border-border bg-muted/30 p-0.5"
								>
								{(["choice", "free"] as const).map((m) => {
									const active = m === "free" ? free : !free;
									return (
										<button
											key={m}
											type="button"
											role="radio"
											aria-checked={active}
											data-testid={`quiz-mechanics-${m}`}
											onClick={() => onSectionChange(composeQuizMechanics(agent, m))}
											className={cn(
												"h-8 rounded-md px-3 text-sm font-medium transition-colors",
												active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
											)}
										>
											{m === "choice" ? "Multiple choice" : "Free recall"}
										</button>
									);
								})}
							</div>
						</SettingsRow>
					);
				})()}
				{TOGGLE_TOOLS.map((id) => (
					<SettingsRow
						key={id}
						label={`Tool · ${id}`}
						testid={`tool-row-${id}`}
					>
						<Toggle
							checked={agent?.tools?.[id] ?? true}
							label={`tool ${id}`}
							onChange={(on) => onSectionChange(composeTool(agent, id, on))}
						/>
					</SettingsRow>
				))}
				{(() => {
					const folders = agent?.fileAccess?.folders ?? [];
					const restricted = Boolean(fileAccessError) || agent?.fileAccess?.restricted === true;
					const effectiveAgent = fileAccessError ? { ...agent, fileAccess: { restricted: true, folders } } : agent;
					const addFolder = () => {
						const next = folderInput.trim();
						if (!isFolderEntry(next)) { setFolderError("Enter an absolute path or ~/folder."); return; }
						if (!folders.includes(next)) onSectionChange(composeAddFolder(effectiveAgent, next));
						setFolderInput("");
						setFolderError(null);
					};
					return (
						<div data-testid="file-access-row" className="flex flex-col gap-2">
							<SettingsRow label="File access" hint={!restricted
								? "Broad local source access, except protected locations"
								: folders.length ? "Only listed folders and subfolders."
									: "Restricted: no folders allowed. Add a folder to enable access."}>
								<div className="flex items-center gap-2 text-xs">
									<span>Restrict to listed folders</span>
									<Toggle checked={restricted} label="Restrict to listed folders" onChange={(on) => onSectionChange(composeFileRestriction(effectiveAgent, on))} />
								</div>
							</SettingsRow>
							{fileAccessError && <p role="alert" data-testid="file-access-config-error" className="text-xs text-error">{fileAccessError}</p>}
							<div className="flex gap-2 pl-3">
								<input value={folderInput} aria-label="Allowed folder path" data-testid="file-access-add" placeholder="Absolute path or ~/folder"
									onChange={(event) => { setFolderInput(event.target.value); setFolderError(null); }}
									onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addFolder(); } }}
									className="min-w-0 flex-1 rounded-lg border-2 border-border bg-background px-2 py-1 text-xs" />
								<button type="button" data-testid="file-access-add-button" disabled={!folderInput.trim()} onClick={addFolder} className="rounded-lg border-2 border-border px-2 text-xs disabled:opacity-40">Add folder</button>
							</div>
							{folderError && <p role="alert" data-testid="file-access-input-error" className="pl-3 text-xs text-error">{folderError}</p>}
							{folders.map((folder) => (
								<div key={folder} data-testid="file-access-folder" className="flex items-center justify-between gap-4 pl-3 text-xs">
									<span title={folder} className="min-w-0 truncate text-muted-foreground">{folder}</span>
									<button type="button" aria-label={`Remove ${folder}`} data-testid="file-access-remove"
										onClick={() => onSectionChange(composeRemoveFolder(effectiveAgent, folder))}
										className="rounded-lg px-1.5 text-muted-foreground hover:text-foreground">Remove</button>
								</div>
							))}
						</div>
					);
				})()}

			</SettingsGroup>

			<SettingsGroup label="Context" testid="group-context">
				<SettingsRow
					label="Compaction threshold"
					hint={`${resolvedCompaction.thresholdTokens} tok`}
					testid="compaction-row-threshold"
				>
					<CommitInput
						type="number"
						value={String(compaction?.thresholdTokens ?? "")}
						placeholder={String(resolvedCompaction.thresholdTokens)}
						ariaLabel="compaction threshold"
						testid="input-compaction-threshold"
						onCommit={(v) => {
							if (v === "") {
								return onCompactionChange({ ...compaction, thresholdTokens: undefined });
							}
							const n = Number(v);
							if (!Number.isFinite(n) || n <= 0) return false;
							return onCompactionChange({
								...compaction,
								thresholdTokens: Math.max(COMPACTION_THRESHOLD_FLOOR, Math.round(n)),
							});
						}}
					/>
				</SettingsRow>
				<SettingsRow
					label="Include reasoning in token estimates (OpenAI Responses only)"
					hint="Use saved output-token usage to account for replayed reasoning on matching OpenAI Responses models. Off uses the original text-based estimate."
					testid="compaction-row-reasoning"
				>
					<Toggle
						label="Include reasoning in token estimates (OpenAI Responses only)"
						checked={resolvedCompaction.includeReasoning}
						onChange={(includeReasoning) => onCompactionChange({ ...compaction, includeReasoning })}
					/>
				</SettingsRow>
			</SettingsGroup>

		</>
	);
}
