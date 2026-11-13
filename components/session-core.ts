
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import {
failedResponseAtEnd,
measuredContextTokens,
needsContinuation,
newAnswerResult,
newNextMessage,
newProblemDismissedMarker,
newThinkingMessage,
newUserMessage,
pendingQuestionOf,
projectView,
type ChatInput,
type LiveExecution,
type OwllyMarkerMessage,
type OwllyMessage,
type OwllyViewMessage,
type QuestionAnswerData,
type QuestionDraft,
type SessionPricing,
type TurnUsage
} from "../src/core";

import { copyImmutableData } from "../src/core/index.ts";


export interface SessionRecordSnapshot {

	messages: OwllyMessage[];
	turnError?: string;

	turnInFlight?: boolean;
	turns?: TurnUsage[];
	pricing?: SessionPricing;
}
export interface SessionRecordReadOptions {
	adoption?: "replace" | "append" | "none";
	signal?: AbortSignal;
	isCurrent?: () => boolean;
	allowInFlight?: boolean;
	tolerateHttpFailure?: boolean;
}

export type SessionStatus = "ready" | "submitted" | "streaming" | "error";

export interface SessionModelDeps {
	fetch?: typeof globalThis.fetch;
}

let localSeq = 0;
function localId(): string {
	return `c_${Date.now().toString(36)}_${(localSeq++).toString(36)}`;
}

const STREAM_DROPPED = "The connection dropped before the turn completed.";

class StreamReadError extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
	}
}

export async function* sseEvents(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Record<string, unknown>, boolean> {
	const decoder = new TextDecoder();
	let buf = "";
	for (;;) {
		let chunk: ReadableStreamReadResult<Uint8Array>;
		try { chunk = await reader.read(); }
		catch (err) { throw new StreamReadError(err); }
		const { done, value } = chunk;
		if (done) return false;
		buf += decoder.decode(value, { stream: true });
		for (;;) {
			const end = buf.indexOf("\n\n");
			if (end === -1) break;
			const event = buf.slice(0, end);
			buf = buf.slice(end + 2);
			const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
			if (!dataLine) continue;
			const data = dataLine.slice("data: ".length);
			if (data === "[DONE]") return true;
			yield JSON.parse(data) as Record<string, unknown>;
		}
	}
}

export function pendingCallTool(messages: readonly OwllyMessage[], toolCallId: string): string | null {
	for (let mi = messages.length - 1; mi >= 0; mi--) {
		const m = messages[mi]!;
		if (m.role !== "assistant") continue;
		for (let bi = m.content.length - 1; bi >= 0; bi--) {
			const block = m.content[bi]!;
			if (block.type === "toolCall" && block.id === toolCallId) return block.name;
		}
	}
	return null;
}

export function absorbed(m: OwllyMessage, record: readonly OwllyMessage[]): boolean {
	if (typeof m.id !== "string" || !m.id.startsWith("c_")) return false;
	const role = (m as { role?: string }).role;
	if (role === "user") {
		const content = (m as { content?: unknown }).content;
		return record.some(
			(r) => (r as { role?: string }).role === "user" && (Array.isArray(content) ? sameDetails((r as { content?: unknown }).content, content) : (r as { content?: unknown }).content === content),
		);
	}
	if (role === "toolResult") {
		const toolCallId = (m as ToolResultMessage).toolCallId;
		return record.some(
			(r) =>
				(r as { role?: string }).role === "toolResult" &&
				(r as ToolResultMessage).toolCallId === toolCallId,
		);
	}
	if (role === "custom") {
		const marker = m as OwllyMarkerMessage;
		return record.some(
			(r) =>
				(r as { role?: string }).role === "custom" &&
				(r as OwllyMarkerMessage).customType === marker.customType &&
				sameDetails((r as OwllyMarkerMessage).details, marker.details),
		);
	}
	return false;
}

function sameDetails(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export interface SessionState {

	messages: OwllyViewMessage[];
	nativeMessages: OwllyMessage[];
	canonicalMessages: OwllyMessage[];
	hasConfirmedConversation: boolean;
	contextTokens: number | null;
	status: SessionStatus;
	evaluating: boolean;
	reconciliation: "ready" | "syncing" | "failed";

	error: { message: string } | null;
	steerQueue: SteerQueueItem[];
}

export interface SteerQueueItem {
	id: string;
	text: string;
}

export function visibleQueuedSteers(
	queue: readonly SteerQueueItem[],
	messages: readonly OwllyMessage[],
): SteerQueueItem[] {
	const ids = new Set(messages.map((m) => (m as { id?: string }).id));
	return queue.filter((s) => !ids.has(s.id));
}

export interface SessionModelOptions extends SessionModelDeps {
	chatId: string;
	initialMessages: OwllyMessage[];
	initialError?: string;
	onChange?: () => void;
	onReattachSettled?: () => void;
}

export class SessionModel {
	readonly chatId: string;
	fetch: typeof globalThis.fetch;
	private steerQueueValue: SteerQueueItem[] = [];
	private onReattachSettled?: () => void;
	onChange?: () => void;

	private base: OwllyMessage[];
	private tail: OwllyMessage[] = [];
	private questionDrafts = new Map<string, QuestionDraft>();


	private reconciliationValue: SessionState["reconciliation"] = "ready";

	private reconciliationTask: Promise<boolean> | null = null;
	private reconciliationOwner: AbortController | null = null;
	private connectionGeneration = 0;
	private reconciliationConnectionGeneration = 0;
	private canonicalIssued = 0;
	private canonicalAcknowledged = 0;
	private canonicalEpoch = 0;
	private imagePostOwner: AbortController | null = null;
	private imagePreview: { owner: AbortController; ids: ReadonlySet<string> } | null = null;
	private unconfirmedAnswers = new Map<string, string>();
	private executions = new Map<string, LiveExecution>();
	private streamingIds = new Set<string>();
	private incompleteUsageIds = new Set<string>();
	private streamingMessageId: string | null = null;
	private statusValue: SessionStatus = "ready";
	private evaluationOwner: AbortController | null = null;
	private errorValue: { message: string } | null = null;
	private automaticContinuationBlocked = false;
	private liveFailureId: string | null = null;
	private consumeAbort: AbortController | null = null;
	private latestRequest: AbortController | null = null;
	readyRef = true;

	private history?: { base: OwllyMessage[]; tail: OwllyMessage[]; messages: OwllyMessage[] };

	constructor(opts: SessionModelOptions) {
		this.chatId = opts.chatId;
		this.base = copyImmutableData(opts.initialMessages);
		this.tail = copyImmutableData(this.tail);

		this.errorValue = opts.initialError === undefined ? null : { message: opts.initialError };
		this.automaticContinuationBlocked = opts.initialError !== undefined;
		this.fetch = opts.fetch ?? ((...args) => globalThis.fetch(...args));
		this.onChange = opts.onChange;
		this.onReattachSettled = opts.onReattachSettled;
	}

	setReattachSettled(fn: () => void): void {
		this.onReattachSettled = fn;
	}

	private nativeHistory(): OwllyMessage[] {
		if (this.history?.base === this.base && this.history.tail === this.tail) return this.history.messages;
		const messages = copyImmutableData([...this.base, ...this.tail]);
		this.history = { base: this.base, tail: this.tail, messages };
		return messages;
	}

	getState(): SessionState {
		const live =
			this.statusValue === "submitted" || this.statusValue === "streaming"
				? { executions: this.executions, inFlight: true, streamingIds: this.streamingIds }
				: undefined;
		const messages = this.nativeHistory();
		const latest = failedResponseAtEnd(messages);
		const providerError =
			latest !== undefined &&
			!this.incompleteUsageIds.has(latest.id) && (!live || latest.id === this.liveFailureId)
				? { message: latest.errorMessage ?? "An error occurred." }
				: null;
		return {
			messages: projectView(messages, live),
			nativeMessages: messages,
			canonicalMessages: this.base,
			hasConfirmedConversation: this.base.some(m => m.role === "user" || m.role === "assistant"),
			contextTokens: measuredContextTokens(messages, this.incompleteUsageIds),
			status: this.statusValue,
			evaluating: this.statusValue === "submitted" && this.evaluationOwner !== null && this.evaluationOwner === this.consumeAbort,
			reconciliation: this.reconciliationValue,


			error: this.errorValue ?? providerError,
			steerQueue: this.steerQueueValue,
		};
	}

	get status(): SessionStatus {
		return this.statusValue;
	}

	private mutate(fn: () => void): void {
		fn();
		this.base = copyImmutableData(this.base);
		this.tail = copyImmutableData(this.tail);
		this.onChange?.();
	}

	private setStatus(status: SessionStatus): void {
		if (status === "submitted") { this.liveFailureId = null; this.invalidateCanonicalReads(); }
		this.statusValue = status;
		this.readyRef = status === "ready" && this.reconciliationValue === "ready";
		this.onChange?.();
	}

	private setError(message: string | null): void {
		this.errorValue = message === null ? null : { message };
		if (message !== null) this.automaticContinuationBlocked = true;
		this.onChange?.();
	}

	private invalidateCanonicalReads(): void { this.canonicalEpoch++; }

	private releaseImagePost(owner: AbortController | null): void {
		if (owner && this.imagePostOwner === owner) {
			this.imagePostOwner = null;
			this.invalidateCanonicalReads();
		}
	}
	private retireImagePreview(owner: AbortController | null): void {
		if (!owner || this.imagePreview?.owner !== owner) return;
		const ids = this.imagePreview.ids;
		this.imagePreview = null;
		this.mutate(() => {
			this.tail = this.tail.filter(message => !ids.has(message.id));
			for (const id of ids) this.unconfirmedAnswers.delete(id);
		});
	}
	private imagePostPending(owner: AbortController, pending: boolean): void {
		if (!pending) { this.releaseImagePost(owner); return; }
		if (this.consumeAbort !== owner || this.latestRequest !== owner) return;
		this.imagePostOwner = owner;
		this.invalidateCanonicalReads();
	}

	async readRecord(options: SessionRecordReadOptions = {}): Promise<SessionRecordSnapshot | undefined> {
		const ticket = ++this.canonicalIssued;
		const epoch = this.canonicalEpoch;
		const response = await this.fetch(`/api/chats/${encodeURIComponent(this.chatId)}`, { signal: options.signal });
		if (!response.ok) {
			const detail = await response.text();
			if (options.tolerateHttpFailure) return undefined;
			throw new Error(detail || "Could not sync the saved session.");
		}
		const record = JSON.parse(await response.text()) as SessionRecordSnapshot;
		if (!Array.isArray(record.messages)) throw new Error("Could not sync the saved session.");
		if (epoch !== this.canonicalEpoch || ticket < this.canonicalAcknowledged || options.signal?.aborted || options.isCurrent?.() === false) return undefined;
		const mode = options.adoption ?? "replace";
		if (mode !== "none" && this.imagePostOwner) return undefined;
		if (mode === "replace" && !options.allowInFlight && (this.statusValue === "submitted" || this.statusValue === "streaming")) return undefined;
		if (mode === "append") {
			if (!this.appendMessages(record.messages)) return undefined;
			this.canonicalAcknowledged = Math.max(this.canonicalAcknowledged, ticket);
		} else if (mode === "replace") {
			this.canonicalAcknowledged = Math.max(this.canonicalAcknowledged, ticket);
			this.replaceMessages(record.messages, record.turnError);
		}
		return record;
	}

	async reconcile(): Promise<boolean> {
		if (this.reconciliationTask && this.reconciliationOwner === this.consumeAbort && this.reconciliationConnectionGeneration === this.connectionGeneration) return this.reconciliationTask;
		this.reconciliationValue = "syncing";
		this.readyRef = false;
		this.onChange?.();
		const owner = this.consumeAbort;
		const connection = this.connectionGeneration;
		const isCurrent = () => this.consumeAbort === owner && this.connectionGeneration === connection;
		const epoch = this.canonicalEpoch;
		const requiredTicket = this.canonicalIssued + 1;
		this.reconciliationOwner = owner;
		this.reconciliationConnectionGeneration = connection;
		let task!: Promise<boolean>;
		task = (async () => {
			try {
				const record = await this.readRecord({ allowInFlight: true, isCurrent });
				if (!isCurrent()) return false;
				if (this.canonicalEpoch !== epoch) throw new Error("Canonical read was invalidated.");
				if (!record && this.canonicalAcknowledged < requiredTicket) return false;
				this.reconciliationValue = "ready";
				this.readyRef = this.statusValue === "ready";
				return true;
			} catch {
				if (!isCurrent()) return false;
				if (this.canonicalEpoch === epoch && this.canonicalAcknowledged >= requiredTicket) {
					this.reconciliationValue = "ready";
					this.readyRef = this.statusValue === "ready";
					return true;
				}
				this.reconciliationValue = "failed";
				this.readyRef = false;
				return false;
			} finally {
				if (this.reconciliationTask === task) this.reconciliationTask = null;
				if (isCurrent()) this.onChange?.();
			}
		})();
		this.reconciliationTask = task;
		return task;
	}


	async postInputEvent(input: ChatInput, signal?: AbortSignal, onPostPending?: (pending: boolean) => void): Promise<Response> {
		onPostPending?.(true);
		try {
			return await this.fetch("/api/chat", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chatId: this.chatId, input }),
				signal,
			});
		} finally { onPostPending?.(false); }
	}

	applyWireEvent(event: Record<string, unknown>): boolean {
		if (event.type === "error") {
			this.setError(String(event.errorText ?? "An error occurred."));
			return false;
		}
		const agent = event as unknown as AgentEvent;
		switch (agent.type) {
			case "agent_start":
				this.automaticContinuationBlocked = false;
				if (this.errorValue !== null) this.setError(null);
				return false;
			case "message_start":
			case "message_update":
			case "message_end": {
				const message = agent.message as OwllyMessage & {
					role?: string;
					id?: string;
				};
				if ((message as { role?: string }).role !== "assistant") {
					const mid = message.id;
					if (mid === undefined) return false;
					if (this.base.some((m) => m.id === mid)) return false;
					this.mutate(() => {
						const idx = this.tail.findIndex((m) => m.id === mid);
						this.tail =
							idx === -1 ? [...this.tail, message as OwllyMessage] : this.tail.with(idx, message as OwllyMessage);
					});
					return true;
				}
				const id = message.id ?? this.streamingMessageId ?? localId();
				const withId = { ...message, id } as OwllyMessage;
				if (agent.type === "message_end") {
					this.incompleteUsageIds.delete(id);
					if (message.role === "assistant" && message.stopReason === "error") {
						this.liveFailureId = id;
						this.errorValue = null;
					}
				} else this.incompleteUsageIds.add(id);
				if (agent.type === "message_start") {
					this.streamingMessageId = id;
					this.streamingIds.add(id);
					this.mutate(() => {
						this.tail = [...this.tail, withId];
					});
				} else {
					this.mutate(() => {
						const idx = this.tail.findIndex((m) => m.id === id);
						this.tail = idx === -1 ? [...this.tail, withId] : this.tail.with(idx, withId);
					});
				}
				if (agent.type === "message_end") {
					this.streamingMessageId = null;
				}
				return true;
			}
			case "tool_execution_end": {
				const result = agent.result as
					| Pick<ToolResultMessage, "content" | "details">
					| null;
				const text = result?.content?.find((c) => c.type === "text")?.text ?? "The tool call failed.";
				this.mutate(() => {
					this.executions = new Map(this.executions).set(agent.toolCallId, {
						isError: agent.isError,
						output: result?.details,
						errorText: text,
						...(result ? { result: { content: result.content, details: result.details, isError: agent.isError } } : {}),
					});
				});
				return true;
			}
			case "turn_end": {
				this.mutate(() => {
					this.tail = [
						...this.tail,
						...(agent.toolResults as ToolResultMessage[]).map(
							(r) => ({ ...r, id: localId() }) as unknown as OwllyMessage,
						),
					];
				});
				return true;
			}
			default:
				return false;
		}
	}

	async consumeStream(res: Response, controller = this.consumeAbort): Promise<void> {
		if (!res.body) throw new Error("The turn stream body is empty.");
		const reader = res.body.getReader();
		let sawEvent = false;
		let sawDone = false;
		try {
			const events = sseEvents(reader);
			for (;;) {
				let next: IteratorResult<Record<string, unknown>, boolean>;
				try { next = await events.next(); }
				catch (err) {
					if (err instanceof StreamReadError) break;
					throw err;
				}
				if (this.consumeAbort !== controller) return;
				if (next.done) { sawDone = next.value; break; }
				const event = next.value;
				if (event.type === "turn-settled") {
					sawDone = true;
					return;
				}
				const acted = this.applyWireEvent(event);
				if (!sawEvent && acted) {
					sawEvent = true;
					if (this.statusValue !== "error") this.setStatus("streaming");
				}
			}
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
			if (this.consumeAbort === controller) {
				this.streamingIds = new Set();
				this.executions = new Map();
				if (sawDone) {
					await this.reconcile();
					if (this.consumeAbort === controller && this.statusValue !== "error") this.setStatus("ready");
					if (this.consumeAbort === controller && this.reconciliationValue === "ready") this.onReattachSettled?.();
				}
			}
		}
		if (this.consumeAbort !== controller || sawDone) return;
		throw new Error(STREAM_DROPPED);
	}

	async resumeStream(refetchRecordFirst = true): Promise<void> {
		this.retireImagePreview(this.imagePostOwner);
		this.releaseImagePost(this.imagePostOwner);
		this.consumeAbort?.abort();
		const controller = new AbortController();
		this.consumeAbort = controller;
		this.latestRequest = controller;
		if (!refetchRecordFirst) {
			this.mutate(() => {
				this.incompleteUsageIds.clear();
				this.tail = [];
				this.streamingMessageId = null;
			});
		}
		this.setStatus("submitted");
		try {
			if (refetchRecordFirst) {
				const record = await this.readRecord({ signal: controller.signal, allowInFlight: true, tolerateHttpFailure: true, isCurrent: () => this.consumeAbort === controller });
				if (this.consumeAbort !== controller) return;
				if (!record) {
					this.mutate(() => {
						this.incompleteUsageIds.clear();
						this.tail = [];
						this.streamingMessageId = null;
					});
				}
			}
			const res = await this.fetch(`/api/chats/${encodeURIComponent(this.chatId)}/stream`, { signal: controller.signal });
			if (this.consumeAbort !== controller) return;
			if (!res.ok) throw new Error((await res.text()) || "Failed to attach to the running turn.");
			await this.consumeStream(res, controller);
		} catch (err) {
			if (this.consumeAbort !== controller || controller.signal.aborted) return;
			this.retireImagePreview(this.imagePreview?.owner ?? null);
			this.mutate(() => {
				this.tail = this.tail.filter(m => !this.unconfirmedAnswers.has(m.id));
				this.unconfirmedAnswers.clear();
			});
			this.setError((err as Error).message);
			this.setStatus("error");
		}
	}

	async send(input: ChatInput, onAccepted?: () => void, questionKey?: string, onDeliverySettled?: () => void): Promise<boolean> {
		let deliverySettled = false;
		const settleDelivery = () => { if (!deliverySettled) { deliverySettled = true; onDeliverySettled?.(); } };
		const refused = () => { settleDelivery(); return false; };
		const recovering = this.statusValue === "error";
		if (this.reconciliationValue !== "ready" || (!this.readyRef && !recovering)) return refused();
		if (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") return refused();
		const subject = input.type === "answer" ? pendingQuestionOf(this.nativeHistory()) : null;
		if (input.type === "answer" && questionKey !== undefined &&
			(subject?.key !== questionKey || subject.toolCallId !== input.toolCallId)) return refused();
		const expectedKey = questionKey ?? (input.type === "answer" && subject?.toolCallId === input.toolCallId ? subject.key : undefined);
		const imageBearing = input.type === "text" || input.type === "thinking" ? !!input.images?.length
			: input.type === "answer" ? Object.values(input.answer.images ?? {}).some(images => images?.length)
				: false;
		this.retireImagePreview(this.imagePreview?.owner ?? null);
		this.releaseImagePost(this.imagePostOwner);
		this.consumeAbort?.abort();
		const controller = new AbortController();
		this.consumeAbort = controller;
		this.latestRequest = controller;
		this.evaluationOwner = null;
		this.setError(null);
		this.setStatus("submitted");
		if (input.type !== "continue") this.automaticContinuationBlocked = false;
		const optimistic: OwllyMessage[] = [];
		if (input.type === "text") optimistic.push({ ...newUserMessage(input.text, input.images), id: localId() });
		else if (input.type === "thinking") {
			optimistic.push({ ...newThinkingMessage(input.problemCallId, input.text, input.images), id: localId() });
		} else if (input.type === "next") {
			optimistic.push({ ...newNextMessage(), id: localId() });
		} else if (input.type === "answer") {
			const tool = pendingCallTool(this.nativeHistory(), input.toolCallId) ?? "quiz";
			const result = { ...newAnswerResult(input.toolCallId, tool, input.answer), id: localId() };
			optimistic.push(result);
			this.unconfirmedAnswers.set(result.id, expectedKey ?? input.toolCallId);
		}
		if (optimistic.length > 0) this.mutate(() => {
			this.tail = [...this.tail, ...optimistic];
		});
		if (imageBearing) this.imagePreview = { owner: controller, ids: new Set(optimistic.map(message => message.id)) };
		let accepted = false;
		try {
			let res: Response;
			try {
				res = await this.postInputEvent(input, undefined, imageBearing ? pending => this.imagePostPending(controller, pending) : undefined);
			} finally {
				if (this.evaluationOwner === controller) this.mutate(() => { this.evaluationOwner = null; });
			}
			if (res.status === 409) {
				settleDelivery();
				throw new Error("A turn is already running — try again in a moment.");
			}
			if (!res.ok) {
				settleDelivery();
				let message = (await res.text()) || `The send failed (${res.status}).`;
				if ((input.type === "retry" || input.type === "retry-question") && res.status === 400) {
					try {
						const refusal = JSON.parse(message) as { error?: unknown } | null;
						if (typeof refusal?.error === "string" && refusal.error.length > 0) message = refusal.error;
					} catch {  }
				}
				throw new Error(message);
			}
			accepted = true;
			if (this.latestRequest === controller) this.invalidateCanonicalReads();
			onAccepted?.();
			settleDelivery();
			await res.text().catch(() => {});
			if (this.consumeAbort !== controller) return true;
			await this.resumeStream(true);
			return true;
		} catch (err) {
			settleDelivery();
			if (imageBearing && !accepted) this.retireImagePreview(controller);
			const failedOpening = input.type === "text" && onAccepted !== undefined && !accepted;
			if (failedOpening) {
				const ids = new Set(optimistic.map(m => m.id));
				this.mutate(() => { this.tail = this.tail.filter(m => !ids.has(m.id)); });
			}
			const detachedOpening = failedOpening && this.consumeAbort === null && this.latestRequest === controller;
			if ((this.consumeAbort !== controller || controller.signal.aborted) && !detachedOpening) return accepted;
			if (input.type === "answer") {
				const ids = new Set(optimistic.map(m => m.id));
				this.mutate(() => {
					this.tail = this.tail.filter(m => !ids.has(m.id));
					for (const id of ids) this.unconfirmedAnswers.delete(id);
				});
			}
			this.setError((err as Error).message);
			this.setStatus("error");
			if (imageBearing && !accepted && this.latestRequest === controller) {
				await this.readRecord({ allowInFlight: true, isCurrent: () => this.latestRequest === controller && (this.consumeAbort === controller || detachedOpening) }).catch(() => {});
			}
			return accepted;
		}
	}

	async steer(text: string, images?: import("../src/core/plugin-submissions.ts").PluginSubmissionContent["images"], onAccepted?: () => void, onDeliverySettled?: () => void): Promise<boolean> {
		let deliverySettled = false;
		const settleDelivery = () => { if (!deliverySettled) { deliverySettled = true; onDeliverySettled?.(); } };
		const t = text.trim();
		if (!t && !images?.length) { settleDelivery(); return false; }
		this.invalidateCanonicalReads();
		const id = `steer_${localId()}`;
		this.steerQueueValue = [...this.steerQueueValue, { id, text: t }];
		this.onChange?.();
		const dropSteer = () => {
			this.steerQueueValue = this.steerQueueValue.filter((s) => s.id !== id);
			this.onChange?.();
		};
		try {
			const res = await this.fetch(`/api/chats/${this.chatId}/steer`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { type: "steer", id, text: t, ...(images?.length ? { images } : {}) } }),
			});
			if (res.ok) { this.invalidateCanonicalReads(); onAccepted?.(); settleDelivery(); await res.text().catch(() => {}); return true; }
			if (res.status === 409) {
				dropSteer();
				return await this.send({ type: "text", text: t, ...(images?.length ? { images: images.map(image => ({ ...image })) } : {}) }, onAccepted, undefined, settleDelivery);
			}
			dropSteer();
			settleDelivery();
			this.setError((await res.text()) || `The steer failed (${res.status}).`);
		} catch (err) {
			dropSteer(); settleDelivery();
			this.setError((err as Error).message);
		}
		return false;
	}

	submitAnswer(tool: string, toolCallId: string, output: QuestionAnswerData, questionKey?: string): Promise<void> {
		void tool;
		return this.send({ type: "answer", toolCallId, answer: output }, undefined, questionKey).then(() => undefined);
	}

	async dismissQuestion(toolCallId: string, answer: QuestionAnswerData, questionKey?: string): Promise<void> {
		if (!this.readyRef) return;
		const subject = pendingQuestionOf(this.nativeHistory());
		if (questionKey !== undefined && (subject?.key !== questionKey || subject.toolCallId !== toolCallId)) return;
		const tool = pendingCallTool(this.nativeHistory(), toolCallId) ?? "quiz";
		this.invalidateCanonicalReads();
		this.mutate(() => {
			this.tail = [...this.tail, { ...newAnswerResult(toolCallId, tool, answer), id: localId() }];
		});
		try {
			const res = await this.fetch(`/api/chats/${this.chatId}/dismiss`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { type: "dismiss", toolCallId, answer } }),
			});
			if (!res.ok) throw new Error(`The dismissal failed (${res.status}).`);
			this.invalidateCanonicalReads();
		} catch (err) {
			this.setError((err as Error).message);
		}
	}

	async dismissProblem(problemCallId: string): Promise<void> {
		if (!this.readyRef) return;
		this.invalidateCanonicalReads();
		this.mutate(() => {
			this.tail = [...this.tail, { ...newProblemDismissedMarker(problemCallId), id: localId() }];
		});
		try {
			const res = await this.fetch(`/api/chats/${this.chatId}/dismiss`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ input: { type: "dismiss-problem", problemCallId } }),
			});
			if (!res.ok) throw new Error(`The dismissal failed (${res.status}).`);
			this.invalidateCanonicalReads();
		} catch (err) {
			this.setError((err as Error).message);
		}
	}

	stop(): void {
		this.connectionGeneration++;
		this.retireImagePreview(this.imagePreview?.owner ?? null);
		this.releaseImagePost(this.imagePostOwner);
		this.invalidateCanonicalReads();
		this.consumeAbort?.abort();
		this.consumeAbort = null;
		this.streamingIds = new Set();
		this.streamingMessageId = null;
		this.executions = new Map();
		this.setStatus("ready");
	}

	questionDraft(questionKey: string): QuestionDraft | undefined {
		return this.questionDrafts.get(questionKey);
	}

	saveQuestionDraft(questionKey: string, draft: Partial<QuestionDraft>): void {
		this.questionDrafts.set(questionKey, { ...this.questionDrafts.get(questionKey), ...draft });
	}

	private forgetResolvedDrafts(record: readonly OwllyMessage[]): void {
		const pendingKey = pendingQuestionOf(record)?.key;
		for (const key of this.questionDrafts.keys()) {
			if (key !== pendingKey) this.questionDrafts.delete(key);
		}
		for (const [id, key] of this.unconfirmedAnswers) {
			if (key !== pendingKey) this.unconfirmedAnswers.delete(id);
		}
	}

	setMessages(record: OwllyMessage[], turnError?: string): void {
		this.invalidateCanonicalReads();
		this.replaceMessages(record, turnError);
	}

	private replaceMessages(record: OwllyMessage[], turnError?: string): void {
		if (this.imagePostOwner) return;
		record = copyImmutableData(record);
		this.mutate(() => {
			this.base = record;

			if (turnError !== undefined) {
				this.errorValue = { message: turnError };
				this.automaticContinuationBlocked = true;
			}
			this.forgetResolvedDrafts(record);


			this.incompleteUsageIds.clear();
			this.tail = [];
			this.imagePreview = null;
			this.streamingMessageId = null;
		});
	}

	adoptRecord(record: OwllyMessage[]): void {
		this.invalidateCanonicalReads();
		this.appendMessages(record);
	}

	private appendMessages(record: OwllyMessage[]): boolean {
		if (this.imagePostOwner) return false;
		record = copyImmutableData(record);
		const recordIds = new Set(record.map((m) => (m as { id?: string }).id));
		const baseAbsorbed = this.base.some((m) => !recordIds.has((m as { id?: string }).id));
		if (baseAbsorbed) return false;
		this.mutate(() => {
			this.base = record;

			this.forgetResolvedDrafts(record);
			this.tail = this.tail.filter((m) => !(typeof m.id === "string" && recordIds.has(m.id)) && !absorbed(m, record));
		});
		return true;
	}

	async continueIfOwed(record: readonly OwllyMessage[]): Promise<void> {
		if (this.readyRef && !this.automaticContinuationBlocked && this.getState().error === null && needsContinuation(record)) {
			await this.send({ type: "continue" });
		}
	}

	static needsContinuation = needsContinuation;

	clearError(): void {
		this.setError(null);
	}
}
