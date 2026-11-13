import { Agent, type AgentEvent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { APP_IDENTITY, piEngineFor, type PiEngine } from "../models.ts";
import { usageWasAdmitted } from "../subscription-request-cycle.ts";
import { workerRequestStream } from "../worker-request-admission.ts";
import { providerEventObserver } from "../provider-events.ts";
import { backgroundCaptureStream, createBackgroundCapture } from "../background-capture.ts";
import type { ModelRole } from "../../../config.ts";


export interface SubagentRunOptions {
	role?: ModelRole;
	engine?: PiEngine;
	systemPrompt: string;
	messages?: AgentMessage[];
	prompt?: string;
	maxTurns: number;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onToolStart?: (toolName: string, args: unknown) => void;
	onEvent?: (event: AgentEvent) => void | Promise<void>;
	beforeRequest?: () => void | Promise<void>;
	bypassWorkerRequestAdmission?: boolean;
	onAssistantMessage?: (message: AssistantMessage, step: number) => void;
	shouldStop?: (message: AssistantMessage, toolResults: ToolResultMessage[]) => boolean;
	chatId?: string;
}

export interface SubagentRunResult {
	newMessages: AgentMessage[];
	text: string;
}

export function subagentEngine(role: ModelRole | undefined, override?: PiEngine): PiEngine {
	if (override) return override;
	if (!role) throw new Error("An explicit engine or configured model role is required");
	return piEngineFor(role);
}

export async function runSubagent(tools: AgentTool<any, any>[], opts: SubagentRunOptions): Promise<SubagentRunResult> {
	if (opts.abortSignal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
	const engine = subagentEngine(opts.role, opts.engine);
	let turns = 0;
	const providerEvents = opts.chatId && opts.role ? providerEventObserver(opts.chatId, `job:${opts.role}`) : undefined;
	const sessionId = randomUUID();
	const capture = opts.role ? createBackgroundCapture({ role: opts.role, runId: sessionId, sourceId: opts.chatId }) : undefined;
	const agent = new Agent({
		identity: APP_IDENTITY,
		sessionId,
		initialState: {
			systemPrompt: opts.systemPrompt,
			model: engine.model,
			thinkingLevel: engine.level,
			tools,
			messages: opts.messages ?? [],
		},
		streamFn: backgroundCaptureStream(
			opts.bypassWorkerRequestAdmission ? engine.streamFn : workerRequestStream(engine.streamFn),
			capture,
		),
		prepareRequest: async () => {
			if (opts.abortSignal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
			await opts.beforeRequest?.();
		},
		...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		finishTurn: (turn) => {
			turns++;
			return turns >= opts.maxTurns || opts.shouldStop?.(turn.message, turn.toolResults) === true
				? { action: "end" }
				: undefined;
		},
	});

	const onAbort = () => agent.abort();
	opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

	const before = opts.messages?.length ?? 0;
	let step = 0;
	let errorMessage: string | undefined;
	let aborted = false;
	let runFailure: unknown;

	try {
		agent.subscribe(async (event: AgentEvent) => {
			await opts.onEvent?.(event);
			switch (event.type) {
				case "message_end":
					if ((event.message as { role?: string }).role === "assistant") {
						const m = event.message as AssistantMessage;
						capture?.reply(m);
						if (m.stopReason === "aborted") {
								aborted = true;
							break;
						}
						if (!usageWasAdmitted(m.usage)) { if (m.stopReason === "error") errorMessage = m.errorMessage ?? "Subagent provider error"; break; }
						step++;
						opts.onUsage?.(m.usage);
						opts.onAssistantMessage?.(m, step);
						if (m.stopReason === "error") errorMessage = m.errorMessage ?? "Subagent provider error";
					} else if (event.message.role === "toolResult") {
						capture?.toolResult(event.message);
					}
					break;
				case "tool_execution_start":
					opts.onToolStart?.(event.toolName, event.args);
					break;
			}
		});
		if (opts.prompt !== undefined) await agent.prompt({
			role: "user",
			content: opts.prompt,
			timestamp: Date.now(),
		});
		else await agent.continue();
	} catch (error) {
		runFailure = error;
		throw error;
	} finally {
		opts.abortSignal?.removeEventListener("abort", onAbort);
		capture?.finish(runFailure);
	}

	if (aborted || opts.abortSignal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		capture?.finish(err);
		throw err;
	}
	if (errorMessage !== undefined) throw new Error(errorMessage);

	const newMessages = agent.state.messages
		.filter((m) => (m as { role?: string }).role !== "system")
		.slice(before);
	const assistants = newMessages.filter((m) => (m as { role?: string }).role === "assistant") as AssistantMessage[];
	const last = assistants[assistants.length - 1];
	const text = last
		? last.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("")
		: "";
	return { newMessages, text };
}