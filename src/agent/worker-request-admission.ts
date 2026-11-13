import type { AssistantMessage, AssistantMessageEvent, StreamFunction } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { markUnadmittedUsage } from "./subscription-request-cycle.ts";

const POOL_KEY = Symbol.for("owlly.worker-request-admission.pool.v1");
const WRAPPED_KEY = Symbol.for("owlly.worker-request-admission.wrapped.v1");
const DEFAULT_LIMIT = 8;
type Waiter = { state: "queued" | "active" | "cancelled"; grant: (release: () => void) => void; release?: () => void };
type Pool = { getLimit: () => number; limit: number; active: number; queue: Waiter[] };
const shared = globalThis as typeof globalThis & { [POOL_KEY]?: Pool };
function pool(): Pool {
	return shared[POOL_KEY] ??= { getLimit: () => DEFAULT_LIMIT, limit: DEFAULT_LIMIT, active: 0, queue: [] };
}
function validLimit(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError("Worker request concurrency must be a positive whole integer");
	return value;
}
function drain(state: Pool): void {
	while (state.active < state.limit && state.queue.length) {
		const waiter = state.queue.shift()!;
		if (waiter.state !== "queued") continue;
		waiter.state = "active";
		state.active++;
		let released = false;
		const release = waiter.release = () => {
			if (released) return;
			released = true;
			waiter.state = "cancelled";
			state.active--;
			drain(state);
		};
		queueMicrotask(() => waiter.grant(release));
	}
}
function acquire(state: Pool, grant: Waiter["grant"]): () => void {
	const waiter: Waiter = { state: "queued", grant };
	state.queue.push(waiter);
	drain(state);
	return () => {
		if (waiter.state === "active") waiter.release!();
		else if (waiter.state === "queued") {
			waiter.state = "cancelled";
			state.queue.splice(state.queue.indexOf(waiter), 1);
		}
	};
}

export function configureWorkerRequestAdmission(getLimit: () => number): void {
	const limit = validLimit(getLimit());
	const state = pool();
	state.getLimit = getLimit;
	state.limit = limit;
	drain(state);
}
export function refreshWorkerRequestAdmission(): void {
	const state = pool();
	const limit = validLimit(state.getLimit());
	state.limit = limit;
	drain(state);
}

type StreamArgs = Parameters<StreamFunction>;
type Terminal = Extract<AssistantMessageEvent, { type: "done" | "error" }>;

class WorkerRequestStream extends AssistantMessageEventStream {
	private source?: AssistantMessageEventStream;
	private iterator?: AsyncIterator<AssistantMessageEvent>;
	private partial?: AssistantMessage;
	private final?: AssistantMessage;
	private syntheticTerminal?: Terminal;
	private invoked = false;
	private constructing = false;
	private claimed = false;
	private cancelAdmission?: () => void;
	private readonly controller = new AbortController();
	private readonly ready: Promise<void>;
	private resolveReady!: () => void;
	private readonly signal?: AbortSignal;
	private readonly onAbort = () => this.cancel();

	constructor(private readonly streamFn: StreamFunction, private readonly args: StreamArgs) {
		super();
		this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
		this.signal = args[2]?.signal;
		this.signal?.addEventListener("abort", this.onAbort, { once: true });
		if (this.signal?.aborted) this.cancel();
		else this.cancelAdmission = acquire(pool(), (release) => {
			if (this.final) { release(); return; }
			void this.start();
		});
	}

	private failure(aborted: boolean, error?: unknown): AssistantMessage {
		const model = this.args[0];
		const message: AssistantMessage = {
			...(this.partial ?? { role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [], timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }),
			stopReason: aborted ? "aborted" : "error",
			errorMessage: aborted ? "Worker model request cancelled" : error instanceof Error ? error.message : "Worker model request failed or ended without a terminal response",
		};
		if (!this.invoked) markUnadmittedUsage(message.usage);
		return message;
	}
	private finish(message: AssistantMessage, synthetic = false): void {
		if (this.final) return;
		this.final = message;
		if (synthetic) this.syntheticTerminal = { type: "error", reason: message.stopReason === "aborted" ? "aborted" : "error", error: message };
		this.signal?.removeEventListener("abort", this.onAbort);
		this.cancelAdmission?.();
		super.end(message);
	}
	private stopSource(): void {
		this.controller.abort();
		try { this.source?.end(this.final); } catch {  }
		try { void Promise.resolve(this.iterator?.return?.()).catch(() => {}); } catch {  }
	}
	private cancel(): void {
		if (this.constructing && !this.final) {
			this.controller.abort();
			return;
		}
		const complete = () => {
			if (!this.final) this.finish(this.failure(true), true);
			this.stopSource();
			this.resolveReady();
		};
		if (this.source && !this.final) {
			this.controller.abort();
			queueMicrotask(complete);
		} else complete();
	}
	private async start(): Promise<void> {
		try {
			if (this.final) return;
			this.invoked = true;
			const [model, context, options] = this.args;
			let source: AssistantMessageEventStream;
			this.constructing = true;
			try { source = this.streamFn(model, context, { ...options, signal: this.controller.signal }); }
			finally { this.constructing = false; }
			const pendingSetup = typeof (source as unknown as { then?: unknown })?.then === "function";
			if (pendingSetup && this.controller.signal.aborted) this.cancel();
			this.source = pendingSetup ? await source : source;
			if (this.final) { this.stopSource(); return; }
			this.iterator = this.source[Symbol.asyncIterator]();
			void Promise.resolve(this.source.result()).then(
				(message) => this.finish(message),
				(error: unknown) => { this.finish(this.failure(false, error), true); this.stopSource(); },
			).catch(() => {});
			if (this.controller.signal.aborted) this.cancel();
		} catch (error) {
			this.finish(this.failure(this.controller.signal.aborted, error), true);
			this.stopSource();
		} finally { this.resolveReady(); }
	}
	private async next(): Promise<IteratorResult<AssistantMessageEvent>> {
		const signal = this.controller.signal;
		const aborted = () => new DOMException("Worker model request cancelled", "AbortError");
		if (signal.aborted) throw aborted();
		let onAbort!: () => void;
		const cancelled = new Promise<never>((_resolve, reject) => {
			onAbort = () => reject(aborted());
			signal.addEventListener("abort", onAbort, { once: true });
		});
		try {
			return await Promise.race([this.iterator!.next(), cancelled]);
		} finally { signal.removeEventListener("abort", onAbort); }
	}
	private async *events(): AsyncGenerator<AssistantMessageEvent> {
		let terminal = false;
		try {
			await this.ready;
			if (!this.iterator) {
				terminal = true;
				if (this.syntheticTerminal) yield this.syntheticTerminal;
				return;
			}
			while (true) {
				const next = await this.next();
				if (next.done) break;
				const event = next.value;
				if ("partial" in event) this.partial = event.partial;
				if (event.type === "done" || event.type === "error") {
					this.finish(event.type === "done" ? event.message : event.error);
					terminal = true;
				}
				yield event;
				if (terminal) return;
			}
			if (!this.final) this.finish(this.failure(false), true);
			terminal = true;
			if (this.syntheticTerminal) yield this.syntheticTerminal;
		} catch (error) {
			if (!this.final) this.finish(this.failure(this.controller.signal.aborted, error), true);
			terminal = true;
			if (this.syntheticTerminal) yield this.syntheticTerminal;
			else if (this.final?.stopReason === "error" || this.final?.stopReason === "aborted") {
				yield { type: "error", reason: this.final.stopReason, error: this.final };
			}
		} finally {
			if (!terminal) this.cancel();
			else this.stopSource();
		}
	}
	override [Symbol.asyncIterator](): AsyncGenerator<AssistantMessageEvent> {
		if (this.claimed) throw new Error("Worker request streams support one consumer");
		this.claimed = true;
		const iterator = this.events();
		const originalReturn = iterator.return.bind(iterator);
		iterator.return = (value) => { this.cancel(); return originalReturn(value); };
		return iterator;
	}
	override end(message?: AssistantMessage): void {
		if (!this.final) this.finish(message ?? this.failure(true), message === undefined);
		this.stopSource();
		this.resolveReady();
	}
	override result(): Promise<AssistantMessage> {
		if (!this.claimed) void (async () => {
			for await (const _event of this) {  }
		})().catch(() => {});
		return super.result();
	}
}

export function workerRequestStream(streamFn: StreamFunction): StreamFunction {
	if ((streamFn as StreamFunction & { [WRAPPED_KEY]?: boolean })[WRAPPED_KEY]) return streamFn;
	const wrapped: StreamFunction = (...args) => new WorkerRequestStream(streamFn, args);
	Object.defineProperty(wrapped, WRAPPED_KEY, { value: true });
	return wrapped;
}
