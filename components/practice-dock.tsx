"use client";

import { useAttachmentUploads } from "@/components/file-path-drop-zone";

import { ToolContentResponse } from "@/components/ai-elements/message";
import { useEnterSubmits } from "@/components/enter-submits";
import { PathInput } from "@/components/path-input";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useRef,useState,type ReactNode } from "react";
import { isInteractionScopeEligible } from "./interaction-focus";
import { useOptionalInteractionLayers } from "./interaction-layers";
import type { PrepareThinkingSubmission } from "./submission-adapters";


export interface PracticeDockProps {

	problemCallId: string;
	input: { statement: string };
	expanded: boolean;
	onExpand: () => void;
	onSubmit: (text: string) => void;
	onPrepareSubmission?: PrepareThinkingSubmission;
	customInput?: {
		editor: ReactNode;
		ready: boolean;
		prepare: PrepareThinkingSubmission;
	};
	hasPendingInput?: boolean;
	preparing?: boolean;
	compactionRunning?: boolean;
}

export function PracticeDock({ problemCallId, input, expanded, onExpand, onSubmit, onPrepareSubmission, customInput, hasPendingInput = false, preparing = false, compactionRunning = false }: PracticeDockProps) {
	const attachments = useAttachmentUploads();
	const controller = useOptionalInteractionLayers();
	const rootRef = useRef<HTMLElement>(null);
	const [nativeThinking, setNativeThinking] = useState("");
	const custom = useRef(customInput); custom.current = customInput;
	const thinking = customInput ? "" : nativeThinking;
	const setThinking = (value: string) => { if (!custom.current) setNativeThinking(value); };
	const thinkingRef = useRef(thinking); thinkingRef.current = thinking;
	const editRevision = useRef(0);


	const submit = () => {
		if (attachments.isUploading() || compactionRunning || preparing) return;
		const prepare = customInput?.prepare ?? onPrepareSubmission;
		if (prepare) {
			if (customInput ? !customInput.ready : (!thinkingRef.current.trim() && !hasPendingInput)) return;
			let capturedRevision = editRevision.current;
			prepare(() => { capturedRevision = editRevision.current; return customInput ? thinkingRef.current : thinkingRef.current.trim(); }, captured => {
				if (editRevision.current === capturedRevision && (customInput ? thinkingRef.current : thinkingRef.current.trim()) === captured) { thinkingRef.current = ""; setThinking(""); }
			});
			return;
		}
		const text = thinkingRef.current.trim();
		if (text.length === 0) return;
		thinkingRef.current = "";
		setThinking("");
		onSubmit(text);
	};

	useEnterSubmits(submit, rootRef);

	const bar = (
			<button
				ref={element => { if (!customInput) rootRef.current = element; }}
				type="button"
				data-testid="practice-dock-bar"
				onClick={onExpand}
				className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
			>
				<ChevronRightIcon className="size-4 shrink-0 rotate-90" />
				<span className="font-medium">Problem</span>
				<span className="min-w-0 flex-1 truncate">{input.statement}</span>
			</button>
		);
	if (!expanded && !customInput) return bar;

	return (
		<div ref={element => { rootRef.current = element; }} data-testid="practice-dock" data-problem={problemCallId}>
			{!expanded && bar}
			<div hidden={!expanded}>
			{
}
			<div data-dock-scroll-area="" className="max-h-[var(--dock-max-h,40vh)] overflow-y-auto px-4 pt-3 pb-2">
				<div className="mb-2 inline-flex rounded-full bg-secondary-soft px-2.5 py-0.5 text-xs font-extrabold text-secondary">Problem</div>
				<div className="ow-prose text-[15px]">
					<ToolContentResponse>{input.statement}</ToolContentResponse>
				</div>
			</div>

			{customInput?.editor}

			{
}
			<div
				data-testid={customInput ? undefined : "practice-answer-field"}
				className="m-2 rounded-2xl border-2 bg-muted/50 transition-colors focus-within:border-secondary focus-within:bg-card"
			>
				{!customInput && <>
				<div className="px-3 pt-2.5 text-xs font-extrabold text-muted-foreground">Your answer</div>
				<PathInput
					value={thinking}
					onValueChange={(value) => {
						thinkingRef.current = value; editRevision.current++;
						setThinking(value);
					}}
					onKeyDown={(e) => {
						if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
						if (e.key === "Enter" && (!e.shiftKey || e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							submit();
						}
					}}
					placeholder="Write your answer…"
					className={cn(
						"field-sizing-content ow-input max-h-64 min-h-16 w-full resize-none bg-transparent px-2.5 pb-2 outline-none placeholder:text-muted-foreground",
					)}
				/>
				</>}
				{
}
				<div className="flex items-center justify-between gap-2 p-1">
					<span aria-hidden className="pl-2 text-xs font-semibold text-muted-foreground">
						{compactionRunning ? "compacting session…" : "↵ submits · ⇧↵ newline"}
					</span>
					<Button
						type="button"
						data-testid="practice-send"
						disabled={(customInput ? !customInput.ready : (!thinking.trim() && !hasPendingInput)) || attachments.uploading || compactionRunning || preparing}
						onClick={() => submit()}
						size="lg" className="ml-auto h-11 px-6"
					>
						{customInput ? "Submit" : "Submit answer"}
					</Button>
				</div>
			</div>
			</div>
		</div>
	);
}
