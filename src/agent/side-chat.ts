
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeContext, type AssistantMessage, type Message, type Usage } from "@earendil-works/pi-ai";
import { backgroundCaptureStream, createBackgroundCapture } from "./background-capture.ts";
import { providerEventObserver } from "./provider-events.ts";
import { PATHS } from "../../config.ts";
import type { SideModelTurn } from "../core/side-chat.ts";
import type { PiEngine } from "./models.ts";

const PROMPTS_DIR = path.join(PATHS.root, "src", "agent", "prompts");
const SIDE_BASE = path.join(PROMPTS_DIR, "side-chat", "00-base.md");
const SIDE_STYLE = path.join(PROMPTS_DIR, "side-chat", "90-style.md");
const SIDE_SHARED_FRAGMENTS = ["shared/10-voice.md", "shared/15-accuracy.md", "shared/40-formatting.md"];

function readSource(file: string): string {
	try {
		return fs.readFileSync(file, "utf-8");
	} catch {
		return "";
	}
}

export function composeSideChatInstructions(): string {
	const segments = [readSource(SIDE_BASE)];
	for (const key of SIDE_SHARED_FRAGMENTS) {
		segments.push(readSource(path.join(PROMPTS_DIR, ...key.split("/"))));
	}
	segments.push(readSource(SIDE_STYLE));
	return segments
		.map((s) => s.trim())
		.filter(Boolean)
		.join("\n\n---\n\n");
}

export interface SideAnswerResult {
	text: string;
	usage?: Usage;
	outcome: "done" | "aborted" | "error";
	errorMessage?: string;
}

function textOf(message: AssistantMessage): string {
	return message.content
		.filter((c): c is { type: "text"; text: string } => c.type === "text")
		.map((c) => c.text)
		.join("");
}

export async function streamSideAnswer(opts: {
	engine: PiEngine;
	instructions: string;
	turns: readonly SideModelTurn[];
	signal?: AbortSignal;
	onText?: (text: string) => void;
	chatId?: string;
	runId?: string;
}): Promise<SideAnswerResult> {
	const now = Date.now();
	const messages: Message[] = opts.turns.map((turn) =>
		turn.role === "user"
			? { role: "user", content: turn.text, timestamp: now }
			: ({
					role: "assistant",
					content: [{ type: "text", text: turn.text }],
					api: opts.engine.model.api,
					provider: opts.engine.model.provider,
					model: opts.engine.model.id,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: now,
				} as AssistantMessage),
	);
	let text = "";
	let failure: unknown;
	const capture = createBackgroundCapture({ role: "sideQuestion", runId: opts.runId ?? randomUUID(), sourceId: opts.chatId });
	const providerEvents = opts.chatId ? providerEventObserver(opts.chatId, "sideQuestion") : undefined;
	try {
		const stream = backgroundCaptureStream(opts.engine.streamFn, capture)(opts.engine.model, normalizeContext({ systemPrompt: opts.instructions, messages, tools: [] }), {
			signal: opts.signal,
			reasoning: opts.engine.level === "off" ? undefined : opts.engine.level,
			...(providerEvents ? { onProviderStreamEvent: providerEvents } : {}),
		});
		for await (const event of stream) {
			if (event.type === "text_delta" || event.type === "text_end") {
				const next = textOf(event.partial);
				if (next !== text) {
					text = next;
					opts.onText?.(text);
				}
			} else if (event.type === "done") {
				capture?.reply(event.message);
				return { text: textOf(event.message) || text, usage: event.message.usage, outcome: "done" };
			} else if (event.type === "error") {
				capture?.reply(event.error);
				failure = new Error(event.error.errorMessage ?? event.reason);
				const partial = textOf(event.error) || text;
				if (event.reason === "aborted") return { text: partial, usage: event.error.usage, outcome: "aborted" };
				return { text: partial, usage: event.error.usage, outcome: "error", errorMessage: event.error.errorMessage ?? "The model call failed." };
			}
		}
		failure = new Error("The model stream ended without a result.");
		return { text, outcome: "error", errorMessage: (failure as Error).message };
	} catch (err) {
		failure = err;
		if (opts.signal?.aborted) return { text, outcome: "aborted" };
		return { text, outcome: "error", errorMessage: err instanceof Error ? err.message : String(err) };
	} finally {
		capture?.finish(failure);
	}
}
