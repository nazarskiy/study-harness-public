import type { AgentEvent,AgentMessage,AgentTool } from "@earendil-works/pi-agent-core";
import { Agent } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import fs from "node:fs";
import { demoModeEnabled } from "../core/demo-mode.ts";
import { nativeInputCause,PRACTICE_PROBLEM_TOOL,toLlmMessages } from "../core/native-messages.ts";
import { QUESTION_TOOLS,type EnabledTools } from "../core/pending.ts";
import { quizInputObject,quizInputProblems } from "../core/question-core.ts";
import type { ChatGPTRequestCycle } from "./chatgpt-request-cycle.ts";
import { createDemoQuestionGuard } from "./demo-mode.ts";
import { APP_IDENTITY,piEngineFor,type PiEngine } from "./models.ts";
import { makeNarrationGuard,narrationGuardApplies,SEND_TO_USER_DELIVERY_RULE } from "./narration-guard.ts";
import { listSourceSegments } from "./prompt-segments.ts";
import { providerEventObserver } from "./provider-events.ts";
import { usageWasAdmitted } from "./subscription-request-cycle.ts";
import { invalidInputResult,questionResult } from "./tool-execute.ts";
import {
askUserQuestionTool,
createProberTools,
createTeacherTools,
type ProberToolContext,
type TeacherToolContext
} from "./tools.ts";
import { healToolRecord,withArgumentHeal } from "./tools/heal.ts";
import { createPracticeGate,practiceTools,type PracticeToolContext } from "./tools/practice.ts";
import { createReadTool,readTool } from "./tools/read.ts";
import { sendToUserApplies,sendToUserTool } from "./tools/send-to-user.ts";


export type AgentKind = "prober" | "teacher" | "practice";

export function composeInstructions(kind: AgentKind): string {
	const segments = listSourceSegments(kind);
	return segments
		.map((segment) => {
			try { return fs.readFileSync(segment.file, "utf-8"); }
			catch { return ""; }
		})
		.map((t) => t.trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

const composedInstructions: Record<AgentKind, string> = {
	prober: composeInstructions("prober"),
	teacher: composeInstructions("teacher"),
	practice: composeInstructions("practice"),
};

export type StepUsageCollector = (usage: Usage) => void;

export interface AgentBuildOptions {
	demoMode?: boolean;
	engine?: PiEngine;
	callPurpose?: { background: boolean };
	requestCycle?: ChatGPTRequestCycle;
	messages?: AgentMessage[];
	onUsage?: StepUsageCollector;
	contextUpdates?: (messages: readonly AgentMessage[]) => AgentMessage[];
	validateContext?: (messages: readonly AgentMessage[]) => void;
	tools?: Record<string, AgentTool<any>>;
	toolToggles?: EnabledTools;
	chatId?: string;
}

function makeQuestionStopper(kind: AgentKind) {
	return (context: {
		message: { content: Array<{ type: string; id?: string; name?: string }> };
		toolResults: Array<{ toolCallId: string; isError?: boolean }>;
	}): boolean => {
		const called = new Set(
			context.message.content
				.filter((c) => c.type === "toolCall" && c.name !== undefined && (
					(QUESTION_TOOLS as readonly string[]).includes(c.name) ||
					(kind === "practice" && c.name === PRACTICE_PROBLEM_TOOL)
				))
				.map((c) => c.id!),
		);
		if (called.size === 0) return false;
		for (const result of context.toolResults) {
			if (called.has(result.toolCallId) && result.isError) return false;
		}
		return true;
	};
}

function baseAgentOptions(kind: AgentKind, opts: AgentBuildOptions, tools: AgentTool<any, any>[]) {
	const engine = opts.engine ?? piEngineFor(kind as "prober" | "teacher");
	const stopper = makeQuestionStopper(kind);
	const narrationGuard = narrationGuardApplies(kind, engine.model, opts.tools !== undefined);
	const narrationHooks = narrationGuard ? makeNarrationGuard() : undefined;
	const composedPrompt = composedInstructions[kind];
	const builtinPrompt = narrationGuard ? `${composedPrompt}\n\n---\n\n${SEND_TO_USER_DELIVERY_RULE}` : composedPrompt;
	const builtinTools = [
		...tools.map((tool) => tool.name === "read" && tool.execute === readTool.execute
			? { ...tool, execute: createReadTool(engine.model).execute as AgentTool<any>["execute"] }
			: tool),
		...(sendToUserApplies(kind, engine.model, opts.tools !== undefined)
			? [withArgumentHeal(sendToUserTool)]
			: []),
	];
	const demo = kind === "prober" && (opts.demoMode ?? demoModeEnabled(process.env))
		? createDemoQuestionGuard(opts.messages ?? []) : undefined;
	const systemPrompt = demo ? `${builtinPrompt}\n\n---\n\n${demo.instructions()}` : builtinPrompt;
	const conversationTools = builtinTools;
	const providerEvents = opts.chatId ? providerEventObserver(opts.chatId, kind) : undefined;
	const seenInputs = new Set((opts.messages ?? []).map((m) => (m as { id?: string }).id).filter(Boolean));
	const agent = new Agent({
		identity: APP_IDENTITY,
		sessionId: opts.chatId,
		initialState: {
			systemPrompt,
			model: engine.model,
			thinkingLevel: engine.level,
			tools: demo ? demo.wrapTools(conversationTools) : conversationTools,
			messages: opts.messages ?? [],
		},
		streamFn: engine.streamFn,
		...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		...narrationHooks,
		finishTurn: (turn) => (demo?.posedIn(turn) || stopper(turn) ? { action: "end" } : undefined),
		steeringMode: "all",
		convertToLlm: toLlmMessages,
		...(opts.contextUpdates ? { prepareNextTurnWithContext: ({ context }: { context: { messages: AgentMessage[] } }) => {
			const messages = opts.contextUpdates!(context.messages);
			return messages.length ? { messages } : undefined;
		} } : {}),
		prepareRequest: (request) => {
			if (opts.callPurpose) {
				let learner = false, automatic = false;
				const messages = request.context.messages;
				for (const message of messages) {
					const id = (message as { id?: string }).id;
					const cause = nativeInputCause(message, messages.slice(0, messages.indexOf(message)));
					if (cause === "neutral") continue;
					if (id && seenInputs.has(id)) continue;
					if (id) seenInputs.add(id);
					if (cause === "learner" && id) learner = true;
					else automatic = true;
				}
				if (automatic) opts.callPurpose.background = true;
				else if (learner) opts.callPurpose.background = false;
			}
			opts.requestCycle?.prepare(request);
			try { opts.validateContext?.(request.context.messages); }
			catch (error) {
				opts.requestCycle?.rejectLocalRequest();
				throw error;
			}
			if (demo) return { context: { ...request.context, tools: demo.availableTools(request.context.tools ?? []) } };
		},
	});
	if (opts.onUsage) {
		agent.subscribe((event: AgentEvent) => {
			if (event.type === "message_end" && event.message.role === "assistant" && "usage" in event.message) {
				if (event.message.stopReason === "aborted" || !usageWasAdmitted(event.message.usage) || (opts.requestCycle && !opts.requestCycle.acceptsUsage(event.message))) return;
				opts.onUsage!(event.message.usage);
			}
		});
	}
	return agent;
}

export function createProberAgent(ctx: ProberToolContext, opts: AgentBuildOptions = {}) {
	return baseAgentOptions("prober", opts, Object.values(createProberTools(ctx, opts.toolToggles)));
}

export function createTeacherAgent(
	ctx?: TeacherToolContext,
	opts: AgentBuildOptions = {},
) {
	const tools = opts.tools ?? (ctx ? createTeacherTools(ctx, opts.toolToggles) : bareQuestionTools());
	return baseAgentOptions("teacher", opts, Object.values(tools));
}

export function bareQuestionTools(): Record<string, AgentTool<any>> {
	const quiz: AgentTool<typeof quizInputObject> = {
		name: "quiz",
		label: "quiz",
		description: "Ask the learner a graded question.",
		parameters: quizInputObject,
		executionMode: "sequential",
		execute: async (_toolCallId, input) => {
			const problems = quizInputProblems(input);
			if (problems.length > 0) return invalidInputResult("quiz", problems);
			return questionResult();
		},
	};
	return healToolRecord({
		quiz,
		ask_user_question: askUserQuestionTool,
	});
}

export function createPracticeAgent(ctx: PracticeToolContext, opts: AgentBuildOptions = {}) {
	if (opts.tools !== undefined) return baseAgentOptions("practice", opts, Object.values(opts.tools));
	const gate = createPracticeGate(ctx);
	return baseAgentOptions("practice", opts, Object.values(practiceTools(ctx, gate)));
}

export type ProberAgent = ReturnType<typeof createProberAgent>;
export type TeacherAgent = ReturnType<typeof createTeacherAgent>;
export type PracticeAgent = ReturnType<typeof createPracticeAgent>;
export type TeachingAgent = ProberAgent | TeacherAgent | PracticeAgent;
