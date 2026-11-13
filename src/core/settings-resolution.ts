
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ModelRole } from "../../config.ts";
import type { ChatSettings } from "./contracts/chat.ts";
import type { SearchEngineId } from "./search.ts";
import {
	BACKGROUND_MODEL_ROLES,
	FACTORY_SETTINGS,
	MODEL_SLOTS,
	ROLE_SLOT,
	type AgentSettings,
	type BackgroundModelRole,
	type FactorySettings,
	type GeneralSettings,
	type CompactionSettings,
	type CustomModel,
	type CustomModelOverride,
	type GraphSettings,
	type ModelSlot,
	type ModelSlotName,
	type RoleModelOverride,
	type UserSettings,
} from "./settings.ts";

export interface EffectiveSlot {
	cacheRetention?: ModelSlot["cacheRetention"];
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

export interface EffectiveModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

export type EffectiveAppearance = FactorySettings["appearance"];

export interface EffectiveSettings {
	general: Required<GeneralSettings>;
	agent: {
		workerRequestConcurrency: number;
		models: Record<BackgroundModelRole, EffectiveModelSpec | undefined>;
		tools: Record<string, boolean>;
		search: { engine?: SearchEngineId };
		graphTools: { enabled?: boolean };
	};
	models: Record<ModelSlotName, EffectiveSlot | null>;
	appearance: EffectiveAppearance;
	graph: Required<GraphSettings>;
	compaction: Required<CompactionSettings>;
	customProvider: { baseUrl: string; models: CustomModel[]; overrides: Record<string, CustomModelOverride>; manualModels: string[] };
}

export function resolveConversationSpec(
	chat: ChatSettings | undefined,
	strong: EffectiveSlot | null,
): EffectiveModelSpec | null {
	const model = chat?.model ?? (strong ? { provider: strong.provider, id: strong.id } : undefined);
	if (!model) return null;
	return {
		provider: model.provider,
		id: model.id,
		thinkingLevel: chat?.thinkingLevel ?? strong?.thinkingLevel,
	};
}

export function resolveSideQuestionSpec(chat: ChatSettings | undefined, record: UserSettings | null): EffectiveModelSpec | null {
	const conversation = resolveConversationSpec(chat, resolveSlot(record?.models?.strong));
	const override = record?.agent?.models?.sideQuestion;
	const model = override?.model ?? (conversation ? { provider: conversation.provider, id: conversation.id } : undefined);
	if (!model) return null;
	return { provider: model.provider, id: model.id, thinkingLevel: override?.thinkingLevel ?? conversation?.thinkingLevel };
}

export function resolveRoleSpec(role: ModelRole, record: UserSettings | null): EffectiveModelSpec | undefined {
	const bg = BACKGROUND_MODEL_ROLES as readonly string[];
	const override = bg.includes(role) ? record?.agent?.models?.[role as BackgroundModelRole] : undefined;
	return resolveModelSpec(role, override, record?.models);
}

export function resolveSlot(slot: ModelSlot | undefined): EffectiveSlot | null {
	if (!slot?.model) return null;
	return {
		provider: slot.model.provider, id: slot.model.id, thinkingLevel: slot.thinkingLevel,
		...(slot.cacheRetention !== undefined ? { cacheRetention: slot.cacheRetention } : {}),
	};
}

export function resolveModelSpec(
	role: ModelRole,
	override: RoleModelOverride | undefined,
	slots?: Partial<Record<ModelSlotName, ModelSlot>>,
): EffectiveModelSpec | undefined {
	const slotName = ROLE_SLOT[role] as ModelSlotName | undefined;
	const slot = slotName ? slots?.[slotName] : undefined;
	const model = override?.model ?? slot?.model;
	if (!model) return undefined;
	return {
		provider: model.provider,
		id: model.id,
		thinkingLevel: override?.thinkingLevel ?? slot?.thinkingLevel,
	};
}

export function resolveSettings(record: UserSettings | null): EffectiveSettings {
	const agent = record?.agent ?? {};
	const modelsSection = record?.models ?? {};
	const appearance = record?.appearance ?? {};
	const graph = record?.graph ?? {};
	const factoryAppearance = FACTORY_SETTINGS.appearance;
	const models = {} as Record<BackgroundModelRole, EffectiveModelSpec | undefined>;
	for (const role of BACKGROUND_MODEL_ROLES) {
		models[role] = resolveModelSpec(role, agent.models?.[role], modelsSection);
	}
	return {
		general: {
			autoUpdate: record?.general?.autoUpdate ?? FACTORY_SETTINGS.general.autoUpdate,
		},
		agent: {
			workerRequestConcurrency: agent.workerRequestConcurrency ?? FACTORY_SETTINGS.agent.workerRequestConcurrency,
			models,
			tools: agent.tools ?? {},
			search: agent.search ?? {},
			graphTools: agent.graphTools ?? {},
		},
		models: {
			strong: resolveSlot(modelsSection.strong),
			cheap: resolveSlot(modelsSection.cheap),
			vision: resolveSlot(modelsSection.vision),
		},
		appearance: {
			mode: appearance.mode ?? factoryAppearance.mode,
			proseFontSize: appearance.proseFontSize ?? factoryAppearance.proseFontSize,
		},
		graph: {
			enabled: graph.enabled ?? FACTORY_SETTINGS.graph.enabled,
			rendering: graph.rendering ?? FACTORY_SETTINGS.graph.rendering,
			extractionChunkTokens: graph.extractionChunkTokens ?? FACTORY_SETTINGS.graph.extractionChunkTokens,
		},
		compaction: {
			thresholdTokens: record?.compaction?.thresholdTokens ?? FACTORY_SETTINGS.compaction.thresholdTokens,
			includeReasoning: record?.compaction?.includeReasoning ?? FACTORY_SETTINGS.compaction.includeReasoning,
		},
		customProvider: {
			baseUrl: record?.customProvider?.baseUrl ?? "",
			models: record?.customProvider?.models ?? [],
			overrides: record?.customProvider?.overrides ?? {},
			manualModels: record?.customProvider?.manualModels ?? [],
		},
	};
}


export function extractionEnabled(graph: { enabled: boolean }): boolean {
	return graph.enabled;
}

export function renderingEnabled(graph: { rendering: boolean }): boolean {
	return graph.rendering;
}

export function graphToolsEnabled(effective: {
	graph: { enabled: boolean };
	agent: { graphTools: { enabled?: boolean } };
}): boolean {
	return effective.graph.enabled && (effective.agent.graphTools.enabled ?? true);
}
