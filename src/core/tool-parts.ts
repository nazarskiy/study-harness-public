
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { quizDisplayInputSchema, askInputSchema, askOptionProblems, quizInputProblems, explainInputProblems, explainDisplayInputSchema, type AskToolInput, type QuizToolInput, type ExplainToolInput } from "./question-core.ts";
import { healEncodedArguments } from "./argument-heal.ts";
import { probeDoneInputSchema, type ProbeDoneInput } from "./contracts/probe.ts";
import { readPluginQuestionSnapshot, type PluginQuestionSnapshot } from "./plugin-questions.ts";

export function posedPluginQuestionOfPart(part: { pluginQuestion?: unknown }): PluginQuestionSnapshot | undefined {
	const annotation = part.pluginQuestion;
	if (!annotation || typeof annotation !== "object" || (annotation as { status?: unknown }).status !== "posed") return undefined;
	return readPluginQuestionSnapshot((annotation as { snapshot?: unknown }).snapshot) ?? undefined;
}

function boundaryParse<T>(schema: TSchema, input: unknown): T | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const converted = structuredClone(input);
	Value.Convert(schema, converted);
	if (!Value.Check(schema, converted)) return undefined;
	return Value.Clean(schema, converted) as T;
}

export function parseQuizInput(input: unknown): QuizToolInput | undefined {
	const healedInput = healEncodedArguments(input, quizDisplayInputSchema);
	const cleaned = boundaryParse<QuizToolInput>(quizDisplayInputSchema, healedInput);
	if (!cleaned) return undefined;
	if (quizInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

export function parseAskInput(input: unknown): AskToolInput | undefined {
	const cleaned = boundaryParse<AskToolInput>(askInputSchema, healEncodedArguments(input, askInputSchema));
	if (!cleaned) return undefined;
	if (askOptionProblems(cleaned.options ?? []).length > 0) return undefined;
	return cleaned;
}

export function parseExplainInput(input: unknown): ExplainToolInput | undefined {
	const cleaned = boundaryParse<ExplainToolInput>(explainDisplayInputSchema, healEncodedArguments(input, explainDisplayInputSchema));
	if (!cleaned) return undefined;
	if (explainInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

export function parseQuestionInput(tool: string, input: unknown): QuizToolInput | AskToolInput | ExplainToolInput | undefined {
	switch (tool) {
		case "quiz": case "probe": return parseQuizInput(input);
		case "explain": case "recall": return parseExplainInput(input);
		case "ask_user_question": return parseAskInput(input);
		default: return undefined;
	}
}

export function parseProbeDoneInput(input: unknown): ProbeDoneInput | undefined {
	return boundaryParse<ProbeDoneInput>(probeDoneInputSchema, input);
}