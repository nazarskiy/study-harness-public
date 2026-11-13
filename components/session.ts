"use client";


import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { ChatInput, OwllyMessage, QuestionAnswerData } from "@/src/core";
import { SessionModel, type SessionState } from "@/components/session-core";

export interface UseChatSessionOptions {
	chatId: string;
	initialMessages: OwllyMessage[];
	initialError?: string;
	initiallyInFlight?: boolean;
}

export function useChatSession({ chatId, initialMessages, initialError, initiallyInFlight }: UseChatSessionOptions) {
	const modelRef = useRef<SessionModel | null>(null);
	if (modelRef.current === null) {
		modelRef.current = new SessionModel({ chatId, initialMessages, initialError });
	}
	const model = modelRef.current;
	const [version, bump] = useReducer((n: number) => n + 1, 0);
	useEffect(() => {
		model.onChange = bump;
		return () => {
			model.onChange = undefined;
		};
	}, [model, bump]);

	useEffect(() => {
		if (initiallyInFlight) void model.resumeStream(false);
		return () => {
			model.stop();
		};
	}, [initiallyInFlight, model]);

	const state = useMemo<SessionState>(() => model.getState(), [model, version] as const);

	const prevStatusRef = useRef(state.status);
	useEffect(() => {
		const was = prevStatusRef.current;
		prevStatusRef.current = state.status;
		if (was === state.status) return;
		const running = state.status === "submitted" || state.status === "streaming";
		const wasRunning = was === "submitted" || was === "streaming";
		if (running === wasRunning) return;
		window.dispatchEvent(new CustomEvent("owlly:turn-state", { detail: { id: chatId, running } }));
	}, [state.status, chatId]);

	const setReattachSettled = useCallback(
		(fn: () => void) => {
			model.setReattachSettled(fn);
		},
		[model],
	);

	const send = useCallback((input: ChatInput, onAccepted?: () => void, questionKey?: string, onDeliverySettled?: () => void) => model.send(input, onAccepted, questionKey, onDeliverySettled), [model]);
	const continueIfOwed = useCallback((record: readonly OwllyMessage[]) => void model.continueIfOwed(record), [model]);
	const steer = useCallback((text: string, images?: import("@/src/core").PluginSubmissionContent["images"], onAccepted?: () => void, onDeliverySettled?: () => void) => model.steer(text, images, onAccepted, onDeliverySettled), [model]);
	const submitAnswer = useCallback(
		(tool: string, toolCallId: string, output: QuestionAnswerData, questionKey?: string) =>
			void model.submitAnswer(tool, toolCallId, output, questionKey),
		[model],
	);
	const dismissQuestion = useCallback(
		(toolCallId: string, answer: QuestionAnswerData, questionKey?: string) => void model.dismissQuestion(toolCallId, answer, questionKey),
		[model],
	);
	const dismissProblem = useCallback(
		(problemCallId: string) => void model.dismissProblem(problemCallId),
		[model],
	);
	const questionDraft = useCallback((questionKey: string) => model.questionDraft(questionKey), [model]);
	const saveQuestionDraft = useCallback((questionKey: string, draft: Parameters<SessionModel["saveQuestionDraft"]>[1]) => model.saveQuestionDraft(questionKey, draft), [model]);
	const setMessages = useCallback((record: OwllyMessage[], turnError?: string, availability?: Parameters<SessionModel["setMessages"]>[2], problemAvailability?: Parameters<SessionModel["setMessages"]>[3]) => model.setMessages(record, turnError, availability, problemAvailability), [model]);
	const reconcile = useCallback(() => model.reconcile(), [model]);
	const readRecord = useCallback((options?: Parameters<SessionModel["readRecord"]>[0]) => model.readRecord(options), [model]);
	const pluginProblemDraft = useCallback((snapshot: Parameters<SessionModel["pluginProblemDraft"]>[0]) => model.pluginProblemDraft(snapshot), [model]);
	const pluginQuestionDraft = useCallback((snapshot: Parameters<SessionModel["pluginQuestionDraft"]>[0]) => model.pluginQuestionDraft(snapshot), [model]);
	const dismissPluginQuestion = useCallback((occurrence: Parameters<SessionModel["dismissPluginQuestion"]>[0], questionId?: string) => model.dismissPluginQuestion(occurrence, questionId), [model]);
	const adoptRecord = useCallback((record: OwllyMessage[]) => model.adoptRecord(record), [model]);
	const stop = useCallback(() => model.stop(), [model]);
	const clearError = useCallback(() => model.clearError(), [model]);
	const resumeStream = useCallback(() => void model.resumeStream(), [model]);

	return {
		messages: state.messages,
		nativeMessages: state.nativeMessages,
		canonicalMessages: state.canonicalMessages,
		reconciliation: state.reconciliation,
		reconcile,
		readRecord,
		pluginQuestionAvailability: state.pluginQuestionAvailability,
		pluginProblemAvailability: state.pluginProblemAvailability,
		pluginProblemDraft,
		pluginQuestionDraft,
		dismissPluginQuestion,
		hasConfirmedConversation: state.hasConfirmedConversation,
		contextTokens: state.contextTokens,
		status: state.status,
		evaluating: state.evaluating,
		error: state.error,
		steerQueue: state.steerQueue,
		send,
		continueIfOwed,
		steer,
		submitAnswer,
		dismissQuestion,
		dismissProblem,
		questionDraft,
		saveQuestionDraft,
		setMessages,
		adoptRecord,
		stop,
		clearError,
		resumeStream,
		setReattachSettled,
	};
}
