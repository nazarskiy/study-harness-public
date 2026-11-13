"use client";


import { useEffect, useRef, type RefObject } from "react";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { isInteractionScopeEligible } from "./plugin-input-focus";
import { pluginQuestionKeySuppressed, composingQuestionKey } from "./plugin-question-keys";
import { isTypingSurface } from "@/src/core";

const OVERLAY_ROOTS = '[data-owlly-menu], [data-radix-popper-content-wrapper], [role="menu"], [role="dialog"]';

export function buttonKeepsNativeEnter(el: HTMLElement): boolean {
	try {
		if (el.matches(":focus-visible")) return true;
	} catch {
	}
	return !!el.closest(OVERLAY_ROOTS);
}

export function useEnterSubmits(submit: () => void, scopeRef?: RefObject<HTMLElement | null>): void {
	const controller = useOptionalInteractionLayers();
	const submitRef = useRef(submit);
	submitRef.current = submit;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.defaultPrevented || pluginQuestionKeySuppressed(e) || composingQuestionKey(e)) return;
			if (!isInteractionScopeEligible(scopeRef ? scopeRef.current : document.body, controller)) return;
			if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
			if (isTypingSurface(e)) return;
			const target = e.target as HTMLElement | null;
			if (target?.tagName === "BUTTON" && buttonKeepsNativeEnter(target)) return;
			e.preventDefault();
			submitRef.current();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [controller, scopeRef]);
}
