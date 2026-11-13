import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { probeDoneInputSchema, PROBE_DONE_ACK_TEXT } from "../../core/contracts.ts";
import { hasUnresolvedQuestion, hasProbeDone, type OwllyMessage } from "../../core/native-messages.ts";
import type { ChatStore } from "../../core/ports.ts";
import { buildProbeHandoffSteer, type SteerMessage } from "../../core/contracts.ts";

export interface ProbeDoneContext {
	chatId: string;
	chatStore: ChatStore;
	deliver: (steer: SteerMessage) => void;
}

function probeConcluded(messages: readonly OwllyMessage[]): boolean {
	return hasProbeDone(messages);
}

export function probeDoneTool(ctx: ProbeDoneContext): Record<string, AgentTool<any>> {
	return {
		probe_done: {
			name: "probe_done",
			label: "probe_done",
			description:
				"Conclude the probing phase and hand off to the teaching phase. Call this ONCE, when the probe is " +
				"complete: every strand the lesson depends on is bracketed (a floor he reliably gets right AND a " +
				"ceiling where it runs out), and his learning goal is concrete. The input IS the learner assessment — " +
				"one strand per dependency the lesson will rest on, with your read of where his edge sits on it " +
				"(floor, ceiling, misconceptions, what to build from). It streams to the learner live and becomes " +
				"the handoff artifact the teacher plans from. Refused while a question is still open, and after " +
				"the probe is already concluded. After it succeeds, say your closing sentence and end your turn.",
			parameters: probeDoneInputSchema,
			execute: serverExecute("probe_done", probeDoneInputSchema, async (input) => {
				const record = ctx.chatStore.getChat(ctx.chatId);
				if (!record) return { ok: false, error: `Chat not found: ${ctx.chatId}` };

				if (hasUnresolvedQuestion(record.messages)) {
					return {
						ok: false,
						error:
							"A question is still open — resolve it (or let him answer) before concluding the probe. " +
							"probe_done only fires with no question outstanding.",
					};
				}
				if (probeConcluded(record.messages)) {
					return { ok: false, error: "The probe is already concluded — probe_done fires exactly once." };
				}
				try {
					ctx.deliver(buildProbeHandoffSteer(ctx.chatId));
				} catch (err) {
					console.error(`[chat ${ctx.chatId}] probe handoff queueing failed:`, err);
				}
				return {
					text: PROBE_DONE_ACK_TEXT,
					details: { ok: true },
				};
			}),
		},
	};
}
