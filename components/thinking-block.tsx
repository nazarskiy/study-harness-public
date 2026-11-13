"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon } from "@/components/ui/icons";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { cn } from "@/lib/utils";
import type { ImageContent } from "@earendil-works/pi-ai";
import { SubmittedImages } from "./submitted-images";
import { PathText } from "@/components/file-path-chip";


let allUserThinkingOpen: boolean | null = null;
const userThinkingListeners = new Set<(open: boolean) => void>();

export function currentUserThinkingOpen(): boolean {
	return allUserThinkingOpen ?? true;
}

function resolveUserThinkingOpen(defaultOpen: boolean): boolean {
	return allUserThinkingOpen ?? defaultOpen;
}

export function setAllUserThinkingOpen(open: boolean) {
	allUserThinkingOpen = open;
	for (const l of userThinkingListeners) l(open);
}

function subscribeUserThinking(fn: (open: boolean) => void): () => void {
	userThinkingListeners.add(fn);
	if (allUserThinkingOpen !== null) fn(allUserThinkingOpen);
	return () => userThinkingListeners.delete(fn);
}

export function ThinkingBlock({
	label = "Your thinking",
	text,
	images,
	testId,
	dataCommit,
	defaultOpen = false,
	inCard = false,
}: {
	label?: string;
	text: string;
	images?: readonly Readonly<ImageContent>[];
	testId?: string;
	dataCommit?: boolean;
	defaultOpen?: boolean;
	inCard?: boolean;
}) {
	const [open, setOpen] = useState(() => resolveUserThinkingOpen(defaultOpen));
	const syncedRef = useRef(false);
	useEffect(
		() => subscribeUserThinking((o) => { syncedRef.current = true; setOpen(o); }),
		[],
	);
	return (
		<div
			data-testid={testId}
			data-commit={dataCommit === undefined ? undefined : dataCommit ? "true" : "false"}
			className={cn(
				"ow-card-enter my-2 w-full rounded-2xl px-3.5 py-2 text-xs",
				inCard ? "bg-muted/60" : "border-2 bg-card",
			)}
		>
			<button
				type="button"
				data-testid={testId ? `${testId}-trigger` : undefined}
				onClick={(e) => {
					setOpen((v) => !v);
					blurAfterPointerClick(e);
				}}
				aria-expanded={open}
				className="flex w-full cursor-pointer items-center gap-2 text-xs font-extrabold text-muted-foreground transition-colors hover:text-foreground"
			>
				{label}
				<ChevronDownIcon className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "rotate-0")} />
			</button>
			{open && (
				<div>{text && <span className="ow-prose mt-1.5 block whitespace-pre-wrap text-[15px] font-medium text-foreground/70"><PathText text={text} /></span>}<SubmittedImages images={images} /></div>
			)}
		</div>
	);
}
