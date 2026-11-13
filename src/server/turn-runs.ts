
import type { PiTurnHandle } from "./pi/ui-stream.ts";

interface OwllyTurnRunsGlobal {
	__lhTurnRuns?: Map<string, PiTurnHandle>;
	__lhTurnFailures?: Map<string, string>;
}

function runs(): Map<string, PiTurnHandle> {
	const g = globalThis as typeof globalThis & OwllyTurnRunsGlobal;
	return (g.__lhTurnRuns ??= new Map<string, PiTurnHandle>());
}

function failures(): Map<string, string> {
	const g = globalThis as typeof globalThis & OwllyTurnRunsGlobal;
	return (g.__lhTurnFailures ??= new Map<string, string>());
}

export function rememberTurnFailure(chatId: string, errorText: string): void {
	failures().set(chatId, errorText);
}

export function turnFailure(chatId: string): string | undefined {
	return failures().get(chatId);
}

export function clearTurnFailure(chatId: string): void {
	failures().delete(chatId);
}

export function registerTurn(chatId: string, handle: PiTurnHandle): void {
	runs().set(chatId, handle);
}

export function unregisterTurn(chatId: string, ownerHandle?: PiTurnHandle): void {
	if (ownerHandle && runs().get(chatId) !== ownerHandle) return;
	runs().delete(chatId);
}

export function runningTurn(chatId: string): PiTurnHandle | undefined {
	return runs().get(chatId);
}

export function abortTurn(chatId: string): { ok: true } | { ok: false; reason: "not_running" } {
	const handle = runs().get(chatId);
	if (!handle) return { ok: false, reason: "not_running" };
	handle.abort();
	return { ok: true };
}

export function settledTurnResponse(chatId?: string): Response {
	const errorText = chatId ? turnFailure(chatId) : undefined;
	const notice = errorText === undefined ? "" : `data: ${JSON.stringify({ type: "error", errorText })}\n\n`;
	return new Response(`${notice}data: {"type":"turn-settled"}\n\ndata: [DONE]\n\n`, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache, no-transform",
			"X-Accel-Buffering": "no",
		},
	});
}
