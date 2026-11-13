"use client";

import { useAttachmentUploads } from "@/components/file-path-drop-zone";

import { ToolContentResponse } from "@/components/ai-elements/message";
import { useEnterSubmits } from "@/components/enter-submits";
import { MalformedQuestion } from "@/components/malformed-question";
import { Owl } from "@/components/owl/owl";
import { PathInput } from "@/components/path-input";
import { QuestionPreview } from "@/components/question-preview";
import { Button } from "@/components/ui/button";
import { ArrowDownIcon,CheckIcon,ChevronRightIcon,PlayIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import {
buildAnswer,
emptyDockSelection,
normalizeOptions,
normalizeQuizType,
parseAskInput,
parseExplainInput,
parseQuizInput,
resolveCorrect,
seededRandom,
shuffleOptions,
toggleOption,
toggleOther,
toolQuestionKind,
type AnswerRequest,
type AskToolInput,
type DockSelection,
type ExplainToolInput,
type Phase3,
type QuestionAnswerData,
type QuestionData,
type QuestionFormDraft,
type QuestionMode,
type QuizToolInput,
type SelectMode
} from "@/src/core";
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { isInteractionScopeEligible } from "./interaction-focus";
import { useOptionalInteractionLayers } from "./interaction-layers";
import type { PrepareBuiltinSubmission } from "./submission-adapters";


export interface QuestionDockProps {

	toolName: "quiz" | "probe" | "ask_user_question" | "explain" | "recall";
	toolCallId: string;
	input: QuizToolInput | AskToolInput | ExplainToolInput;
	expanded: boolean;
	reveal?: boolean;
	onExpand: () => void;
	onSubmit: (output: QuestionAnswerData) => void;
	onPrepareSubmission?: PrepareBuiltinSubmission;
	hasPendingInput?: (question: QuestionData) => boolean;
	preparing?: boolean;
	initialDraft?: QuestionFormDraft;
	onSaveDraft?: (draft: QuestionFormDraft) => void;
	workingRef?: { current: string };
	active?: boolean;
	phase?: Phase3;
	compactionRunning?: boolean;
}

export function QuestionDock({
	toolName,
	toolCallId,
	input,
	expanded,
	reveal = false,
	onExpand,
	onSubmit,
	onPrepareSubmission,
	hasPendingInput,
	preparing,
	initialDraft,
	onSaveDraft,
	phase = "probe",
	compactionRunning = false,
	workingRef,
}: QuestionDockProps) {
	const canonical =
		toolName === "probe" ? "quiz" : toolName === "recall" ? "explain" : toolName;
	const toolLabel = toolName === "probe" ? "Probe" : toolName === "recall" ? "Recall" : undefined;
	const parsed = useMemo(() =>
		canonical === "quiz" ? parseQuizInput(input) : canonical === "explain" ? parseExplainInput(input) : parseAskInput(input), [canonical, input]);
	if (!parsed) {
		return <MalformedQuestion />;
	}
	return (
		<>
			{!expanded && (
				<QuestionDockBar
					toolName={canonical}
					question={parsed.question}
					onExpand={onExpand}
					variant={reveal ? "reveal" : "collapsed"}
					toolLabel={toolLabel}
					label={
						(canonical === "quiz" || canonical === "explain") &&
						normalizeQuizType((parsed as { type?: unknown }).type) === "predict"
							? "Prediction"
							: undefined
					}
				/>
			)}
			<div className={expanded ? "dock-variant" : "invisible h-0 overflow-hidden"}>
				<QuestionDockForm

					toolName={toolName}
					toolCallId={toolCallId}
					input={parsed}
					phase={phase}
					active={expanded}
					onSubmit={onSubmit}
					onPrepareSubmission={onPrepareSubmission}
					hasPendingInput={hasPendingInput}
					preparing={preparing}
					initialDraft={initialDraft}
					onSaveDraft={onSaveDraft}
					workingRef={workingRef}
					compactionRunning={compactionRunning}
				/>
			</div>
		</>
	);
}

export function QuestionDockBar({
	toolName,
	question,
	onExpand,
	variant = "collapsed",
	label,
	toolLabel,
}: {
	toolName: "quiz" | "ask_user_question" | "explain";
	question: string;
	onExpand: () => void;
	variant?: "collapsed" | "reveal";
	label?: string;
	toolLabel?: string;
}) {
	if (variant === "reveal") {
		return (
			<button
				type="button"
				data-testid="teach-check-reveal"
				onClick={onExpand}
				className="dock-variant flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted"
			>
				<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_3px_0_var(--primary-shade)]">
					<PlayIcon className="size-4 fill-current" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block text-base font-extrabold">Check your understanding</span>
					<span className="block text-xs text-muted-foreground">
						<QuestionPreview>{question}</QuestionPreview>
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-1 text-sm font-extrabold text-secondary">
					Open <ChevronRightIcon className="size-3.5" />
				</span>
			</button>
		);
	}
	return (
		<button
			type="button"
			data-testid="question-dock-bar"
			onClick={onExpand}
			className="dock-variant flex w-full cursor-pointer items-center gap-2.5 px-4 py-3 text-left text-sm transition-colors hover:bg-muted"
		>
			<span className="shrink-0 text-xs font-extrabold text-muted-foreground">
				{label ??
							toolLabel ??
							(toolName === "quiz" ? "Check" : toolName === "explain" ? "Explain" : "Question")}
			</span>
			<span className="min-w-0 flex-1 text-muted-foreground">
				<QuestionPreview>{question}</QuestionPreview>
			</span>
			<span className="flex shrink-0 items-center gap-1 text-sm font-extrabold text-secondary">
				Answer <ArrowDownIcon className="size-3.5" />
			</span>
		</button>
	);
}

function QuestionDockForm({
	toolName,
	toolCallId,
	input,
	phase = "probe",
	active,
	onSubmit,
	onPrepareSubmission,
	hasPendingInput,
	preparing,
	initialDraft,
	onSaveDraft,
	compactionRunning = false,
	workingRef,
}: Omit<QuestionDockProps, "expanded" | "onExpand" | "reveal">) {
	const kind = toolQuestionKind(toolName);
	const attachments = useAttachmentUploads();
	const controller = useOptionalInteractionLayers();
	const rootRef = useRef<HTMLDivElement>(null);
	const submitButtonRef = useRef<HTMLButtonElement>(null);

	const qd = useMemo<QuestionData>(() => {
		const quizInput = kind === "quiz" ? (input as QuizToolInput) : null;
		const askInput = kind === "ask" ? (input as AskToolInput) : null;
		const explainInput = kind === "explain" ? (input as ExplainToolInput) : null;
		const multi = input instanceof Object && "multiSelect" in input ? input.multiSelect === true : false;
		const mode: QuestionMode =
			kind === "quiz"
				? multi
					? "multi-select"
					: "single-select"
				: askInput?.options?.length
					? multi
						? "multi-select"
						: "single-select"
						: "text";
		const options = normalizeOptions(
			(quizInput?.options ?? askInput?.options ?? []) as { label: string; value?: string }[],
		);
		const ordered = kind === "quiz" && options.length > 0 ? shuffleOptions(options, seededRandom(toolCallId)) : options;
		const q: QuestionData = {
			id: toolCallId,
			kind,
			questionType: kind === "quiz" ? normalizeQuizType((input as { type?: unknown }).type) : undefined,
			question: input.question,
			context: input.details,
			mode,
			options: ordered,
			createdAt: new Date().toISOString(),
		};
		if (quizInput) {
			const resolved = resolveCorrect(quizInput.correctAnswer, ordered);
			if (resolved.error) console.error("[quiz] correctAnswer did not resolve:", resolved.error);
			q.correctIndices = resolved.indices;
			q.explanation = quizInput.explanation;
		}
		if (explainInput) {
			q.committedAnswer = explainInput.correctAnswer;
		}
		return q;
	}, [toolCallId, kind, input]);

	const [sel, setSel] = useState<DockSelection>(() => initialDraft?.selection ?? emptyDockSelection());
	const [other, setOther] = useState(initialDraft?.other ?? "");
	const [text, setText] = useState(initialDraft?.text ?? "");
	useEffect(() => {
		if (workingRef) workingRef.current = (qd.mode === "text" ? text : "").trim();
	}, [workingRef, qd.mode, text]);
	useEffect(() => () => { if (workingRef) workingRef.current = ""; }, [workingRef]);
	const answerTextRef = useRef(initialDraft?.text ?? "");
	const selectMode: SelectMode = qd.mode === "multi-select" ? "multi-select" : "single-select";

	const toggle = (idx: number) => setSel(toggleOption(selectMode, sel, idx));

	const nativeCanSubmit =
		qd.mode === "text"
			? text.trim().length > 0
			: sel.dontKnow || (sel.otherSelected && other.trim().length > 0) || sel.selected.size > 0;

	const canSubmit = !attachments.uploading && (nativeCanSubmit || hasPendingInput?.(qd) === true);
	const formValues = useRef({ sel, other }); formValues.current = { sel, other };
	const currentQuestion = useRef(qd); currentQuestion.current = qd;
	const mounted = useRef(true);
	useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);


	const submit = () => {
		if (!canSubmit || attachments.isUploading() || compactionRunning || preparing) return;
		if (onPrepareSubmission) {
			onPrepareSubmission({ question: qd, isCurrent: () => mounted.current && currentQuestion.current === qd && isInteractionScopeEligible(rootRef.current, controller), capture: captureRequest });
			return;
		}
		doSubmit();
	};
	const captureRequest = (): AnswerRequest => {
		const { sel, other } = formValues.current;
		const req: AnswerRequest = {
			dontKnow: sel.dontKnow,
			values: [...sel.selected].map((i) => qd.options[i]!.value),
			other: sel.otherSelected ? other : undefined,
			text: qd.mode === "text" ? answerTextRef.current : undefined,
		};
		onSaveDraft?.({
			selection: { ...sel, selected: new Set(sel.selected) },
			thinking: "",
			other,
			text: answerTextRef.current,
		});
		return req;
	};
	const doSubmit = () => {
		if (!canSubmit) return;
		onSubmit(buildAnswer(qd, captureRequest(), toolName));
	};

	useEnterSubmits(submit, rootRef);

	const selectOther = () => setSel(toggleOther(selectMode, sel));

	const [kbdIdx, setKbdIdx] = useState<number | null>(null);
	const otherInputRef = useRef<HTMLDivElement>(null);
	const optionCount = qd.mode === "text" ? 0 : qd.options.length;
	const rowCount = qd.mode === "text" ? 0 : optionCount + 1;

	const kbdAct = (idx: number) => {
		if (idx < optionCount) toggle(idx);
		else if (kind === "quiz")
			setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }));
		else {
			if (sel.otherSelected) setSel((prev) => ({ ...prev, otherSelected: false, dontKnow: false }));
			else {
				otherInputRef.current?.focus();
				selectOther();
			}
		}
	};

	const focusRow = (idx: number) => {
		const row = rootRef.current?.querySelector(`[data-kbdrow="${idx}"]`) as HTMLElement | null;
		if (!row) return;
		const el = (row.querySelector("input, [data-file-path-input]") as HTMLElement | null) ?? row;
		el.focus();
	};

	useEffect(() => {
		if (!active || rowCount === 0) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (!isInteractionScopeEligible(rootRef.current, controller)) return;
			const t = e.target as HTMLElement | null;
			const typing =
				!!t &&
				((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") ||
					t.tagName === "TEXTAREA" ||
					t.isContentEditable);
			const modded = e.altKey || e.metaKey || e.ctrlKey;
			if (e.key === "Tab" && !e.shiftKey && !modded) {
				e.preventDefault();
				e.stopPropagation();
				if (t?.closest("[data-kbdrow]")) submitButtonRef.current?.focus();
				else { const index = kbdIdx ?? 0; setKbdIdx(index); focusRow(index); }
				return;
			}
			if (typing || modded) return;
			if (e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min((kbdIdx ?? -1) + 1, rowCount - 1);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max((kbdIdx ?? rowCount) - 1, 0);
				setKbdIdx(next);
				if (t?.closest?.("[data-kbdrow]")) focusRow(next);
			} else if (e.key === " ") {
				if (kbdIdx === null) return;
				e.preventDefault();
				kbdAct(kbdIdx);
			} else if (e.key === "Enter") {
				if (kbdIdx === null || !canSubmit) return;
				e.preventDefault();
				submit();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	useEffect(() => {
		if (kbdIdx === null) return;
		rootRef.current
			?.querySelector(`[data-kbdrow="${kbdIdx}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [kbdIdx]);

	return (
		<div ref={rootRef} data-testid="question-dock">
			{
}
			<div data-dock-scroll-area="" data-session-find-root="" className="max-h-[var(--dock-max-h,55dvh)] overflow-y-auto px-4 pt-3">
				<div className="mb-3 flex items-start gap-3">
				<Owl mood="neutral" size={52} className="-mt-1" />
				<div className="min-w-0 flex-1">
				<div className="mb-1 inline-flex rounded-full bg-secondary-soft px-2.5 py-0.5 text-xs font-extrabold text-secondary">
					{toolName === "probe"
						? "Probe"
						: toolName === "recall"
							? "Recall"
							: kind === "quiz"
								? qd.questionType === "predict"
									? "Prediction"
									: "Check"
									: kind === "explain"
										? "Explain"
											: "Question"}
					{qd.mode === "multi-select" && " · select all that apply"}
				</div>
				<div className="text-lg font-bold leading-snug">
					<ToolContentResponse>{qd.question}</ToolContentResponse>
				</div>
				</div>
				</div>
				{qd.context && (
					<div className="mb-3 text-sm font-medium text-muted-foreground">
						<ToolContentResponse>{qd.context}</ToolContentResponse>
					</div>
				)}

				{qd.mode !== "text" && (
					<div className="flex flex-col gap-2.5 pb-3" role={qd.mode === "multi-select" ? "group" : "radiogroup"}>
						{qd.options.map((opt, i) => {
							const isSel = sel.selected.has(i);
							return (
								<button
									key={opt.value}
									type="button"
									role={qd.mode === "multi-select" ? "checkbox" : "radio"}
									aria-checked={isSel}
									data-kbdrow={i}
									onClick={() => toggle(i)}
									className={cn(
										"flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[15px] font-semibold outline-none transition-[transform,box-shadow,background-color,border-color] duration-100 active:translate-y-[2px] active:shadow-none",
										isSel ? "border-secondary bg-secondary-soft text-secondary shadow-[0_3px_0_var(--secondary)]" : "bg-card shadow-[0_3px_0_var(--border)] hover:bg-muted",
										i === kbdIdx && !isSel && "border-secondary/50 bg-muted",
									)}
								>
									<span
										className={cn(
											"mt-0.5 flex size-5 shrink-0 items-center justify-center border-2",
											qd.mode === "multi-select" ? "rounded-md" : "rounded-full",
											isSel ? "border-secondary bg-secondary text-secondary-foreground" : "border-input",
										)}
									>
										{isSel && (
											qd.mode === "multi-select" ? <CheckIcon className="size-3.5" strokeWidth={3.5} /> : <span className="size-2 rounded-full bg-current" />
										)}
									</span>
									<span>
										<ToolContentResponse>{opt.label}</ToolContentResponse>
										{kind !== "quiz" && opt.description && (
											<ToolContentResponse className="ow-prose block text-xs text-muted-foreground">
												{opt.description}
											</ToolContentResponse>
										)}
									</span>
								</button>
							);
						})}

						{kind === "quiz" && (
							<button
								type="button"
								onClick={() =>
									setSel((prev) => ({ ...prev, selected: new Set(), otherSelected: false, dontKnow: !prev.dontKnow }))
								}
								data-kbdrow={optionCount}
								aria-pressed={sel.dontKnow}
								className={cn(
									"flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-dashed px-4 py-3 text-left text-[15px] font-semibold outline-none transition-colors",
									sel.dontKnow ? "border-secondary bg-secondary-soft text-secondary" : "text-muted-foreground hover:bg-muted",
									kbdIdx === optionCount && !sel.dontKnow && "border-secondary/50 bg-muted",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
										sel.dontKnow
											? "border-secondary bg-secondary text-secondary-foreground"
											: "border-input",
									)}
								>
									{sel.dontKnow && <span className="size-2 rounded-full bg-current" />}
								</span>
								<span>I don't know</span>
							</button>
						)}

						{kind === "ask" && (
							<div
								role={qd.mode === "multi-select" ? "checkbox" : "radio"}
								aria-checked={sel.otherSelected}
								data-testid="other-option"
								data-kbdrow={optionCount}
								onClick={selectOther}
								className={cn(
									"flex cursor-pointer items-start gap-3 rounded-2xl border-2 px-4 py-3 text-left text-[15px] font-semibold outline-none transition-[transform,box-shadow,background-color,border-color] duration-100 active:translate-y-[2px] active:shadow-none",
									sel.otherSelected ? "border-secondary bg-secondary-soft shadow-[0_3px_0_var(--secondary)]" : "border-dashed bg-card hover:bg-muted",
									kbdIdx === optionCount && !sel.otherSelected && "border-secondary/50 bg-muted",
								)}
							>
								<span
									className={cn(
										"mt-0.5 flex size-5 shrink-0 items-center justify-center border-2",
										qd.mode === "multi-select" ? "rounded-md" : "rounded-full",
										sel.otherSelected
											? "border-secondary bg-secondary text-secondary-foreground"
											: "border-input",
									)}
								>
									{sel.otherSelected && (
										qd.mode === "multi-select" ? <CheckIcon className="size-3.5" strokeWidth={3.5} /> : <span className="size-2 rounded-full bg-current" />
									)}
								</span>
								<PathInput
									ref={otherInputRef}
									singleLine
									value={other}
									onValueChange={(value) => {
										setOther(value);
										setSel((prev) => (prev.otherSelected ? prev : toggleOther(selectMode, prev)));
									}}
									onKeyDown={(e) => {
										if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
										if (e.key === "Escape") {
											controller?.claimEscape(e);
											e.preventDefault();
											e.stopPropagation();
											e.currentTarget.blur();
											setKbdIdx(optionCount);
										}
											if (e.key === "Enter") {
												e.preventDefault();
												submit();
											}
									}}
									placeholder="Type your own answer…"
									className="ow-input w-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
									onClick={(e) => e.stopPropagation()}
								/>
							</div>
						)}
					</div>
				)}
			</div>

			{
}

			<form
				className="border-t-2 p-2"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
			>
				<div
					data-testid={qd.mode === "text" ? "answer-field" : undefined}
					className="rounded-2xl border-2 bg-muted/50 transition-colors focus-within:border-secondary focus-within:bg-card"
				>
					{qd.mode === "text" && <div className="px-3 pt-2.5 text-xs font-extrabold text-muted-foreground">Your answer</div>}
					{qd.mode === "text" && (
						<PathInput
							value={text}
							onValueChange={(value) => {
								answerTextRef.current = value;
								setText(value);
							}}
							onKeyDown={(e) => {
								if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
								if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
									e.preventDefault();
									submit();
								}
							}}
							placeholder="Type your answer…"
							className="field-sizing-content ow-input max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-2 outline-none placeholder:text-muted-foreground"
						/>
					)}
					<div className="flex items-center justify-between gap-2 p-1">
						<span aria-hidden className="pl-2 text-xs font-semibold text-muted-foreground">
								{compactionRunning ? "compacting session…" : qd.mode === "text" ? "↵ submits · ⇧↵ newline" : "Select an answer to continue"}
						</span>
						<Button
							ref={submitButtonRef}
							type="submit"
							disabled={!canSubmit || compactionRunning || preparing}
							size="lg"
							className="ml-auto h-11 px-6"
						>
							Submit answer
						</Button>
					</div>
				</div>
			</form>
		</div>
	);
}
