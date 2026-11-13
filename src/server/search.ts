
import { SEARCH_ENGINES, type SearchEngineId, type SearchHit, type SearchProvider, type SearchStatus } from "../core/search.ts";
import { keyValue } from "./keys.ts";
import { effectiveSettings } from "./stores.ts";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function tavilyProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "tavily",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://api.tavily.com/search", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ query, max_results: Math.min(count, 20) }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) {
				const body = await resp.text();
				let detail = body.slice(0, 200);
				try {
					const parsed = JSON.parse(body) as { detail?: { error?: string } };
					if (parsed.detail?.error) detail = parsed.detail.error.slice(0, 200);
				} catch {
				}
				throw new Error(`Tavily search API ${resp.status}: ${detail}`);
			}
			const data = (await resp.json()) as {
				results?: Array<{ title?: string; url?: string; content?: string }>;
			};
			return (data.results ?? [])
				.filter((r) => typeof r.url === "string" && r.url)
				.map((r) => ({
					title: r.title ?? r.url ?? "",
					url: r.url ?? "",
					snippet: (r.content ?? "").replace(/\n/g, " ").slice(0, 500),
				}));
		},
	};
}

export function braveProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "brave",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const url = new URL("https://api.search.brave.com/res/v1/web/search");
			url.searchParams.set("q", query);
			url.searchParams.set("count", String(Math.min(count, 20)));
			const resp = await fetchFn(url.toString(), {
				headers: {
					accept: "application/json",
					"x-subscription-token": apiKey,
				},
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) {
				const body = await resp.text();
				throw new Error(`Brave search API ${resp.status}: ${body.slice(0, 200)}`);
			}
			const data = (await resp.json()) as {
				web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
			};
			return (data.web?.results ?? [])
				.filter((r) => typeof r.url === "string" && r.url)
				.map((r) => ({
					title: r.title ?? r.url ?? "",
					url: r.url ?? "",
					snippet: (r.description ?? "").replace(/\n/g, " ").slice(0, 500),
				}));
		},
	};
}

async function searchJson(response: Response, label: string): Promise<unknown> {
	try {
		return await response.json();
	} catch {
		throw new Error(`${label} search API returned an invalid response`);
	}
}

export function exaProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "exa",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://api.exa.ai/search", {
				method: "POST",
				headers: { "content-type": "application/json", "x-api-key": apiKey },
				body: JSON.stringify({ query, type: "auto", numResults: Math.min(100, Math.max(1, Math.floor(count))), contents: { highlights: true } }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) throw new Error(`Exa search API ${resp.status}`);
			const data = await searchJson(resp, "Exa");
			if (!data || typeof data !== "object" || !Array.isArray((data as { results?: unknown }).results)) {
				throw new Error("Exa search API returned an invalid response");
			}
			return (data as { results: unknown[] }).results.flatMap((result): SearchHit[] => {
				if (!result || typeof result !== "object") return [];
				const row = result as { title?: unknown; url?: unknown; highlights?: unknown; text?: unknown };
				if (typeof row.url !== "string" || !row.url.trim()) return [];
				try {
					const protocol = new URL(row.url).protocol;
					if (protocol !== "http:" && protocol !== "https:") return [];
				} catch { return []; }
				const highlights = Array.isArray(row.highlights) ? row.highlights.filter((v): v is string => typeof v === "string").join(" ") : "";
				const snippet = highlights || (typeof row.text === "string" ? row.text : "");
				return [{ title: typeof row.title === "string" && row.title ? row.title : row.url, url: row.url, snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 500) }];
			});
		},
	};
}

export function firecrawlProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "firecrawl",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://api.firecrawl.dev/v2/search", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify({ query, limit: Math.min(100, Math.max(1, Math.floor(count))) }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) throw new Error(`Firecrawl search API ${resp.status}`);
			const data = await searchJson(resp, "Firecrawl");
			if (!data || typeof data !== "object" || (data as { success?: unknown }).success !== true) {
				throw new Error("Firecrawl search API returned an invalid response");
			}
			const payload = (data as { data?: unknown }).data;
			if (!payload || typeof payload !== "object" || !Array.isArray((payload as { web?: unknown }).web)) {
				throw new Error("Firecrawl search API returned an invalid response");
			}
			return (payload as { web: unknown[] }).web.flatMap((result): SearchHit[] => {
				if (!result || typeof result !== "object") return [];
				const row = result as { title?: unknown; url?: unknown; description?: unknown };
				return searchHit(row.title, row.url, row.description);
			});
		},
	};
}

export function ollamaProvider(apiKey: string, fetchFn: FetchLike = fetch): SearchProvider {
	return {
		id: "ollama",
		async search(query: string, count: number): Promise<SearchHit[]> {
			const resp = await fetchFn("https://ollama.com/api/web_search", {
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
				body: JSON.stringify({ query, max_results: Math.min(10, Math.max(1, Math.floor(count))) }),
				signal: AbortSignal.timeout(30_000),
			});
			if (!resp.ok) throw new Error(`Ollama search API ${resp.status}`);
			const data = await searchJson(resp, "Ollama");
			if (!data || typeof data !== "object" || !Array.isArray((data as { results?: unknown }).results)) {
				throw new Error("Ollama search API returned an invalid response");
			}
			return (data as { results: unknown[] }).results.flatMap((result): SearchHit[] => {
				if (!result || typeof result !== "object") return [];
				const row = result as { title?: unknown; url?: unknown; content?: unknown };
				return searchHit(row.title, row.url, row.content);
			});
		},
	};
}

function searchHit(title: unknown, url: unknown, snippet: unknown): SearchHit[] {
	if (typeof url !== "string" || !url.trim()) return [];
	try {
		const protocol = new URL(url).protocol;
		if (protocol !== "http:" && protocol !== "https:") return [];
	} catch { return []; }
	return [{
		title: typeof title === "string" && title ? title : url,
		url,
		snippet: typeof snippet === "string" ? snippet.replace(/\s+/g, " ").trim().slice(0, 500) : "",
	}];
}

function engineKey(id: SearchEngineId): string | null {
	const envVar = SEARCH_ENGINES.find((e) => e.id === id)?.envVar;
	const value = envVar ? keyValue(envVar) : undefined;
	return value ? value : null;
}

function engineKeys(): Partial<Record<SearchEngineId, string>> {
	const keys: Partial<Record<SearchEngineId, string>> = {};
	for (const { id } of SEARCH_ENGINES) {
		const key = engineKey(id);
		if (key) keys[id] = key;
	}
	return keys;
}

export function resolveSearchEngineFor(
	pinned: SearchEngineId | undefined,
	keys: Partial<Record<SearchEngineId, string | undefined>>,
): SearchStatus & { key: string | null } {
	const pinnedKey = pinned ? keys[pinned] ?? null : null;
	if (pinned) {
		if (!pinnedKey) {
			return {
				available: false,
				engine: null,
				reason: `search engine is set to "${pinned}" but its API key is missing — set the ${SEARCH_ENGINES.find((e) => e.id === pinned)?.envVar} key`,
				key: null,
			};
		}
		return { available: true, engine: pinned, reason: `search engine: ${pinned} (chosen)`, key: pinnedKey };
	}
	for (const { id } of SEARCH_ENGINES) {
		const key = keys[id] ?? null;
		if (key) return { available: true, engine: id, reason: `search engine: ${id} (auto)`, key };
	}
	return {
		available: false,
		engine: null,
		reason: "no search engine configured — set a Tavily, Brave, Exa, Firecrawl, or Ollama search API key",
		key: null,
	};
}

export function searchStatus(): SearchStatus {
	const { available, engine, reason } = resolveSearchEngineFor(
		effectiveSettings().agent.search?.engine,
		engineKeys(),
	);
	return { available, engine, reason };
}

export function searchAvailable(): boolean {
	return searchStatus().available;
}

export function searchProvider(): SearchProvider | null {
	const resolved = resolveSearchEngineFor(effectiveSettings().agent.search?.engine, engineKeys());
	if (!resolved.available || !resolved.key) return null;
	switch (resolved.engine) {
		case "tavily":
			return tavilyProvider(resolved.key);
		case "brave":
			return braveProvider(resolved.key);
		case "exa":
			return exaProvider(resolved.key);
		case "firecrawl":
			return firecrawlProvider(resolved.key);
		case "ollama":
			return ollamaProvider(resolved.key);
		default:
			return null;
	}
}
