import {
	clampThinkingLevel,
	createModels,
	getSupportedThinkingLevels,
	type Api,
	type CacheRetention,
	type Model,
	type Models,
	type MutableModels,
	type StreamFunction,
} from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { lazyApi, lazyStream } from "@earendil-works/pi-ai/api/lazy";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { type ModelRole } from "../../config.ts";
import { DEFAULT_THINKING_ORDER } from "../core/settings.ts";
import packageMetadata from "../../package.json" with { type: "json" };
import { chatGPTModel } from "./chatgpt-bridge.ts";
import { chatGPTStream } from "./chatgpt-stream.ts";
import type { ChatGPTDispatchLifecycle } from "./chatgpt-request-cycle.ts";
import { createClaudeCodeProvider } from "./claude-code/provider.ts";
import { streamClaudeCode } from "./claude-code/stream.ts";
import { nativeSubscriptionId, nativeSubscriptionModel } from "./subscription-bridge.ts";
import { nativeSubscriptionStream } from "./subscription-stream.ts";

export const APP_IDENTITY = Object.freeze({
	userAgent: Object.freeze({ custom: `owlly/${packageMetadata.version}` }),
	attribution: null,
});


export interface PiEngine {
	model: Model<Api>;
	streamFn: StreamFunction;
	level?: ThinkingLevel;
}

export type { ThinkingLevel };

let collection: ReturnType<typeof createModels> | undefined;
interface ProviderSource {
	sync(models: MutableModels): void;
	isCustom(id: string): boolean;
}
let providerSource: ProviderSource | undefined;

export function configureProviderSource(source: ProviderSource): void {
	if (collection && providerSource) {
		for (const provider of collection.getProviders()) {
			if (providerSource.isCustom(provider.id)) collection.deleteProvider(provider.id);
		}
	}
	providerSource = source;
}

export function piModels() {
	if (!collection) {
		collection = createModels({ identity: APP_IDENTITY });
		for (const provider of builtinProviders()) {
			collection.setProvider(provider.id === "amazon-bedrock"
				? { ...provider, ...lazyApi(() => import("@earendil-works/pi-ai/api/bedrock-converse-stream")) }
				: provider);
		}
		collection.setProvider(createClaudeCodeProvider(streamClaudeCode));
	}
	providerSource?.sync(collection);
	return collection;
}

export function openRouterApiKey(): string | undefined {
	return process.env.OPENROUTER_API_KEY || undefined;
}

export interface ResolvedModelSpec {
	provider: string;
	id: string;
	thinkingLevel?: ThinkingLevel;
}

function defaultThinkingLevel(model: Model<Api>): ThinkingLevel {
	const supported = getSupportedThinkingLevels(model);
	for (const level of DEFAULT_THINKING_ORDER) {
		if (supported.includes(level)) return level;
	}
	return supported[0] ?? "off";
}

export function piEngineForSpec(spec: ResolvedModelSpec, background: boolean | (() => boolean) = true, lifecycle?: ChatGPTDispatchLifecycle, cacheRetention?: () => CacheRetention | undefined): PiEngine {
	const models: Models = piModels();
	const nativeId = nativeSubscriptionId(spec.provider);
	const registeredModel = spec.provider === "chatgpt" ? chatGPTModel(spec.id) : nativeId ? nativeSubscriptionModel(spec.provider, spec.id) : models.getModel(spec.provider, spec.id);
	const custom = providerSource?.isCustom(spec.provider) ?? false;
	const permitImages = (value: Model<Api>): Model<Api> => ({ ...value, input: ["text", "image"] });
	const model = custom && registeredModel ? permitImages(registeredModel) : registeredModel;
	if (!model) {
		throw new Error(`${spec.provider} catalog has no model ${spec.id}`);
	}
	const thinkingPreference = spec.thinkingLevel;
	const level = thinkingPreference
		? clampThinkingLevel(model, thinkingPreference)
		: defaultThinkingLevel(model);
	return {
		model,
		level,
		streamFn: (requestModel, context, options) => {
			const retention = cacheRetention?.();
			const requestOptions = {
				...options,
				...(retention !== undefined ? { cacheRetention: retention } : {}),
				reasoning: level === "off" ? undefined : level,
			};
			if (custom) {
				const current = piModels();
				const currentModel = current.getModel(spec.provider, spec.id);
				if (!currentModel) return lazyStream(requestModel, async () => { throw new Error("The selected custom model is unavailable."); });
				const currentLevel = thinkingPreference
					? clampThinkingLevel(currentModel, thinkingPreference)
					: defaultThinkingLevel(currentModel);
				return current.streamSimple(permitImages(currentModel), context, { ...requestOptions, reasoning: currentLevel === "off" ? undefined : currentLevel });
			}
			const purpose = typeof background === "function" ? background : () => background;
			const stream = spec.provider === "chatgpt" ? chatGPTStream(purpose, lifecycle) : nativeId ? nativeSubscriptionStream(models.getProvider(nativeId)!, purpose, lifecycle) : models.streamSimple.bind(models);
			return stream(requestModel, context, requestOptions);
		},
	};
}

export function piEngineFor(role: ModelRole): PiEngine {
	throw new Error(
		`no configured model for role "${role}" — set your model slots (settings → models)`,
	);
}
