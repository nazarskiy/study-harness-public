
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent, Message, TextContent, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type { PluginSubmissionImages, PluginSubmissionOccurrence } from "./plugin-submissions.ts";
import { ImmutableReadCache } from "./immutable-data.ts";
import { QUESTION_TOOLS, type PendingQuestion } from "./pending.ts";
import { pluginProblemForCall, readPluginProblemSubmission, type PluginProblemSnapshot } from "./plugin-problems.ts";
import { CLAUDE_CODE_PROVIDER } from "./contracts/claude-code.ts";
import {
	CONCLUDE_ACK_TEXT,
	HANDOFF_TEXT,
	NEXT_PROBLEM_TEXT,
	THINKING_LABEL,
} from "./contracts/chat.ts";
import { compactAnswerForModel, type QuestionAnswerData } from "./question-core.ts";
import { activeCompactionOf, keptIndexFor } from "./compaction.ts";
import { parseQuestionInput } from "./tool-parts.ts";
import { expandCitationsForModel } from "./citations.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionAnswer, readPluginQuestionCancellation, samePluginQuestionOccurrence, type PluginQuestionAnnotationRead, type PluginQuestionOccurrence, type PluginQuestionOccurrenceMap, type PluginQuestionSnapshot } from "./plugin-questions.ts";

export const INTERRUPTED_TEXT =
	"The question was interrupted — the learner never answered; continue without holding a result for it.";


export interface OwllyMarkerMessage {
	id: string;
	role: "custom";
	customType:
		| "graph-context"
		| "probe-handoff"
		| "subagent-steer"
		| "subagent-abort"
		| "plan-block"
		| "practice-thinking"
		| "plugin-problem-submission"
		| "practice-next"
		| "problem-dismissed"
		| "compaction"
		| "side-question"
		| "side-question-told";
	content: string;
	display: boolean;
	details: unknown;
	timestamp: number;
}

declare module "@earendil-works/pi-agent-core" {
	interface CustomAgentMessages {
		owllyMarker: OwllyMarkerMessage;
	}
}

export type OwllyMessage = (UserMessage | AssistantMessage | ToolResultMessage | OwllyMarkerMessage) & {
	id: string;
	cliContextWindow?: number;
	owllyQuestions?: PluginQuestionOccurrenceMap;
	owllyQuestionOccurrence?: PluginQuestionOccurrence;
};

export function cliContextWindowOf(messages: readonly OwllyMessage[]): { model: string; tokens: number } | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!;
		if (message.role === "custom" && message.customType === "compaction") return null;
		if (message.role !== "assistant") continue;
		const tokens = message.cliContextWindow;
		return message.provider === CLAUDE_CODE_PROVIDER && typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens > 0
			? { model: `${message.provider}:${message.model}`, tokens } : null;
	}
	return null;
}

export function asAgentMessages(messages: readonly OwllyMessage[]): AgentMessage[] {
	return messages as unknown as AgentMessage[];
}

export function isSideQuestionMarker(m: OwllyMessage | AgentMessage | undefined): boolean {
	if ((m as { role?: string } | undefined)?.role !== "custom") return false;
	const type = (m as OwllyMarkerMessage).customType;
	return type === "side-question" || type === "side-question-told";
}

function tailIgnoringSideQuestions<T>(messages: readonly T[]): readonly T[] {
	let end = messages.length;
	while (end > 0 && isSideQuestionMarker(messages[end - 1] as never)) end--;
	return end === messages.length ? messages : messages.slice(0, end);
}


export const SEND_TO_USER_TOOL = "send_to_user";

export function sendToUserText(block: unknown): string | undefined {
	if (!block || typeof block !== "object") return undefined;
	const call = block as { type?: unknown; name?: unknown; arguments?: unknown };
	if (call.type !== "toolCall" || call.name !== SEND_TO_USER_TOOL) return undefined;
	if (!call.arguments || typeof call.arguments !== "object") return undefined;
	const message = (call.arguments as { message?: unknown }).message;
	return typeof message === "string" && message.trim() ? message : undefined;
}

export function userFacingTextOf(content: unknown, failedOutputCalls?: ReadonlySet<string>): string[] {
	if (typeof content === "string") return content.trim() ? [content] : [];
	if (!Array.isArray(content)) return [];
	const out: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if (block.type === "toolCall" && failedOutputCalls?.has(block.id)) continue;
		const text = block.type === "text" ? block.text : sendToUserText(block);
		if (typeof text === "string" && text.trim()) out.push(text);
	}
	return out;
}

export function failedOutputCallIds(messages: readonly OwllyMessage[]): ReadonlySet<string> {
	const failed = new Set<string>();
	for (const message of messages) {
		if (message.role === "toolResult" && message.toolName === SEND_TO_USER_TOOL && message.isError) {
			failed.add(message.toolCallId);
		} else if (message.role === "assistant" && (message.stopReason === "error" || message.stopReason === "aborted")) {
			for (const block of message.content) {
				if (block.type === "toolCall" && block.name === SEND_TO_USER_TOOL) failed.add(block.id);
			}
		}
	}
	return failed;
}


export function newMessageId(): string {
	return `msg_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}


export function nativeInlineImageContent(text: string, images?: readonly ImageContent[]): string | (TextContent | ImageContent)[] {
	return images?.length ? [...(text ? [{ type: "text" as const, text }] : []), ...images.map(image => ({ ...image }))] : text;
}

export function nativeAnswerContent(answerText: string, images?: PluginSubmissionImages): ToolResultMessage["content"] {
	const content: ToolResultMessage["content"] = [{ type: "text", text: answerText }];
	for (const [channel, label] of [["answer", "Answer images"], ["thinking", "Question thinking images"], ["readingThinking", "Reading thinking images"]] as const) {
		if (!images?.[channel]?.length) continue;
		content.push({ type: "text", text: `${label}:` }, ...images[channel]!.map(image => ({ ...image })));
	}
	return content;
}

export function newUserMessage(text: string, images?: readonly ImageContent[]): OwllyMessage & UserMessage {
	return {
		id: newMessageId(),
		role: "user",
		content: nativeInlineImageContent(text, images),
		timestamp: Date.now(),
	};
}

export function newUserSteer(text: string, id: string, images?: readonly ImageContent[]): OwllyMessage & UserMessage {
	return { id, role: "user", content: nativeInlineImageContent(text, images), timestamp: Date.now() };
}

export function newAnswerResult(
	toolCallId: string,
	toolName: string,
	answer: unknown,
): OwllyMessage & ToolResultMessage {
	return {
		id: newMessageId(),
		role: "toolResult",
		toolCallId,
		toolName,
		content: nativeAnswerContent(JSON.stringify(compactAnswerForModel(answer as QuestionAnswerData)), (answer as QuestionAnswerData).images),
		details: answer as ToolResultMessage["details"],
		isError: false,
		timestamp: Date.now(),
	};
}

export function newHandoffMessage(chatId: string): OwllyMarkerMessage {
	return {
		id: `steer_probe_${chatId}`,
		role: "custom",
		customType: "probe-handoff",
		content: HANDOFF_TEXT,
		display: true,
		details: { chatId },
		timestamp: Date.now(),
	};
}

export function newPlanBlockMessage(
	planCallId: string,
	block: unknown,
): OwllyMarkerMessage {
	return {
		id: `pb_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		role: "custom",
		customType: "plan-block",
		content: "",
		display: true,
		details: { planCallId, block },
		timestamp: Date.now(),
	};
}


export const PRACTICE_PROBLEM_TOOL = "problem";
export const PRACTICE_CONCLUDE_TOOL = "conclude";

export interface GraphContextPick {
	id: string;
	name: string;
	statement: string;
}

export function newGraphContextMessage(picks: readonly GraphContextPick[], chains: readonly string[]): OwllyMarkerMessage {
	const lines = [
		"[Session context] — picked from the learner's knowledge map when starting this session:",
		"",
		"Propositions (id — name: statement; the problem tool's target field uses these ids):",
		...picks.map((p) => `- [${p.id}] ${p.name}: ${p.statement}`),
	];
	if (chains.length > 0) {
		lines.push("", "Reasoning chains among them (premises → conclusion):", ...chains.map((c) => `- ${c}`));
	}
	return {
		id: newMessageId(),
		role: "custom",
		customType: "graph-context",
		content: lines.join("\n"),
		display: true,
		details: { propositions: picks, chains },
		timestamp: Date.now(),
	};
}

export function newThinkingMessage(problemCallId: string, text: string, images?: readonly ImageContent[]): OwllyMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-thinking",
		content: `${THINKING_LABEL}:\n${text}`,
		display: true,
		details: { problemCallId, text, ...(images?.length ? { images: images.map(image => ({ ...image })) } : {}) },
		timestamp: Date.now(),
	};
}

export function newNextMessage(): OwllyMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "practice-next",
		content: NEXT_PROBLEM_TEXT,
		display: true,
		details: {},
		timestamp: Date.now(),
	};
}

export function newProblemDismissedMarker(problemCallId: string): OwllyMarkerMessage {
	return {
		id: newMessageId(),
		role: "custom",
		customType: "problem-dismissed",
		content: "",
		display: true,
		details: { problemCallId },
		timestamp: Date.now(),
	};
}

export function concludedByDismissalPair(
	problemCallId: string,
): [OwllyMessage & AssistantMessage, OwllyMessage & ToolResultMessage] {
	const callId = `call_conc_${problemCallId}`;
	const now = Date.now();
	const syntheticStamps = {
		api: "faux",
		provider: "synthetic",
		model: "synthetic-conclude",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
	} as const;
	return [
		{
			id: newMessageId(),
			role: "assistant",
			content: [{ type: "toolCall", id: callId, name: PRACTICE_CONCLUDE_TOOL, arguments: { outcome: "dismissed" } }],
			timestamp: now,
			...syntheticStamps,
		},
		{
			id: newMessageId(),
			role: "toolResult",
			toolCallId: callId,
			toolName: PRACTICE_CONCLUDE_TOOL,
			content: [{ type: "text", text: CONCLUDE_ACK_TEXT }],
			details: { outcome: "dismissed", problemCallId },
			isError: false,
			timestamp: now,
		},
	];
}

function cleanToolCallIds(messages: readonly OwllyMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role !== "toolResult") continue;
		const result = m as ToolResultMessage;
		if (!result.isError) ids.add(result.toolCallId);
	}
	return ids;
}

export function practiceProblemForCall(messages: readonly OwllyMessage[], occurrence: PluginSubmissionOccurrence): { input: unknown; pluginProblem?: PluginProblemSnapshot } | null {
	const owner = messages.find(message => message.id === occurrence.messageId && message.role === "assistant") as (AssistantMessage & { id: string }) | undefined;
	const call = owner?.content[occurrence.contentIndex];
	if (call?.type !== "toolCall" || call.id !== occurrence.toolCallId || call.name !== occurrence.toolName) return null;
	if (call.name === PRACTICE_PROBLEM_TOOL) return { input: call.arguments };
	const pluginProblem = pluginProblemForCall(messages, occurrence);
	return pluginProblem ? { input: pluginProblem.input, pluginProblem } : null;
}

export function modelSolutionForConclude(
	messages: readonly OwllyMessage[],
	concludeCallId: string,
): string | undefined {
	const input = problemInputForConclude(messages, concludeCallId);
	return typeof input?.modelSolution === "string" ? input.modelSolution : undefined;
}

export function problemInputForConclude(
	messages: readonly OwllyMessage[],
	concludeCallId: string,
): { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown } | undefined {
	let mi = messages.findIndex(
		(m) =>
			(m as { role?: string }).role === "assistant" &&
			(m as AssistantMessage).content.some(
				(b) => b.type === "toolCall" && b.id === concludeCallId,
			),
	);
	if (mi < 0) return undefined;
	const concludeMessageIndex = mi;
	const clean = cleanToolCallIds(messages);
	for (; mi >= 0; mi--) {
		const m = messages[mi]!;
		if ((m as { role?: string }).role !== "assistant") continue;
		const assistant = m as AssistantMessage;
		const lastIndex = mi === concludeMessageIndex
			? assistant.content.findIndex(block => block.type === "toolCall" && block.id === concludeCallId) - 1
			: assistant.content.length - 1;
		for (let bi = lastIndex; bi >= 0; bi--) {
			const block = assistant.content[bi]!;
			if (block.type !== "toolCall" || !clean.has(block.id)) continue;
			const problem = practiceProblemForCall(messages, { messageId: m.id, contentIndex: bi, toolCallId: block.id, toolName: block.name });
			if (!problem) continue;
			return (problem.input ?? undefined) as
				| { statement?: unknown; mode?: unknown; target?: unknown; modelSolution?: unknown }
				| undefined;
		}
	}
	return undefined;
}

export function activeProblemOf(
	messages: readonly OwllyMessage[],
): { toolCallId: string; input: unknown; pluginProblem?: PluginProblemSnapshot } | null {
	const active = activeProblemCallOf(messages);
	return active ? { toolCallId: active.occurrence.toolCallId, input: active.input, ...(active.pluginProblem ? { pluginProblem: active.pluginProblem } : {}) } : null;
}

export function activeProblemOccurrenceOf(messages: readonly OwllyMessage[]): PluginSubmissionOccurrence | null {
	return activeProblemCallOf(messages)?.occurrence ?? null;
}

function activeProblemCallOf(messages: readonly OwllyMessage[]): { occurrence: PluginSubmissionOccurrence; input: unknown; pluginProblem?: PluginProblemSnapshot } | null {
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as OwllyMarkerMessage;
			if (marker.customType === "problem-dismissed") return null;
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage & { id: string };
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall") continue;
				if (block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null;
					continue;
				}
				const occurrence = { messageId: m.id, contentIndex: bi, toolCallId: block.id, toolName: block.name };
				const problem = practiceProblemForCall(messages, occurrence);
				if (problem && cleanCallIds.has(block.id)) return { occurrence, ...problem };
			}
			continue;
		}
	}
	return null;
}

export function pendingProblemDismissalOf(messages: readonly OwllyMessage[]): string | null {
	const cleanCallIds = cleanToolCallIds(messages);
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as OwllyMarkerMessage;
			if (marker.customType === "problem-dismissed") {
				return (marker.details as { problemCallId?: unknown }).problemCallId as string;
			}
			continue;
		}
		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			for (let bi = assistant.content.length - 1; bi >= 0; bi--) {
				const block = assistant.content[bi]!;
				if (block.type !== "toolCall" && block.type !== "text") continue;
				if (block.type === "toolCall" && block.name === PRACTICE_CONCLUDE_TOOL) {
					if (cleanCallIds.has(block.id)) return null;
					continue;
				}
				if (block.type === "toolCall" && cleanCallIds.has(block.id) && practiceProblemForCall(messages, {
					messageId: m.id, contentIndex: bi, toolCallId: block.id, toolName: block.name,
				})) return null;
			}
			continue;
		}
	}
	return null;
}


function resultIdsFrom(messages: readonly AgentMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const m of messages) {
		if ((m as { role?: string }).role === "toolResult") {
			ids.add((m as ToolResultMessage).toolCallId);
		}
	}
	return ids;
}

function expandUserCitations(message: UserMessage): UserMessage {
	if (typeof message.content === "string") return { ...message, content: expandCitationsForModel(message.content) };
	return { ...message, content: message.content.map((block) => (block.type === "text" ? { ...block, text: expandCitationsForModel(block.text) } : block)) };
}

function withoutLegacyConfidence(message: ToolResultMessage): ToolResultMessage {
	if (!(QUESTION_TOOLS as readonly string[]).includes(message.toolName) || message.isError) return message;
	const omit = (value: unknown): unknown => {
		if (!value || typeof value !== "object" || Array.isArray(value)) return value;
		const record = value as Record<string, unknown>;
		if (record.kind !== "quiz" || !Object.hasOwn(record, "confidence")) return value;
		const { confidence: _legacy, ...answer } = record;
		return answer;
	};
	return { ...message, details: omit(message.details) as ToolResultMessage["details"], content: message.content.map(block => {
		if (block.type !== "text") return block;
		try {
			const parsed: unknown = JSON.parse(block.text), answer = omit(parsed);
			return answer === parsed ? block : { ...block, text: JSON.stringify(answer) };
		} catch { return block; }
	}) };
}

export function toLlmMessages(messages: readonly AgentMessage[]): Message[] {
	const owllyMessages = messages as readonly OwllyMessage[];
	const active = activeCompactionOf(owllyMessages);
	let start = 0;
	let head: Message | null = null;
	if (active) {
		const kept = keptIndexFor(owllyMessages, active);
		if (kept > 0) {
			start = kept;
			head = {
				role: "user",
				content: [{ type: "text", text: active.content }],
				timestamp: active.timestamp,
			};
		}
	}
	const leading =
		(messages[0] as { role?: string } | undefined)?.role === "system" ? (messages[0] as Message) : null;
	const out: Message[] = [];
	if (leading) out.push(leading);
	if (head) out.push(head);
	for (let i = leading ? Math.max(start, 1) : start; i < messages.length; i++) {
		const m = messages[i]!;
		const role = (m as { role?: string }).role;
		if (role === "custom") {
			const marker = m as OwllyMarkerMessage;
			if (marker.customType === "plan-block" || marker.customType === "problem-dismissed") continue;
			if (marker.customType === "side-question" && !marker.content) continue;
			if (marker.customType === "compaction" && head !== null) continue;
			const problemSubmission = marker.customType === "plugin-problem-submission" ? readPluginProblemSubmission(marker.details) : null;
			out.push({
				role: "user",
				content: problemSubmission ? nativeAnswerContent(marker.content, { answer: problemSubmission.images?.submission, thinking: problemSubmission.images?.thinking })
					: [{ type: "text", text: marker.customType === "practice-thinking" || marker.customType === "side-question" ? expandCitationsForModel(marker.content) : marker.content }, ...(marker.customType === "practice-thinking"
						? (marker.details as { images?: ImageContent[] } | null)?.images ?? [] : [])],
				timestamp: marker.timestamp,
			});
			continue;
		}
		const { id: _id, cliContextWindow: _cliContextWindow, owllyQuestions: _lhQuestions, owllyQuestionOccurrence: _lhQuestionOccurrence, ...native } = m as OwllyMessage;
		out.push(role === "user" ? expandUserCitations(native as UserMessage) : role === "toolResult" ? withoutLegacyConfidence(native as ToolResultMessage) : (native as Message));
		if (role === "assistant") {
			const assistant = m as AssistantMessage;
			if (assistant.stopReason === "error" || assistant.stopReason === "aborted") continue;
			const calls = assistant.content.filter((b) => b.type === "toolCall");
			if (calls.length === 0) continue;
			const answered = resultIdsFrom(messages.slice(i + 1));
			for (const call of calls) {
				const contentIndex = assistant.content.indexOf(call);
				const annotation = readPluginQuestionMessageAnnotation(m, contentIndex);
				const occurrence = { messageId: (m as OwllyMessage).id, contentIndex, toolCallId: call.id, toolName: call.name };
				if (annotation.status === "absent" || annotation.status === "attempt" ? answered.has(call.id) : messages.slice(i + 1).some(result => pluginQuestionResultMatches(result as OwllyMessage, occurrence, annotation))) continue;
				out.push({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: INTERRUPTED_TEXT }],
					isError: false,
					timestamp: assistant.timestamp,
				});
			}
		}
	}
	return out;
}


export function pluginQuestionResultMatches(
	message: OwllyMessage,
	occurrence: PluginQuestionOccurrence,
	annotation: PluginQuestionAnnotationRead,
): boolean {
	if (message.role !== "toolResult" || message.isError || message.toolCallId !== occurrence.toolCallId || message.toolName !== occurrence.toolName) return false;
	const cancellation = readPluginQuestionCancellation(message.details, annotation.status === "posed" ? annotation.snapshot : undefined);
	if (cancellation && samePluginQuestionOccurrence(cancellation.occurrence, occurrence)) {
		return annotation.status !== "unreadable" || !annotation.identity || cancellation.questionId === annotation.identity.questionId;
	}
	if (annotation.status !== "posed" || !message.owllyQuestionOccurrence || !samePluginQuestionOccurrence(message.owllyQuestionOccurrence, occurrence)) return false;
	return readPluginQuestionAnswer(message.details, annotation.snapshot) !== null;
}

export interface PluginQuestionCall {
	occurrence: PluginQuestionOccurrence;
	annotation: Exclude<PluginQuestionAnnotationRead, { status: "absent" }>;
	status: "answerable" | "unreadable" | "attempt" | "failed" | "streaming";
	snapshot?: PluginQuestionSnapshot;
}

const pluginQuestionHistory = new ImmutableReadCache<PluginQuestionCall[]>();
export function pluginQuestionCallsOf(messages: readonly OwllyMessage[]): PluginQuestionCall[] {
	return pluginQuestionHistory.read(messages, undefined, () => scanPluginQuestionCalls(messages));
}
function scanPluginQuestionCalls(messages: readonly OwllyMessage[]): PluginQuestionCall[] {
	const calls: PluginQuestionCall[] = [];
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const message = messages[mi]!;
		if (message.role !== "assistant") continue;
		for (const [contentIndex, block] of message.content.entries()) {
			if (block.type !== "toolCall") continue;
			const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
			if (annotation.status === "absent") continue;
			const occurrence = { messageId: message.id, contentIndex, toolCallId: block.id, toolName: block.name };
			if (messages.slice(mi + 1).some(result => pluginQuestionResultMatches(result, occurrence, annotation))) continue;
			const status = annotation.status === "posed" ? "answerable" : annotation.status === "unreadable" ? "unreadable"
				: message.stopReason === "error" || message.stopReason === "aborted" ? "failed"
				: message.stopReason === "pending" ? "streaming" : "attempt";
			calls.push({ occurrence, annotation, status, ...(annotation.status === "posed" ? { snapshot: annotation.snapshot } : {}) });
		}
	}
	return calls;
}

export function pendingPluginQuestionOf(messages: readonly OwllyMessage[]): PluginQuestionSnapshot | undefined {
	return pluginQuestionCallsOf(messages).find(call => call.status === "answerable")?.snapshot;
}
export const danglingPluginQuestionOf = pendingPluginQuestionOf;

export function danglingQuestionOf(
	messages: readonly OwllyMessage[],
): { toolCallId: string; tool: string; input: unknown } | null {
	const question = questionCallsOf(messages).find(call => call.status === "answerable");
	return question ? { toolCallId: question.toolCallId, tool: question.tool, input: question.input } : null;
}

export function pendingQuestionOf(messages: readonly OwllyMessage[]): PendingQuestion | null {
	const question = questionCallsOf(messages.filter(message => !isLiveQuestionPlaceholder(message))).find(call => call.status === "answerable");
	if (!question) return null;
	let occurrences = 0;
	for (const message of messages) {
		if (message.role !== "assistant" || message.id.startsWith("c_")) continue;
		for (const call of message.content) {
			if (call.type === "toolCall" && call.id === question.toolCallId) occurrences++;
		}
	}
	return {
		toolCallId: question.toolCallId, tool: question.tool, input: question.input,
		messageId: question.messageId, contentIndex: question.contentIndex,
		key: occurrences > 1 ? JSON.stringify([question.messageId, question.contentIndex, question.toolCallId]) : question.toolCallId,
	};
}

function isLiveQuestionPlaceholder(message: OwllyMessage): boolean {
	return message.role === "toolResult" && message.id.startsWith("c_") &&
		!message.isError && message.details === null &&
		(QUESTION_TOOLS as readonly string[]).includes(message.toolName);
}

export interface QuestionCall extends Omit<PendingQuestion, "key"> {
	status: "streaming" | "answerable" | "malformed" | "failed";
}

export function questionCallsOf(messages: readonly OwllyMessage[]): QuestionCall[] {
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const assistant = messages[mi]!;
		if (assistant.role !== "assistant") continue;
		const answered = resultIdsFrom(messages.slice(mi + 1));
		const calls: QuestionCall[] = [];
		for (const [contentIndex, block] of assistant.content.entries()) {
			if (block.type !== "toolCall" || !(QUESTION_TOOLS as readonly string[]).includes(block.name) || answered.has(block.id)) continue;
			if (readPluginQuestionMessageAnnotation(assistant, contentIndex).status !== "absent") continue;
			const status = assistant.stopReason === "error" || assistant.stopReason === "aborted" ? "failed"
				: assistant.stopReason === "pending" ? "streaming"
				: assistant.stopReason === "length" || block.argumentsError || !parseQuestionInput(block.name, block.arguments) ? "malformed"
				: "answerable";
			calls.push({ toolCallId: block.id, tool: block.name, input: block.arguments,
				messageId: assistant.id, contentIndex, status });
		}
		return calls;
	}
	return [];
}

export function hasUnresolvedQuestion(messages: readonly OwllyMessage[]): boolean {
	return questionCallsOf(messages).length > 0 || pluginQuestionCallsOf(messages).some(call => call.status === "answerable" || call.status === "unreadable");
}

export function malformedQuestionsOf(messages: readonly OwllyMessage[]): QuestionCall[] {
	return questionCallsOf(messages.filter(message => !isLiveQuestionPlaceholder(message))).filter(call => call.status === "malformed");
}

export function probeDoneResultIds(messages: readonly OwllyMessage[]): Set<string> {
	const calls = new Set<string>();
	const results = new Set<string>();
	for (const m of messages) {
		if (m.role === "assistant") {
			if (m.stopReason === "error" || m.stopReason === "aborted") continue;
			for (const block of m.content) {
				if (block.type === "toolCall" && block.name === "probe_done") calls.add(block.id);
			}
		} else if (
			m.role === "toolResult" && m.toolName === "probe_done" &&
			calls.has(m.toolCallId) && !m.isError &&
			(m.details as { ok?: unknown } | null | undefined)?.ok !== false
		) {
			results.add(m.id);
		}
	}
	return results;
}

export function hasProbeDone(messages: readonly OwllyMessage[]): boolean {
	return probeDoneResultIds(messages).size > 0;
}

export function answeredCallIds(messages: readonly OwllyMessage[]): Set<string> {
	return resultIdsFrom(messages);
}


function isDismissedResult(m: OwllyMessage): boolean {
	if ((m as { role?: string }).role !== "toolResult") return false;
	const details = (m as { details?: unknown }).details as { dismissed?: unknown } | undefined;
	return details?.dismissed === true || readPluginQuestionCancellation((m as ToolResultMessage).details) !== null;
}

export function endsInDismissal(record: readonly OwllyMessage[]): boolean {
	const messages = tailIgnoringSideQuestions(record);
	const last = messages[messages.length - 1];
	return last !== undefined && isDismissedResult(last);
}

export function endsInQuestionRecovery(record: readonly OwllyMessage[]): boolean {
	const messages = tailIgnoringSideQuestions(record);
	const last = messages[messages.length - 1];
	return last?.role === "toolResult" && last.isError &&
		(last.details as { questionRecovery?: unknown } | null)?.questionRecovery === true;
}

export type RequestCause = "foreground" | "background";
export type ReconstructedCause = RequestCause | "ambiguous";
export type NativeInputCause = "learner" | "automatic" | "neutral" | "unrecognizable";
export function nativeInputCause(message: AgentMessage, history: readonly AgentMessage[]): NativeInputCause {
	if (message.role === "user") return "learner";
	if (message.role === "system" || message.role === "assistant") return "neutral";
	if (message.role === "custom") {
		if (["probe-handoff", "subagent-steer", "subagent-abort"].includes(message.customType)) return "automatic";
		if (["practice-thinking", "plugin-problem-submission", "practice-next"].includes(message.customType)) return "learner";
		return ["graph-context", "plan-block", "problem-dismissed", "compaction", "side-question", "side-question-told"].includes(message.customType) ? "neutral" : "unrecognizable";
	}
	if (message.role === "toolResult") {
		const pluginAnswer = readPluginQuestionAnswer(message.details);
		if (pluginAnswer) {
			return pluginQuestionCallsOf(history as readonly OwllyMessage[]).some(call => call.annotation.status === "posed" && pluginQuestionResultMatches(message as OwllyMessage, call.occurrence, call.annotation)) ? "learner" : "unrecognizable";
		}
		if (readPluginQuestionCancellation(message.details)) return "neutral";
		if (message.isError && (message.details as { questionRecovery?: unknown } | null)?.questionRecovery === true) {
			return questionCallsOf(history as readonly OwllyMessage[]).some(call => call.status === "malformed" && call.toolCallId === message.toolCallId && call.tool === message.toolName) ? "learner" : "unrecognizable";
		}
		if (!(QUESTION_TOOLS as readonly string[]).includes(message.toolName) || message.isError || message.details == null || (message.details as { dismissed?: boolean }).dismissed) return "neutral";
		const details = message.details as Partial<QuestionAnswerData>;
		if (!["quiz", "ask", "explain"].includes(details.kind ?? "") || typeof details.questionText !== "string" || typeof details.dontKnow !== "boolean" || !Array.isArray(details.answers) || typeof details.answeredAt !== "string") return "unrecognizable";
		const calls = history.flatMap((m) => m.role === "assistant" ? m.content.filter((b) => b.type === "toolCall" && b.id === message.toolCallId) : []);
		return calls.length === 1 && calls[0]?.type === "toolCall" && calls[0].name === message.toolName ? "learner" : "unrecognizable";
	}
	return "unrecognizable";
}
export function reconstructRequestCause(messages: readonly OwllyMessage[]): ReconstructedCause {
	let inherited: ReconstructedCause = "ambiguous";
	let triggers: NativeInputCause[] = [];
	const seen = new Map<string, string>();
	const history: AgentMessage[] = [];
	const resolve = (): ReconstructedCause => {
		if (triggers.includes("unrecognizable")) return "ambiguous";
		const lastLearner = triggers.lastIndexOf("learner"), lastAutomatic = triggers.lastIndexOf("automatic");
		if (lastLearner < 0 && lastAutomatic < 0) return inherited;
		if (lastAutomatic < 0) return "foreground";
		if (lastLearner < lastAutomatic) return "background";
		return "ambiguous";
	};
	for (const message of messages) {
		const cause = nativeInputCause(message, history);
		const id = (message as { id?: string }).id;
		if (id) {
			const value = JSON.stringify(message);
			if (seen.has(id)) { if (seen.get(id) !== value) triggers.push("unrecognizable"); continue; }
			seen.set(id, value);
		} else if (cause !== "neutral") triggers.push("unrecognizable");
		if (message.role === "assistant" && !(message.provider === "synthetic" && message.api === "faux" && message.model === "synthetic-conclude" && message.content.some((b) => b.type === "toolCall" && b.name === "conclude" && b.arguments?.outcome === "dismissed"))) {
			inherited = resolve(); triggers = [];
		} else if (cause !== "neutral") triggers.push(cause);
		history.push(message);
	}
	return resolve();
}

export function needsContinuation(record: readonly OwllyMessage[]): boolean {
	const messages = tailIgnoringSideQuestions(record);
	if (pluginQuestionCallsOf(messages).some(call => call.status === "answerable" || call.status === "unreadable")) return false;
	const last = messages[messages.length - 1];
	if (!last || (last as { role?: string }).role !== "toolResult") return false;
	let start = messages.length - 1;
	while (
		start > 0 &&
		(messages[start - 1] as { role?: string } | undefined)?.role === "toolResult"
	) {
		start--;
	}
	if (isDismissedResult(messages[messages.length - 1]!) || endsInQuestionRecovery(messages)) {
		return false;
	}
	const owner = messages[start - 1];
	if (!owner || (owner as { role?: string }).role !== "assistant") return false;
	const content = (owner as { content?: unknown }).content;
	if (!Array.isArray(content)) return false;
	const results = messages.slice(start) as ToolResultMessage[];
	const posedProblem = results.some(
		(m) => !m.isError && ((m.toolName === PRACTICE_PROBLEM_TOOL && m.details == null) ||
			(content as AssistantMessage["content"]).some((call, contentIndex) => call.type === "toolCall" && call.id === m.toolCallId && call.name === m.toolName &&
				!!pluginProblemForCall(messages, { messageId: owner.id, contentIndex, toolCallId: call.id, toolName: call.name }))),
	);
	if (posedProblem) return false;
	const answered = new Set(results.map((m) => m.toolCallId));
	const calls = (content as Array<{ type?: string; id?: string; name?: string }>).filter(
		(b) => b.type === "toolCall" && typeof b.id === "string",
	);
	return calls.length > 0 && calls.every((b) => {
		const contentIndex = content.indexOf(b);
		const annotation = readPluginQuestionMessageAnnotation(owner, contentIndex);
		return annotation.status === "absent" || annotation.status === "attempt" ? answered.has(b.id!) : results.some(result => pluginQuestionResultMatches(result as OwllyMessage, {
			messageId: owner.id, contentIndex, toolCallId: b.id!, toolName: b.name!,
		}, annotation));
	});
}
