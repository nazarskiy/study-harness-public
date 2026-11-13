import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { OwllyMessage } from "../native-messages.ts";
import type { Phase3 } from "../phases.ts";
import type { PlanNodeStatus, PlanTree } from "./plan.ts";
import type { EmissionStats } from "./graph.ts";


export type ChatKind = "teach" | "practice";

export interface ChatRecord {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: OwllyMessage[];
	imageSnapshots?: Record<string, ImageSnapshot>;
	kind?: ChatKind;
	tree?: PlanTree;
	turns?: TurnUsage[];
	extractions?: ExtractionRunUsage[];
	settings?: ChatSettings;
	sideChats?: SideChatThread[];
	version?: number;
}

export const CURRENT_CHAT_VERSION = 2;

export interface ChatSettings {
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
}



export interface ExtractionStageUsage {
	model: string;
	steps: CallUsage[];
}

export interface ExtractionRunUsage {
	startedAt: number;
	at: string;
	durationMs: number;
	stats?: EmissionStats;
	stages: {
		extractor: ExtractionStageUsage;
		auditor: ExtractionStageUsage;
	};
}



export interface SideChatAnchor {
	messageId: string;
	partId: string;
	blockIndex: number;
	blockText: string;
}

export interface SideChatMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	quotes?: string[];
	quoteCitations?: string[];
	at: string;
	model?: string;
	requestId?: string;
	stopped?: boolean;
	pending?: boolean;
	error?: string;
}

export interface SideChatThread {
	id: string;
	anchor: SideChatAnchor;
	open: boolean;
	createdAt: string;
	messages: SideChatMessage[];
	contextSnapshot?: SideChatMessage[];
}

export interface CallUsage {
	inputTokens: number | undefined;
	outputTokens: number | undefined;
	cacheReadTokens: number | undefined;
	cacheWriteTokens: number | undefined;
	cacheWrite1hTokens?: number;
	reasoningTokens: number | undefined;
}

export interface TurnUsage {
	id: string;
	messageId: string;
	at: string;
	model: string;
	steps: CallUsage[];
}



export const HANDOFF_TEXT =
	"Next: plan the full teaching arc from my current understanding to the goal understanding. " +
	"Apply the teaching methodology in your system prompt, and find the optimal way to teach me this. " +
	"Find the unconditional truths, plan the motivated derivations/discoveries, so every reasoning step has to land as obviously true. " +
	"Take your time here and really think this through. " +
	"When it's genuinely reasoned out, call plan_init and present the plan; I'll accept it or ask for changes.";


export const THINKING_LABEL = "Your thinking";

export const CONCLUDE_ACK_TEXT =
	"Problem concluded. Say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, answer their questions about the concluded one.";

export const NEXT_PROBLEM_TEXT =
	"[NEXT PROBLEM] — the learner's explicit go-ahead: pose the next problem now per the selection rules, or wrap the session in text if the arc is complete.";

export const COMPACTED_HISTORY_HEADER =
	"[SESSION HISTORY COMPACTED] The transcript before this point was summarized to fit the context window; the summary below replaces it. Everything after this message is the verbatim recent transcript.";


export interface PlanBlockData {
	kind: "full";
	at: string;
	current: string | null;
	nodes: Array<{ id: string; title: string; status: PlanNodeStatus }>;
	edges: Array<{ from: string; to: string }>;
}

export interface ChatSummary {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	kind: ChatKind;
	messageCount: number;
	phase: Phase3;
	pendingQuestion: boolean;
	pendingProblem: boolean;
	settings?: ChatSettings;
}

export interface ChatListItem extends ChatSummary {
	busy: boolean;
	compacting: boolean;
}


export interface ImageSnapshot {
	mimeType: "image/png" | "image/jpeg";
	data: string;
	width: number;
	height: number;
}

export interface ShowImageDetails {
	path: string;
	caption?: string;
	mimeType: "image/png" | "image/jpeg";
	snapshotId: string;
	width: number;
	height: number;
}


export interface ArtifactPartProps {
	part: {
		type: string;
		state: string;
		toolCallId: string;
		input?: unknown;
		output?: unknown;
		problemInput?: unknown;
		reveal?: unknown;
	};
}
