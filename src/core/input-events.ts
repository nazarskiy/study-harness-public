
import type { QuestionAnswerData } from "./question-core.ts";
import type { ImageContent } from "@earendil-works/pi-ai";
import { validatePluginSubmissionImageArray, validatePluginSubmissionImages, type PluginSubmissionImages, type PluginSubmissionOccurrence } from "./plugin-submissions.ts";
import type { OwllyMessage } from "./native-messages.ts";
import {
	activeProblemOf,
	activeProblemOccurrenceOf,
	concludedByDismissalPair,
	isSideQuestionMarker,
	danglingQuestionOf,
	newAnswerResult,
	newNextMessage,
	newProblemDismissedMarker,
	newThinkingMessage,
	newUserMessage,
	newMessageId,
	questionCallsOf,
	pluginQuestionCallsOf,
	pendingProblemDismissalOf,
} from "./native-messages.ts";
import { QUESTION_TOOLS, toolQuestionKind } from "./pending.ts";
import { isPluginQuestionJson, type JsonValue, type PluginQuestionOccurrence } from "./plugin-questions.ts";
import { preparePluginProblemSubmissionImages, type PluginProblemSubmissionImages } from "./plugin-submissions.ts";

export type PluginQuestionAnswerInput = { type: "plugin-question-answer"; questionId: string; occurrence: PluginQuestionOccurrence; answer: JsonValue; thinking?: string; readingThinking?: string; images?: PluginSubmissionImages };
export type PluginProblemSubmissionInput = { type: "plugin-problem-submission"; problemId: string; occurrence: PluginSubmissionOccurrence; submission: JsonValue; thinking?: string; images?: PluginProblemSubmissionImages };
export type DismissPluginQuestionInput = { type: "dismiss-plugin-question"; questionId?: string; occurrence: PluginQuestionOccurrence };

export type ChatInput =
	| PluginQuestionAnswerInput
	| PluginProblemSubmissionInput
	| { type: "text"; text: string; images?: ImageContent[] }
	| { type: "answer"; toolCallId: string; answer: QuestionAnswerData; occurrence?: PluginSubmissionOccurrence }
	| { type: "continue" }
	| { type: "retry" }
	| { type: "retry-question"; messageId: string; contentIndex: number; toolCallId: string }
	| { type: "thinking"; problemCallId: string; text: string; images?: ImageContent[]; occurrence?: PluginSubmissionOccurrence }
	| { type: "next" };

export type SteerInput = { type: "steers"; steers: OwllyMessage[] };

export type TurnInput = ChatInput | SteerInput;

export type DismissInput =
	| DismissPluginQuestionInput
	| { type: "dismiss"; toolCallId: string; answer: QuestionAnswerData }
	| { type: "dismiss-problem"; problemCallId: string };

export function parseDismissInput(input: unknown): DismissInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	if (i.type === "dismiss-plugin-question") {
		if (i.questionId !== undefined && (typeof i.questionId !== "string" || !i.questionId)) throw new ChatInputError("dismiss-plugin-question requires a valid questionId");
		return { type: "dismiss-plugin-question", ...(i.questionId !== undefined ? { questionId: i.questionId as string } : {}), occurrence: parsePluginQuestionOccurrence(i.occurrence) };
	}
	if (i.type === "dismiss-problem") {
		if (typeof i.problemCallId !== "string" || i.problemCallId.length === 0) {
			throw new ChatInputError("dismiss-problem input requires problemCallId");
		}
		return { type: "dismiss-problem", problemCallId: i.problemCallId };
	}
	if (i.type !== "dismiss") throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	if (typeof i.toolCallId !== "string" || i.toolCallId.length === 0) {
		throw new ChatInputError("dismiss input requires toolCallId");
	}
	const answer = i.answer as QuestionAnswerData | undefined;
	if (typeof answer !== "object" || answer === null) {
		throw new ChatInputError("dismiss input requires the dismissal answer object");
	}
	if (answer.dismissed !== true) {
		throw new ChatInputError("dismiss input's answer must be a dismissal (dismissed: true)");
	}
	return { type: "dismiss", toolCallId: i.toolCallId, answer };
}

export type UserSteerInput = { type: "steer"; id: string; text: string; images?: ImageContent[] };

export function parseUserSteerInput(input: unknown): UserSteerInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	if (i.type !== "steer") throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	if (typeof i.id !== "string" || i.id.length === 0) {
		throw new ChatInputError("steer input requires a client-minted id");
	}
	const images = parseImages(i.images);
	if (typeof i.text !== "string" || (!i.text.trim() && !images)) {
		throw new ChatInputError("steer input requires non-empty text or images");
	}
	return { type: "steer", id: i.id, text: i.text, ...(images ? { images } : {}) };
}

export function dismissAppends(record: { messages: OwllyMessage[] }, input: DismissInput): OwllyMessage[] {
	assertPluginQuestionInputAllowed(record.messages, input);
	if (input.type === "dismiss-plugin-question") throw new ChatInputError("Plugin question dismissal requires canonical server validation");
	if (input.type === "dismiss-problem") {
		const active = activeProblemOf(record.messages);
		if (!active || active.toolCallId !== input.problemCallId) {
			throw new ChatInputError("dismiss-problem input targets no active problem");
		}
		return [newProblemDismissedMarker(input.problemCallId)];
	}
	const pending = danglingQuestionOf(record.messages);
	if (!pending || pending.toolCallId !== input.toolCallId) {
		throw new ChatInputError("dismiss input targets no pending question call");
	}
	if (input.answer.kind !== toolQuestionKind(pending.tool)) {
		throw new ChatInputError("dismiss input's answer kind does not match the question");
	}
	return [newAnswerResult(input.toolCallId, pending.tool, input.answer)];
}

export class ChatInputError extends Error {}

export function assertPluginQuestionInputAllowed(messages: readonly OwllyMessage[], input: unknown): void {
	const type = input && typeof input === "object" ? (input as { type?: unknown }).type : undefined;
	if (type === "plugin-question-answer" || type === "dismiss-plugin-question") return;
	if (pluginQuestionCallsOf(messages).some(call => call.status === "answerable" || call.status === "unreadable")) {
		throw new ChatInputError("Answer or dismiss the pending plugin question first");
	}
}

function parsePluginQuestionOccurrence(value: unknown): PluginQuestionOccurrence {
	if (!value || typeof value !== "object") throw new ChatInputError("Plugin question input requires an exact occurrence");
	const o = value as Record<string, unknown>;
	if (typeof o.messageId !== "string" || !o.messageId || typeof o.toolCallId !== "string" || !o.toolCallId || typeof o.toolName !== "string" || !o.toolName || typeof o.contentIndex !== "number" || !Number.isSafeInteger(o.contentIndex) || o.contentIndex < 0) throw new ChatInputError("Plugin question input requires an exact occurrence");
	return { messageId: o.messageId, contentIndex: o.contentIndex, toolCallId: o.toolCallId, toolName: o.toolName };
}

function parseImages(value: unknown): ImageContent[] | undefined {
	if (value === undefined) return undefined;
	try {
		const images = validatePluginSubmissionImageArray(value);
		return images.length ? images : undefined;
	} catch (error) { throw new ChatInputError(error instanceof Error ? error.message : "Invalid submission images"); }
}
function parseImageChannels(value: unknown): PluginSubmissionImages | undefined {
	if (value === undefined) return undefined;
	try {
		const images = validatePluginSubmissionImages(value);
		return Object.keys(images).length ? images : undefined;
	} catch (error) { throw new ChatInputError(error instanceof Error ? error.message : "Invalid submission image channels"); }
}
function parseOptionalOccurrence(value: unknown, images: unknown): PluginSubmissionOccurrence | undefined {
	if (value !== undefined) return parsePluginQuestionOccurrence(value);
	if (images) throw new ChatInputError("Image-bearing submissions require an exact occurrence");
	return undefined;
}

export function parseChatInput(input: unknown): ChatInput {
	if (typeof input !== "object" || input === null) throw new ChatInputError("input must be an object");
	const i = input as Record<string, unknown>;
	switch (i.type) {
		case "plugin-problem-submission": {
			if (typeof i.problemId !== "string" || !i.problemId) throw new ChatInputError("plugin-problem-submission requires problemId");
			if (!isPluginQuestionJson(i.submission)) throw new ChatInputError("plugin-problem-submission requires finite JSON submission");
			if (i.thinking !== undefined && typeof i.thinking !== "string") throw new ChatInputError("Problem thinking must be text");
			let images;
			try { images = i.images === undefined ? undefined : preparePluginProblemSubmissionImages(i.images); }
			catch { throw new ChatInputError("Invalid problem submission images"); }
			return { type: "plugin-problem-submission", problemId: i.problemId, occurrence: parsePluginQuestionOccurrence(i.occurrence), submission: i.submission, ...(i.thinking !== undefined ? { thinking: i.thinking as string } : {}), ...(images ? { images } : {}) };
		}
		case "plugin-question-answer": {
			if (typeof i.questionId !== "string" || !i.questionId) throw new ChatInputError("plugin-question-answer requires questionId");
			if (!isPluginQuestionJson(i.answer)) throw new ChatInputError("plugin-question-answer requires finite JSON answer");
			if ((i.thinking !== undefined && typeof i.thinking !== "string") || (i.readingThinking !== undefined && typeof i.readingThinking !== "string")) throw new ChatInputError("Plugin question thinking must be text");
			const images = parseImageChannels(i.images);
			return { type: "plugin-question-answer", questionId: i.questionId, occurrence: parsePluginQuestionOccurrence(i.occurrence), answer: i.answer, ...(i.thinking !== undefined ? { thinking: i.thinking as string } : {}), ...(i.readingThinking !== undefined ? { readingThinking: i.readingThinking as string } : {}), ...(images ? { images } : {}) };
		}
		case "text": {
			const images = parseImages(i.images);
			if (typeof i.text !== "string" || (!i.text.trim() && !images)) {
				throw new ChatInputError("text input requires non-empty text or images");
			}
			return { type: "text", text: i.text, ...(images ? { images } : {}) };
		}
		case "answer": {
			if (typeof i.toolCallId !== "string" || i.toolCallId.length === 0) {
				throw new ChatInputError("answer input requires toolCallId");
			}
			if (typeof i.answer !== "object" || i.answer === null) {
				throw new ChatInputError("answer input requires the graded answer object");
			}
			const answer = i.answer as QuestionAnswerData;
			const images = parseImageChannels(answer.images);
			const occurrence = parseOptionalOccurrence(i.occurrence, images);
			const { images: _images, ...fields } = answer;
			return { type: "answer", toolCallId: i.toolCallId, answer: { ...fields, ...(images ? { images } : {}) }, ...(occurrence ? { occurrence } : {}) };
		}
		case "continue":
			return { type: "continue" };
		case "retry":
			return { type: "retry" };
		case "retry-question":
			if (typeof i.messageId !== "string" || !i.messageId || typeof i.toolCallId !== "string" || !i.toolCallId ||
				typeof i.contentIndex !== "number" || !Number.isSafeInteger(i.contentIndex) || i.contentIndex < 0) {
				throw new ChatInputError("retry-question input requires an exact question occurrence");
			}
			return { type: "retry-question", messageId: i.messageId, contentIndex: i.contentIndex, toolCallId: i.toolCallId };
		case "thinking": {
			if (typeof i.problemCallId !== "string" || i.problemCallId.length === 0) {
				throw new ChatInputError("thinking input requires problemCallId");
			}
			const images = parseImages(i.images);
			const occurrence = parseOptionalOccurrence(i.occurrence, images);
			if (typeof i.text !== "string" || (!i.text.trim() && !images)) {
				throw new ChatInputError("thinking input requires non-empty text or images");
			}
			return { type: "thinking", problemCallId: i.problemCallId, text: i.text, ...(images ? { images } : {}), ...(occurrence ? { occurrence } : {}) };
		}
		case "next":
			return { type: "next" };
		default:
			throw new ChatInputError(`unknown input type: ${String(i.type)}`);
	}
}

export function inputAppends(
	record: { messages: OwllyMessage[]; kind?: string },
	input: ChatInput,
): OwllyMessage[] {
	assertPluginQuestionInputAllowed(record.messages, input);
	assertNativeSubmissionTarget(record.messages, input);
	switch (input.type) {
		case "plugin-problem-submission":
			throw new ChatInputError("Plugin problem submissions require canonical server validation");
		case "plugin-question-answer":
			throw new ChatInputError("Plugin question answers require canonical server validation");
		case "text":
			return [...dismissalConclusion(record), newUserMessage(input.text, input.images)];
		case "answer": {
			const pending = danglingQuestionOf(record.messages);
			if (!pending || pending.toolCallId !== input.toolCallId) {
				throw new ChatInputError("answer input targets no pending question call");
			}
			return [newAnswerResult(input.toolCallId, pending.tool, input.answer)];
		}
		case "continue":
			return dismissalConclusion(record);
		case "retry":
			return [];
		case "retry-question":
			return questionRecoveryAppends(record.messages, input);
		case "thinking": {
			const active = activeProblemOf(record.messages);
			if (!active || active.toolCallId !== input.problemCallId) {
				throw new ChatInputError("thinking input targets no active problem");
			}
			if (active.pluginProblem) throw new ChatInputError("This problem requires its registered submission editor");
			return [...dismissalConclusion(record), newThinkingMessage(input.problemCallId, input.text, input.images)];
		}
		case "next": {
			if (record.kind !== "practice") {
				throw new ChatInputError("next input is a practice-session affordance");
			}
			if (activeProblemOf(record.messages)) {
				throw new ChatInputError("next input requires no active problem");
			}
			return [...dismissalConclusion(record), newNextMessage()];
		}
	}
}

export function assertNativeSubmissionTarget(messages: readonly OwllyMessage[], input: ChatInput): void {
	if (input.type !== "answer" && input.type !== "thinking") return;
	const hasImages = input.type === "answer"
		? Object.values(input.answer.images ?? {}).some(images => images?.length)
		: !!input.images?.length;
	if (!input.occurrence) {
		if (hasImages) throw new ChatInputError("Image-bearing submissions require an exact occurrence");
		return;
	}
	let occurrence: PluginSubmissionOccurrence | undefined;
	if (input.type === "answer") {
		const pending = questionCallsOf(messages).find(call => call.status === "answerable");
		if (pending && pending.toolCallId === input.toolCallId) occurrence = {
			messageId: pending.messageId, contentIndex: pending.contentIndex, toolCallId: pending.toolCallId, toolName: pending.tool,
		};
	} else {
		const active = activeProblemOccurrenceOf(messages);
		if (active?.toolCallId === input.problemCallId) occurrence = active;
	}
	if (!occurrence || occurrence.messageId !== input.occurrence.messageId || occurrence.contentIndex !== input.occurrence.contentIndex || occurrence.toolCallId !== input.occurrence.toolCallId || occurrence.toolName !== input.occurrence.toolName) {
		throw new ChatInputError("Submission target is no longer active. Refresh the session.");
	}
}

export function questionRecoveryAppends(
	messages: readonly OwllyMessage[],
	input: Extract<ChatInput, { type: "retry-question" }>,
): OwllyMessage[] {
	assertPluginQuestionInputAllowed(messages, input);
	const calls = questionCallsOf(messages);
	const target = calls.find(call => call.messageId === input.messageId && call.contentIndex === input.contentIndex && call.toolCallId === input.toolCallId);
	if (!target || target.status !== "malformed") throw new ChatInputError("This malformed question is no longer available to retry. Refresh the session.");
	if (calls.some(call => call.status === "answerable")) throw new ChatInputError("Answer or discard the remaining question before retrying this one.");
	return calls.filter(call => call.status === "malformed").map(call => ({
		id: newMessageId(), role: "toolResult", toolCallId: call.toolCallId, toolName: call.tool,
		content: [{ type: "text", text: `Tool call "${call.tool}" could not be displayed as a complete question. The learner requested a replacement, not an answer. Re-issue the question with complete, valid arguments.` }],
		details: { questionRecovery: true }, isError: true, timestamp: Date.now(),
	}));
}

export function failedResponseAtEnd(messages: readonly OwllyMessage[]): Extract<OwllyMessage, { role: "assistant" }> | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "custom" && (m.customType === "plan-block" || m.customType === "compaction" || isSideQuestionMarker(m))) continue;
		return m.role === "assistant" && m.stopReason === "error" ? m : undefined;
	}
	return undefined;
}

export function endsInFailedTurn(messages: readonly OwllyMessage[]): boolean {
	const { ids, before } = failedTail(messages);
	return ids.size > 0 && before !== undefined && before.role !== "assistant";
}

export function retryDrops(messages: readonly OwllyMessage[]): Set<string> {
	const { ids, before } = failedTail(messages);
	if (ids.size === 0) {
		const failure = failedResponseAtEnd(messages);
		if (failure) {
			throw new ChatInputError(`${failure.errorMessage ?? "An error occurred."}\n\nThis response cannot be retried after compaction. Send a new message to continue.`);
		}
		throw new ChatInputError("retry input requires a failed turn to retry");
	}
	if (!before || before.role === "assistant") throw new ChatInputError("retry input leaves no input to continue from");
	return ids;
}

function failedTail(messages: readonly OwllyMessage[]): { ids: Set<string>; before: OwllyMessage | undefined } {
	const ids = new Set<string>();
	let i = messages.length - 1;
	for (; i >= 0; i--) {
		const m = messages[i]!;
		if (m.role === "assistant" && m.stopReason === "error") ids.add(m.id);
		else if (!(m.role === "custom" && (m.customType === "plan-block" || isSideQuestionMarker(m)))) break;
	}
	return { ids, before: messages[i] };
}

function dismissalConclusion(record: { messages: OwllyMessage[] }): OwllyMessage[] {
	const problemCallId = pendingProblemDismissalOf(record.messages);
	return problemCallId ? concludedByDismissalPair(problemCallId) : [];
}

export function isQuestionTool(name: string): boolean {
	return (QUESTION_TOOLS as readonly string[]).includes(name);
}
