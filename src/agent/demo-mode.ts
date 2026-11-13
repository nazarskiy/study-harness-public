import type { AgentMessage,AgentTool,AgentTurnContext } from "@earendil-works/pi-agent-core";
import { countDemoQuestions,DEMO_QUESTION_LIMIT,demoModeInstructions } from "../core/demo-mode.ts";
import { QUESTION_TOOLS } from "../core/pending.ts";

export function createDemoQuestionGuard(messages: readonly AgentMessage[]) {
	let asked = countDemoQuestions(messages);
	let reserved = 0;
	const questions = new Set<string>(QUESTION_TOOLS);
	const posed = new Set<string>();
	const availableTools = (tools: readonly AgentTool<any, any>[]) => asked >= DEMO_QUESTION_LIMIT ? tools.filter(tool => !questions.has(tool.name)) : [...tools];
	return {
		count: () => asked,
		instructions: () => demoModeInstructions(asked),
		availableTools,
		posedIn: (turn: AgentTurnContext) => turn.toolResults.some(result => !result.isError && posed.has(`${result.toolName}:${result.toolCallId}`)),
		wrapTools(tools: readonly AgentTool<any, any>[]): AgentTool<any, any>[] {
			return availableTools(tools).map(tool => !questions.has(tool.name) ? tool : {
				...tool,
				execute: async (...args: Parameters<AgentTool<any, any>["execute"]>) => {
					if (asked + reserved >= DEMO_QUESTION_LIMIT) return {
						isError: true,
						content: [{ type: "text" as const, text: "Demo probing question limit reached. Call probe_done with the evidence available, then end your turn for the teacher to create the learning graph. Do not teach or ask another probing question." }],
						details: { code: "demo_question_limit" },
					};
					reserved++;
					try {
						const result = await tool.execute(...args);
						if (!result.isError && result.terminate === true) { asked++; posed.add(`${tool.name}:${args[0]}`); }
						return result;
					} finally { reserved--; }
				},
			});
		},
	};
}
