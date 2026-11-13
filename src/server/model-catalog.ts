
import { clampThinkingLevel, getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { piModels } from "../agent/models.ts";
import { customProviderAvailable } from "./custom-provider.ts";
import { chatGPTConnected, chatGPTModel, chatGPTModels, refreshChatGPTModels } from "../agent/chatgpt-bridge.ts";
import { NATIVE_SUBSCRIPTIONS } from "../core/contracts/subscriptions.ts";
import { nativeSubscriptionId, nativeSubscriptionConnected, nativeSubscriptionModel, nativeSubscriptionModels, refreshSubscriptionModels } from "../agent/subscription-bridge.ts";

export async function refreshConnectionCatalog(provider?: string): Promise<void> {
	await Promise.all([
		!provider || provider === "chatgpt" ? refreshChatGPTModels(piModels().getModels("openai").filter((m): m is Model<"openai-responses"> => m.api === "openai-responses")) : Promise.resolve(),
		!provider || nativeSubscriptionId(provider) ? refreshSubscriptionModels() : Promise.resolve(),
	]);
}
function connectionModel(provider: string, id: string): Model<Api> | undefined {
	if (provider === CLAUDE_CODE_PROVIDER && !claudeCodeAvailable()) return undefined;
	return provider === "chatgpt" ? chatGPTModel(id) : nativeSubscriptionId(provider) ? nativeSubscriptionModel(provider, id) : piModels().getModel(provider, id);
}
function connectionProviderIds(): string[] { return [...piModels().getProviders().map((p) => p.id), "chatgpt", ...NATIVE_SUBSCRIPTIONS.map((p) => p.logicalId)]; }
import { settingsStore } from "../store/settings.ts";
import { effectiveSettings } from "./stores.ts";
import { keyValue } from "./keys.ts";
import type { ChatSettings } from "../core/contracts/chat.ts";
import type {
	CatalogDefaults,
	CatalogProvider,
	ModelCatalogEntry,
	ModelCatalogResponse,
	RolePins,
	SlotPins,
} from "../core/contracts/models.ts";
import type { EffectiveModelSpec, EffectiveSlot } from "../core/settings-resolution.ts";
import { AUTH_PROVIDER_KEYS, CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { claudeCodeAvailable } from "./claude-code-config.ts";
import { CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";
import {
	BACKGROUND_MODEL_ROLES,
	MODEL_SLOTS,
	customProviderUsable,
	type BackgroundModelRole,
	type ModelSlotName,
	type ModelsSettings,
} from "../core/settings.ts";

export type ModelDto = ModelCatalogEntry;

export function catalogDefaultsFor(
	strong: EffectiveSlot | null,
): CatalogDefaults | null {
	const model = strong ? { provider: strong.provider, id: strong.id } : undefined;
	if (!model) return null;
	const level = strong?.thinkingLevel;
	return {
		model,
		...(level !== undefined ? { thinkingLevel: level } : {}),
	};
}

export function catalogDefaults(): CatalogDefaults | null {
	return catalogDefaultsFor(effectiveSettings().models.strong);
}

export function rolePinsFor(
	models: Record<BackgroundModelRole, EffectiveModelSpec | undefined>,
): RolePins {
	const pins = {} as RolePins;
	for (const role of BACKGROUND_MODEL_ROLES) {
		const spec = models[role];
		pins[role] = spec
			? {
					model: { provider: spec.provider, id: spec.id },
					...(spec.thinkingLevel !== undefined ? { thinkingLevel: spec.thinkingLevel } : {}),
				}
			: null;
	}
	return pins;
}

export function catalogRolePins(): RolePins {
	return rolePinsFor(effectiveSettings().agent.models);
}

export function catalogSlots(): SlotPins {
	const slots = effectiveSettings().models;
	const pins = {} as SlotPins;
	for (const name of ["strong", "cheap", "vision"] as const) {
		const slot: EffectiveSlot | null = slots[name];
		pins[name] = slot
			? {
					model: { provider: slot.provider, id: slot.id },
					...(slot.thinkingLevel !== undefined ? { thinkingLevel: slot.thinkingLevel } : {}),
					...(slot.cacheRetention !== undefined ? { cacheRetention: slot.cacheRetention } : {}),
				}
			: null;
	}
	return pins;
}

export function catalogProviders(): CatalogProvider[] {
	piModels();
	return AUTH_PROVIDER_KEYS.map((p) => ({
		id: p.id,
		envVar: p.envVar,
		keyPresent: keyValue(p.envVar) !== undefined,
	})).concat([
		{ id: "chatgpt", envVar: "", keyPresent: chatGPTConnected() },
		{ id: CLAUDE_CODE_PROVIDER, envVar: "", keyPresent: claudeCodeAvailable() },
		...NATIVE_SUBSCRIPTIONS.map((p) => ({ id: p.logicalId, envVar: "", keyPresent: nativeSubscriptionConnected(p.providerId) })),
		...(customProviderUsable(effectiveSettings().customProvider)
			? [{ id: CUSTOM_PROVIDER.id, envVar: CUSTOM_PROVIDER.envVar, keyPresent: customProviderAvailable() }]
			: []),
	]).sort((a, b) => a.id.localeCompare(b.id));
}

function keyedProviderIds(): Set<string> {
	return new Set(catalogProviders().filter((p) => p.keyPresent).map((p) => p.id));
}

export function toModelDto(model: Model<Api>): ModelDto {
	return {
		id: model.id,
		name: model.name,
		provider: model.provider,
		reasoning: model.reasoning,
		input: [...model.input],
		supportedLevels: getSupportedThinkingLevels(model),
		cost: model.provider === CLAUDE_CODE_PROVIDER || model.provider === CUSTOM_PROVIDER.id ? null : {
			input: model.cost.input,
			output: model.cost.output,
			cacheRead: model.cost.cacheRead,
			cacheWrite: model.cost.cacheWrite,
		},
		contextWindow: model.provider === CLAUDE_CODE_PROVIDER ? null : model.contextWindow,
		maxTokens: model.provider === CLAUDE_CODE_PROVIDER ? null : model.maxTokens,
	};
}

export function catalogContextLimits(): Map<string, number> {
	const keyed = keyedProviderIds();
	const index = new Map<string, number>();
	for (const provider of piModels().getProviders()) {
		if (!keyed.has(provider.id) || provider.id === CLAUDE_CODE_PROVIDER) continue;
		for (const model of piModels().getModels(provider.id)) {
			index.set(`${provider.id}:${model.id}`, model.contextWindow);
		}
	}
	for (const model of [...chatGPTModels(), ...nativeSubscriptionModels()]) index.set(`${model.provider}:${model.id}`, model.contextWindow);
	return index;
}

export function modelCatalog(): ModelCatalogResponse {
	const keyed = keyedProviderIds();
	const models = piModels()
		.getProviders()
		.filter((p) => keyed.has(p.id))
		.flatMap((p) => piModels().getModels(p.id))
		.map(toModelDto)
		.sort((a, b) => (a.provider === b.provider ? a.id.localeCompare(b.id) : a.provider.localeCompare(b.provider)))
		.concat([...chatGPTModels(), ...nativeSubscriptionModels()].map(toModelDto));
	return {
		models,
		defaults: catalogDefaults(),
		rolePins: catalogRolePins(),
		slots: catalogSlots(),
		providers: catalogProviders(),
	};
}

export type SettingsValidation =
	| { ok: true }
	| { ok: false; error: string; supported?: ThinkingLevel[] };

export function validateChatSettings(settings: ChatSettings): SettingsValidation {
	const providers = connectionProviderIds();
	if (settings.model) {
		const { provider, id } = settings.model;
		if (!providers.includes(provider)) {
			return { ok: false, error: `Unknown provider "${provider}" — configured: ${providers.join(", ")}` };
		}
		if (!connectionModel(provider, id)) {
			return { ok: false, error: `No model "${id}" in the ${provider} catalog` };
		}
	}
	return { ok: true };
}

export function validateModelsSettings(settings: ModelsSettings, stored?: ModelsSettings): SettingsValidation {
	for (const name of MODEL_SLOTS) {
		const slot = settings[name];
		if (!slot) continue;
		const previous = stored?.[name]?.model;
		if (slot.model && previous && slot.model.provider === previous.provider && slot.model.id === previous.id) continue;
		const verdict = validateSlotSpec(name, slot);
		if (!verdict.ok) return verdict;
	}
	return { ok: true };
}

function validateSlotSpec(name: ModelSlotName, slot: { model?: { provider: string; id: string }; thinkingLevel?: ThinkingLevel }): SettingsValidation {
	const providers = connectionProviderIds();
	if (slot.model) {
		const { provider, id } = slot.model;
		if (!providers.includes(provider)) {
			return { ok: false, error: `Unknown provider "${provider}" — configured: ${providers.join(", ")}` };
		}
		if (!connectionModel(provider, id)) {
			return { ok: false, error: `No model "${id}" in the ${provider} catalog` };
		}
	}
	return { ok: true };
}


function clampLevelFor(provider: string, id: string, level: ThinkingLevel): ThinkingLevel {
	const model = connectionModel(provider, id);
	return model ? clampThinkingLevel(model, level) : level;
}

export function clampModelsLevels(settings: ModelsSettings): ModelsSettings {
	const out: ModelsSettings = {};
	for (const name of MODEL_SLOTS) {
		const slot = settings[name];
		if (!slot?.model) continue;
		out[name] =
			slot.thinkingLevel !== undefined
				? {
						...slot,
						thinkingLevel: clampLevelFor(slot.model.provider, slot.model.id, slot.thinkingLevel),
					}
				: slot;
	}
	return out;
}

export function clampChatLevel(settings: ChatSettings, strong: EffectiveSlot | null): ChatSettings {
	if (settings.thinkingLevel === undefined) return settings;
	const provider = settings.model?.provider ?? strong?.provider;
	const id = settings.model?.id ?? strong?.id;
	if (!provider || !id) return settings;
	return { ...settings, thinkingLevel: clampLevelFor(provider, id, settings.thinkingLevel) };
}
