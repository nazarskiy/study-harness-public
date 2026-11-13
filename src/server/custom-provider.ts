
import { createProvider, type Api, type Model, type Provider } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { configureProviderSource, piModels } from "../agent/models.ts";
import { readSettings } from "../store/settings.ts";
import { CustomBodyLimitError, readBoundedJson } from "./custom-provider-body.ts";
import { CUSTOM_PROVIDER } from "../core/auth-keys.ts";
import { customBindingMatches } from "../core/custom-provider-auth.ts";
import { customAuthState, customKeyAuthorized } from "./custom-provider-auth.ts";
import {
	CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW,
	CUSTOM_MODEL_DEFAULT_MAX_TOKENS,
	customProviderUsable,
	normalizeBaseUrl,
	type CustomModel,
	type CustomModelOverride,
} from "../core/settings.ts";


const KEYLESS_PLACEHOLDER = "not-needed";

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export function installCustomProviderSource(readAuth = customAuthState): void {
	let fingerprint: string | undefined;
	configureProviderSource({
		isCustom: (id) => id === CUSTOM_PROVIDER.id,
		sync(models) {
			const cp = readSettings()?.customProvider;
			const auth = readAuth(cp?.authMode === "apiKey", cp);
			const key = auth.key;
			const ready = customProviderUsable(cp) && auth.readable && customBindingMatches(cp, auth.binding) && (cp.authMode === "keyless" || customKeyAuthorized(cp, auth));
			const next = JSON.stringify([cp, auth]);
			if (next === fingerprint) return;
			if (ready) models.setProvider(buildOpenAiCompatibleProvider({ ...cp, baseUrl: cp.baseUrl, models: cp.models ?? [], apiKey: key }));
			else models.deleteProvider(CUSTOM_PROVIDER.id);
			fingerprint = next;
		},
	});
}

export function customProviderAvailable(): boolean {
	return piModels().getProvider(CUSTOM_PROVIDER.id) !== undefined;
}

function toPiModel(
	model: CustomModel,
	baseUrl: string,
	overrides: Record<string, CustomModelOverride>,
): Model<Api> {
	const pin = overrides[model.id];
	return {
		id: model.id,
		name: model.id,
		api: "openai-completions",
		provider: CUSTOM_PROVIDER.id,
		baseUrl,
		reasoning: pin?.reasoning ?? Boolean(model.reasoning),
		input: model.image ? ["text", "image"] : ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: pin?.context ?? model.context ?? CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW,
		maxTokens: pin?.maxTokens ?? model.maxTokens ?? CUSTOM_MODEL_DEFAULT_MAX_TOKENS,
		type: "chat",
	};
}

export function buildOpenAiCompatibleProvider(input: {
	baseUrl: string;
	models: readonly CustomModel[];
	overrides?: Record<string, CustomModelOverride>;
	apiKey?: string;
}): Provider<Api> {
	const overrides = input.overrides ?? {};
	return createProvider<Api>({
		id: CUSTOM_PROVIDER.id,
		name: CUSTOM_PROVIDER.label,
		baseUrl: input.baseUrl,
		auth: { apiKey: {
			name: `${CUSTOM_PROVIDER.label} API key`,
			resolve: async () => ({ auth: { apiKey: input.apiKey ?? KEYLESS_PLACEHOLDER }, source: input.apiKey ? CUSTOM_PROVIDER.envVar : "keyless" }),
		} },
		models: input.models.map((m) => toPiModel(m, input.baseUrl, overrides)),
		api: openAICompletionsApi(),
	});
}

export function syncCustomProvider(): void {
	piModels();
}

export type DiscoverResult =
	| { ok: true; models: CustomModel[] }
	| { ok: false; error: string; status?: number; fatal?: boolean };

export async function discoverModels(baseUrl: string, apiKey?: string): Promise<DiscoverResult> {
	const base = normalizeBaseUrl(baseUrl);
	if (!base) return { ok: false, error: "Base URL must be a valid http(s) URL" };
	const key = apiKey?.trim();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);
	try {
		const res = await fetch(`${base}/models`, {
			headers: key ? { authorization: `Bearer ${key}` } : {},
			signal: controller.signal,
			redirect: "manual",
		});
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel();
			return { ok: false, error: "Discovery redirects are not allowed", fatal: true };
		}
		if (!res.ok) { await res.body?.cancel(); return { ok: false, error: `Endpoint returned HTTP ${res.status}`, status: res.status }; }
		const body = await readBoundedJson(res, 8 * 1024 * 1024);
		const list = extractModels(body);
		if (list === null) return { ok: false, error: "Endpoint response was not a model list" };
		return { ok: true, models: list };
	} catch (err) {
		return { ok: false, error: err instanceof CustomBodyLimitError ? err.message : controller.signal.aborted ? "Endpoint timed out" : "Discovery request failed", fatal: err instanceof CustomBodyLimitError };
	} finally {
		clearTimeout(timer);
	}
}

export function mergeManualModels(discovered: readonly CustomModel[], manualIds: readonly string[]): CustomModel[] {
	const byId = new Map(discovered.map((m) => [m.id, m]));
	for (const id of manualIds) if (!byId.has(id)) byId.set(id, { id });
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function modelRows(body: unknown): unknown[] | null {
	if (Array.isArray(body)) return body;
	if (isRecord(body)) {
		if (Array.isArray(body.data)) return body.data;
		if (Array.isArray(body.models)) return body.models;
	}
	return null;
}

function detectImage(row: Record<string, unknown>): boolean {
	const architecture = isRecord(row.architecture) ? row.architecture : undefined;
	const candidates = [
		architecture?.input_modalities,
		row.input_modalities,
		row.modalities,
		row.supported_modalities,
		row.capabilities,
	];
	for (const c of candidates) {
		if (Array.isArray(c) && c.some((v) => typeof v === "string" && /image|vision/i.test(v))) return true;
	}
	return false;
}

function detectReasoning(row: Record<string, unknown>): boolean {
	for (const key of ["reasoning", "supports_reasoning", "thinking"] as const) {
		if (row[key] === true) return true;
	}
	const architecture = isRecord(row.architecture) ? row.architecture : undefined;
	const candidates = [row.supported_parameters, row.capabilities, row.tags, architecture?.output_modalities];
	return candidates.some(
		(list) =>
			Array.isArray(list) &&
			list.some((v) => typeof v === "string" && (/reasoning/i.test(v) || v.toLowerCase() === "thinking")),
	);
}

function firstPositive(row: Record<string, unknown>, keys: readonly string[]): number | undefined {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	}
	return undefined;
}

const CONTEXT_KEYS = ["max_input_tokens", "context_length", "context_window", "max_context", "n_ctx", "max_seq_len", "max_position_embeddings"] as const;
const MAX_TOKEN_KEYS = ["max_output_tokens"] as const;
const META_CONTEXT_KEYS = ["n_ctx"] as const;

function extractModels(body: unknown): CustomModel[] | null {
	const rows = modelRows(body);
	if (rows === null) return null;
	if (rows.length > 10_000) throw new CustomBodyLimitError("Model list exceeds 10000 entries");
	const byId = new Map<string, CustomModel>();
	for (const row of rows) {
		if (typeof row === "string") {
			if (row.trim()) byId.set(row, { id: row });
			continue;
		}
		if (isRecord(row) && typeof row.id === "string" && row.id.trim()) {
			const model: CustomModel = { id: row.id };
			if (detectImage(row)) model.image = true;
			if (detectReasoning(row)) model.reasoning = true;
			const context =
				firstPositive(row, CONTEXT_KEYS) ??
				(isRecord(row.meta) ? firstPositive(row.meta, META_CONTEXT_KEYS) : undefined);
			if (context) model.context = context;
			const maxTokens = firstPositive(row, MAX_TOKEN_KEYS);
			if (maxTokens) model.maxTokens = maxTokens;
			byId.set(row.id, model);
		}
	}
	return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
