import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));

const DATA_ROOT = process.env.OWLLY_DATA_DIR
	? path.resolve( process.env.OWLLY_DATA_DIR)
	: path.join( ROOT, "data");

export const PATHS = {
	root: ROOT,
	teacherPrompt: path.join(ROOT, "src", "agent", "system-prompt.md"),
	data: DATA_ROOT,
	chats: path.join( DATA_ROOT, "chats"),
	graph: path.join( DATA_ROOT, "graph"),
	debug: path.join( DATA_ROOT, "debug"),
} as const;


export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type ModelRole =
	| "prober"
	| "teacher"
	| "researcher"
	| "demoBuilder"
	| "visualMaker"
	| "pdfReader"
	| "extractor"
	| "auditor"
	| "sideQuestion";

export const LEDGER_FILES = {
	nodes: path.join( PATHS.graph, "nodes.jsonl"),
	chains: path.join( PATHS.graph, "chains.jsonl"),
	sessions: path.join( PATHS.graph, "sessions.jsonl"),
	coverage: path.join( PATHS.graph, "coverage.jsonl"),
} as const;

export const SOURCES_FILE = path.join( PATHS.graph, "sources.json");
export const SOURCE_ORGANIZATION_FILE = path.join( PATHS.graph, "source-organization.json");
export const POSITIONS_FILE = path.join( PATHS.graph, "positions.json");

export const RENDER_SETTINGS_FILE = path.join( PATHS.graph, "render-settings.json");

export const GRAPH_FORMAT_FILE = path.join( PATHS.graph, "format.json");

export const SETTINGS_FILE = path.join( DATA_ROOT, "settings.json");


export const AUTH_FILE = process.env.OWLLY_AUTH_FILE
	? path.resolve( process.env.OWLLY_AUTH_FILE)
	: path.join( ROOT, "auth.json");
