interface UIMessage {
	role?: string;
	parts: Array<Record<string, unknown> & { type: string }>;
}

function isToolUIPart(part: UIMessage["parts"][number]): boolean {
	return part.type.startsWith("tool-") && typeof part.toolCallId === "string";
}

export interface PendingToolCall {
	toolCallId: string;
	tool: string;
	input: unknown;
}

export interface PendingQuestion extends PendingToolCall {
	messageId: string;
	contentIndex: number;
	key: string;
}

export const QUESTION_TOOLS = [
	"quiz",
	"probe",
	"ask_user_question",
	"explain",
	"recall",
] as const;

export function toolQuestionKind(tool: string): "quiz" | "ask" | "explain" {
	return tool === "quiz" || tool === "probe" ? "quiz" : tool === "explain" || tool === "recall" ? "explain" : "ask";
}

export const JOB_TOOLS = ["research", "demo", "visual"] as const;


export const TOGGLEABLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

export const WRITABLE_TOOL_KEYS = [...TOGGLEABLE_TOOLS, "explain"] as const;

export type EnabledTools = Partial<Record<string, boolean>>;

export function filterEnabledTools<T>(tools: Record<string, T>, enabled?: EnabledTools): Record<string, T> {
	if (!enabled) return tools;
	const out: Record<string, T> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (enabled[name] === false) continue;
		out[name] = tool;
	}
	return out;
}

function findPending(messages: UIMessage[], names: readonly string[], authority?: string | PendingQuestion): PendingToolCall | null {
	for (let m = messages.length - 1; m >= 0; m--) {
		const msg = messages[m]!;
		for (let p = 0; p < msg.parts.length; p++) {
			const part = msg.parts[p]!;
			if (isToolUIPart(part) && !part.pluginQuestion && part.state === "input-available") {
				const tool = part.type.slice("tool-".length);
				if (!names.includes(tool)) continue;
				if (typeof authority === "object") {
					if (part.toolCallId !== authority.toolCallId || tool !== authority.tool ||
						part.sourceMessageId !== authority.messageId || part.sourceContentIndex !== authority.contentIndex) continue;
					return authority;
				}
				if (authority === undefined || part.toolCallId === authority) {
					return { toolCallId: part.toolCallId as string, tool, input: part.input };
				}
			}
		}
	}
	return null;
}

export function findPendingToolCall(messages: UIMessage[], authority: PendingQuestion | null): PendingQuestion | null;
export function findPendingToolCall(messages: UIMessage[], authority?: string | null): PendingToolCall | null;
export function findPendingToolCall(messages: UIMessage[], authority?: string | PendingQuestion | null): PendingToolCall | null {
	if (authority === null) return null;
	return findPending(messages, QUESTION_TOOLS, authority);
}


const ACTIVITY_LABELS: Record<string, string> = {
	read: "Reading a file…",
	ls: "Listing a directory…",
	find: "Finding files…",
	grep: "Searching file contents…",
	research: "Dispatching research…",
	demo: "Building a demo…",
	visual: "Making a visual…",
	pdf: "Reading a PDF…",
	plan_init: "Drawing up the plan…",
	probe_done: "Concluding the assessment…",
};

export function toolActivityLabel(tool: string): string {
	if ((QUESTION_TOOLS as readonly string[]).includes(tool)) return "Writing a question…";
	return ACTIVITY_LABELS[tool] ?? "Working…";
}

export function streamingToolActivity(messages: UIMessage[]): string | null {
	const last = messages.at(-1);
	if (!last || last.role !== "assistant") return null;
	for (const part of last.parts) {
		if (isToolUIPart(part) && part.state === "input-streaming") {
			return toolActivityLabel(part.type.slice("tool-".length));
		}
	}
	return null;
}
