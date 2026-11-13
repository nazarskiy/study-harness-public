
import { citationsToReadableText } from "./citations.ts";
import type { OwllyMessage } from "./native-messages.ts";
import {
	failedOutputCallIds,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	problemInputForConclude,
	SEND_TO_USER_TOOL,
	userFacingTextOf,
	pluginQuestionResultMatches,
} from "./native-messages.ts";
import { readPluginQuestionMessageAnnotation, readPluginQuestionAnswer, readPluginQuestionCancellation } from "./plugin-questions.ts";
import { readPluginProblemSnapshot, readPluginProblemSubmission, pluginProblemById } from "./plugin-problems.ts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

export interface MarkdownContext {
	messages: ReadonlyArray<OwllyMessage>;
	calls: Map<string, { name: string; args: Record<string, unknown> | undefined }>;
	failedOutputCalls?: ReadonlySet<string>;
}

function markdownContext(messages: ReadonlyArray<OwllyMessage>): MarkdownContext {
	const calls: MarkdownContext["calls"] = new Map();
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		const content = (message as { content?: unknown }).content;
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			const block = part as { type?: string; id?: string; name?: string; arguments?: unknown };
			if (block.type === "toolCall" && typeof block.id === "string") {
				calls.set(block.id, {
					name: typeof block.name === "string" ? block.name : "",
					args: (block.arguments ?? undefined) as Record<string, unknown> | undefined,
				});
			}
		}
	}
	return { messages, calls, failedOutputCalls: failedOutputCallIds(messages) };
}

function outcomeLabel(outcome: string): string {
	const spaced = outcome.replace(/([a-z])([A-Z])/g, (_, lo: string, hi: string) => `${lo} ${hi.toLowerCase()}`);
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function toolResultBody(result: ToolResultMessage, ctx?: MarkdownContext): { heading: string; body: string[] } {
	const pluginAnswer = readPluginQuestionAnswer(result.details);
	const cancellation = readPluginQuestionCancellation(result.details);
	if (pluginAnswer || cancellation) {
		const bound = ctx?.messages.some(message => message.role === "assistant" && Array.isArray(message.content) && message.content.some((block, contentIndex) => {
			if (block.type !== "toolCall") return false;
			const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
			return annotation.status !== "absent" && pluginQuestionResultMatches(result as OwllyMessage, { messageId: message.id, contentIndex, toolCallId: block.id, toolName: block.name }, annotation);
		}));
		if (!bound) return { heading: "Question", body: ["Question unavailable"] };
		if (cancellation) return { heading: "Question", body: ["The question was cancelled without a learner answer."] };
		const body = [`**Answer:** ${typeof pluginAnswer!.answer === "string" ? pluginAnswer!.answer : JSON.stringify(pluginAnswer!.answer)}`];
		if (pluginAnswer!.thinking !== undefined) body.push(`**Thinking:** ${pluginAnswer!.thinking}`);
		if (pluginAnswer!.readingThinking !== undefined) body.push(`**Reading thinking:** ${pluginAnswer!.readingThinking}`);
		return { heading: "Learner answer", body };
	}
	const out = result.details as
		| Partial<{
				questionText: string;
				correct: boolean;
				dontKnow: boolean;
				note: string;
				text: string;
				answers: string[];
				other: string;
				dismissed: boolean;
		  }>
		| undefined;

	if (
		result.toolName === "quiz" ||
		result.toolName === "probe" ||
		result.toolName === "explain" ||
		result.toolName === "recall"
	) {
		const heading =
			result.toolName === "quiz"
				? "Quiz"
				: result.toolName === "probe"
					? "Probe"
					: result.toolName === "recall"
						? "Recall"
						: "Recall check";
		const question = typeof out?.questionText === "string" && out.questionText ? out.questionText : "(no question text)";
		const body = [`**Q:** ${question}`];
		if (out?.dismissed === true) body.push("The learner skipped this check.");
		else if (out?.dontKnow === true) body.push("The learner did not know.");
		else if (out?.correct === true) body.push("The learner answered correctly.");
		else if (out?.correct === false) body.push("The learner answered incorrectly.");
		else if (typeof out?.text === "string" && out.text.trim()) body.push(`The learner answered in his own words: ${out.text.trim()}`);
		if (typeof out?.note === "string" && out.note) body.push(`*(his thinking: ${out.note})*`);
		return { heading, body };
	}

	const pluginProblem = readPluginProblemSnapshot((result.details as { pluginProblem?: unknown } | undefined)?.pluginProblem);
	if (pluginProblem && ctx && pluginProblemById(ctx.messages, pluginProblem.problemId)) {
		return { heading: "Problem", body: [pluginProblem.input.statement] };
	}
	if (ctx !== undefined && result.toolName === PRACTICE_PROBLEM_TOOL) {
		const statement = ctx.calls.get(result.toolCallId)?.args?.statement;
		return {
			heading: "Problem",
			body: [typeof statement === "string" && statement.trim() ? statement.trim() : "(no statement)"],
		};
	}

	if (ctx !== undefined && result.toolName === PRACTICE_CONCLUDE_TOOL) {
		const args = ctx.calls.get(result.toolCallId)?.args;
		const outcome = typeof args?.outcome === "string" && args.outcome.trim() ? args.outcome.trim() : "";
		const verdict = typeof args?.verdict === "string" && args.verdict.trim() ? args.verdict.trim() : undefined;
		if (outcome === "dismissed") return { heading: "Concluded", body: ["The learner skipped this problem."] };
		const label = outcome !== "" ? `**${outcomeLabel(outcome)}.**` : "**Concluded.**";
		const body = [verdict !== undefined ? `${label} ${verdict}` : label];
		const input = problemInputForConclude(ctx.messages, result.toolCallId);
		const solution = typeof input?.modelSolution === "string" && input.modelSolution.trim() ? input.modelSolution.trim() : undefined;
		if (solution !== undefined) body.push(`> **Model solution**\n>\n> ${solution.replace(/\n/g, "\n> ")}`);
		return { heading: "Concluded", body };
	}

	if (result.toolName === "ask_user_question") {
		const question = typeof out?.questionText === "string" && out.questionText ? out.questionText : "(no question text)";
		const body = [`**Q:** ${question}`];
		const chosen = [
			...(Array.isArray(out?.answers) ? out!.answers! : []),
			...(typeof out?.other === "string" && out.other.trim() ? [out.other.trim()] : []),
		];
		if (typeof out?.text === "string" && out.text.trim()) body.push(`The learner answered: ${out.text.trim()}`);
		else if (chosen.length > 0) body.push(`The learner chose: ${chosen.join(", ")}`);
		else if (out?.dismissed === true) body.push("The learner skipped this question.");
		if (typeof out?.note === "string" && out.note) body.push(`*(his thinking: ${out.note})*`);
		return { heading: "Question", body };
	}

	return { heading: "Tool", body: [`*${result.toolName} result delivered*`] };
}

export function messageMarkdown(
	message: OwllyMessage,
	mid: string,
	anchors = true,
	ctx?: MarkdownContext,
): string | null {
	const role = (message as { role?: string }).role;
	const anchor = anchors ? ` · ${mid}` : "";
	const parts: string[] = [];

	if (message.role === "custom" && message.customType === "plugin-problem-submission") {
		const submitted = readPluginProblemSubmission(message.details);
		if (submitted) parts.push(`### Learner${anchor}\n\n\`\`\`json\n${JSON.stringify({ submission: submitted.submission, thinking: submitted.thinking, ...(submitted.processing ? { processing: submitted.processing } : {}) }, null, 2)}\n\`\`\``);
	} else if (role === "user") {
		for (const text of userFacingTextOf((message as { content: unknown }).content)) {
			parts.push(`### Learner${anchor}\n\n${citationsToReadableText(text).trim()}`);
		}
	} else if (role === "assistant") {
		for (const text of userFacingTextOf((message as { content: unknown }).content, ctx?.failedOutputCalls ?? failedOutputCallIds([message]))) {
			parts.push(`### Teacher${anchor}\n\n${text.trim()}`);
		}
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const [contentIndex, block] of message.content.entries()) {
				if (block.type !== "toolCall") continue;
				const annotation = readPluginQuestionMessageAnnotation(message, contentIndex);
				if (annotation.status === "posed") parts.push(`### Question${anchor}\n\n${annotation.snapshot.input.question}`);
			}
		}
	} else if (role === "toolResult") {
		const result = message as ToolResultMessage;
		if (result.isError || result.toolName === SEND_TO_USER_TOOL) return null;
		const { heading, body } = toolResultBody(result, ctx);
		parts.push(`### ${heading}${anchor}\n\n${citationsToReadableText(body.join("\n\n"))}`);
	}

	return parts.length > 0 ? parts.join("\n\n") : null;
}

export function sessionMarkdown(
	messages: ReadonlyArray<OwllyMessage>,
	opts: { title?: string; anchors?: boolean } = {},
): string {
	const blocks: string[] = [];
	if (opts.title !== undefined && opts.title.length > 0) blocks.push(`# ${opts.title}`);
	const ctx = markdownContext(messages);
	for (const message of messages) {
		const block = messageMarkdown(message, (message as { id?: string }).id ?? "", opts.anchors ?? true, ctx);
		if (block !== null) blocks.push(block);
	}
	return blocks.join("\n\n");
}
