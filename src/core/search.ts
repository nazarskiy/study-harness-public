
export interface SearchHit {
	title: string;
	url: string;
	snippet: string;
}

export const SEARCH_ENGINES = [
	{ id: "tavily", label: "Tavily", envVar: "TAVILY_API_KEY" },
	{ id: "brave", label: "Brave", envVar: "BRAVE_API_KEY" },
	{ id: "exa", label: "Exa", envVar: "EXA_API_KEY" },
	{ id: "firecrawl", label: "Firecrawl", envVar: "FIRECRAWL_API_KEY" },
	{ id: "ollama", label: "Ollama", envVar: "OLLAMA_API_KEY" },
] as const;

export type SearchEngineId = (typeof SEARCH_ENGINES)[number]["id"];

export function isSearchEngineId(value: unknown): value is SearchEngineId {
	return SEARCH_ENGINES.some((engine) => engine.id === value);
}

export interface SearchProvider {
	id: SearchEngineId;
	search(query: string, count: number): Promise<SearchHit[]>;
}

export interface SearchStatus {
	available: boolean;
	engine: SearchEngineId | null;
	reason: string;
}
