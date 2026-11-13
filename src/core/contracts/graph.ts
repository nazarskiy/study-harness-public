
import type { CallUsage, ExtractionRunUsage } from "./chat.ts";

export interface GraphEdge {
	from: string;
	to: string;
}

export interface GraphChain {
	id: string;
	premises: string[];
	conclusion: string;
	provenance: ProvenancePoint[];
	createdAt: string;
}

export interface EmissionStats {
	nodes: number;
	chains?: number;
	droppedChains?: number;
}

export interface ProvenancePoint {
	chatId: string;
	messageId: string;
}

export interface NotesSource {
	id: string;
	filePath: string;
	importedAt: string;
	contentFp?: string;
	extractions?: ExtractionRunUsage[];
}

export interface NamingRunStats {
	detected: number;
	claimed: number;
	named: number;
	appended: number;
}

export const CURRENT_GRAPH_FORMAT_VERSION = 1;


export interface GraphNode {
	id: string;
	name: string;
	statement: string;
	aliases: string[];
	createdAt: string;
	provenance: ProvenancePoint[];
}

export interface SessionCheckpoint {
	chatId: string;
	foldedAt: string;
}

export interface CoverageEntry {
	chatId: string;
	fp: string;
	tokens: number;
	foldedAt: string;
}



export interface ExtractedProposition {
	id: string;
	name: string;
	statement: string;
	aliases: string[];
	messageId?: string;
}

export interface ExtractedChain {
	premises: string[];
	conclusion: string;
}

export interface SessionFindings {
	propositions: ExtractedProposition[];
	chains: ExtractedChain[];
}

export interface IdentityLink {
	id: string;
	linkTo: string;
}

export interface AuditVerdicts {
	links: IdentityLink[];
}

export interface Cluster {
	id: string;
	label: string | null;
	members: string[];
}

export interface GraphSnapshot {
	nodes: GraphNode[];
	propositions: GraphNode[];
	edges: GraphEdge[];
	logicalEdges: GraphEdge[];
	impLinks: Array<{ id: string; premises: string[]; conclusion: string }>;
	chains: GraphChain[];
	sessions: Record<string, string>;
	fileSources: Record<string, string>;
	nodeSessions: Record<string, string[]>;
	clusters: Cluster[];
	positions?: Record<string, Position>;
}

export interface Position {
	x: number;
	y: number;
}

export const TITLE_MAX_CHARS = 72;

export function titleFromPrompt(prompt: string): string {
	const oneLine = prompt.replace(/\s+/g, " ").trim();
	if (oneLine.length <= TITLE_MAX_CHARS) return oneLine;
	let cut = -1;
	for (let i = TITLE_MAX_CHARS; i > 0; i--) {
		if (oneLine[i - 1] === " ") {
			cut = i - 1;
			break;
		}
	}
	if (cut < 0) cut = TITLE_MAX_CHARS;
	return `${oneLine.slice(0, cut)}…`;
}
