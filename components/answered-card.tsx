"use client";

import { useState } from "react";
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { Owl, type OwlMood } from "@/components/owl/owl";
import { SubmittedImages } from "./submitted-images";
import { ThinkingBlock } from "@/components/thinking-block";
import { PathText } from "@/components/file-path-chip";
import { cn } from "@/lib/utils";
import { ToolContentResponse } from "@/components/ai-elements/message";
import type { QuestionAnswerData } from "@/src/core";
import { answerForPresentation, parseAskInput, parseQuizInput } from "@/src/core";

export function AnsweredCard({ answer: savedAnswer, input }: { answer: QuestionAnswerData; input?: unknown }) {
	const answer = answerForPresentation(savedAnswer, input);
	const [whyOpen, setWhyOpen] = useState(false);
	if (answer.dismissed) {
		return (
			<div className="rounded-2xl border-2 bg-card px-4 py-3 text-sm text-muted-foreground">
				<span className="font-bold">{answer.questionText}</span> — skipped
			</div>
		);
	}

	const isQuiz = answer.kind === "quiz";
	const isExplain = answer.kind === "explain";
	const selectedIdx = new Set(answer.answers.map((a) => a.index));
	const correctIdx = new Set(answer.correctIndices ?? []);
	const askInput = answer.kind === "ask" ? parseAskInput(input) : undefined;
	const parsedDetails = askInput?.details ?? (answer.kind === "quiz" ? parseQuizInput(input)?.details : undefined);
	const descByIndex = new Map((askInput?.options ?? []).map((o, i) => [i + 1, o.description]));

	const verdict: { mood: OwlMood; label: string; tone: string } | null = !isQuiz
		? null
		: answer.dontKnow
			? { mood: "neutral", label: "Didn't know", tone: "bg-muted text-muted-foreground" }
			: answer.correct
				? { mood: "happy", label: "Correct", tone: "bg-success-soft text-success" }
				: { mood: "unimpressed", label: "Incorrect", tone: "bg-error-soft text-error" };

	return (
		<>
		{
}
		{(answer.readingThinking || answer.images?.readingThinking?.length) && (
			<ThinkingBlock testId="reading-thinking-block" label="Your thinking" text={answer.readingThinking ?? ""} images={answer.images?.readingThinking} defaultOpen />
		)}
		{
}
		<div
			className="ow-card-enter overflow-hidden rounded-2xl border-2 bg-card text-card-foreground"
			data-testid="answered-card"
		>
			{verdict && (
				<div
					data-testid="answer-verdict"
					data-verdict={answer.dontKnow ? "dont-know" : answer.correct ? "correct" : "incorrect"}
					className={cn("ow-pop-in flex items-center gap-3 px-4 py-2.5", verdict.tone)}
				>
					<Owl mood={verdict.mood} size={44} />
					<span className="text-lg font-extrabold">{verdict.label}</span>
				</div>
			)}
			<div className="p-4 [&>*:last-child]:mb-0">
			<div className="mb-1.5 flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
				{
}
				{answer.tool === "probe"
					? "Probe"
					: answer.tool === "recall"
						? "Recall"
						: isQuiz
								? answer.questionType === "predict"
									? "Prediction"
									: "Check"
									: isExplain
										? "Explain"
											: "Question"}
			</div>
			<div className="mb-3 text-base font-bold">
				<ToolContentResponse>{answer.questionText}</ToolContentResponse>
			</div>
			{parsedDetails && (
				<div className="mb-3 text-sm text-muted-foreground">
					<ToolContentResponse>{parsedDetails}</ToolContentResponse>
				</div>
			)}

			{((answer.options?.length ?? 0) > 0 || answer.other) && (
				<div className="flex flex-col gap-2 text-sm">
					{answer.options?.map((opt) => {
						const sel = selectedIdx.has(opt.index);
						const key = isQuiz && correctIdx.has(opt.index);
						return (
							<div
								key={opt.index}
								className={cn(
									"flex items-center gap-2.5 rounded-xl border-2 px-3 py-2 font-semibold",
									sel && key && "border-success bg-success-soft",
									sel && !key && isQuiz && "border-error bg-error-soft",
									sel && !isQuiz && "border-secondary bg-secondary-soft",
									!sel && key && "border-success/60",
								)}
							>
								{isQuiz && (
									<span
										aria-hidden
										data-mark={sel && key ? "check" : sel && !key ? "x" : !sel && key ? "check" : undefined}
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-full text-white",
											key && "bg-success",
											sel && !key && "bg-error",
											!sel && !key && "border-2 border-border",
										)}
									>
										{key ? <CheckIcon className="size-3.5" strokeWidth={3.5} /> : sel ? <XIcon className="size-3.5" strokeWidth={3.5} /> : null}
									</span>
								)}
								<span className={cn(!sel && "text-muted-foreground")}>
									<ToolContentResponse>{opt.label}</ToolContentResponse>
									{descByIndex.get(opt.index) && (
										<ToolContentResponse className="ow-prose block text-xs text-muted-foreground">
											{descByIndex.get(opt.index)}
										</ToolContentResponse>
									)}
								</span>
							</div>
						);
					})}
					{
}
					{answer.other && (
						<div
							data-testid="answered-other"
							className="flex items-center gap-2 rounded-xl border-2 border-secondary bg-secondary-soft px-3 py-2 font-semibold"
						>
							<span>“<PathText text={answer.other} />”</span>
						</div>
					)}
				</div>
			)}

			{answer.text && <div className="ow-prose mt-2 whitespace-pre-wrap">“<PathText text={answer.text} />”</div>}
			<SubmittedImages images={answer.images?.answer} />

			{
}
			{answer.dontKnow && isQuiz && (
				<div className="mt-2 text-sm text-muted-foreground">Answered “I don't know”.</div>
			)}

			{((answer.thinking ?? answer.note) || answer.images?.thinking?.length) && (
				<ThinkingBlock
					testId="your-thinking"
					label="Your thinking"
					text={answer.thinking ?? answer.note ?? ""}
					images={answer.images?.thinking}
					inCard
				/>
			)}

			{
}
			{isQuiz && answer.explanation && (
				<div className="mt-2" data-testid="tucked-explanation">
					<button
						type="button"
						onClick={() => setWhyOpen((v) => !v)}
						className="rounded-lg px-2 py-1 text-xs font-extrabold text-secondary transition-colors hover:bg-secondary-soft"
					>
						{whyOpen ? "Hide why" : "Why"}
					</button>
					{whyOpen && (
						<div className="mt-1.5 rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground/80">
							<span className="font-extrabold text-foreground">Why: </span>
							{
}
							<ToolContentResponse className="inline [&>p:first-child]:inline [&>p:first-child]:m-0">{answer.explanation}</ToolContentResponse>
						</div>
					)}
				</div>
			)}

			{
}
			{isExplain && answer.committed && (
				<div className="mt-3 rounded-xl bg-muted px-3 py-2.5 text-sm text-foreground/80">
					<span className="font-extrabold text-foreground">The answer: </span>
					<ToolContentResponse className="inline [&>p:first-child]:inline [&>p:first-child]:m-0">{answer.committed}</ToolContentResponse>
				</div>
			)}
			</div>
		</div>
		</>
	);
}
