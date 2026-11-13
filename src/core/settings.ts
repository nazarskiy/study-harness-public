
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { CacheRetention } from "@earendil-works/pi-ai";
import { AUTH_PROVIDER_KEYS } from "./auth-keys.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";
import type { ModelRole } from "../../config.ts";
import type { ChatSettings } from "./contracts/chat.ts";
import { isSearchEngineId, type SearchEngineId } from "./search.ts";
import { isDictationLanguage, type DictationLanguage } from "./dictation.ts";
import { parseFileAccessSettings, type FileAccessSettings } from "./file-access.ts";
import { DEFAULT_THEME_PREFERENCE, isThemePreference, type ThemePreference } from "./themes.ts";

export const CURRENT_SETTINGS_VERSION = 1;

export const BACKGROUND_MODEL_ROLES = [
	"researcher",
	"demoBuilder",
	"visualMaker",
	"extractor",
	"auditor",
	"sideQuestion",
] as const;

export type BackgroundModelRole = (typeof BACKGROUND_MODEL_ROLES)[number];

export interface RoleModelOverride {
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}


export const MODEL_SLOTS = ["strong", "cheap", "vision"] as const;
export type ModelSlotName = (typeof MODEL_SLOTS)[number];

export const DEFAULT_THINKING_ORDER = [
	"medium",
	"low",
	"high",
	"minimal",
	"xhigh",
	"max",
] as const satisfies readonly ThinkingLevel[];

export const MODELS_NOT_CONFIGURED_CODE = "models_not_configured" as const;
export interface ModelsNotConfigured {
	error: string;
	code: typeof MODELS_NOT_CONFIGURED_CODE;
	missing: ModelSlotName[];
}
export function modelsNotConfigured(missing: ModelSlotName[]): ModelsNotConfigured {
	return {
		error: "No model configured — set up your models first",
		code: MODELS_NOT_CONFIGURED_CODE,
		missing,
	};
}

export function isModelsRefusal(error: string | undefined): boolean {
	return !!error && error.startsWith(modelsNotConfigured([]).error);
}
export class ModelsNotConfiguredError extends Error {
	readonly envelope: ModelsNotConfigured;
	constructor(missing: ModelSlotName[]) {
		super(modelsNotConfigured(missing).error);
		this.name = "ModelsNotConfiguredError";
		this.envelope = modelsNotConfigured(missing);
	}
}

export const PROVIDER_KEY_MISSING_CODE = "provider_key_missing" as const;
export interface ProviderKeyMissing {
	error: string;
	code: typeof PROVIDER_KEY_MISSING_CODE;
	provider: string;
	slots: ModelSlotName[];
}
const PROVIDER_KEY_MISSING_TAIL = "key is set — add one in Settings → Keys";
const CLAUDE_CODE_UNAVAILABLE = "Claude Code is unavailable. Enable and set it up in Settings → Providers.";
export function providerKeyMissing(provider: string, slots: ModelSlotName[]): ProviderKeyMissing {
	const label = AUTH_PROVIDER_KEYS.find((p) => p.id === provider)?.label ?? provider;
	return {
		error: provider === CLAUDE_CODE_PROVIDER ? CLAUDE_CODE_UNAVAILABLE : `No ${label} ${PROVIDER_KEY_MISSING_TAIL}`,
		code: PROVIDER_KEY_MISSING_CODE,
		provider,
		slots,
	};
}
export function isProviderKeyRefusal(error: string | undefined): boolean {
	return !!error && (error.endsWith(PROVIDER_KEY_MISSING_TAIL) || error === CLAUDE_CODE_UNAVAILABLE);
}
export class ProviderKeyMissingError extends Error {
	readonly envelope: ProviderKeyMissing;
	constructor(provider: string, slots: ModelSlotName[]) {
		const envelope = providerKeyMissing(provider, slots);
		super(envelope.error);
		this.name = "ProviderKeyMissingError";
		this.envelope = envelope;
	}
}

export const CACHE_RETENTIONS = ["none", "short", "long"] as const satisfies readonly CacheRetention[];

export interface ModelSlot {
	cacheRetention?: CacheRetention;
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}

export interface ModelsSettings {
	strong?: ModelSlot;
	cheap?: ModelSlot;
	vision?: ModelSlot;
}


export const CUSTOM_MODEL_DEFAULT_CONTEXT_WINDOW = 8192;
export const CUSTOM_MODEL_DEFAULT_MAX_TOKENS = 4096;

export const CUSTOM_MODEL_PIN_FLOOR = 1;

export interface CustomModel {
	id: string;
	image?: boolean;
	reasoning?: boolean;
	context?: number;
	maxTokens?: number;
}

export interface CustomModelOverride {
	context?: number;
	maxTokens?: number;
	reasoning?: boolean;
}

export interface CustomProviderSettings {
	credentialBindingId?: string;
	authMode?: "keyless" | "apiKey";
	baseUrl?: string;
	models?: CustomModel[];
	overrides?: Record<string, CustomModelOverride>;
	manualModels?: string[];
}

export function parseModelIds(raw: unknown): string[] {
	const items = typeof raw === "string" ? raw.split(/[\s,]+/) : Array.isArray(raw) ? raw : [];
	const ids = items.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean);
	return [...new Set(ids)];
}

export function normalizeBaseUrl(raw: string): string {
	const value = raw.trim();
	if (!value) return "";
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return "";
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return "";
	if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) return "";
	return url.toString().replace(/\/+$/, "");
}

export function customProviderUsable(
	cp: CustomProviderSettings | undefined,
): cp is CustomProviderSettings & { baseUrl: string } {
	return Boolean(cp?.baseUrl);
}

export function slotsConfigured(models: ModelsSettings | undefined): boolean {
	return Boolean(models?.strong?.model && models?.cheap?.model && models?.vision?.model);
}

export const ROLE_SLOT: Readonly<Record<ModelRole, ModelSlotName>> = {
	prober: "strong",
	teacher: "strong",
	researcher: "cheap",
	demoBuilder: "cheap",
	extractor: "cheap",
	auditor: "cheap",
	visualMaker: "vision",
	pdfReader: "vision",
	sideQuestion: "strong",
};

export interface GeneralSettings {
	autoUpdate?: boolean;
}

export interface DictationSettings {
	language?: DictationLanguage;
}

export interface AgentSettings {
	workerRequestConcurrency?: number;
	models?: Partial<Record<BackgroundModelRole, RoleModelOverride>>;
	tools?: Record<string, boolean>;
	search?: { engine?: SearchEngineId };
	graphTools?: { enabled?: boolean };
	fileAccess?: FileAccessSettings;
}

export interface AppearanceSettings {
	mode?: ThemePreference;
	proseFontSize?: number;
}

export interface GraphSettings {
	enabled?: boolean;
	rendering?: boolean;
	extractionChunkTokens?: number;
}

export interface CompactionSettings {
	thresholdTokens?: number;
	includeReasoning?: boolean;
}

export interface UserSettings {
	version: number;
	general?: GeneralSettings;
	dictation?: DictationSettings;
	claudeCode?: { enabled?: boolean };
	agent?: AgentSettings;
	models?: ModelsSettings;
	customProvider?: CustomProviderSettings;
	appearance?: AppearanceSettings;
	graph?: GraphSettings;
	compaction?: CompactionSettings;
	[key: string]: unknown;
}

export interface FactorySettings {
	version: number;
	agent: Required<Pick<AgentSettings, "workerRequestConcurrency">>;
	general: Required<GeneralSettings>;
	dictation: Required<DictationSettings>;
	appearance: {
		mode: ThemePreference;
		proseFontSize: number;
	};
	graph: Required<GraphSettings>;
	compaction: Required<CompactionSettings>;
}

export const FACTORY_SETTINGS: FactorySettings = {
	version: CURRENT_SETTINGS_VERSION,
	agent: { workerRequestConcurrency: 8 },
	general: { autoUpdate: true },
	dictation: { language: "en" },
	appearance: {
		mode: DEFAULT_THEME_PREFERENCE,
		proseFontSize: 17,
	},
	graph: { enabled: true, rendering: true, extractionChunkTokens: 4096 },
	compaction: { thresholdTokens: 150_000, includeReasoning: false },
};

export const EXTRACTION_CHUNK_TOKENS_FLOOR = 500;


const PROSE_FONT_MIN = 12;
const PROSE_FONT_MAX = 24;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

const boolOrDrop = (value: unknown): boolean | undefined =>
	typeof value === "boolean" ? value : undefined;

function sanitizeGeneral(raw: Record<string, unknown>): GeneralSettings {
	const out: GeneralSettings = {};
	const autoUpdate = boolOrDrop(raw.autoUpdate);
	if (autoUpdate !== undefined) out.autoUpdate = autoUpdate;
	return out;
}

const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

function sanitizeRoleOverride(raw: unknown): RoleModelOverride | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const r = raw as Record<string, unknown>;
	const out: RoleModelOverride = {};
	if (
		typeof r.model === "object" &&
		r.model !== null &&
		!Array.isArray(r.model) &&
		typeof (r.model as Record<string, unknown>).provider === "string" &&
		typeof (r.model as Record<string, unknown>).id === "string"
	) {
		out.model = {
			provider: (r.model as { provider: string }).provider,
			id: (r.model as { id: string }).id,
		};
	}
	if (typeof r.thinkingLevel === "string" && THINKING_LEVELS.includes(r.thinkingLevel as ThinkingLevel)) {
		out.thinkingLevel = r.thinkingLevel as ThinkingLevel;
	}
	return Object.keys(out).length ? out : undefined;
}

function sanitizeModels(raw: Record<string, unknown>): ModelsSettings {
	const out: ModelsSettings = {};
	for (const slot of MODEL_SLOTS) {
		const cleaned: ModelSlot = sanitizeRoleOverride(raw[slot]) ?? {};
		const value = raw[slot];
		if (value && typeof value === "object" && !Array.isArray(value)) {
			const retention = (value as Record<string, unknown>).cacheRetention;
			if (CACHE_RETENTIONS.includes(retention as CacheRetention)) cleaned.cacheRetention = retention as CacheRetention;
		}
		if (Object.keys(cleaned).length) out[slot] = cleaned;
	}
	return out;
}

function positiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function sanitizeCustomModelOverride(raw: unknown): CustomModelOverride | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const rec = raw as Record<string, unknown>;
	const out: CustomModelOverride = {};
	const context = positiveInt(rec.context);
	if (context) out.context = Math.max(CUSTOM_MODEL_PIN_FLOOR, context);
	const maxTokens = positiveInt(rec.maxTokens);
	if (maxTokens) out.maxTokens = Math.max(CUSTOM_MODEL_PIN_FLOOR, maxTokens);
	if (typeof rec.reasoning === "boolean") out.reasoning = rec.reasoning;
	return Object.keys(out).length ? out : undefined;
}

export function sanitizeCustomModelOverrides(
	raw: unknown,
	liveIds?: Iterable<string>,
): Record<string, CustomModelOverride> {
	const out: Record<string, CustomModelOverride> = {};
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
	const live = liveIds ? new Set(liveIds) : undefined;
	for (const [key, value] of Object.entries(raw)) {
		const id = key.trim();
		if (!id || (live && !live.has(id))) continue;
		const pin = sanitizeCustomModelOverride(value);
		if (pin) Object.defineProperty(out, id, { value: pin, enumerable: true, configurable: true, writable: true });
	}
	return out;
}

function sanitizeCustomProvider(raw: Record<string, unknown>): CustomProviderSettings {
	const out: CustomProviderSettings = {};
	if (typeof raw.credentialBindingId === "string" && /^[a-f0-9]{32}$/.test(raw.credentialBindingId)) out.credentialBindingId = raw.credentialBindingId;
	if (raw.authMode === "keyless" || raw.authMode === "apiKey") out.authMode = raw.authMode;
	if (typeof raw.baseUrl === "string") {
		const base = normalizeBaseUrl(raw.baseUrl);
		if (base) out.baseUrl = base;
	}
	if (Array.isArray(raw.models)) {
		const byId = new Map<string, CustomModel>();
		for (const m of raw.models) {
			if (typeof m !== "object" || m === null) continue;
			const rec = m as Record<string, unknown>;
			if (typeof rec.id !== "string") continue;
			const id = rec.id.trim();
			if (!id) continue;
			const model: CustomModel = { id };
			if (rec.image === true) model.image = true;
			if (rec.reasoning === true) model.reasoning = true;
			const context = positiveInt(rec.context);
			if (context) model.context = context;
			const maxTokens = positiveInt(rec.maxTokens);
			if (maxTokens) model.maxTokens = maxTokens;
			byId.set(id, model);
		}
		out.models = [...byId.values()];
	}
	const overrides = sanitizeCustomModelOverrides(raw.overrides);
	if (Object.keys(overrides).length) out.overrides = overrides;
	const manualModels = parseModelIds(raw.manualModels);
	if (manualModels.length) out.manualModels = manualModels;
	return out;
}

function sanitizeBooleanMap(raw: unknown): Record<string, boolean> | undefined {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return undefined;
	const out: Record<string, boolean> = {};
	for (const [key, value] of Object.entries(raw)) {
		if (typeof value === "boolean") out[key] = value;
	}
	return Object.keys(out).length ? out : undefined;
}

function sanitizeAgent(raw: Record<string, unknown>): AgentSettings {
	const out: AgentSettings = {};
	if (typeof raw.workerRequestConcurrency === "number" && Number.isSafeInteger(raw.workerRequestConcurrency) && raw.workerRequestConcurrency > 0) {
		out.workerRequestConcurrency = raw.workerRequestConcurrency;
	}
	if (raw.models !== null && typeof raw.models === "object" && !Array.isArray(raw.models)) {
		const models: Partial<Record<BackgroundModelRole, RoleModelOverride>> = {};
		for (const [role, override] of Object.entries(raw.models as Record<string, unknown>)) {
			if ((BACKGROUND_MODEL_ROLES as readonly string[]).includes(role)) {
				const cleaned = sanitizeRoleOverride(override);
				if (cleaned) models[role as BackgroundModelRole] = cleaned;
			}
		}
		if (Object.keys(models).length) out.models = models;
	}
	const tools = sanitizeBooleanMap(raw.tools);
	if (tools) out.tools = tools;
	if (raw.search !== null && typeof raw.search === "object" && !Array.isArray(raw.search)) {
		const engine = (raw.search as Record<string, unknown>).engine;
		if (isSearchEngineId(engine)) out.search = { engine };
	}
	if (raw.graphTools !== null && typeof raw.graphTools === "object" && !Array.isArray(raw.graphTools)) {
		const enabled = (raw.graphTools as Record<string, unknown>).enabled;
		if (enabled === undefined) out.graphTools = {};
		else if (typeof enabled === "boolean") out.graphTools = { enabled };
	}
	if (raw.fileAccess !== undefined) {
		const parsed = parseFileAccessSettings(raw.fileAccess);
		out.fileAccess = parsed.ok ? parsed.settings : { restricted: true, folders: [] };
	}
	return out;
}

function sanitizeAppearance(raw: Record<string, unknown>): AppearanceSettings {
	const out: AppearanceSettings = {};
	if (isThemePreference(raw.mode)) out.mode = raw.mode;
	if (typeof raw.proseFontSize === "number" && Number.isFinite(raw.proseFontSize)) {
		out.proseFontSize = clamp(Math.round(raw.proseFontSize), PROSE_FONT_MIN, PROSE_FONT_MAX);
	}
	return out;
}

function sanitizeGraph(raw: Record<string, unknown>): GraphSettings {
	const out: GraphSettings = {};
	const enabled = boolOrDrop(raw.enabled);
	if (enabled !== undefined) out.enabled = enabled;
	const rendering = boolOrDrop(raw.rendering);
	if (rendering !== undefined) out.rendering = rendering;
	const rawTokens = raw.extractionChunkTokens;
	if (typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0) {
		out.extractionChunkTokens = Math.max(EXTRACTION_CHUNK_TOKENS_FLOOR, Math.floor(rawTokens));
	}
	return out;
}

export const COMPACTION_THRESHOLD_FLOOR = 32_000;

function sanitizeCompaction(raw: Record<string, unknown>): CompactionSettings {
	const out: CompactionSettings = {};
	const includeReasoning = boolOrDrop(raw.includeReasoning);
	if (includeReasoning !== undefined) out.includeReasoning = includeReasoning;
	const rawTokens = raw.thresholdTokens;
	if (typeof rawTokens === "number" && Number.isFinite(rawTokens) && rawTokens > 0) {
		out.thresholdTokens = Math.max(COMPACTION_THRESHOLD_FLOOR, Math.floor(rawTokens));
	}
	return out;
}

export function sanitizeUserSettings(raw: unknown): UserSettings | null {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const out: UserSettings = {
		version: typeof r.version === "number" && Number.isInteger(r.version) && r.version >= 1 ? r.version : CURRENT_SETTINGS_VERSION,
	};
	if (r.general !== null && typeof r.general === "object" && !Array.isArray(r.general)) {
		out.general = sanitizeGeneral(r.general as Record<string, unknown>);
	}
	if (r.dictation !== undefined) {
		const raw = r.dictation;
		out.dictation = raw !== null && typeof raw === "object" && !Array.isArray(raw) &&
			isDictationLanguage((raw as Record<string, unknown>).language)
			? { language: (raw as DictationSettings).language }
			: {};
	}
	if (r.claudeCode !== undefined) {
		const raw = r.claudeCode;
		out.claudeCode = raw !== null && typeof raw === "object" && !Array.isArray(raw)
			&& typeof (raw as Record<string, unknown>).enabled === "boolean"
			? { enabled: (raw as { enabled: boolean }).enabled } : {};
	}
	if (r.agent !== null && typeof r.agent === "object" && !Array.isArray(r.agent)) {
		out.agent = sanitizeAgent(r.agent as Record<string, unknown>);
	}
	if (r.appearance !== null && typeof r.appearance === "object" && !Array.isArray(r.appearance)) {
		out.appearance = sanitizeAppearance(r.appearance as Record<string, unknown>);
	}
	if (r.models !== null && typeof r.models === "object" && !Array.isArray(r.models)) {
		const models = sanitizeModels(r.models as Record<string, unknown>);
		if (Object.keys(models).length) out.models = models;
	}
	if (r.customProvider !== null && typeof r.customProvider === "object" && !Array.isArray(r.customProvider)) {
		out.customProvider = sanitizeCustomProvider(r.customProvider as Record<string, unknown>);
	}
	if (r.graph !== null && typeof r.graph === "object" && !Array.isArray(r.graph)) {
		out.graph = sanitizeGraph(r.graph as Record<string, unknown>);
	}
	if (r.compaction !== undefined && r.compaction !== null && typeof r.compaction === "object") {
		out.compaction = sanitizeCompaction(r.compaction as Record<string, unknown>);
	}
	for (const [key, value] of Object.entries(r)) {
		if (key === "chat") continue;
		if (!(key in out)) out[key] = value;
	}
	return out;
}
