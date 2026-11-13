"use client";

import { useAttachmentUploads } from "@/components/file-path-drop-zone";

import { AttachFilesButton } from "@/components/attach-files-button";
import { PathInput } from "@/components/path-input";
import { ArrowRightIcon,ArrowUpIcon,SquareIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useCallback,useLayoutEffect,useRef,useState,type ReactNode } from "react";
import { isInteractionScopeEligible } from "./interaction-focus";
import { useOptionalInteractionLayers } from "./interaction-layers";

export function enterAction(state: {
	busy: boolean;
	canSend: boolean;
	nextProblem?: boolean;
}): "stop" | "send" | "next" | "none" {
	if (state.busy) return state.canSend ? "send" : "stop";
	if (state.canSend) return "send";
	if (state.nextProblem) return "next";
	return "none";
}

export function ChatSessionComposer({
	busy,
	value,
	revision,
	onChange,
	onSend,
	onStop,
	sendAllowed,
	autoFocus,
	inputRef,
	placeholder,
	nextProblem,
	onNext,
	pendingInput = false,
}: {
	busy: boolean;
	value: string;
	revision: number;
	onChange: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	sendAllowed: boolean;
	autoFocus?: boolean;
	inputRef?: React.RefObject<HTMLDivElement | null>;
	placeholder?: string;
	nextProblem?: boolean;
	onNext?: () => void;
	pendingInput?: boolean;
}) {
	const [draft, setDraft] = useState(value);
	useLayoutEffect(() => { setDraft(value); }, [revision, value]);
	const canSend = sendAllowed && (draft.trim().length > 0 || pendingInput);
	const applyDraft = useCallback((next: string) => {
		setDraft(next);
		onChange(next);
	}, [onChange]);

	return (
		<Composer
			busy={busy}
			value={draft}
			onChange={applyDraft}
			onSend={onSend}
			onStop={onStop}
			canSend={canSend}
			autoFocus={autoFocus}
			inputRef={inputRef}
			placeholder={placeholder}
			nextProblem={nextProblem}
			onNext={onNext}
		/>
	);
}

export function Composer({
	busy,
	value,
	onChange,
	onSend,
	onStop,
	canSend,
	autoFocus,
	inputRef,
	placeholder = "Ask, answer, or steer the lesson…",
	nextProblem = false,
	onNext,
	defaultDropTarget = true,
	fileInsertion = true,
}: {
	busy: boolean;
	value: string;
	onChange: (v: string) => void;
	onSend: () => void;
	onStop: () => void;
	canSend: boolean;
	autoFocus?: boolean;
	inputRef?: React.RefObject<HTMLDivElement | null>;
	placeholder?: string;
	nextProblem?: boolean;
	onNext?: () => void;
	defaultDropTarget?: boolean;
	fileInsertion?: boolean;
}) {
	const attachments = useAttachmentUploads();
	const controller = useOptionalInteractionLayers();
	const act = () => {
		if (attachments.isUploading()) return;
		const action = enterAction({ busy, canSend, nextProblem });
		if (action === "stop") onStop();
		else if (action === "send") onSend();
		else if (action === "next") onNext?.();
	};
	const ownInputRef = useRef<HTMLDivElement>(null);
	const editorRef = inputRef ?? ownInputRef;
	return (
		<form
			data-testid="composer"
			className="flex items-end gap-2 p-2"
			onSubmit={(e) => {
				e.preventDefault();
				act();
			}}
		>
			<PathInput
				ref={editorRef}
				value={value}
				onValueChange={onChange}
				defaultDropTarget={defaultDropTarget}
				fileInsertion={fileInsertion}
				onKeyDown={(e) => {
					if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
						e.preventDefault();
						act();
					}
				}}
				placeholder={placeholder}
				autoFocus={autoFocus}
				className="field-sizing-content ow-input max-h-48 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 font-semibold outline-none placeholder:font-medium placeholder:text-muted-foreground"
			/>
			<AttachFilesButton editorRef={editorRef} />
			{
}
				{nextProblem && !busy && !canSend ? (
					<button
						type="submit"
						data-testid="next-problem-button"
						disabled={attachments.uploading}
						aria-label="Next problem"
						className="flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-2xl bg-success px-5 text-sm font-extrabold uppercase tracking-wide text-white shadow-[0_4px_0_var(--success-shade)] transition-[transform,box-shadow] duration-100 hover:brightness-105 active:translate-y-[3px] active:shadow-none"
					>
						Next problem
						<ArrowRightIcon className="size-4" />
					</button>
				) : (
					<button
						type="submit"
						aria-label={busy && !canSend ? "Stop" : "Send"}
						disabled={attachments.uploading || (!busy && !canSend)}
						className={cn(
							"flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-2xl transition-[transform,box-shadow,background-color] duration-100 active:translate-y-[3px] active:shadow-none disabled:cursor-default disabled:opacity-40 disabled:shadow-none",
							busy && !canSend
								? "bg-secondary text-secondary-foreground shadow-[0_4px_0_var(--secondary-shade)]"
								: "bg-primary text-primary-foreground shadow-[0_4px_0_var(--primary-shade)] hover:brightness-105",
						)}
					>
						{busy && !canSend ? <SquareIcon className="size-4 fill-current" /> : <ArrowUpIcon className="size-5" strokeWidth={3} />}
					</button>
				)}
		</form>
	);
}
