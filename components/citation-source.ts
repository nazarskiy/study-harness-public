import { messageAnchorId, type TutorCitation } from "@/src/core";
import { scrollSessionTarget, type SessionScrollContext } from "./session-navigation";
import { resolveCitationRange, sourceElements } from "./selection-text";


type HighlightRegistry = { set(name: string, highlight: unknown): void; delete(name: string): boolean };

function registry(): HighlightRegistry | null {
	const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
	return css?.highlights && typeof (globalThis as { Highlight?: unknown }).Highlight === "function" ? css.highlights : null;
}

const STYLE_ID = "ow-citation-style";
function injectStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = `
::highlight(ow-citation-comment) { background-color: color-mix(in oklab, var(--primary) 30%, transparent); }
::highlight(ow-citation) { background-color: color-mix(in oklab, var(--primary) 45%, transparent); }`;
	document.head.appendChild(style);
}

export function highlightRange(name: "ow-citation" | "ow-citation-comment", range: Range): () => void {
	const highlights = registry();
	if (!highlights) return () => {};
	injectStyles();
	const HighlightCtor = (globalThis as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight;
	highlights.set(name, new HighlightCtor(range));
	return () => { highlights.delete(name); };
}



export type RevealPlan = "navigate" | "highlight" | "message" | "missing";

export function revealPlan({ citationChatId, currentChatId, rangeFound, messageFound }: {
	citationChatId: string; currentChatId: string; rangeFound: boolean; messageFound: boolean;
}): RevealPlan {
	if (citationChatId !== currentChatId) return "navigate";
	if (rangeFound) return "highlight";
	return messageFound ? "message" : "missing";
}

export function citationSourceHref({ chatId, messageId }: Pick<TutorCitation, "chatId" | "messageId">): string {
	return `/chat/${encodeURIComponent(chatId)}#${encodeURIComponent(messageAnchorId(messageId))}`;
}

let stopPulse: (() => void) | null = null;

export function citationPulseSteps(reducedMotion: boolean): ReadonlyArray<readonly [on: boolean, at: number]> {
	return reducedMotion ? [[true, 0], [false, 750]] : [[true, 0], [false, 250], [true, 500], [false, 750]];
}
function pulse(range: Range, reducedMotion: boolean): void {
	stopPulse?.();
	const steps = citationPulseSteps(reducedMotion);
	let clear: () => void = () => {};
	const timers = steps.map(([on, at]) => window.setTimeout(() => {
		clear();
		clear = on ? highlightRange("ow-citation", range) : () => {};
	}, at));
	stopPulse = () => { timers.forEach((timer) => window.clearTimeout(timer)); clear(); stopPulse = null; };
}

export function revealCitationSource({ transcript, scroll, citation, currentChatId, navigate }: {
	transcript: HTMLElement | null;
	scroll: SessionScrollContext | null;
	citation: TutorCitation;
	currentChatId: string;
	navigate: (href: string) => void;
}): RevealPlan {
	const range = transcript && citation.chatId === currentChatId ? resolveCitationRange(transcript, citation.messageId, citation) : null;
	const message = transcript
		? (transcript.ownerDocument.getElementById(messageAnchorId(citation.messageId)) ?? sourceElements(transcript, citation.messageId)[0] ?? null)
		: null;
	const plan = revealPlan({ citationChatId: citation.chatId, currentChatId, rangeFound: range !== null, messageFound: message !== null });
	if (plan === "navigate") navigate(citationSourceHref(citation));
	else if (plan === "highlight" && transcript) {
		scrollSessionTarget(range!, transcript, scroll);
		pulse(range!, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
	} else if (plan === "message" && transcript && message instanceof HTMLElement) {
		scrollSessionTarget(message, transcript, scroll);
		message.classList.add("ow-source-highlight");
		window.setTimeout(() => message.classList.remove("ow-source-highlight"), 2_000);
	}
	return plan;
}
