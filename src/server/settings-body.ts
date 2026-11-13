
import path from "node:path";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { ChatSettings } from "../core";
import { isThemePreference } from "../core/themes.ts";
import type {
	AgentSettings,
	AppearanceSettings,
	BackgroundModelRole,
	CompactionSettings,
	CustomModelOverride,
	GeneralSettings,
	GraphSettings,
	ModelsSettings,
	ModelSlot,
	RoleModelOverride,
} from "../core/settings.ts";
import { BACKGROUND_MODEL_ROLES, CACHE_RETENTIONS, COMPACTION_THRESHOLD_FLOOR, CUSTOM_MODEL_PIN_FLOOR, EXTRACTION_CHUNK_TOKENS_FLOOR, MODEL_SLOTS } from "../core/settings.ts";
import { WRITABLE_TOOL_KEYS } from "../core/pending.ts";
import { isSearchEngineId, SEARCH_ENGINES } from "../core/search.ts";
import { parseFileAccessSettings } from "../core/file-access.ts";

export type SettingsBodyResult<T> =
	| { ok: true; settings: T }
	| { ok: false; error: string };

export function parseSettingsBody(body: unknown): SettingsBodyResult<ChatSettings> {
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return { ok: false, error: "Invalid JSON body" };
	}
	const raw = body as {
		model?: { provider?: unknown; id?: unknown };
		thinkingLevel?: unknown;
	};
	const settings: ChatSettings = {};
	if (raw.model !== undefined) {
		if (
			typeof raw.model !== "object" ||
			raw.model === null ||
			typeof raw.model.provider !== "string" ||
			typeof raw.model.id !== "string"
		) {
			return { ok: false, error: "model must be {provider, id}" };
		}
		settings.model = { provider: raw.model.provider, id: raw.model.id };
	}
	if (raw.thinkingLevel !== undefined) {
		if (typeof raw.thinkingLevel !== "string") {
			return { ok: false, error: "thinkingLevel must be a string" };
		}
		settings.thinkingLevel = raw.thinkingLevel as ThinkingLevel;
	}
	return { ok: true, settings };
}


function asRecord(body: unknown): Record<string, unknown> | null {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	return body as Record<string, unknown>;
}

export function parseGeneralSettingsBody(body: unknown): SettingsBodyResult<GeneralSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: GeneralSettings = {};
	if (raw.autoUpdate !== undefined) {
		if (typeof raw.autoUpdate !== "boolean") {
			return { ok: false, error: "autoUpdate must be a boolean" };
		}
		settings.autoUpdate = raw.autoUpdate;
	}
	return { ok: true, settings };
}

export function parseClaudeCodeSettingsBody(body: unknown): SettingsBodyResult<{ enabled?: boolean }> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	if (raw.enabled === undefined) return { ok: true, settings: {} };
	if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
	return { ok: true, settings: { enabled: raw.enabled } };
}

function parseRoleOverride(value: unknown, role: string): { ok: true; override: RoleModelOverride } | { ok: false; error: string } {
	const raw = asRecord(value);
	if (!raw) return { ok: false, error: `${role} must be an object` };
	const override: RoleModelOverride = {};
	if (raw.model !== undefined) {
		if (
			typeof raw.model !== "object" ||
			raw.model === null ||
			typeof (raw.model as Record<string, unknown>).provider !== "string" ||
			typeof (raw.model as Record<string, unknown>).id !== "string"
		) {
			return { ok: false, error: `${role}.model must be {provider, id}` };
		}
		override.model = {
			provider: (raw.model as { provider: string }).provider,
			id: (raw.model as { id: string }).id,
		};
	}
	if (raw.thinkingLevel !== undefined) {
		if (typeof raw.thinkingLevel !== "string") {
			return { ok: false, error: `${role}.thinkingLevel must be a string` };
		}
		override.thinkingLevel = raw.thinkingLevel as ThinkingLevel;
	}
	return { ok: true, override };
}

function parseBooleanMap(value: unknown, field: string): { map?: Record<string, boolean>; error?: string } {
	if (value === undefined) return {};
	const raw = asRecord(value);
	if (!raw) return { error: `${field} must be an object` };
	const out: Record<string, boolean> = {};
	for (const [key, entry] of Object.entries(raw)) {
		if (typeof entry !== "boolean") return { error: `${field}.${key} must be a boolean` };
		out[key] = entry;
	}
	return { map: out };
}

export function parseAgentSettingsBody(body: unknown): SettingsBodyResult<AgentSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: AgentSettings = {};
	if (raw.workerRequestConcurrency !== undefined) {
		if (typeof raw.workerRequestConcurrency !== "number" || !Number.isSafeInteger(raw.workerRequestConcurrency) || raw.workerRequestConcurrency <= 0) {
			return { ok: false, error: "workerRequestConcurrency must be a positive, safely representable whole number" };
		}
		settings.workerRequestConcurrency = raw.workerRequestConcurrency;
	}
	if (raw.models !== undefined) {
		const models = asRecord(raw.models);
		if (!models) return { ok: false, error: "models must be an object" };
		const known = BACKGROUND_MODEL_ROLES as readonly string[];
		const parsed: NonNullable<AgentSettings["models"]> = {};
		for (const [role, value] of Object.entries(models)) {
			if (!known.includes(role)) {
				return { ok: false, error: `unknown role "${role}" (supported: ${known.join(", ")})` };
			}
			const override = parseRoleOverride(value, role);
			if (!override.ok) return { ok: false, error: override.error };
			if (Object.keys(override.override).length) parsed[role as BackgroundModelRole] = override.override;
		}
		if (Object.keys(parsed).length) settings.models = parsed;
	}
	const tools = parseBooleanMap(raw.tools, "tools");
	if (tools.error) return { ok: false, error: tools.error };
	if (tools.map) {
		const supported = WRITABLE_TOOL_KEYS as readonly string[];
		for (const key of Object.keys(tools.map)) {
			if (!supported.includes(key)) {
				return { ok: false, error: `unknown tool "${key}" (supported: ${supported.join(", ")})` };
			}
		}
		settings.tools = tools.map;
	}
	if (raw.search !== undefined) {
		const search = asRecord(raw.search);
		if (!search) return { ok: false, error: "search must be an object" };
		if (search.engine !== undefined) {
			if (!isSearchEngineId(search.engine)) {
				return { ok: false, error: `search.engine must be ${SEARCH_ENGINES.map((engine) => `"${engine.id}"`).join(", ")}` };
			}
			settings.search = { engine: search.engine };
		}
	}
	if (raw.graphTools !== undefined) {
		const graphTools = asRecord(raw.graphTools);
		if (!graphTools) return { ok: false, error: "graphTools must be an object" };
		if (graphTools.enabled !== undefined && typeof graphTools.enabled !== "boolean") {
			return { ok: false, error: "graphTools.enabled must be a boolean" };
		}
		settings.graphTools = graphTools.enabled === undefined ? {} : { enabled: graphTools.enabled };
	}
	if (raw.fileAccess !== undefined) {
		const parsed = parseFileAccessSettings(raw.fileAccess);
		if (!parsed.ok) return parsed;
		if (parsed.settings.folders.some((folder) => folder !== "~" && !folder.startsWith("~/") && !path.isAbsolute(folder))) {
			return { ok: false, error: "fileAccess.folders must be absolute on the server filesystem (or start with ~/)" };
		}
		settings.fileAccess = parsed.settings;
	}
	return { ok: true, settings };
}

export function parseAppearanceSettingsBody(body: unknown): SettingsBodyResult<AppearanceSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: AppearanceSettings = {};
	if (raw.mode !== undefined) {
		if (!isThemePreference(raw.mode)) return { ok: false, error: 'mode must be "light", "dark" or "system"' };
		settings.mode = raw.mode;
	}
	if (raw.proseFontSize !== undefined) {
		if (
			typeof raw.proseFontSize !== "number" ||
			!Number.isInteger(raw.proseFontSize) ||
			raw.proseFontSize < 12 ||
			raw.proseFontSize > 24
		) {
			return { ok: false, error: "proseFontSize must be an integer between 12 and 24" };
		}
		settings.proseFontSize = raw.proseFontSize;
	}
	return { ok: true, settings };
}

export function parseGraphSettingsBody(body: unknown): SettingsBodyResult<GraphSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: GraphSettings = {};
	if (raw.enabled !== undefined) {
		if (typeof raw.enabled !== "boolean") return { ok: false, error: "enabled must be a boolean" };
		settings.enabled = raw.enabled;
	}
	if (raw.rendering !== undefined) {
		if (typeof raw.rendering !== "boolean") return { ok: false, error: "rendering must be a boolean" };
		settings.rendering = raw.rendering;
	}
	if (raw.extractionChunkTokens !== undefined) {
		if (typeof raw.extractionChunkTokens !== "number" || !Number.isFinite(raw.extractionChunkTokens)) {
			return { ok: false, error: "extractionChunkTokens must be a number" };
		}
		const floored = Math.floor(raw.extractionChunkTokens);
		if (floored < EXTRACTION_CHUNK_TOKENS_FLOOR) {
			return {
				ok: false,
				error: `extractionChunkTokens must be at least ${EXTRACTION_CHUNK_TOKENS_FLOOR} (smaller batches waste the per-run graph overhead)`,
			};
		}
		settings.extractionChunkTokens = floored;
	}
	return { ok: true, settings };
}

export function parseModelsSettingsBody(body: unknown): SettingsBodyResult<ModelsSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: ModelsSettings = {};
	for (const key of Object.keys(raw)) {
		const known = MODEL_SLOTS as readonly string[];
		if (!known.includes(key)) {
			return { ok: false, error: `unknown slot "${key}" (supported: ${known.join(", ")})` };
		}
		const parsed = parseRoleOverride(raw[key], key);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		if (!parsed.override.model) {
			return { ok: false, error: `slot "${key}" must set a model (thinkingLevel alone cannot run — absent slot = unset)` };
		}
		const slot: ModelSlot = parsed.override;
		const retention = (raw[key] as Record<string, unknown>).cacheRetention;
		if (retention !== undefined) {
			if (!CACHE_RETENTIONS.some((value) => value === retention)) {
				return { ok: false, error: `${key}.cacheRetention must be none, short, or long` };
			}
			slot.cacheRetention = retention as ModelSlot["cacheRetention"];
		}
		settings[key as (typeof MODEL_SLOTS)[number]] = slot;
	}
	return { ok: true, settings };
}

export function parseCompactionSettingsBody(body: unknown): SettingsBodyResult<CompactionSettings> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const settings: CompactionSettings = {};
	if (raw.includeReasoning !== undefined) {
		if (typeof raw.includeReasoning !== "boolean") {
			return { ok: false, error: "includeReasoning must be true or false" };
		}
		settings.includeReasoning = raw.includeReasoning;
	}
	if (raw.thresholdTokens !== undefined) {
		if (typeof raw.thresholdTokens !== "number" || !Number.isFinite(raw.thresholdTokens)) {
			return { ok: false, error: "thresholdTokens must be a number" };
		}
		const floored = Math.floor(raw.thresholdTokens);
		if (floored < COMPACTION_THRESHOLD_FLOOR) {
			return {
				ok: false,
				error: `thresholdTokens must be at least ${COMPACTION_THRESHOLD_FLOOR} (compaction keeps a ~20k-token recent tail — smaller budgets would churn it)`,
			};
		}
		settings.thresholdTokens = floored;
	}
	return { ok: true, settings };
}

export function parseCustomModelOverridesBody(
	body: unknown,
): SettingsBodyResult<Record<string, CustomModelOverride>> {
	const raw = asRecord(body);
	if (!raw) return { ok: false, error: "Invalid JSON body" };
	const map = asRecord(raw.overrides);
	if (!map) return { ok: false, error: "overrides must be a { modelId: { context?, maxTokens?, reasoning? } } map" };
	const out: Record<string, CustomModelOverride> = {};
	for (const [key, value] of Object.entries(map)) {
		const id = key.trim();
		if (!id) return { ok: false, error: "override keys must be non-empty model ids" };
		const entry = asRecord(value);
		if (!entry) return { ok: false, error: `override for ${id} must be an object` };
		const pin: CustomModelOverride = {};
		for (const field of ["context", "maxTokens"] as const) {
			const v = entry[field];
			if (v === undefined) continue;
			if (typeof v !== "number" || !Number.isInteger(v) || v < CUSTOM_MODEL_PIN_FLOOR) {
				return {
					ok: false,
					error: `${field} for ${id} must be a whole number of tokens at least ${CUSTOM_MODEL_PIN_FLOOR}`,
				};
			}
			pin[field] = v;
		}
		if (entry.reasoning !== undefined) {
			if (typeof entry.reasoning !== "boolean") return { ok: false, error: `reasoning for ${id} must be true or false` };
			pin.reasoning = entry.reasoning;
		}
		Object.defineProperty(out, id, { value: pin, enumerable: true, configurable: true, writable: true });
	}
	return { ok: true, settings: out };
}

export const SETTINGS_SECTIONS = {
	general: parseGeneralSettingsBody,
	chat: parseSettingsBody,
	agent: parseAgentSettingsBody,
	appearance: parseAppearanceSettingsBody,
	graph: parseGraphSettingsBody,
	compaction: parseCompactionSettingsBody,
	models: parseModelsSettingsBody,
	claudeCode: parseClaudeCodeSettingsBody,
} as const;

export type SettingsSectionName = keyof typeof SETTINGS_SECTIONS;
