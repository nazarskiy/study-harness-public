
export interface AuthKeyInfo {
	id: string;
	label: string;
	description: string;
	docsUrl: string;
}

export const AUTH_KEYS: readonly AuthKeyInfo[] = [
	{
		id: "TAVILY_API_KEY",
		label: "Tavily",
		description: "Web-search engine for the researcher sub-agent (AI-native search API). Setting the key activates it — no engine toggle needed.",
		docsUrl: "https://app.tavily.com/",
	},
	{
		id: "BRAVE_API_KEY",
		label: "Brave Search",
		description: "Web-search engine for the researcher sub-agent — the alternative to Tavily. Setting the key activates it.",
		docsUrl: "https://brave.com/search/api/",
	},
	{
		id: "EXA_API_KEY",
		label: "Exa",
		description: "Web-search engine for the researcher. Search requests use your Exa account and its pricing.",
		docsUrl: "https://dashboard.exa.ai/api-keys",
	},
	{
		id: "FIRECRAWL_API_KEY",
		label: "Firecrawl",
		description: "Web-search engine for the researcher sub-agent — an alternative to Tavily and Brave. Setting the key activates it.",
		docsUrl: "https://www.firecrawl.dev/app/api-keys",
	},
	{
		id: "OLLAMA_API_KEY",
		label: "Ollama",
		description: "Hosted web search at ollama.com — requires an Ollama API key. Setting it activates search, not local models.",
		docsUrl: "https://ollama.com/settings/keys",
	},
] as const;

const AUTH_KEY_IDS: ReadonlySet<string> = new Set(AUTH_KEYS.map((k) => k.id));

export function isKnownAuthKey(id: string): boolean {
	return AUTH_KEY_IDS.has(id);
}

export interface AuthProviderInfo {
	id: string;
	envVar: string;
	label: string;
}

export const AUTH_PROVIDER_KEYS: readonly AuthProviderInfo[] = [
	{ id: "ant-ling", envVar: "ANT_LING_API_KEY", label: "Ant Ling" },
	{ id: "anthropic", envVar: "ANTHROPIC_API_KEY", label: "Anthropic" },
	{ id: "baseten", envVar: "BASETEN_API_KEY", label: "Baseten" },
	{ id: "cerebras", envVar: "CEREBRAS_API_KEY", label: "Cerebras" },
	{ id: "deepseek", envVar: "DEEPSEEK_API_KEY", label: "DeepSeek" },
	{ id: "fireworks", envVar: "FIREWORKS_API_KEY", label: "Fireworks" },
	{ id: "google", envVar: "GEMINI_API_KEY", label: "Google" },
	{ id: "groq", envVar: "GROQ_API_KEY", label: "Groq" },
	{ id: "huggingface", envVar: "HF_TOKEN", label: "Hugging Face" },
	{ id: "kimi-coding", envVar: "KIMI_API_KEY", label: "Kimi For Coding" },
	{ id: "meta", envVar: "META_API_KEY", label: "Meta" },
	{ id: "minimax", envVar: "MINIMAX_API_KEY", label: "MiniMax" },
	{ id: "minimax-cn", envVar: "MINIMAX_CN_API_KEY", label: "MiniMax CN" },
	{ id: "mistral", envVar: "MISTRAL_API_KEY", label: "Mistral" },
	{ id: "moonshotai", envVar: "MOONSHOT_API_KEY", label: "Moonshot AI" },
	{ id: "moonshotai-cn", envVar: "MOONSHOT_API_KEY", label: "Moonshot AI CN" },
	{ id: "nvidia", envVar: "NVIDIA_API_KEY", label: "NVIDIA" },
	{ id: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI" },
	{ id: "opencode", envVar: "OPENCODE_API_KEY", label: "OpenCode Zen" },
	{ id: "opencode-go", envVar: "OPENCODE_API_KEY", label: "OpenCode Go" },
	{ id: "openrouter", envVar: "OPENROUTER_API_KEY", label: "OpenRouter" },
	{ id: "qwen-token-plan", envVar: "QWEN_TOKEN_PLAN_API_KEY", label: "Qwen Token Plan" },
	{ id: "qwen-token-plan-cn", envVar: "QWEN_TOKEN_PLAN_CN_API_KEY", label: "Qwen Token Plan CN" },
	{ id: "qwen-token-plan-individual", envVar: "QWEN_TOKEN_PLAN_API_KEY", label: "Qwen Token Plan Individual" },
	{ id: "radius", envVar: "RADIUS_API_KEY", label: "Radius" },
	{ id: "together", envVar: "TOGETHER_API_KEY", label: "Together" },
	{ id: "typesafe", envVar: "TYPESAFE_API_KEY", label: "TypeSafe" },
	{ id: "vercel-ai-gateway", envVar: "AI_GATEWAY_API_KEY", label: "Vercel AI Gateway" },
	{ id: "xai", envVar: "XAI_API_KEY", label: "xAI" },
	{ id: "xiaomi", envVar: "XIAOMI_API_KEY", label: "Xiaomi" },
	{ id: "xiaomi-token-plan-ams", envVar: "XIAOMI_TOKEN_PLAN_AMS_API_KEY", label: "Xiaomi Token Plan AMS" },
	{ id: "xiaomi-token-plan-cn", envVar: "XIAOMI_TOKEN_PLAN_CN_API_KEY", label: "Xiaomi Token Plan CN" },
	{ id: "xiaomi-token-plan-sgp", envVar: "XIAOMI_TOKEN_PLAN_SGP_API_KEY", label: "Xiaomi Token Plan SGP" },
	{ id: "zai", envVar: "ZAI_API_KEY", label: "Z.AI" },
	{ id: "zai-coding-cn", envVar: "ZAI_CODING_CN_API_KEY", label: "Z.AI Coding CN" },
] as const;

export const CUSTOM_PROVIDER = {
	id: "custom",
	envVar: "CUSTOM_OPENAI_API_KEY",
	label: "Custom endpoint",
} as const;

export const AUTH_PROVIDER_ENV_VARS: ReadonlySet<string> = new Set(AUTH_PROVIDER_KEYS.map((p) => p.envVar));

export function isProviderEnvVar(envVar: string): boolean {
	return AUTH_PROVIDER_ENV_VARS.has(envVar);
}

export type KeyShapeResult = { ok: true } | { ok: false; error: string };

export function validateKeyShape(id: string, rawValue: string): KeyShapeResult {
	const value = rawValue.trim();
	const nonEmpty = (min: number) =>
		value.length >= min && !/\s/.test(value)
			? { ok: true as const }
			: { ok: false as const, error: `${id} must be at least ${min} characters with no whitespace` };
	switch (id) {
		case "TAVILY_API_KEY":
			return value.startsWith("tvly-")
				? nonEmpty(20)
				: { ok: false, error: `${id} must start with "tvly-" (Tavily's key format)` };
		case "BRAVE_API_KEY":
			return nonEmpty(20);
		case "EXA_API_KEY":
		case "OLLAMA_API_KEY":
			return nonEmpty(12);
		case "FIRECRAWL_API_KEY":
			return value.startsWith("fc-")
				? nonEmpty(20)
				: { ok: false, error: `${id} must start with "fc-" (Firecrawl's key format)` };
		default:
			return { ok: false, error: `unknown key "${id}" (supported: ${[...AUTH_KEY_IDS].join(", ")})` };
	}
}

export function genericProviderKeyGuard(id: string, rawValue: string): KeyShapeResult {
	const value = rawValue.trim();
	if (value.length >= 12 && !/\s/.test(value)) return { ok: true };
	return { ok: false, error: `${id} must be at least 12 characters with no whitespace` };
}

export function maskKey(value: string): string {
	const v = value.trim();
	if (v.length <= 4) return `…${v}`;
	return `…${v.slice(-4)}`;
}

export interface AuthKeyStatus {
	id: string;
	info: AuthKeyInfo | null;
	present: boolean;
	masked: string | null;
	source: "env" | "file" | "none";
	shadowedByEnv: boolean;
}
