"use client";

import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface DockHeightMeasurements {
	columnHeight: number;
	outsideHeight: number;
	beforeShellHeight: number;
	shellBorderHeight: number;
	contentHeight: number;
	questionHeight: number | null;
	questionPaddingHeight: number;
}

export function dockHeightBudget(m: DockHeightMeasurements) {
	const available = Math.max(m.columnHeight - 32, 0);
	const viewportMaxHeight = Math.max(available - m.outsideHeight, 0);
	const shellMaxHeight = Math.max(viewportMaxHeight - m.beforeShellHeight, 0);
	const naturalHeight = m.beforeShellHeight + m.shellBorderHeight + m.contentHeight;
	const questionMaxHeight = m.questionHeight === null
		? null
		: Math.max(viewportMaxHeight - (naturalHeight - m.questionHeight), 0);
	const scrollWholeContent = questionMaxHeight === null
		? naturalHeight > viewportMaxHeight
		: questionMaxHeight <= m.questionPaddingHeight;
	return { viewportMaxHeight, shellMaxHeight, questionMaxHeight, scrollWholeContent };
}

interface DockHeightElements {
	column: HTMLElement;
	block: HTMLElement;
	viewport: HTMLElement;
	body: HTMLElement;
	shell: HTMLElement;
	content: HTMLElement;
}

const pixels = (value: string) => Number.parseFloat(value) || 0;

export function syncDockHeight(elements: DockHeightElements, expanded: boolean) {
	const { column, block, viewport, body, shell, content } = elements;
	const question = expanded ? content.querySelector<HTMLElement>("[data-dock-scroll-area]") : null;
	const height = (el: HTMLElement) => el.getBoundingClientRect().height;
	const shellStyle = getComputedStyle(shell);
	const questionStyle = question ? getComputedStyle(question) : null;
	const budget = dockHeightBudget({
		columnHeight: column.clientHeight,
		outsideHeight: Math.max(height(block) - height(viewport), 0),
		beforeShellHeight: Math.max(height(body) - height(shell), 0),
		shellBorderHeight: pixels(shellStyle.borderTopWidth) + pixels(shellStyle.borderBottomWidth),
		contentHeight: height(content),
		questionHeight: question ? height(question) : null,
		questionPaddingHeight: questionStyle
			? pixels(questionStyle.paddingTop) + pixels(questionStyle.paddingBottom)
			: 0,
	});
	if (budget.questionMaxHeight === null) block.style.removeProperty("--dock-max-h");
	else block.style.setProperty("--dock-max-h", budget.scrollWholeContent ? "none" : `${budget.questionMaxHeight}px`);
	viewport.style.maxHeight = `${budget.viewportMaxHeight}px`;
	viewport.style.overflowY = budget.scrollWholeContent ? "auto" : "visible";
	shell.style.maxHeight = budget.scrollWholeContent ? "none" : `${budget.shellMaxHeight}px`;
	return budget;
}

interface DockHeightRefs {
	scrollRef: RefObject<HTMLElement | null>;
	blockRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
	bodyRef: RefObject<HTMLDivElement | null>;
	shellRef: RefObject<HTMLDivElement | null>;
	contentRef: RefObject<HTMLDivElement | null>;
}

export function useDockHeight({
	scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef,
	expanded, enabled, mode, onScrollbarInset, onHeight, onLayout,
}: DockHeightRefs & {
	expanded: boolean;
	enabled: boolean;
	mode: string;
	onScrollbarInset: (inset: number) => void;
	onHeight: (height: number) => void;
	onLayout?: () => void;
}) {
	const measure = useCallback(() => {
		const column = scrollRef.current;
		const block = blockRef.current;
		const viewport = viewportRef.current;
		const body = bodyRef.current;
		const shell = shellRef.current;
		const content = contentRef.current;
		if (!column || !block || !viewport || !body || !shell || !content) return;
		onScrollbarInset(Math.round((column.offsetWidth - column.clientWidth) / 2));
		if (enabled) syncDockHeight({ column, block, viewport, body, shell, content }, expanded);
		else {
			block.style.removeProperty("--dock-max-h");
			viewport.style.removeProperty("max-height");
			viewport.style.removeProperty("overflow-y");
			shell.style.removeProperty("max-height");
		}
		onLayout?.();
		if (shell.getAnimations().length === 0) onHeight(block.getBoundingClientRect().height);
	}, [scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef, expanded, enabled, onScrollbarInset, onHeight, onLayout]);

	useIsoLayoutEffect(measure);
	useIsoLayoutEffect(() => {
		let active = true;
		const observedMeasure = () => { if (active) measure(); };
		const observer = new ResizeObserver(observedMeasure);
		for (const el of [scrollRef.current, blockRef.current, viewportRef.current, bodyRef.current, contentRef.current]) {
			if (el) observer.observe(el);
		}
		const question = expanded ? contentRef.current?.querySelector("[data-dock-scroll-area]") : null;
		if (question) observer.observe(question);
		window.addEventListener("resize", observedMeasure);
		return () => {
			active = false;
			observer.disconnect();
			window.removeEventListener("resize", observedMeasure);
		};
	}, [measure, mode, expanded, scrollRef, blockRef, viewportRef, bodyRef, contentRef]);
}

export function forwardDockWheel(event: WheelEvent, root: HTMLElement, transcript: HTMLElement) {
	if (event.deltaY === 0) return;
	for (let n = event.target as HTMLElement | null; n && n !== root; n = n.parentElement) {
		if (!(n instanceof HTMLElement) || !/^(auto|scroll)$/.test(getComputedStyle(n).overflowY)) continue;
		if (n.scrollHeight - n.clientHeight < 2) continue;
		if (event.deltaY < 0 ? n.scrollTop > 0 : n.scrollTop < n.scrollHeight - n.clientHeight - 0.5) return;
	}
	event.preventDefault();
	transcript.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? transcript.clientHeight : 1);
}
