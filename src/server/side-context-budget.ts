import { retryDrops } from "../core/input-events.ts";
import { cliContextWindowOf, type OwllyMessage } from "../core/native-messages.ts";
import { CLAUDE_CODE_API, CLAUDE_CODE_PROVIDER } from "../agent/claude-code/constants.ts";

export const SIDE_CONTEXT_BUDGET_ERROR = "New side-chat exchanges exceed the selected model's context budget. The tutor paused before sending this request. Completed work and all pending side exchanges have been kept. Retry to let normal compaction free older lesson history, or select a model with a larger context window.";

export function sideContextWindow(messages: readonly OwllyMessage[], selected: { provider: string; id: string }, catalogWindow: number | undefined, retry: boolean): number | undefined {
	if (selected.provider !== CLAUDE_CODE_PROVIDER) return catalogWindow;
	const report = cliContextWindowOf(retry ? messages.filter((message) => !isLocalSideBudgetFailure(message, selected.id)) : messages);
	return report?.model === `${selected.provider}:${selected.id}` ? report.tokens : undefined;
}

function isLocalSideBudgetFailure(message: OwllyMessage, model: string): boolean {
	if (message.role !== "assistant" || message.provider !== CLAUDE_CODE_PROVIDER || message.api !== CLAUDE_CODE_API || message.model !== model ||
		message.stopReason !== "error" || message.errorMessage !== SIDE_CONTEXT_BUDGET_ERROR || message.responseId !== undefined || message.cliContextWindow !== undefined ||
		!message.content.every((block) => block.type === "text" && block.text === "")) return false;
	const usage = message.usage;
	return !!usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalTokens].every((tokens) => tokens === 0) &&
		[usage.reasoning, usage.cacheWrite1h].every((tokens) => tokens === undefined || tokens === 0) &&
		Object.values(usage.cost ?? {}).every((cost) => cost === 0);
}

export function sideBudgetRetryDrops(before: readonly OwllyMessage[], after: readonly OwllyMessage[]): Set<string> | undefined {
	let omitted: Set<string>;
	try { omitted = retryDrops([...before]); } catch { return undefined; }
	const latestFailure = before.findLast((message) => omitted.has(message.id));
	if (latestFailure?.role !== "assistant" || latestFailure.errorMessage !== SIDE_CONTEXT_BUDGET_ERROR) return undefined;
	if (after.length < before.length || before.some((message, index) => message.id !== after[index]?.id)) return undefined;
	if (!after.slice(before.length).every((message) => message.role === "custom" && message.customType === "compaction")) return undefined;
	return omitted;
}
