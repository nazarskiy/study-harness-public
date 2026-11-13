"use client";

import { useAttachmentUploads } from "@/components/file-path-drop-zone";

import { AttachFilesButton } from "@/components/attach-files-button";

import { AbortTurnDialog,type AbortMode } from "@/components/abort-turn-dialog";
import {
Conversation,
ConversationContent,
ConversationEmptyState,
ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message,MessageContent,MessageResponse } from "@/components/ai-elements/message";
import { Reasoning,ReasoningContent,ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { AnsweredCard } from "@/components/answered-card";
import { SubagentSteerCard } from "@/components/artifacts/steer-card";
import { createCiteAction,type CitationEditTarget } from "@/components/citation-actions";
import { CitationActionsContext,type CitationActions } from "@/components/citation-chip";
import { CitationCommentPopover } from "@/components/citation-comment-popover";
import { revealCitationSource } from "@/components/citation-source";
import {
CompactionCutDivider,
CompactionMomentDivider,
type CompactionDividerData,
} from "@/components/compaction-divider";
import { ChatSessionComposer } from "@/components/composer";
import { forwardDockWheel,useDockHeight } from "@/components/dock-height";
import { createDockMorph } from "@/components/dock-morph";
import { dockStateKey } from "@/components/dock-state-key";
import { useEnterSubmits } from "@/components/enter-submits";
import { CoverageRing } from "@/components/extraction-coverage";
import { useFieldCycle } from "@/components/field-cycle";
import { PathText } from "@/components/file-path-chip";
import { blurAfterPointerClick } from "@/components/focus-hygiene";
import { GraphContextCard,type GraphContextData } from "@/components/graph-context-card";
import { JobsContext } from "@/components/jobs-context";
import { MalformedQuestion } from "@/components/malformed-question";
import { clearOpeningPrompt,OPENING_PROMPT_FAILURE,readOpeningPromptEntry,stashOpeningPrompt } from "@/components/opening-prompt";
import { Owl,type OwlMood } from "@/components/owl/owl";
import { OwlBusy } from "@/components/owl/owl-busy";
import { PhaseChip,PhaseDivider } from "@/components/phase-divider";
import { latestTree,PlanBlock,PlanPopup } from "@/components/plan-block";
import { planExists,PlanMarginalia } from "@/components/plan-window";
import { ProblemCard,ThinkingCard,type PracticeThinkingData } from "@/components/practice-cards";
import { PracticeDock } from "@/components/practice-dock";
import { QuestionDock } from "@/components/question-dock";
import { QueuedSteersBody,type QueuedSteerLine } from "@/components/queued-steers";
import { SelectionToolbar } from "@/components/selection-toolbar";
import { useServerEvent,useServerResync } from "@/components/server-events";
import { useChatSession } from "@/components/session";
import { visibleQueuedSteers } from "@/components/session-core";
import { SessionFind } from "@/components/session-find";
import { SessionMessageNavigation } from "@/components/session-navigation";
import { MermaidOverlay,SessionMermaidContext,type SessionImage } from "@/components/session-overlay";
import { openModelPicker,selectedModelUnavailable,useModelSetup,ZeroKeysPill } from "@/components/setup-cta";
import { SetupDialog } from "@/components/setup-dialog";
import { createSideQuestionActions,SideThreadBody,SideThreadPanel,SideThreadPopover } from "@/components/side-thread";
import { StatsBar } from "@/components/stats-bar";
import { currentUserThinkingOpen,setAllUserThinkingOpen } from "@/components/thinking-block";
import { ToolPartRenderer } from "@/components/tool-renderers";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { ArrowRightIcon,DumbbellIcon,MessageCircleQuestionIcon,WaypointsIcon } from "@/components/ui/icons";
import { Separator } from "@/components/ui/separator";
import { useSideThread } from "@/components/use-side-thread";
import type { JobRecord,OwllyViewMessage,Phase3,PlanBlockData,QuestionAnswerData,QuestionFormDraft,SessionPricing,TurnUsage } from "@/src/core";
import {
activeProblemOccurrenceOf,activeProblemOf,buildAnswer,cliContextWindowOf,dismissedAnswer,
endsInFailedTurn,
findPendingToolCall,firstSourceTextParts,isProviderKeyRefusal,kbdEventForAction as kbdEventForChat,malformedQuestionsOf,messageAnchorId,pendingQuestionOf,phaseAt3,
phaseTimeline,practiceProblemForCall,questionNeedsReveal,sideEntryPoints,
teachStepIndex,textPartMessageId,toolQuestionKind,type ChatInput,type ModelSlotName,type OwllyMessage,type QuestionData
} from "@/src/core";
import { usePathname,useRouter } from "next/navigation";
import { createContext,Fragment,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from "react";
import { useStickToBottomContext,type StickToBottomContext } from "use-stick-to-bottom";
import { composingQuestionKey } from "./input-keys";
import { isInteractionScopeEligible } from "./interaction-focus";
import { useOptionalInteractionLayers } from "./interaction-layers";
import { scheduleOpeningSubmission } from "./opening-submission";
import type { BuiltinSubmissionCapture,PrepareBuiltinSubmission,PrepareThinkingSubmission } from "./submission-adapters";
import { SubmissionModelEpoch,SubmissionRunner,type SubmissionAttempt } from "./submission-runner";
import { SubmittedImages } from "./submitted-images";

const COLUMN = "mx-auto w-full max-w-none px-6";
const DOCK = "mx-auto w-full max-w-[46rem] px-4";
const DOCK_W = 46 * 16;
const MARGIN_GAP = 16;
const MARGIN_MIN_W = 220;
const GRADIENT_H = 96;
const COLLAPSE_DIST = 96;
const EXPAND_DIST = 16;

export const ChatActionsContext = createContext<{
	chatId: string;
	syncFromServer: () => Promise<void>;
	sendText: (text: string) => void;
	openSetup: () => void;
} | null>(null);

export function parseModelsRefusal(message: string | undefined): ModelSlotName[] | null {
	if (!message) return null;
	try {
		const body = JSON.parse(message) as { code?: unknown; missing?: unknown };
		if (body.code === "models_not_configured" && Array.isArray(body.missing)
			&& body.missing.every((s) => typeof s === "string")) {
			return body.missing as ModelSlotName[];
		}
		return null;
	} catch {
		return null;
	}
}

export function parseProviderKeyRefusal(message: string | undefined): boolean {
	if (!message) return false;
	try {
		const body = JSON.parse(message) as { code?: unknown; error?: unknown };
		return body.code === "provider_key_missing" && typeof body.error === "string" && isProviderKeyRefusal(body.error);
	} catch {
		return false;
	}
}

export function retryFailedResponse(
	send: (input: ChatInput) => void,
	submittedDraft: { current: string | null },
): void {
	submittedDraft.current = null;
	void send({ type: "retry" });
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function SystemLine({ children, testId }: { children: React.ReactNode; testId?: string }) {
	return (
		<div
			data-testid={testId}
			className="flex items-center justify-center gap-1.5 py-1 text-xs font-bold text-muted-foreground"
		>
			{children}
		</div>
	);
}

export function PendingTurnIndicator({ evaluating }: { evaluating: boolean }) {
	return (
		<div className="flex items-center gap-3">
			<TeacherAvatar mood="talking" />
			<span className="flex items-center gap-2.5 rounded-2xl rounded-tl-md border-2 bg-card px-4 py-2.5 text-sm font-bold text-muted-foreground">
				<OwlBusy label={evaluating ? "Evaluating" : "Thinking"} />
				<Shimmer duration={1.4}>{evaluating ? "Owlly is evaluating…" : "Owlly is thinking…"}</Shimmer>
			</span>
		</div>
	);
}

function TeacherAvatar({ mood }: { mood: OwlMood }) {
	return (
		<div data-testid="teacher-avatar" className="flex size-11 shrink-0 items-center justify-center rounded-2xl border-2 bg-card">
			<Owl mood={mood} size={34} />
		</div>
	);
}

function isSubagentSteer(m: OwllyViewMessage): boolean {
	return (m.metadata as { subagentResult?: unknown } | undefined)?.subagentResult != null;
}

export function Chat({
	chatId,
	title,
	initialMessages,
	initialError,
	initialPrompt,
	initiallyInFlight,
	initiallyCompacting = false,
	initialConfigured = false,
	kind = "teach",
}: {
	chatId: string;
	title: string;
	initialMessages: OwllyMessage[];
	initialError?: string;
	kind?: "teach" | "practice";
	initialPrompt?: string;
	initiallyInFlight?: boolean;
	initiallyCompacting?: boolean;
	initialConfigured?: boolean;
}) {
	const reattachSettledRef = useRef<() => void>(() => {});

	const { reconciliation, reconcile, readRecord, messages, nativeMessages, hasConfirmedConversation, contextTokens, send, continueIfOwed, steer, steerQueue, submitAnswer, dismissQuestion, dismissProblem, questionDraft, saveQuestionDraft, status, evaluating, error, stop, clearError, resumeStream, setReattachSettled } =
		useChatSession({ chatId, initialMessages, initialError, initiallyInFlight });

	const controller = useOptionalInteractionLayers();
	const sessionFindScopeRef = useRef<HTMLDivElement | null>(null);
	const pathname = usePathname();
	const [, submissionChanged] = useState(0);
	const [preparationError, setPreparationError] = useState<string>();
	const [submissionRunner] = useState(() => new SubmissionRunner(() => submissionChanged(n => n + 1)));
	const [submissionModel] = useState(() => new SubmissionModelEpoch());
	const submissionMounted = useRef(true);
	useEffect(() => { submissionMounted.current = true; return () => { submissionMounted.current = false; submissionRunner.dispose(); }; }, [submissionRunner]);
	const submissionLive = useRef({ nativeMessages, pathname, ready: true });
	submissionLive.current = { nativeMessages, pathname, ready: true };
	const attachments = useAttachmentUploads();
	const runSubmission = async <T,>(capture: () => T | Promise<T>, current: () => boolean, deliver: (prepared: T, attempt: SubmissionAttempt) => Promise<boolean>): Promise<boolean> => {
		if (attachments.isUploading()) return false;
		const modelRevision = submissionModel.capture();
		const attempt = submissionRunner.begin(() => !attachments.isUploading() && submissionMounted.current && submissionModel.isCurrent(modelRevision) && submissionLive.current.pathname === pathname && current());
		if (!attempt) return false;
		setPreparationError(undefined);
		try {
			const prepared = await attempt.finalize(capture);
			attempt.check();
			const accepted = await deliver(prepared, attempt);
			if (!accepted) attempt.refused();
			return accepted;
		} catch (error) {
			attempt.cancel(); attempt.refused();
			if (!(error instanceof DOMException && error.name === "AbortError")) setPreparationError(attempt.preparationFailure(error).message);
			return false;
		}
	};
	const scrollContextRef = useRef<StickToBottomContext | null>(null);
	const sourceTextParts = useMemo(() => firstSourceTextParts(messages), [messages]);
	const sideEntries = useMemo(() => sideEntryPoints(nativeMessages, messages), [nativeMessages, messages]);

	setReattachSettled(() => reattachSettledRef.current());

	const [turnInFlight, setTurnInFlight] = useState(initiallyInFlight ?? false);

	const [titleText, setTitleText] = useState(title);
	const [renaming, setRenaming] = useState(false);
	const [titleDraft, setTitleDraft] = useState("");
	const titleInputRef = useRef<HTMLInputElement | null>(null);

	const commitRename = useCallback(
		async (next: string) => {
			setRenaming(false);
			const t = next.trim();
			if (t === "" || t === titleText) return;
			try {
				const res = await fetch(`/api/chats/${chatId}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: t }),
				});
				if (!res.ok) throw new Error(`rename failed: ${res.status}`);
				setTitleText(t);
				window.dispatchEvent(
					new CustomEvent("owlly:chat-renamed", { detail: { id: chatId, title: t } }),
				);
			} catch (err) {
				console.error("rename failed:", err);
			}
		},
		[chatId, titleText],
	);

	useEffect(() => {
		if (renaming) {
			const el = titleInputRef.current;
			if (el) {
					el.focus();
					el.select();
			}
		}
	}, [renaming]);

	useEffect(() => {
		const onRename = () => {
			if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller)) return;
			setTitleDraft(titleText);
			setRenaming(true);
		};
		window.addEventListener("owlly:kbd-rename-session", onRename);
		return () => window.removeEventListener("owlly:kbd-rename-session", onRename);
	}, [titleText, controller]);

	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			if (id === chatId) setTitleText((prev) => (title !== prev ? title : prev));
		};
		window.addEventListener("owlly:chat-renamed", onRenamed);
		return () => window.removeEventListener("owlly:chat-renamed", onRenamed);
	}, [chatId]);

	const abortInFlightTurn = useCallback(() => {
		if (localStreamRef.current) stop();
		void fetch("/api/activity/abort", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "turn", id: chatId }),
		}).catch(() => {
		});
	}, [chatId, stop]);
	const [abortAsk, setAbortAsk] = useState<AbortMode | null>(null);
	const abortAskRef = useRef<AbortMode | null>(null);
	abortAskRef.current = abortAsk;
	const closeAbortAsk = useCallback(() => setAbortAsk(null), []);
	useEffect(() => {
		const onAbort = () => {
			if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller)) return;
			const target = escAbortTarget({
				abortAsk: abortAskRef.current !== null,
				sideThread: sideThreadOpenRef.current,
				mermaidFocus: mermaidFocusRef.current !== null || figureFocusRef.current !== null,
				planOpen: planOpenRef.current,
				setupOpen: setupOpenRef.current,
				pending: pendingRef.current !== null,
				problem: activeProblemRef.current !== null,
				busy: busyRef.current,
			});
			if (target === "side-thread") closeSideThreadRef.current();
			else if (target === "question") setAbortAsk("question");
			else if (target === "problem") setAbortAsk("problem");
			else if (target === "turn") setAbortAsk("turn");
			else if (target === "mermaid") setMermaidFocus(null);
			else if (target === "plan") setPlanOpen(false);
		};
		window.addEventListener("owlly:kbd-abort-turn", onAbort);
		return () => window.removeEventListener("owlly:kbd-abort-turn", onAbort);
	}, [controller]);
	const confirmAbort = useCallback(
		(mode: AbortMode) => {
			closeAbortAsk();
			if (mode === "turn") {
				abortInFlightTurn();
				return;
			}
			const p = pendingRef.current;
			if (p) {
				const question = (p.input as { question?: string } | null)?.question ?? "";
				const reading = readingThinkingRef.current.trim() || undefined;
				clearReadingThinking();
				void closeSideThreadRef.current();
				const answer = dismissedAnswer(toolQuestionKind(p.tool), question);
				void dismissQuestion(
					p.toolCallId,
					reading ? { ...answer, readingThinking: reading } : answer,
					p.key,
				);
				if (busyRef.current) abortInFlightTurn();
				return;
			}
			const problem = activeProblemRef.current;
			if (problem) {
				void dismissProblem(problem.toolCallId);
				if (busyRef.current) abortInFlightTurn();
			}
		},
		[abortInFlightTurn, dismissQuestion, dismissProblem, closeAbortAsk],
	);
	const mountContinuation = useRef(false);
	useEffect(() => {
		if (mountContinuation.current) return;
		mountContinuation.current = true;
		if (!turnInFlight) continueIfOwed(initialMessages);
	}, []);

	const pending = findPendingToolCall(messages, pendingQuestionOf(nativeMessages));
	const malformedQuestions = malformedQuestionsOf(nativeMessages);
	const pendingRef = useRef(pending);
	pendingRef.current = pending;

	const activeProblem = activeProblemOf(nativeMessages);
	const activeProblemOccurrence = activeProblemOccurrenceOf(nativeMessages);
	const activeProblemRef = useRef(activeProblem);
	activeProblemRef.current = activeProblem;

	const localStream = status === "submitted" || status === "streaming";
	const busy = localStream || turnInFlight || reconciliation !== "ready";
	const busyRef = useRef(busy);
	busyRef.current = busy;
	useEffect(() => {
		if (turnInFlight && (status === "submitted" || status === "streaming")) setTurnInFlight(false);
	}, [status, turnInFlight]);

	const turnInFlightRef = useRef(turnInFlight);
	turnInFlightRef.current = turnInFlight;
	const attachToRunningTurn = useCallback(() => {
		setTurnInFlight(true);
		void resumeStream();
	}, [resumeStream]);

	const submitThinking = useCallback(
		(text: string) => {
			const problem = activeProblemRef.current;
			if (!problem) return;
			void send({ type: "thinking", problemCallId: problem.toolCallId, text });
		},
		[send],
	);

	const requiresReveal = pending !== null && questionNeedsReveal(pending.tool, pending.input, phaseAt3(messages));

	const readingThinkingRef = useRef("");

	useEffect(() => {
		const onToggle = () => {
			if (isInteractionScopeEligible(sessionFindScopeRef.current, controller)) setAllUserThinkingOpen(!currentUserThinkingOpen());
		};
		window.addEventListener(kbdEventForChat("toggle-user-thinking"), onToggle);
		return () => window.removeEventListener(kbdEventForChat("toggle-user-thinking"), onToggle);
	}, [controller]);
	const clearReadingThinking = useCallback(() => { readingThinkingRef.current = ""; }, []);

	const phases = useMemo(() => phaseTimeline(messages), [messages]);

	const [composerDraftRevision, setComposerDraftRevision] = useState(0);
	const textRef = useRef("");
	const composerEditRevision = useRef(0);
	const applyText = useCallback((v: string) => {
		textRef.current = v; composerEditRevision.current++;
		setComposerDraftRevision((revision) => revision + 1);
	}, []);
	const recordComposerText = useCallback((v: string) => {
		textRef.current = v; composerEditRevision.current++;
	}, []);
	const { catalog, configured, zeroKeys } = useModelSetup(initialConfigured);
	const catalogRef = useRef(catalog);
	catalogRef.current = catalog;
	const [selectedModel, setSelectedModel] = useState<string | undefined>();
	const recordSelectedModel = useCallback((model: string | undefined) => { submissionModel.observe(model); setSelectedModel(model); }, [submissionModel]);
	const [setupOpen, setSetupOpen] = useState(false);
	const draftRef = useRef<string | null>(null);
	const openingDraftRef = useRef<string | null>(null);
	const [openingError, setOpeningError] = useState(false);
	const openingMountedRef = useRef(false);
	useEffect(() => {
		openingMountedRef.current = true;
		return () => { openingMountedRef.current = false; };
	}, []);

	const prepareBuiltin: PrepareBuiltinSubmission = ({ question, capture, isCurrent }: BuiltinSubmissionCapture) => {
		const original = pending;
		if (!original || busyRef.current || compacting) return;
		void runSubmission(capture, () => {
			const now = pendingQuestionOf(submissionLive.current.nativeMessages);
			return isCurrent() && !busyRef.current && now?.messageId === original.messageId && now.contentIndex === original.contentIndex && now.toolCallId === original.toolCallId && now.tool === original.tool;
		}, async (raw, attempt) => {
			const answer = buildAnswer(question, raw, original.tool);
			saveQuestionDraft(original.key, { readingThinking: readingThinkingRef.current });
			attempt.deliver();
			return send({ type: "answer", toolCallId: original.toolCallId, occurrence: { messageId: original.messageId, contentIndex: original.contentIndex, toolCallId: original.toolCallId, toolName: original.tool }, answer }, attempt.accepted, original.key, attempt.refused);
		});
	};
	const prepareThinking: PrepareThinkingSubmission = (capture, clear) => {
		const occurrence = activeProblemOccurrenceOf(nativeMessages);
		if (!occurrence || !activeProblem || busyRef.current || compacting) return;
		void runSubmission(capture, () => !busyRef.current && JSON.stringify(activeProblemOccurrenceOf(submissionLive.current.nativeMessages)) === JSON.stringify(occurrence), async (text, attempt) => {
			if (!text.trim()) { attempt.cancel(); return false; }
			attempt.deliver();
			return send({ type: "thinking", problemCallId: occurrence.toolCallId, occurrence, text }, () => { clear(text); attempt.accepted(); }, undefined, attempt.refused);
		});
	};
	const prepareText = (supplied?: string, openingAccepted?: () => void, beforePost?: (captured: string) => boolean) => {
		if (pendingRef.current || activeProblemRef.current || compacting) return Promise.resolve(false);
		if (!busyRef.current && zeroKeys) { setSetupOpen(true); return Promise.resolve(false); }
		if (!busyRef.current && selectedModelUnavailable(catalog, selectedModel)) { openModelPicker(); return Promise.resolve(false); }
		let capturedRevision = 0;
		return runSubmission(() => { capturedRevision = composerEditRevision.current; return supplied ?? textRef.current.trim(); }, () => submissionLive.current.ready && !pendingQuestionOf(submissionLive.current.nativeMessages) && !activeProblemOf(submissionLive.current.nativeMessages), async (text, attempt) => {
			if (!text.trim()) { attempt.cancel(); return false; }
			if (beforePost && !beforePost(text)) { attempt.cancel(); return false; }
			draftRef.current = text;
			const accepted = () => { if (composerEditRevision.current === capturedRevision && textRef.current.trim() === text) applyText(""); openingAccepted?.(); attempt.accepted(); };
			attempt.deliver();
			if (busyRef.current) return steer(text, undefined, accepted, attempt.refused);
			return send({ type: "text", text }, accepted, undefined, attempt.refused);
		});
	};

	const deliverOpeningPrompt = (prompt: string, captureNative = false) => {
		let submitted = prompt;
		openingDraftRef.current = prompt;
		if (!stashOpeningPrompt(chatId, prompt, true)) {
			applyText(prompt);
			setOpeningError(true);
			return;
		}
		setOpeningError(false);
		draftRef.current = prompt;
		void prepareText(captureNative ? undefined : prompt, () => {
			clearOpeningPrompt(chatId);
			openingDraftRef.current = null;
			if (draftRef.current === submitted) draftRef.current = null;
		}, captured => {
			submitted = captured; openingDraftRef.current = captured;
			const saved = stashOpeningPrompt(chatId, captured, true);
			if (!saved) setOpeningError(true);
			return saved;
		}).then(accepted => {
			if (!accepted && openingMountedRef.current && openingDraftRef.current === prompt && !textRef.current) {
				applyText(prompt);
			}
		});
	};

	const sentInitial = useRef(false);
	useEffect(() => {
		if (sentInitial.current || pathname !== `/chat/${encodeURIComponent(chatId)}`) return;
		return scheduleOpeningSubmission(
			() => !sentInitial.current && submissionMounted.current && submissionLive.current.pathname === pathname,
			() => {
				sentInitial.current = true;
				const entry = readOpeningPromptEntry(chatId);
				const prompt = initialPrompt || entry?.text;
				if (!initialPromptOwed(initialMessages, prompt)) {
					if (initialMessages.some(m => m.role === "user" || m.role === "assistant")) clearOpeningPrompt(chatId);
					return;
				}
				openingDraftRef.current = prompt!;
				if (entry?.attempted || initiallyInFlight) {
					applyText(prompt!);
					return;
				}
				deliverOpeningPrompt(prompt!);
			},
		);
	}, [chatId, initialPrompt, initialMessages, initiallyInFlight, pathname, deliverOpeningPrompt, applyText]);

	useEffect(() => {
		if (!hasConfirmedConversation) return;
		clearOpeningPrompt(chatId);
		const opening = openingDraftRef.current;
		if (opening !== null && textRef.current === opening) applyText("");
		if (draftRef.current === opening) draftRef.current = null;
		openingDraftRef.current = null;
		setOpeningError(false);
	}, [chatId, hasConfirmedConversation, applyText]);

	useEffect(() => {
		if (!error) return;
		const missing = parseModelsRefusal(error.message);
		const keyRefused = parseProviderKeyRefusal(error.message);
		if (!missing && !keyRefused) return;
		let cancelled = false;
		void (async () => {
			try { await readRecord({ isCurrent: () => !cancelled }); }
			catch {  }
			if (cancelled) return;
			if (draftRef.current !== null) {
				if (!textRef.current) applyText(draftRef.current);
				draftRef.current = null;
			}
			clearError();
			if (keyRefused && catalogRef.current?.providers.some((p) => p.keyPresent)) openModelPicker();
			else setSetupOpen(true);
		})();
		return () => {
			cancelled = true;
		};
	}, [error, chatId, readRecord]);
	const cycleChatFields = useCallback((): readonly HTMLElement[] => {
		const pick = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
		return [
			...pick('[data-testid="question-dock"] [data-file-path-input]'),
			...pick('[data-testid="practice-dock"] [data-file-path-input]'),
			...pick('[data-testid="composer"] [data-file-path-input]'),
		];
	}, []);
	useFieldCycle(cycleChatFields);
	const composerInputRef = useRef<HTMLDivElement>(null);

	const [transcriptElement, setTranscriptElement] = useState<HTMLElement | null>(null);
	const [citationEdit, setCitationEdit] = useState<CitationEditTarget | null>(null);
	const lastCiteInputRef = useRef<HTMLElement | null>(null);
	const citeInput = useCallback(() => {
		const fields = cycleChatFields();
		return fields.find((field) => field === lastCiteInputRef.current) ?? fields[0] ?? composerInputRef.current;
	}, [cycleChatFields]);
	useEffect(() => {
		const remember = (event: FocusEvent) => {
			const input = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-file-path-input]") : null;
			if (input && cycleChatFields().includes(input)) lastCiteInputRef.current = input;
		};
		document.addEventListener("focusin", remember);
		return () => document.removeEventListener("focusin", remember);
	}, [cycleChatFields]);
	const citeAction = useMemo(
		() => createCiteAction({ chatId, composer: citeInput, openEditor: setCitationEdit }),
		[chatId, citeInput],
	);
	const workingRef = useRef("");
	const sideThread = useSideThread(chatId, nativeMessages, () => {
		return workingRef.current;
	});
	const closeSideThread = useCallback(() => {
		const id = sideThread.state?.threadId;
		if (id) sideThread.close(id);
	}, [sideThread.state?.threadId, sideThread.close]);
	const openSideThread = sideThread.open;
	const goToCurrentSideStep = sideThread.state && sideThread.currentSegmentId && sideThread.state.segmentId !== sideThread.currentSegmentId
		? () => openSideThread({ sourceMessageId: sideThread.currentSegmentId!, anchor: sideThread.state!.anchor }) : undefined;
	const renderSideEntry = (sourceMessageId?: string) => {
		if (!sourceMessageId) return null;
		const hasHistory = sideThread.threads.some((thread) => thread.anchor.messageId === sourceMessageId && thread.messages.length > 0);
		return <div className="mt-1 flex justify-end">
			<Button type="button" variant="ghost" size="icon-xs" data-testid="side-conversation-button" data-side-segment-id={sourceMessageId}
				data-has-history={hasHistory} aria-label={hasHistory ? "Open side conversation" : "Ask a side question"}
				title={hasHistory ? "Open side conversation" : "Ask a side question"}
				className={hasHistory ? "border-2 border-border text-muted-foreground" : "text-muted-foreground/40 hover:text-muted-foreground"}
				onClick={(event) => openSideThread({ sourceMessageId, anchor: { kind: "element", element: event.currentTarget } })}>
				<MessageCircleQuestionIcon aria-hidden className="size-3.5" fill="currentColor" fillOpacity={hasHistory ? 0.12 : 0} />
			</Button>
		</div>;
	};
	const sideThreadOpenRef = useRef(false);
	sideThreadOpenRef.current = sideThread.state !== null;
	const closeSideThreadRef = useRef(closeSideThread);
	closeSideThreadRef.current = closeSideThread;
	const toggleQuestionThread = useCallback(() => {
		if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller)) return;
		if (sideThreadOpenRef.current) closeSideThreadRef.current();
		else openSideThread({ anchor: { kind: "composer" }, questionCallId: pendingRef.current?.toolCallId });
	}, [controller, openSideThread]);
	useEffect(() => {
		window.addEventListener(kbdEventForChat("toggle-question-thread"), toggleQuestionThread);
		return () => window.removeEventListener(kbdEventForChat("toggle-question-thread"), toggleQuestionThread);
	}, [toggleQuestionThread]);
	const sideActions = useMemo(() => createSideQuestionActions({ open: openSideThread }), [openSideThread]);
	const selectionActions = useMemo(() => [citeAction, ...sideActions], [citeAction, sideActions]);
	const router = useRouter();
	const transcriptElementRef = useRef<HTMLElement | null>(null);
	transcriptElementRef.current = transcriptElement;
	const citationActions = useMemo<CitationActions>(() => ({
		editComment: (citation, source) => setCitationEdit({ citation, link: source.link, start: source.start, host: source.host, input: source.host.closest<HTMLElement>("[data-file-path-input]") ?? undefined }),
		openSource: (citation) => {
			const context = scrollContextRef.current;
			revealCitationSource({
				transcript: transcriptElementRef.current,
				scroll: context ? { scrollRef: context.scrollRef, stopScroll: context.stopScroll } : null,
				citation,
				currentChatId: chatId,
				navigate: (href) => router.push(href),
			});
		},
	}), [chatId, router]);

	const [compacting, setCompacting] = useState(initiallyCompacting);
	submissionLive.current.ready = !compacting && reconciliation === "ready";
	const retryable = (status === "ready" || status === "error") && !busy && !compacting && endsInFailedTurn(nativeMessages);
	const retryFailedTurn = () => retryFailedResponse(send, draftRef);
	const sendAllowed = reconciliation === "ready" && !pending && !activeProblem && !compacting && !submissionRunner.occupied;
	const pendingTextInput = false;
	const pendingThinkingInput = false;

	const nextReady =
		kind === "practice" &&
		!pending &&
		!activeProblem &&
		!compacting &&
		!busy &&
		nativeMessages.some(
			(m) => m.role === "assistant" && m.content.some(
					(b, contentIndex) => b.type === "toolCall" && !!practiceProblemForCall(nativeMessages, { messageId: m.id, contentIndex, toolCallId: b.id, toolName: b.name }),
				),
		);
	const sendNext = useCallback(() => {
		if (!nextReady || submissionRunner.occupied) return;
		if (pendingTextInput) { void prepareText(); return; }
		void send({ type: "next" });
	}, [nextReady, send, submissionRunner, pendingTextInput]);

	useEnterSubmits(sendNext, sessionFindScopeRef);

	const syncFromServer = useCallback(async () => {
		const record = await readRecord().catch(() => undefined);
		if (!record) return;
		if (Array.isArray(record.turns)) setTurns(record.turns);
		setPricing(record.pricing);
		continueIfOwed(record.messages);
	}, [readRecord, continueIfOwed]);

	reattachSettledRef.current = () => {
		setTurnInFlight(false);
		void syncFromServer();
	};

	const adoptAppendOnly = useCallback(async () => {
		try {
			await readRecord({ adoption: "append" });
		} catch {
		}
	}, [readRecord]);

	const turnStartStatusRef = useRef(status);
	const adoptionWindowOpenRef = useRef(false);
	const turnStartTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => {
		const was = turnStartStatusRef.current;
		turnStartStatusRef.current = status;
		if (was === "submitted" || status !== "submitted") return;
		adoptionWindowOpenRef.current = true;
		const timers = [400, 1000, 2000].map((ms) =>
			setTimeout(() => {
				if (adoptionWindowOpenRef.current) {
					void adoptAppendOnly();
				}
			}, ms),
		);
		timers.forEach((t) => {
			turnStartTimerRefs.current.push(t);
		});
	}, [status, adoptAppendOnly]);
	useEffect(() => {
		const timers = turnStartTimerRefs;
		return () => {
			adoptionWindowOpenRef.current = false;
			timers.current.forEach(clearTimeout);
			timers.current = [];
		};
	}, []);

	const [planOpen, setPlanOpen] = useState(false);
	const hasPlan = useMemo(() => planExists(messages), [messages]);
	const [coverageTick, setCoverageTick] = useState(0);
	const [mermaidFocus, setMermaidFocus] = useState<string | null>(null);
	const [figureFocus, setFigureFocus] = useState<{ svg: string; inverted: boolean } | { image: SessionImage } | null>(null);

	const mermaidFocusRef = useRef(mermaidFocus);
	mermaidFocusRef.current = mermaidFocus;
	const figureFocusRef = useRef(figureFocus);
	figureFocusRef.current = figureFocus;
	const planOpenRef = useRef(planOpen);
	planOpenRef.current = planOpen;
	const setupOpenRef = useRef(setupOpen);
	setupOpenRef.current = setupOpen;
	const planTree = useMemo(() => latestTree(messages), [messages]);

	const [turns, setTurns] = useState<TurnUsage[]>([]);
	const [pricing, setPricing] = useState<SessionPricing | undefined>();
	const [dockReserve, setDockReserve] = useState(208);
	const syncTurns = useCallback(async () => {
		try {
			const record = await readRecord({ adoption: "none" });
			if (!record) return;
			if (Array.isArray(record.turns)) setTurns(record.turns);
			setPricing(record.pricing);
		} catch {
		}
	}, [readRecord]);
	useEffect(() => {
		void syncTurns();
	}, [syncTurns]);
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const transitioned = prevStatusRef.current !== "ready" && status === "ready";
		prevStatusRef.current = status;
		if (!transitioned) return;
		void syncTurns();
		setCoverageTick((t) => t + 1);
		if (settleAnnouncedRef.current) {
			settleAnnouncedRef.current = false;
			void syncFromServer();
		}
	}, [status, syncTurns, syncFromServer]);

	const prevErrorStatusRef = useRef(status);
	useEffect(() => {
		const was = prevErrorStatusRef.current;
		prevErrorStatusRef.current = status;
		if (was === "error" || status !== "error") return;
		let cancelled = false;
		void (async () => {
			try {
				const record = await readRecord({ adoption: "none", isCurrent: () => !cancelled });
				if (!record) return;
				if (record.turnInFlight === true) setTurnInFlight(true);
				else void syncFromServer();
			} catch {
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [status, readRecord, syncFromServer]);

	const [jobs, setJobs] = useState<JobRecord[]>([]);
	const localStreamRef = useRef(false);
	localStreamRef.current = localStream;
	const jobStatusRef = useRef<Map<string, string>>(new Map());
	const pendingSyncRef = useRef(false);
	const firstFetchRef = useRef(true);
	const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const fetchJobsRef = useRef<() => void>(() => {});
	const fetchJobs = useCallback(async () => {
		try {
			const res = await fetch(`/api/jobs?chatId=${encodeURIComponent(chatId)}`);
			if (!res.ok) return;
			const data = (await res.json()) as { jobs?: JobRecord[]; turnInFlight?: boolean };
			const list = data.jobs ?? [];
			for (const j of list) {
				const prev = jobStatusRef.current.get(j.id);
				if (prev === "running" && j.status !== "running") {
					if (localStreamRef.current || data.turnInFlight === true) {
						pendingSyncRef.current = true;
						void adoptAppendOnly();
					} else {
						void syncFromServer();
					}
				}
				jobStatusRef.current.set(j.id, j.status);
			}
			firstFetchRef.current = false;
			if (
				pendingSyncRef.current &&
				!localStreamRef.current &&
				data.turnInFlight !== true
			) {
				pendingSyncRef.current = false;
				void syncFromServer();
			}
			setJobs(list);
		} catch {
		}
	}, [chatId, syncFromServer, adoptAppendOnly]);
	fetchJobsRef.current = () => void fetchJobs();
	useEffect(() => {
		firstFetchRef.current = jobStatusRef.current.size === 0;
		void fetchJobs();
	}, [fetchJobs]);
	useServerEvent("jobs-changed", (p) => {
		if (p.chatId != null && p.chatId !== chatId) return;
		if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
		fetchDebounceRef.current = setTimeout(() => {
			fetchDebounceRef.current = undefined;
			fetchJobsRef.current();
		}, 250);
	});
	useServerResync(() => fetchJobsRef.current());
	useEffect(
		() => () => {
			if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
		},
		[],
	);

	const statusRef = useRef(status);
	statusRef.current = status;
	const settleAnnouncedRef = useRef(false);
	useServerEvent("turn-started", (p) => {
		if (p.chatId !== chatId) return;
		if (localStreamRef.current) return;
		if (turnInFlightRef.current) return;
		attachToRunningTurn();
	});
	useServerEvent("turn-settled", (p) => {
		if (p.chatId !== chatId) return;
		if (localStreamRef.current) {
			settleAnnouncedRef.current = true;
			return;
		}
		if (turnInFlightRef.current) {
			if (statusRef.current === "error") {
				setTurnInFlight(false);
				clearError();
				void syncFromServer();
			}
			return;
		}
		void syncFromServer();
	});
	useServerEvent("compaction-changed", (p) => {
		if (p.chatId !== chatId) return;
		setCompacting(p.running);
	});
	useServerEvent("record-changed", (p) => {
		if (p.chatId !== chatId) return;
		if (localStreamRef.current || turnInFlightRef.current) return;
		void syncFromServer();
	});

	const onSend = () => {
		if (!isInteractionScopeEligible(sessionFindScopeRef.current, controller) || submissionRunner.occupied) return;
		if (openingDraftRef.current !== null) { deliverOpeningPrompt(textRef.current.trim(), true); return; }
		void prepareText();
	};


	return (
		<ChatActionsContext.Provider
			value={{
				chatId,
				syncFromServer,
				sendText: (t: string) => { void prepareText(t); },
				openSetup: () => setSetupOpen(true),
			}}
		>
		<SessionMermaidContext.Provider
			value={{
				openMermaid: setMermaidFocus,
				openFigure: (svg, inverted) => setFigureFocus({ svg, inverted }),
				openImage: image => setFigureFocus({ image }),
			}}
		>
		<JobsContext.Provider value={jobs}>
		<CitationActionsContext.Provider value={citationActions}>
		{
}
		<div className="flex h-dvh">
			<div className="flex min-w-0 flex-1 flex-col">
				{
}
				<TopBar
					drag={!renaming}
					onMouseDown={(e) => {
						if (renaming && e.target !== titleInputRef.current) titleInputRef.current?.blur();
					}}
				>
					{renaming ? (
						<>
							<input
								ref={titleInputRef}
								value={titleDraft}
								onChange={(e) => setTitleDraft(e.target.value)}
								onKeyDown={(e) => {
									if (!isInteractionScopeEligible(e.currentTarget, controller)) return;
									if (e.key === "Enter") void commitRename(titleDraft);
									else if (e.key === "Escape") {
										controller?.claimEscape(e);
										e.stopPropagation();
										setRenaming(false);
									}
								}}
								onBlur={() => void commitRename(titleDraft)}
								spellCheck={false}
								data-conversation-title
								aria-label="Session title"
								title="Rename this session"
								className="min-w-[8ch] max-w-[70%] shrink-0 bg-transparent font-title text-3xl tracking-tight caret-current outline-none [field-sizing:content]"
							/>
							{
}
							<div className="min-w-4 flex-1" aria-hidden="true" />
						</>
					) : (
					<>
						<Hint
							label="Rename session"
							action="rename-session"
							side="bottom"
						>
<button
							type="button"
														onClick={() => {
								setTitleDraft(titleText);
								setRenaming(true);
							}}
							data-conversation-title
							className="-mx-1.5 min-w-4 shrink cursor-text truncate rounded-md px-1.5 text-left font-title text-3xl tracking-tight transition-colors hover:bg-accent"
						>
							{titleText}
							</button>
						</Hint>
							{
}
							<div className="min-w-4 flex-1" aria-hidden="true" />
					</>
					)}
					{
}
					{planTree && (
						<Hint label="Open the full plan" side="bottom">
<button
							type="button"
							data-testid="plan-chip"
							onClick={(e) => {
								blurAfterPointerClick(e);
								setPlanOpen(true);
							}}
							className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border-2 bg-card px-3 py-1 text-xs font-extrabold text-foreground shadow-[0_3px_0_var(--border)] transition-[transform,box-shadow,background-color] duration-100 hover:bg-muted active:translate-y-[3px] active:shadow-none"
						>
							<WaypointsIcon className="size-4 text-beak" aria-hidden />
							Plan
						</button>
</Hint>
					)}
					{
}
					{
}
					{kind !== "practice" && <CoverageRing chatId={chatId} refreshKey={coverageTick} />}
					{
}
					{kind === "practice" ? (
						<span
							data-testid="phase-chip"
							data-phase="practice"
							role="img"
							aria-label="Challenge"
							title="Challenge"
							className="flex size-8 shrink-0 select-none items-center justify-center rounded-full bg-secondary-soft text-secondary"
						>
							<DumbbellIcon aria-hidden className="size-4" />
						</span>
					) : (
						<PhaseChip phase={phases.at(-1) ?? "probe"} />
					)}
				</TopBar>

				<SessionFind scopeRef={sessionFindScopeRef} scrollContextRef={scrollContextRef} />
				<div ref={sessionFindScopeRef} className="relative flex min-h-0 flex-1">
				<Conversation className="h-full min-w-0 flex-1" initial="instant" contextRef={scrollContextRef}>
					<SessionMessageNavigation />
					<TranscriptElementReporter onElement={setTranscriptElement} />
					<ConversationContent className="min-h-full gap-0 p-0">
						<div data-session-find-root="" className={`${COLUMN} flex flex-1 flex-col gap-4 pt-4`}>
							{messages.length === 0 && !busy && (
								<ConversationEmptyState
									title="New session"
									description="The teacher will open by probing what you already know."
								/>
							)}

							{messages.map((m, mi) =>
								m.role === "user" && isSubagentSteer(m) ? (
									<SubagentSteerCard key={m.id || `m-${mi}`} message={m} />
								) : m.role === "user" && m.parts.some((p) => p.type === "data-probe-handoff") ? (
								<PhaseDivider key={m.id || `m-${mi}`} phase="plan" />
							) : m.role === "user" && m.parts.length > 0 && m.parts.every((p) => p.type.startsWith("data-")) ? (
								<Fragment key={m.id || `m-${mi}`}>
									{m.parts.map((part, pi) => {
										switch (part.type) {
											case "data-graph-context":
												return <GraphContextCard key={pi} data={part.data as GraphContextData} />;
											case "data-compaction":
												return <CompactionMomentDivider key={pi} data={part.data as CompactionDividerData} />;
											case "data-compaction-cut":
												return <CompactionCutDivider key={pi} data={part.data as CompactionDividerData} />;
											case "data-practice-thinking":
												return <ThinkingCard key={pi} data={part.data as PracticeThinkingData} />;
											case "data-practice-next":
												return (
													<div
														key={pi}
														data-testid="practice-next-line"
														className="my-4 flex items-center justify-center gap-1.5 text-sm font-extrabold text-secondary"
													>
														<ArrowRightIcon className="size-4" />
														Next problem
													</div>
												);
											default:
												return null;
										}
									})}
								</Fragment>
							) : (
									<Fragment key={m.id || `m-${mi}`}>
									{
}
									{m.role === "assistant" &&
									mi > 0 &&
									phases[mi] === "teach" &&
									phases[mi - 1] !== "teach" &&
									teachStepIndex(m.parts) === -1 ? (
										<PhaseDivider key={`teach-${m.id || `m-${mi}`}`} phase="teach" />
									) : null}
									{m.role === "user" ? (
										<div data-testid="user-message" className="my-1 flex w-full justify-end">
											<div className="max-w-[80%] rounded-2xl rounded-br-md border-2 border-primary/40 bg-primary/15 px-4 py-2.5">
												<div className="ow-prose whitespace-pre-wrap font-semibold text-foreground">
													<PathText text={m.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")} />
												</div>
												<SubmittedImages images={m.parts.filter((part) => part.type === "image").map(part => ({ type: "image" as const, data: part.data as string, mimeType: part.mimeType as string }))} />
											</div>
										</div>
									) : (
									<div className="flex w-full items-start gap-3" data-testid="teacher-turn">
									<div className="sticky top-3 shrink-0">
										<TeacherAvatar mood={busy && mi === messages.length - 1 ? "talking" : "neutral"} />
									</div>
									<Message from="assistant" className="min-w-0 max-w-full flex-1 pt-1.5">
									<MessageContent className="w-full">
											{m.parts.map((part, pi) => {
												if (part.pluginProblem) return <ProblemCard key={pi} part={{ ...part, state: part.state ?? "input-available", toolCallId: part.toolCallId ?? "" }} />;
												const isLastPart = mi === messages.length - 1 && pi === m.parts.length - 1;
												const teachBoundary =
													m.role === "assistant" &&
													mi > 0 &&
													phases[mi] === "teach" &&
													phases[mi - 1] !== "teach" &&
													teachStepIndex(m.parts) === pi;
												if (
													part.state === "output-error" &&
													part.type.startsWith("tool-") &&
													part.errorText !== "Operation aborted"
												) {
													return (
														<SystemLine key={`retry-${pi}`} testId="tool-retry">
															Retrying…
														</SystemLine>
													);
												}
												switch (part.type) {
													case "text": {
														const sourceId = textPartMessageId(part.id);
														const anchor = sourceId && sourceTextParts.get(sourceId) === part.id ? messageAnchorId(sourceId) : undefined;
														return (
															<div key={part.id || pi} id={anchor} data-source-message-id={sourceId ?? undefined} className="ow-source-passage">
																<MessageResponse>{part.text}</MessageResponse>
															</div>
														);
													}
													case "reasoning":
														return (
															<Reasoning key={pi} isStreaming={status === "streaming" && isLastPart} className="mb-2">
																<ReasoningTrigger />
																<ReasoningContent>{part.text ?? ""}</ReasoningContent>
															</Reasoning>
														);
													case "step-start":
														return <Fragment key={`step-${pi}`}>
															{renderSideEntry(sideEntries.get(m.id)?.get(pi))}
															{teachBoundary ? <PhaseDivider phase="teach" /> : pi > 0 ? <Separator className="my-3" /> : null}
														</Fragment>;
													case "data-plan-block":
														return (
															<PlanBlock
																key={pi}
																data={part.data as PlanBlockData}
																onOpen={() => setPlanOpen(true)}
															/>
														);
													case "tool-quiz":
													case "tool-probe":
													case "tool-ask_user_question":
													case "tool-explain":
													case "tool-recall": {
														const malformed = !busy && malformedQuestions.find(call => call.messageId === part.sourceMessageId && call.contentIndex === part.sourceContentIndex && call.toolCallId === part.toolCallId);
														if (malformed) return <MalformedQuestion key={pi} disabled={!!pending || compacting}
															reason={pending ? "Answer or discard the remaining question first." : undefined}
															onRetry={() => {
																draftRef.current = null;
																void send({ type: "retry-question", messageId: malformed.messageId, contentIndex: malformed.contentIndex, toolCallId: malformed.toolCallId });
															}} />;
														if (part.state === "output-available") {
															return (
																<AnsweredCard key={pi} answer={part.output as QuestionAnswerData} input={part.input} />
															);
														}
														return null;
													}
													default: {
														if (part.type.startsWith("tool-")) return <ToolPartRenderer key={pi} part={part} />;
														return null;
													}
												}
											})}
										</MessageContent>
										{m.role === "assistant" && renderSideEntry(sideEntries.get(m.id)?.get(m.parts.length))}
									</Message>
									</div>
									)}
								</Fragment>
							))}

							{
}
							{
}
							{compacting && (
								<span className="flex items-center gap-2.5 self-start rounded-2xl border-2 bg-card px-4 py-2.5 text-sm font-bold text-muted-foreground">
									<OwlBusy label="Compacting context" />
									<Shimmer duration={1.4}>Compacting context…</Shimmer>
								</span>
							)}
							{(status === "submitted" || turnInFlight) && (
								<PendingTurnIndicator evaluating={evaluating} />
							)}
							{openingError && <p role="alert" className="rounded-xl bg-error-soft px-3 py-2 text-sm font-bold text-error">{OPENING_PROMPT_FAILURE}</p>}
							{error && (
								<div className="flex items-center justify-between gap-3 rounded-2xl border-2 border-error/50 bg-error-soft px-3 py-2.5 text-sm font-semibold">
									<span className="flex items-center gap-3">
										<Owl mood="unimpressed" size={40} />
										<span>Something went wrong: {error.message}</span>
									</span>
									{retryable && (
										<Button variant="outline" size="xs" data-testid="retry-failed-turn" onClick={retryFailedTurn}>
											Retry
										</Button>
									)}
								</div>
							)}
						</div>

						{
}
						<div aria-hidden data-testid="dock-spacer" style={{ height: dockReserve }} />
				</ConversationContent>
				{
}
				<DockOverlay
					pending={pending}
					onPrepareBuiltin={prepareBuiltin}

					onBuiltinPendingInput={() => false}
					onPrepareThinking={prepareThinking}
					pendingThinkingInput={pendingThinkingInput}
					preparing={submissionRunner.occupied}
					preparationStatus={<>
						{preparationError && <p role="alert" className="px-4 py-2 text-sm text-destructive">{preparationError}</p>}
					</>}
					reconciliation={reconciliation}
					onRetrySync={() => { void reconcile(); }}
					initialQuestionDraft={pending ? questionDraft(pending.key)?.form : undefined}
					onSaveQuestionDraft={(form) => { if (pending) saveQuestionDraft(pending.key, { form }); }}
					workingRef={workingRef}
					practice={activeProblem}
					compactionRunning={compacting}
					onSubmitThinking={submitThinking}
					chatId={chatId}
					onModelChange={recordSelectedModel}
					plan={hasPlan ? <PlanMarginalia messages={messages} /> : undefined}
					onOpenPlan={() => setPlanOpen(true)}
					requiresReveal={requiresReveal}
					readingThinking=""
					phase={phases.at(-1) ?? "probe"}
					turns={turns}
					contextTokens={contextTokens}
					cliContextWindow={cliContextWindowOf(nativeMessages)}
					pricing={pricing}
					onReserve={setDockReserve}
					queuedSteers={visibleQueuedSteers(steerQueue, nativeMessages)}
					setupCta={
						zeroKeys ? (
							<ZeroKeysPill onOpen={() => setSetupOpen(true)} />
						) : (
							!configured && (
								<div className="pointer-events-auto mb-2 flex justify-center">
									<button
										type="button"
										data-testid="setup-cta"
										onClick={() => setSetupOpen(true)}
										className="rounded-lg border-2 border-border bg-card px-3 py-1.5 text-xs text-foreground transition-colors hover:border-muted-foreground/50 hover:bg-accent cursor-pointer"
									>
										Set up your models
									</button>
								</div>
							)
						)
					}
					composer={
						<ChatSessionComposer
							busy={busy}
							value={textRef.current}
							pendingInput={pendingTextInput}
							revision={composerDraftRevision}
							onChange={recordComposerText}
							inputRef={composerInputRef}
							onSend={onSend}
							onStop={abortInFlightTurn}
							sendAllowed={sendAllowed}
							nextProblem={nextReady}
							onNext={sendNext}
							placeholder={nextReady ? "Ask anything, or press Enter for the next one." : undefined}
						/>
					}
					onSubmitAnswer={(output) => {
						if (!pending) return;
						saveQuestionDraft(pending.key, { readingThinking: readingThinkingRef.current });
						const reading = readingThinkingRef.current.trim() || undefined;
						const send = () => submitAnswer(pending.tool, pending.toolCallId, reading ? { ...output, readingThinking: reading } : output, pending.key);
						send();
					}}
				/>
				</Conversation>
				{sideThread.state?.mode === "panel" && (
					<SideThreadPanel>
						<SideThreadBody
							key={sideThread.state.threadId}
							state={sideThread.state}
							chatId={chatId}
							draft={sideThread.draftFor(sideThread.state.threadId)}
							readDraft={sideThread.draftFor.bind(null, sideThread.state.threadId)}
							onDraftChange={sideThread.saveDraft.bind(null, sideThread.state.threadId)}
							onAsk={(text, retry) => sideThread.ask(text, retry, sideThread.state!.threadId)}
							onStop={sideThread.stop}
							onExpand={sideThread.expand}
							onFloat={sideThread.float}
							onClose={closeSideThread}
							onCurrentStep={goToCurrentSideStep}
						/>
					</SideThreadPanel>
				)}

				{sideThread.state?.mode === "popover" && (
					<SideThreadPopover
						state={sideThread.state}
						chatId={chatId}
						draft={sideThread.draftFor(sideThread.state.threadId)}
						readDraft={sideThread.draftFor.bind(null, sideThread.state.threadId)}
						onDraftChange={sideThread.saveDraft.bind(null, sideThread.state.threadId)}
						composer={() => composerInputRef.current}
						onAsk={(text, retry) => sideThread.ask(text, retry, sideThread.state!.threadId)}
						onStop={sideThread.stop}
						onExpand={sideThread.expand}
						onFloat={sideThread.float}
						onClose={closeSideThread}
						onCurrentStep={goToCurrentSideStep}
					/>
				)}

				{
}
				<>
				{mermaidFocus !== null && (
					<MermaidOverlay chart={mermaidFocus} onClose={() => setMermaidFocus(null)} />
				)}
				{figureFocus !== null && (
					<MermaidOverlay
						{...figureFocus}
						onClose={() => setFigureFocus(null)}
					/>
				)}
				{planOpen && <PlanPopup messages={messages} onClose={() => setPlanOpen(false)} />}
				<SelectionToolbar viewport={transcriptElement} actions={selectionActions} />
				{citationEdit && (
					<CitationCommentPopover
						key={`${citationEdit.start}:${citationEdit.link}`}
						target={citationEdit}
						transcript={transcriptElement}
						composer={() => citationEdit.input?.isConnected ? citationEdit.input : citeInput()}
						onClose={() => setCitationEdit(null)}
						onSend={() => {
							const input = citationEdit.input?.isConnected ? citationEdit.input : citeInput();
							if (input === composerInputRef.current) onSend();
							else if (input) requestAnimationFrame(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
						}}
					/>
				)}
				</>
				<AbortTurnDialog mode={abortAsk} onClose={closeAbortAsk} onConfirm={confirmAbort} busy={busy} />
				</div>
			</div>
		</div>
		</CitationActionsContext.Provider>
		</JobsContext.Provider>
		</SessionMermaidContext.Provider>
		{
}
		<SetupDialog
			open={setupOpen}
			onClose={() => setSetupOpen(false)}
			onDone={() => {
				setSetupOpen(false);
			}}
		/>
		</ChatActionsContext.Provider>
	);
}

export type EscAbortTarget = "side-thread" | "mermaid" | "plan" | "setup" | "question" | "problem" | "turn" | null;
export function initialPromptOwed(messages: readonly { role: string }[], prompt: string | undefined): boolean {
	if (!prompt) return false;
	return !messages.some((m) => m.role === "user" || m.role === "assistant");
}

export function escAbortTarget(s: {
	abortAsk: boolean;
	sideThread?: boolean;
	mermaidFocus: boolean;
	planOpen: boolean;
	setupOpen: boolean;
	pending: boolean;
	problem: boolean;
	busy: boolean;
}): EscAbortTarget {
	if (s.abortAsk) return null;
	if (s.sideThread) return "side-thread";
	if (s.mermaidFocus) return "mermaid";
	if (s.planOpen) return "plan";
	if (s.setupOpen) return "setup";
	if (s.pending) return "question";
	if (s.problem) return "problem";
	if (s.busy) return "turn";
	return null;
}

export function revealArrival(wasQuestion: boolean): { expanded: boolean; revealed: boolean } {
	return wasQuestion ? { expanded: true, revealed: true } : { expanded: false, revealed: false };
}

export function probeArrivalExpanded(isAtBottom: boolean): boolean {
	return isAtBottom;
}

export function shouldStampGeometryMute(nextH: number, prevH: number, pending: boolean): boolean {
	return pending && nextH > prevH + 1;
}

function TranscriptElementReporter({ onElement }: { onElement: (element: HTMLElement | null) => void }) {
	const { scrollRef } = useStickToBottomContext();
	useEffect(() => {
		if (scrollRef.current) { onElement(scrollRef.current); return () => onElement(null); }
		const id = window.setInterval(() => {
			if (!scrollRef.current) return;
			window.clearInterval(id);
			onElement(scrollRef.current);
		}, 50);
		return () => { window.clearInterval(id); onElement(null); };
	}, [scrollRef, onElement]);
	return null;
}

export function DockOverlay({
	pending,
	onPrepareBuiltin, onBuiltinPendingInput, onPrepareThinking, pendingThinkingInput, preparing, preparationStatus,
	reconciliation, onRetrySync,
	initialQuestionDraft,
	onSaveQuestionDraft,
	workingRef,
	practice,
	compactionRunning,
	onSubmitThinking,
	requiresReveal,
	readingThinking,
	phase,
	turns,
	contextTokens,
	cliContextWindow,
	pricing,
	composer,
	onSubmitAnswer,
	chatId,
	onModelChange,
	onReserve,
	plan,
	onOpenPlan,
	setupCta,
	queuedSteers,
}: {
	pending: ReturnType<typeof pendingQuestionOf>;
	onPrepareBuiltin: PrepareBuiltinSubmission;
	onBuiltinPendingInput: (question: QuestionData) => boolean;
	onPrepareThinking: PrepareThinkingSubmission;
	pendingThinkingInput: boolean;
	preparing: boolean;
	preparationStatus: React.ReactNode;
	reconciliation: "ready" | "syncing" | "failed";
	onRetrySync(): void;
	initialQuestionDraft?: QuestionFormDraft;
	onSaveQuestionDraft: (draft: QuestionFormDraft) => void;
	workingRef?: { current: string };
	compactionRunning: boolean;
	practice: { toolCallId: string; input: unknown } | null;
	onSubmitThinking: (text: string) => void;
	requiresReveal: boolean;
	readingThinking: string;
	phase: Phase3;
	turns: TurnUsage[];
	contextTokens: number | null;
	cliContextWindow: ReturnType<typeof cliContextWindowOf>;
	pricing?: SessionPricing;
	composer: React.ReactNode;
	onSubmitAnswer: (output: QuestionAnswerData) => void;
	chatId: string;
	onModelChange: (model: string | undefined) => void;
	onReserve: (h: number) => void;
	plan?: React.ReactNode;
	onOpenPlan: () => void;
	queuedSteers: QueuedSteerLine[];
	setupCta?: React.ReactNode;
}) {
	const controller = useOptionalInteractionLayers();
	const { isAtBottom, scrollToBottom, scrollRef } = useStickToBottomContext();
	const atBottomRef = useRef(isAtBottom);
	atBottomRef.current = isAtBottom;
	const [expanded, setExpanded] = useState(!requiresReveal);
	const [revealed, setRevealed] = useState(false);
	const revealPending = requiresReveal && !revealed;

	const pendingId = pending?.key ?? null;
	const ownsDock = !!pending || !!practice;
	const initialPendingRef = useRef(pendingId);

	const prevPendingIdRef = useRef(pendingId);
	if (pendingId !== prevPendingIdRef.current) {
		const wasQuestion = prevPendingIdRef.current !== null;
		prevPendingIdRef.current = pendingId;
		if (pendingId && requiresReveal) {
			const arrival = revealArrival(wasQuestion);
			setExpanded(arrival.expanded);
			setRevealed(arrival.revealed);
		} else if (pendingId) {
			setExpanded(probeArrivalExpanded(atBottomRef.current));
		}
	}

	useEffect(() => {
		if (!pendingId || pendingId === initialPendingRef.current) return;
		if (!requiresReveal && atBottomRef.current) void suppressFoldDuringReveal();
	}, [pendingId]);

	const expandedRef = useRef(expanded);
	expandedRef.current = expanded;
	const pendingRef = useRef(ownsDock);
	pendingRef.current = ownsDock;
	const requiresRevealRef = useRef(requiresReveal);
	requiresRevealRef.current = requiresReveal;
	const revealedRef = useRef(revealed);
	revealedRef.current = revealed;

	const blockRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const bodyRef = useRef<HTMLDivElement>(null);
	const shellRef = useRef<HTMLDivElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);
	const mode = pending
		? `question:${pending.key}`
		: practice
			? `practice:${practice.toolCallId}`
			: "chat";


	const [flankW, setFlankW] = useState(0);
	const flankWRef = useRef(0);
	const geometryAtRef = useRef(0);
	useIsoLayoutEffect(() => {
		const block = blockRef.current;
		if (!block) return;
		const measure = () => {
			const next = Math.round(block.offsetWidth / 2 - DOCK_W / 2 - 2 * MARGIN_GAP);
			if (Math.abs(next - flankWRef.current) > 1) {
				flankWRef.current = next;
				setFlankW(next);
				geometryAtRef.current = Date.now();
			}
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(block);
		return () => ro.disconnect();
	}, []);

	const reserveRef = useRef(0);
	const offer = useCallback((blockH: number) => {
		const next = blockH + GRADIENT_H;
		if (next <= reserveRef.current + 0.5 && pendingRef.current) return;
		if (shouldStampGeometryMute(next, reserveRef.current, pendingRef.current)) geometryAtRef.current = Date.now();
		reserveRef.current = next;
		onReserve(next);
	}, [onReserve]);

	const [sbInset, setSbInset] = useState(0);
	const stateKey = dockStateKey(mode, ownsDock, expanded);
	const heightMorphRef = useRef<ReturnType<typeof createDockMorph> | null>(null);
	if (!heightMorphRef.current) heightMorphRef.current = createDockMorph();
	const retargetOpening = useCallback(() => heightMorphRef.current?.retarget(stateKey), [stateKey]);
	useIsoLayoutEffect(() => () => heightMorphRef.current?.dispose(), []);
	useDockHeight({
		scrollRef, blockRef, viewportRef, bodyRef, shellRef, contentRef,
		expanded, enabled: ownsDock, mode, onScrollbarInset: setSbInset, onHeight: offer,
		onLayout: retargetOpening,
	});

	const growthAtRef = useRef(0);
	useEffect(() => {
		const el = scrollRef.current;
		const content = el?.firstElementChild as HTMLElement | null | undefined;
		if (!el || !content) return;
		let prevH = content.getBoundingClientRect().height;
		const ro = new ResizeObserver(() => {
			const h = content.getBoundingClientRect().height;
			if (h > prevH + 0.5) growthAtRef.current = Date.now();
			prevH = Math.max(prevH, h);
		});
		ro.observe(content);
		return () => ro.disconnect();
	}, [scrollRef]);

	useEffect(() => {
		const root = blockRef.current;
		const el = scrollRef.current;
		if (!root || !el) return;
		const onWheel = (e: WheelEvent) => forwardDockWheel(e, root, el);
		root.addEventListener("wheel", onWheel, { passive: false });
		return () => root.removeEventListener("wheel", onWheel);
	}, [scrollRef]);

	const expandIntentRef = useRef(false);
	const intentTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
	const suppressFoldDuringReveal = () => {
		expandIntentRef.current = true;
		clearTimeout(intentTimerRef.current);
		intentTimerRef.current = setTimeout(() => {
			expandIntentRef.current = false;
		}, 2000);
		return Promise.resolve(scrollToBottom()).finally(() => {
			clearTimeout(intentTimerRef.current);
			expandIntentRef.current = false;
		});
	};
	const expandAndReveal = () => {
		setRevealed(true);
		setExpanded(true);
		void suppressFoldDuringReveal();
	};
	const expandAndRevealRef = useRef(expandAndReveal);
	expandAndRevealRef.current = expandAndReveal;
	useEffect(() => {
		if (!pending || expanded) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "Enter" || e.altKey || e.defaultPrevented || composingQuestionKey(e) || !isInteractionScopeEligible(blockRef.current, controller)) return;
			if (e.shiftKey && !e.metaKey && !e.ctrlKey) return;
			const t = e.target as HTMLElement | null;
			if (
				t &&
				((t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range") ||
				t.tagName === "TEXTAREA" ||
				t.isContentEditable ||
				t.closest("button"))
			)
				return;
			e.preventDefault();
			expandAndRevealRef.current();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [pending, expanded, controller]);

	useEffect(() => {
		const el = scrollRef.current;
		if (!el) return;
		const onScroll = () => {
			if (!pendingRef.current) return;
			if (Date.now() - geometryAtRef.current < 400) return;
			if (Date.now() - growthAtRef.current < 400) return;
			const d = el.scrollHeight - el.clientHeight - el.scrollTop;
			if (expandedRef.current) {
				if (d > COLLAPSE_DIST && !expandIntentRef.current && !atBottomRef.current) setExpanded(false);
			} else if (d < EXPAND_DIST) {
				if (requiresRevealRef.current && !revealedRef.current) return;
				setExpanded(true);
				void scrollToBottom();
			}
		};
		el.addEventListener("scroll", onScroll, { passive: true });
		return () => el.removeEventListener("scroll", onScroll);
	}, [scrollRef, scrollToBottom]);

	const measureBlock = () => {
		const b = blockRef.current;
		if (b) offer(b.getBoundingClientRect().height);
	};

	const initialModeRef = useRef(mode);

	const prevExpandedForFadeRef = useRef(expanded);
	useIsoLayoutEffect(() => {
		if (prevExpandedForFadeRef.current === expanded) return;
		prevExpandedForFadeRef.current = expanded;
		contentRef.current?.animate(
			[{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }],
			{ duration: 160, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
		);
	}, [expanded]);
	useIsoLayoutEffect(() => {
		const el = shellRef.current;
		if (!el) return;
		heightMorphRef.current?.layout(el, stateKey, ownsDock && expanded, measureBlock);
	});

	return (
		<div className="pointer-events-none absolute inset-x-0 bottom-0" style={{ right: sbInset }}>
			<div className="h-24 bg-gradient-to-t from-background via-background/85 to-transparent" />
			<div ref={blockRef} className="relative bg-background pb-5">
				<div className={DOCK}>
					<div ref={viewportRef} data-dock-viewport="" className="pointer-events-auto">
					<div ref={bodyRef}>
					{setupCta}
					{reconciliation === "failed" && <div role="alert" className="mb-2 rounded-2xl border-2 bg-card px-4 py-3 text-sm">Could not sync the saved session. <Button type="button" variant="ghost" onClick={onRetrySync}>Retry syncing</Button></div>}
					{
}
					<QueuedSteersBody steers={queuedSteers} />
					{
}

					<div ref={shellRef} data-attachment-composer="" className="pointer-events-auto overflow-hidden rounded-3xl border-2 bg-card shadow-[0_4px_0_var(--border)] transition-colors focus-within:border-secondary">
						{preparationStatus}
						{
}
						<div
							ref={contentRef}
							key={mode}
							className={mode === initialModeRef.current ? "flow-root" : "flow-root dock-variant"}
						>
							{pending ? (
								<QuestionDock
									toolName={pending.tool as "quiz" | "probe" | "ask_user_question" | "explain" | "recall"}
									toolCallId={pending.toolCallId}
									input={pending.input as never}
									expanded={expanded}
									reveal={revealPending}
									phase={phase}
									onExpand={expandAndReveal}
									onSubmit={onSubmitAnswer}
									onPrepareSubmission={onPrepareBuiltin}
									hasPendingInput={onBuiltinPendingInput}
									preparing={preparing}
									initialDraft={initialQuestionDraft}
									onSaveDraft={onSaveQuestionDraft}
									workingRef={workingRef}
									compactionRunning={compactionRunning}
								/>
							) : practice ? (
								<PracticeDock
									problemCallId={practice.toolCallId}
									input={practice.input as { statement: string }}
									expanded={expanded}
									onExpand={() => {
										setExpanded(true);
										void suppressFoldDuringReveal();
									}}
									onSubmit={onSubmitThinking}
									onPrepareSubmission={onPrepareThinking}
									hasPendingInput={pendingThinkingInput}
									preparing={preparing}
									compactionRunning={compactionRunning}
								/>
							) : (
								composer
							)}
						</div>
						{ownsDock && <div className="flex items-center justify-end gap-2 px-2 pb-2"><AttachFilesButton /></div>}
					</div>
					</div>
					</div>
					{
}
					<StatsBar
						turns={turns}
						contextTokens={contextTokens}
						cliContextWindow={cliContextWindow}
						pricing={pricing}
						chatId={chatId}
						onModelChange={onModelChange}
					/>
					{
}
					<ConversationScrollButton className="pointer-events-auto bottom-full mb-2" />
				</div>
				{
}
				{pending && plan && (
					<Hint label="Open the full plan" side="bottom">
<button
						type="button"
						data-testid="plan-marginalia"
						onClick={onOpenPlan}
						style={{ left: `calc(50% + ${DOCK_W / 2 + MARGIN_GAP}px)` }}
						className={`absolute bottom-5 right-4 top-0 cursor-pointer transition-[filter,opacity] duration-300 ease-out ${
							expanded && flankW >= MARGIN_MIN_W
								? "pointer-events-auto opacity-100 blur-0"
								: "pointer-events-none opacity-0 blur-md"
						}`}
					>
						{plan}
					</button>
</Hint>
				)}
			</div>
		</div>
	);
}
