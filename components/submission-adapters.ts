import type { AnswerRequest,QuestionData } from "../src/core/index.ts";
export interface BuiltinSubmissionCapture { question: QuestionData; capture(): AnswerRequest; isCurrent(): boolean }
export type PrepareBuiltinSubmission = (capture: BuiltinSubmissionCapture) => void;
export type PrepareThinkingSubmission = (capture: () => string, onAccepted: (captured: string) => void) => void;
