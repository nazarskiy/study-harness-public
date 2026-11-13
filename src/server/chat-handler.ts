import type { Usage } from "@earendil-works/pi-ai";
import {
	createPracticeAgent,
	createProberAgent,
	createTeacherAgent,
	type AgentBuildOptions,
	type TeachingAgent,
} from "../agent/teacher-agent.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { connectionBackgroundAllowed as subscriptionBackgroundAllowed, connectionScopeCurrent, isSubscriptionProvider } from "../agent/subscription-connections.ts";
import { nativeSubscriptionError } from "../agent/subscription-stream.ts";
import { chatGPTStreamError } from "../agent/chatgpt-stream.ts";
import { SubscriptionRequestCycle, type SubscriptionDispatchLifecycle } from "../agent/subscription-request-cycle.ts";
import { reconstructRequestCause } from "../core/native-messages.ts";
import { createJobRunner } from "../agent/subagents/runner.ts";
import { createExtractionPipeline } from "../agent/subagents/extraction.ts";
import type { ModelRole } from "../../config.ts";
import {
	deliverJobResult,
	noteSteersDurable,
	reconcileUserSteers,
	registerLiveAgent,
	restoreUncommittedAutomatic,
	setTurnRunner,
	settleSteers,
	steerLiveChat,
	unregisterLiveAgent,
} from "./jobs.ts";
import { runPiTurn } from "./pi/ui-stream.ts";
import { setFileAccessPolicy } from "../agent/tools/file-access.ts";
import { fileAccessPolicy } from "./file-access.ts";
import { collectToolCallIds } from "./pi/call-ids.ts";
import { providerEventNote } from "../agent/provider-events.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { getPluginAgentContributions, getPluginHost } from "./plugins.ts";
import { preparePluginQuestionSubmission, reconcilePluginQuestionCompatibility, type QuestionTypeResolver } from "./plugin-questions.ts";
import { searchAvailable, searchProvider } from "./search.ts";
import { prepareSubmissionImages, prepareSubmissionImageChannels, prepareProblemSubmissionImageChannels, submissionImagePolicyKey } from "./submission-images.ts";
import { preparePluginProblemSubmission, requirePluginProblemTarget, type ProblemTypeResolver } from "./plugin-problems.ts";
import { providerKeyPresent } from "./keys.ts";
import { CLAUDE_CODE_PROVIDER } from "../core/contracts/claude-code.ts";
import {
	extractionEnabled,
	graphToolsEnabled,
	resolveConversationSpec,
	resolveRoleSpec,
} from "../core/settings-resolution.ts";
import { modelsNotConfigured, providerKeyMissing as providerKeyMissingEnvelope, ROLE_SLOT, type ModelSlotName, type ProviderKeyMissing } from "../core/settings.ts";
import { beginTurn, endTurn, isTurnRunning } from "./turn-liveness.ts";
import { claimPreparingTurn, type TurnPreparation } from "./turn-preparation.ts";
import { applyParkedDismissal } from "./dismissal-park.ts";
import { sideConversationEntries } from "../core/side-chat.ts";
import { sideChats, type SideChatService } from "./side-chat.ts";
import { SIDE_CONTEXT_BUDGET_ERROR, sideBudgetRetryDrops, sideContextWindow } from "./side-context-budget.ts";
import { registerTurn, rememberTurnFailure, unregisterTurn } from "./turn-runs.ts";
import { persistTurn, triggerExtraction, TurnPersistenceError } from "./turn-service.ts";
import { hasProbeDone, hasUnresolvedQuestion, pendingPluginQuestionOf, pluginQuestionCallsOf, questionCallsOf } from "../core/native-messages.ts";
import { samePluginQuestionOccurrence } from "../core/plugin-questions.ts";
import { composeInstructions } from "../agent/teacher-agent.ts";
import { ensureCompacted, kickCompaction, effectiveThresholdTokens, projectedContextTokens, compactionInFlight } from "./compaction.ts";
import { COMPACTION_RESERVE_TOKENS } from "../core/compaction.ts";
import { catalogContextLimits, refreshConnectionCatalog } from "./model-catalog.ts";
import { emit } from "../core/events.ts";
import { settledTurnResponse } from "./turn-runs.ts";
import { asAgentMessages, type OwllyMessage } from "../core/native-messages.ts";
import { QUESTION_TOOLS } from "../core/pending.ts";
import {
	ChatInputError,
	assertPluginQuestionInputAllowed,
	assertNativeSubmissionTarget,
	inputAppends,
	parseChatInput,
	questionRecoveryAppends,
	retryDrops,
	type TurnInput,
} from "../core/input-events.ts";
import { steerDelivered } from "../core/contracts.ts";
import type {CallUsage} from "../core/contracts.ts";


function connectionBackgroundAllowed(provider: string): boolean {
	return subscriptionBackgroundAllowed(provider) && (provider !== CLAUDE_CODE_PROVIDER || providerKeyPresent(provider));
}

function settlementErrorText(error: unknown): string {
	return error instanceof TurnPersistenceError ? error.message : "An error occurred.";
}

const jobRunner = createJobRunner({
	chatStore: stores.chatStore,
	jobStore: stores.jobStore,
	deliver: deliverJobResult,
	engineFor: (role) =>
		resolveEngine(role),
	providerKeyMissing: (provider, tier) =>
		providerKeyPresent(provider) ? null : providerKeyMissingEnvelope(provider, [tier]),
	searchProvider,
});
export const extraction = createExtractionPipeline({
	...stores,
	engineFor: (role) =>
		resolveEngine(role),
	providerKeyMissing: (provider, tier) =>
		providerKeyPresent(provider) ? null : providerKeyMissingEnvelope(provider, [tier]),
});


setTurnRunner(async (chatId, input) => {
	const res = await handleChatInput(chatId, input);
	await res.arrayBuffer().catch(() => undefined);
	return res.status;
});
function resolveEngine(role: ModelRole): PiEngine | undefined {
	const spec = resolveRoleSpec(role, stores.settingsStore.readSettings());
	return spec ? piEngineForSpec(spec, true, undefined, retentionForSlot(ROLE_SLOT[role])) : undefined;
}

function retentionForSlot(slot: ModelSlotName) {
	return () => stores.settingsStore.readSettings()?.models?.[slot]?.cacheRetention;
}

setFileAccessPolicy(fileAccessPolicy);

export async function handleChatRequest(
	req: Request,
	buildAgent?: (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent,
	sideContext: Pick<SideChatService, "snapshot"> = sideChats,
): Promise<Response> {
	let body: { chatId?: unknown; input?: unknown };
	try {
		body = await req.json();
	} catch {
		return Response.json({ error: "Invalid JSON body" }, { status: 400 });
	}
	const chatId = typeof body.chatId === "string" ? body.chatId : "";
	if (!chatId) return Response.json({ error: "Unknown chat" }, { status: 404 });
	let input: TurnInput;
	try {
		input = parseChatInput(body.input);
	} catch (err) {
		if (err instanceof ChatInputError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}
	return handleChatInput(chatId, input, buildAgent, sideContext);
}

export async function handleChatInput(
	chatId: string,
	input: TurnInput,
	buildAgent?: (opts: AgentBuildOptions & { teaching: boolean }) => TeachingAgent,
	sideContext: Pick<SideChatService, "snapshot"> = sideChats,
): Promise<Response> {
	await reconcilePluginQuestionCompatibility(stores.chatStore, chatId);
	const initialRecord = stores.chatStore.getChat(chatId);
	if (!initialRecord) {
		return Response.json({ error: "Unknown chat" }, { status: 404 });
	}
	let record = initialRecord;

	const capturedSession = { createdAt: record.createdAt, kind: record.kind };
	const freshSubmission = input.type === "text" || input.type === "thinking" || input.type === "answer" || input.type === "plugin-question-answer" || input.type === "plugin-problem-submission";
	try {
		assertPluginQuestionInputAllowed(record.messages, input);
		if (input.type !== "steers") assertNativeSubmissionTarget(record.messages, input);
		if (input.type === "plugin-problem-submission") requirePluginProblemTarget(record, input);
		if (input.type === "plugin-question-answer") {
			const pending = pendingPluginQuestionOf(record.messages);
			if (!pending || pending.questionId !== input.questionId || !samePluginQuestionOccurrence(pending.occurrence, input.occurrence))
				throw new ChatInputError("This question is no longer pending. Sync the saved session before trying again.");
		}
	}
	catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	if ((input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") && isTurnRunning(chatId))
		return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
	let questionResolver: QuestionTypeResolver | undefined;
	let problemResolver: ProblemTypeResolver | undefined;
	if (input.type === "plugin-problem-submission") {
		try {
			const host = await getPluginHost();
			problemResolver = (pluginId, typeId, version) => host.resolveProblemType(pluginId, typeId, version);
		} catch { return Response.json({ error: "Problem unavailable" }, { status: 400 }); }
	}
	if (input.type === "plugin-question-answer") {
		try {
			const host = await getPluginHost();
			questionResolver = (pluginId, typeId, version) => host.resolveQuestionType(pluginId, typeId, version);
		} catch { return Response.json({ error: "Question unavailable" }, { status: 400 }); }
	}

	if (input.type === "retry") {
		try {
			retryDrops(record.messages);
		} catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	if (input.type === "retry-question") {
		try { questionRecoveryAppends(record.messages, input); }
		catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	const effective = effectiveSettings();
	const conversation = resolveConversationSpec(record.settings, effective.models.strong);
	if (!conversation) {
		const envelope = modelsNotConfigured(["strong"]);
		console.info(`[chat ${chatId}] turn refused — ${JSON.stringify(envelope)}`);
		return Response.json(envelope, { status: 503 });
	}

	if (isSubscriptionProvider(conversation.provider)) {
		await refreshConnectionCatalog(conversation.provider);
		if (input.type === "steers" && !connectionBackgroundAllowed(conversation.provider)) {
			return Response.json({ error: "Background use is off for this connection. Automatic follow-up remains deferred in its queue." }, { status: 403 });
		}
	}
	if (!providerKeyPresent(conversation.provider)) {
		const envelope = providerKeyMissingEnvelope(conversation.provider, ["strong"]);
		console.info(`[chat ${chatId}] turn refused — ${JSON.stringify(envelope)}`);
		return Response.json(envelope, { status: 503 });
	}

	const callPurpose = { background: input.type === "steers" || (input.type === "continue" && reconstructRequestCause(record.messages) !== "foreground") };
	let requestCycle: SubscriptionRequestCycle | undefined;
	const tentativeSideIds = new Set<string>();
	const admittedSideIds = new Set<string>();
	let preparedSideIds = new Set<string>();
	const admitSideContext = () => { for (const id of preparedSideIds) admittedSideIds.add(id); };
	const lifecycle: SubscriptionDispatchLifecycle = {
		captured: (scope) => requestCycle?.captured(scope),
		beforeDispatch: (scope) => { requestCycle?.beforeDispatch(scope); admitSideContext(); },
		noDispatch: (kind) => requestCycle?.noDispatch(kind),
	};
	let conversationEngine: PiEngine;
	let compactionEngine: PiEngine;
	try {
		conversationEngine = piEngineForSpec(conversation, () => callPurpose.background, lifecycle, retentionForSlot("strong"));
		compactionEngine = piEngineForSpec(conversation, true, undefined, retentionForSlot("strong"));
	}
	catch { return Response.json({ error: conversation.provider === "chatgpt" ? chatGPTStreamError("model catalog") : isSubscriptionProvider(conversation.provider) ? nativeSubscriptionError(conversation.provider, "model catalog") : "The selected model is unavailable." }, { status: 503 }); }
	const capturedPolicy = submissionImagePolicyKey(conversationEngine);
	const capturedConversation = JSON.stringify(conversation);
	try {
		switch (input.type) {
			case "text": case "thinking":
				input = { ...input, images: await prepareSubmissionImages(input.images, conversationEngine) };
				break;
			case "answer":
				input = { ...input, answer: { ...input.answer, images: await prepareSubmissionImageChannels(input.answer.images, conversationEngine) } };
				break;
			case "plugin-problem-submission":
				input = { ...input, images: await prepareProblemSubmissionImageChannels(input.images, conversationEngine) };
				break;
			case "plugin-question-answer":
				input = { ...input, images: await prepareSubmissionImageChannels(input.images, conversationEngine) };
				break;
		}
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	const modelIdForCompaction = `${conversationEngine.model.provider}:${conversationEngine.model.id}`;
	const contextWindow = catalogContextLimits().get(modelIdForCompaction);
	const thresholdTokens = effectiveThresholdTokens(effective.compaction?.thresholdTokens, contextWindow);
	const systemPromptTokens = Math.ceil(composeInstructions(record.kind === "practice" ? "practice" : "teacher").length / 4);
	const estimateModel = effective.compaction.includeReasoning ? conversationEngine.model : undefined;
	const fitsSideContext = (messages: readonly OwllyMessage[]) => {
		const live = messages.filter((message) => (message as { role: string }).role !== "system");
		const saved = conversation.provider === CLAUDE_CODE_PROVIDER ? stores.chatStore.getChat(chatId)?.messages ?? [] : [];
		const savedIds = new Set(saved.map((message) => message.id));
		const reportHistory = saved.length ? [...saved, ...live.filter((message) => !savedIds.has(message.id))] : live;
		const window = sideContextWindow(reportHistory, conversationEngine.model, contextWindow, input.type === "retry");
		const budget = window === undefined ? thresholdTokens : Math.max(1, window - Math.min(COMPACTION_RESERVE_TOKENS, conversationEngine.model.maxTokens));
		return projectedContextTokens(live, systemPromptTokens, estimateModel) <= budget;
	};
	const sideBudgetError = () => new Error(SIDE_CONTEXT_BUDGET_ERROR);
	const beforeCompaction = record.messages;
	await ensureCompacted(
		{
			chatStore: stores.chatStore,
			engine: compactionEngine,
			canStart: () => !isTurnRunning(chatId) && connectionBackgroundAllowed(conversation.provider),
			modelId: modelIdForCompaction,
			kind: record.kind === "practice" ? "practice" : hasProbeDone(record.messages) ? "teach" : "probe",
			includeReasoning: effective.compaction.includeReasoning,
			thresholdTokens,
			systemPromptTokens,
			projectMessages: (current) => {
				try {
					if (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") {
						if (input.type === "plugin-question-answer") {
							const pending = pendingPluginQuestionOf(current.messages);
							if (!pending || pending.questionId !== input.questionId || !samePluginQuestionOccurrence(pending.occurrence, input.occurrence)) return current.messages;
							if (questionCallsOf(current.messages).length || pluginQuestionCallsOf(current.messages).some(call =>
								(call.status === "answerable" || call.status === "unreadable") && !samePluginQuestionOccurrence(call.occurrence, pending.occurrence))) return current.messages;
						} else {
							requirePluginProblemTarget(current, input);
							if (hasUnresolvedQuestion(current.messages)) return current.messages;
						}
						const updates = sideConversationEntries({ messages: current.messages, sideChats: sideContext.snapshot(chatId) });
						return updates.length ? [...current.messages, ...updates] : current.messages;
					}
					const next = input.type === "steers" ? input.steers.filter((entry) => !steerDelivered(current.messages, entry.id)) : inputAppends(current, input);
					const after = [...current.messages, ...next];
					if (hasUnresolvedQuestion(after)) return current.messages;
					const updates = sideConversationEntries({ messages: current.messages, sideChats: sideContext.snapshot(chatId) }, after);
					if (!updates.length) return current.messages;
					const projected = [...current.messages, ...(input.type === "answer" || input.type === "retry-question" ? [...next, ...updates] : [...updates, ...next])];
					const omitted = input.type === "retry" ? retryDrops(current.messages) : new Set<string>();
					return projected.filter((message) => !omitted.has(message.id));
				} catch (error) {
					if (error instanceof ChatInputError) return current.messages;
					throw error;
				}
			},
		},
		chatId,
	);
	let pluginContributions: AgentBuildOptions["pluginContributions"];
	if (!buildAgent) {
		try { pluginContributions = await getPluginAgentContributions(); }
		catch (error) {
			console.error("[plugins] Agent contributions unavailable:", error);
		}
	}
	const compactedRecord = stores.chatStore.getChat(chatId);
	if (!compactedRecord) return Response.json({ error: "Unknown chat" }, { status: 404 });
	record = compactedRecord;
	const staleSubmission = () => Response.json({ code: "submission-stale", error: "The submission target or selected model changed. Your input has been kept." }, { status: 412 });
	const submissionIsCurrent = (checkModel = true) => {
		if (!freshSubmission) return true;
		if (record.createdAt !== capturedSession.createdAt || record.kind !== capturedSession.kind) return false;
		try {
			if (checkModel) {
				const spec = resolveConversationSpec(record.settings, effectiveSettings().models.strong);
				if (!spec || JSON.stringify(spec) !== capturedConversation) return false;
				const checked = piEngineForSpec(spec, () => callPurpose.background, lifecycle, retentionForSlot("strong"));
				if (submissionImagePolicyKey(checked) !== capturedPolicy || checked.level !== conversationEngine.level) return false;
			}
			assertPluginQuestionInputAllowed(record.messages, input);
			if (input.type !== "steers") assertNativeSubmissionTarget(record.messages, input);
			if (input.type === "plugin-problem-submission") requirePluginProblemTarget(record, input);
			if (input.type === "plugin-question-answer") {
				const pending = pendingPluginQuestionOf(record.messages);
				if (!pending || pending.questionId !== input.questionId || !samePluginQuestionOccurrence(pending.occurrence, input.occurrence)) return false;
			}
		} catch { return false; }
		return true;
	};
	if (!submissionIsCurrent()) return staleSubmission();
	let retryOmissions = new Set<string>();
	if (input.type === "retry") {
		try {
			retryOmissions = sideBudgetRetryDrops(beforeCompaction, record.messages) ?? retryDrops(record.messages);
		} catch (err) {
			if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
			throw err;
		}
	}

	let preparation: TurnPreparation | undefined;
	let turnClaimed = false;
	let handedOff = false;
	let inputSaved = false;
	const releaseOwnership = () => {
		if (preparation) preparation.finish();
		else { endTurn(chatId); unregisterTurn(chatId); }
	};
	try {
	let appends;
	try {
		assertPluginQuestionInputAllowed(record.messages, input);
		if (compactionInFlight(chatId))
			return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
		if ((input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") && isTurnRunning(chatId))
			return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
		if (input.type === "plugin-question-answer" || input.type === "plugin-problem-submission") {
			const questionSubmission = input.type === "plugin-question-answer" ? preparePluginQuestionSubmission({ id: chatId, messages: record.messages }, input, questionResolver!) : undefined;
			const problemSubmission = input.type === "plugin-problem-submission" ? preparePluginProblemSubmission(record, input, problemResolver!) : undefined;
			const submission = questionSubmission ?? problemSubmission!;
			const work = questionSubmission?.grade ?? problemSubmission?.process;
			if (work) {
				const claim = claimPreparingTurn(chatId);
				if (!claim) return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
				preparation = claim;
				turnClaimed = true;
				const outcome = await work(preparation.signal);
				const current = stores.chatStore.getChat(chatId);
				if (!current || !preparation.isCurrent()) return staleSubmission();
				record = current;
				if (!submissionIsCurrent(false)) return staleSubmission();
				preparation.signal.throwIfAborted();
				appends = submission.finish({ id: chatId, kind: record.kind, messages: record.messages }, outcome);
			} else appends = submission.finish({ id: chatId, kind: record.kind, messages: record.messages });
		} else appends = input.type === "steers"
			? input.steers.filter((s) => !steerDelivered(record.messages, s.id))
			: inputAppends(record, input);
	} catch (err) {
		if (err instanceof ChatInputError) {
			return Response.json({ error: err.message }, { status: 400 });
		}
		throw err;
	}

	if ((input.type === "answer" || input.type === "plugin-question-answer") && hasUnresolvedQuestion([...record.messages, ...appends])) {
		const merged = [...record.messages, ...appends];
		try { stores.chatStore.saveMessages(chatId, merged); inputSaved = true; }
		catch (err) {
			console.error(`[chat ${chatId}] write-ahead persist failed:`, err);
			return new Response("Your input could not be saved. Please try again.", { status: 500 });
		}
		emit("record-changed", { chatId });
		return settledTurnResponse();
	}

	if (!preparation && !beginTurn(chatId)) {
		console.info(`[chat ${chatId}] turn already in flight — request rejected`);
		return Response.json({ error: "A turn is already running for this session" }, { status: 409 });
	}

	turnClaimed = true;

	const sideContextSnapshots = sideContext.snapshot(chatId);
	const afterInput = [...record.messages, ...appends];
	const sideQuestions = hasUnresolvedQuestion(afterInput) ? [] : sideConversationEntries({
		messages: record.messages, sideChats: sideContextSnapshots,
	}, afterInput);
	const withSideQuestions = input.type === "answer" || input.type === "retry-question" || input.type === "plugin-question-answer" ? [...appends, ...sideQuestions] : [...sideQuestions, ...appends];
	const prospective = [...record.messages, ...withSideQuestions].filter((message) => !retryOmissions.has(message.id));
	const sideContextBlocked = sideQuestions.length > 0 && !fitsSideContext(prospective);
	if (sideContextBlocked && isSubscriptionProvider(conversation.provider) && input.type === "steers") {
		endTurn(chatId);
		return new Response(sideBudgetError().message, { status: 400 });
	}
	const merged = [...record.messages, ...appends];
	const agentMessages = input.type === "retry" ? merged.filter((m) => !retryOmissions.has(m.id)) : merged;
	const stagedAutomatic = isSubscriptionProvider(conversation.provider) && input.type === "steers";
	let persistBaseCount = stagedAutomatic ? record.messages.length : agentMessages.length;
	try {
		if (!stagedAutomatic) {
			stores.chatStore.saveMessages(chatId, merged);
			inputSaved = true;
		}
	} catch (err) {
		console.error(`[chat ${chatId}] write-ahead persist failed:`, err);
		return new Response("Your input could not be saved. Please try again.", { status: 500 });
	}
	try {
		if (!stagedAutomatic) noteSteersDurable(chatId, merged);
	} catch (err) {
		console.error(`[chat ${chatId}] input visibility bookkeeping failed:`, err);
	}

	const turnUsageId = crypto.randomUUID();
	const steps: CallUsage[] = [];
	const collectUsage = (usage: Usage) => {
		steps.push({
			inputTokens: usage.input,
			outputTokens: usage.output,
			cacheReadTokens: usage.cacheRead,
			cacheWriteTokens: usage.cacheWrite,
			cacheWrite1hTokens: usage.cacheWrite1h ?? 0,
			reasoningTokens: usage.reasoning ?? 0,
		});
	};

	const teaching = hasProbeDone(agentMessages);
	const engine = conversationEngine;
	const modelId = `${engine.model.provider}:${engine.model.id}`;
	if (isSubscriptionProvider(conversation.provider)) requestCycle = new SubscriptionRequestCycle({
		initialMessages: asAgentMessages(agentMessages),
		staged: stagedAutomatic ? asAgentMessages(appends) : undefined,
		foregroundOwed: !callPurpose.background,
		purpose: callPurpose,
		scopeCurrent: (scope) => connectionScopeCurrent(conversation.provider, scope),
		commitStaged: () => {
			stores.chatStore.saveMessages(chatId, merged);
			persistBaseCount = merged.length;
			noteSteersDurable(chatId, merged);
		},
		restoreAutomatic: (automaticIds, retainedIds) => restoreUncommittedAutomatic(chatId, constructed, automaticIds, retainedIds),
	});
	let pendingSideBudgetError: Error | undefined;
	const agentOpts: AgentBuildOptions = {
		pluginContributions,
		engine,
		callPurpose,
		requestCycle,
		messages: asAgentMessages(agentMessages),
		validateContext: (messages) => {
			preparedSideIds = new Set(messages.map((message) => (message as OwllyMessage).id).filter((id) => tentativeSideIds.has(id)));
			if (pendingSideBudgetError || (preparedSideIds.size > 0 && !fitsSideContext(messages as readonly OwllyMessage[]))) {
				pendingSideBudgetError = sideBudgetError();
				const rejected = new Set([...tentativeSideIds].filter((id) => !admittedSideIds.has(id)));
				constructed.state.messages = constructed.state.messages.filter((message) => !rejected.has((message as OwllyMessage).id));
				requestCycle?.rejectLocalRequest(rejected);
				throw pendingSideBudgetError;
			}
			if (!requestCycle) admitSideContext();
		},
		contextUpdates: (messages) => {
			pendingSideBudgetError = undefined;
			const current = stores.chatStore.getChat(chatId);
			if (!current) return [];
			const saved = new Set(current.messages.map((message) => message.id));
			const live = messages.filter((message) => message.role !== "toolResult" || message.isError || message.details !== null ||
				saved.has((message as OwllyMessage).id) || !(QUESTION_TOOLS as readonly string[]).includes(message.toolName)) as OwllyMessage[];
			if (hasUnresolvedQuestion(live)) return [];
			const pending = live.filter((message) => message.role === "custom" && message.customType === "side-question" && !saved.has(message.id));
			const history = [...current.messages, ...pending];
			const updates = sideConversationEntries({ messages: history, sideChats: sideContext.snapshot(chatId) });
			if (updates.length && !fitsSideContext([...live, ...updates])) {
				pendingSideBudgetError = sideBudgetError();
				return [];
			}
			for (const update of updates) tentativeSideIds.add(update.id);
			return asAgentMessages(updates);
		},
		onUsage: collectUsage,
		toolToggles: effective.agent.tools,
		chatId,
	};
	const constructed: TeachingAgent = buildAgent
		? buildAgent({ ...agentOpts, teaching })
		: record.kind === "practice"
			? createPracticeAgent(
					{
						chatId,
						chatStore: stores.chatStore,
						graphNodes: () => stores.graphStore.readNodes(),
						jobs: {
							chatId,
							jobStore: stores.jobStore,
							spawn: (job, input) => void jobRunner.runJob(job.id, input),
							searchAvailable,
						},
						...(graphToolsEnabled(effective) ? { graph: { chatStore: stores.chatStore, graphStore: stores.graphStore } } : {}),
					},
					agentOpts,
				)
			: teaching
			? createTeacherAgent(
					{
						chatId,
						chatStore: stores.chatStore,
						jobStore: stores.jobStore,
						spawn: (job, input) => void jobRunner.runJob(job.id, input),
						searchAvailable,
					},
					agentOpts,
				)
			: createProberAgent(
					{
						chatId,
						chatStore: stores.chatStore,
						deliver: (steer) => void deliverJobResult(steer),
						jobStore: stores.jobStore,
						spawn: (job, input) => void jobRunner.runJob(job.id, input),
						searchAvailable,
						...(graphToolsEnabled(effective) ? { graphStore: stores.graphStore } : {}),
					},
					agentOpts,
				);

	try {
		registerLiveAgent(chatId, constructed, input.type !== "steers" && input.type !== "continue",
			input.type === "steers" ? new Set(appends.map((message) => message.id)) : undefined);
		providerEventNote(chatId, "turn", `run start (base: ${agentMessages.length} messages)`);
		const handle = runPiTurn({
			agent: constructed,
			requestCycle,
			beforeCycle: () => {
				for (const message of agentOpts.contextUpdates!(constructed.state.messages)) constructed.steer(message);
			},
			...(process.env.OWLLY_UPDATE_FLUSH_MS ? { updateFlushMs: Number(process.env.OWLLY_UPDATE_FLUSH_MS) } : {}),
			usedToolCallIds: new Set(collectToolCallIds(merged)),
			onError: (error) => {
				if (conversation.provider === "chatgpt") return chatGPTStreamError(String(error));
				if (isSubscriptionProvider(conversation.provider)) return nativeSubscriptionError(conversation.provider, String(error));
				console.error(`[chat ${chatId}] turn error:`, error);
				return "An error occurred.";
			},
			onSettleError: settlementErrorText,
			onSettleFailure: (error, reportedErrorText) => {
				if (preparation && !preparation.isCurrent()) return;
				rememberTurnFailure(chatId, reportedErrorText ?? settlementErrorText(error));
				try { applyParkedDismissal(stores.chatStore, chatId); }
				catch (dismissalError) { console.error(`[chat ${chatId}] parked dismissal failed:`, dismissalError); }
				finally { releaseOwnership(); unregisterLiveAgent(chatId); }
				const persisted = stores.chatStore.getChat(chatId)?.messages ?? [];
				reconcileUserSteers(chatId, persisted);
				settleSteers(chatId, persisted, true, constructed);
			},
			onFinish: (turnMessages, isAborted) => {
				if (preparation && !preparation.isCurrent()) return;
				const admittedMessages = turnMessages.filter((message) => !tentativeSideIds.has((message as OwllyMessage).id) || admittedSideIds.has((message as OwllyMessage).id));
				const stamped = persistTurn(stores.chatStore, chatId, persistBaseCount, admittedMessages, isAborted);
				noteSteersDurable(chatId, stores.chatStore.getChat(chatId)?.messages ?? stamped);
				const response = stamped.find((m) => (m as { role?: string }).role === "assistant");
				if (response && steps.length > 0) {
					stores.chatStore.appendTurnUsage(chatId, {
						id: turnUsageId,
						messageId: response.id,
						at: new Date().toISOString(),
						model: modelId,
						steps,
					});
				}
				if ((!requestCycle || requestCycle.dispatched) && record.kind !== "practice" && extractionEnabled(effective.graph)) {
					triggerExtraction(stores, extraction, chatId, effective.graph.extractionChunkTokens);
				}
				applyParkedDismissal(stores.chatStore, chatId);
				releaseOwnership();
				unregisterLiveAgent(chatId);
				settleSteers(chatId, stamped, false, constructed);
				reconcileUserSteers(chatId, stamped);
				if (process.env.NODE_ENV !== "test" && !pendingSideBudgetError && (!requestCycle || requestCycle.dispatched))
					kickCompaction(() => {
						const fresh = effectiveSettings();
						const spec = resolveConversationSpec(stores.chatStore.getChat(chatId)?.settings, fresh.models.strong);
						if (!spec || !connectionBackgroundAllowed(spec.provider)) return null;
						let kickEngine: PiEngine;
						try { kickEngine = piEngineForSpec(spec, true, undefined, retentionForSlot("strong")); } catch { return null; }
						const kickModelId = `${kickEngine.model.provider}:${kickEngine.model.id}`;
						const freshRecord = stores.chatStore.getChat(chatId);
						if (!freshRecord) return null;
						return {
							chatStore: stores.chatStore,
							engine: kickEngine,
							canStart: () => !isTurnRunning(chatId) && connectionBackgroundAllowed(spec.provider),
							modelId: kickModelId,
							kind: freshRecord.kind === "practice" ? "practice" : hasProbeDone(freshRecord.messages) ? "teach" : "probe",
							includeReasoning: fresh.compaction.includeReasoning,
							thresholdTokens: effectiveThresholdTokens(
								fresh.compaction?.thresholdTokens,
								catalogContextLimits().get(kickModelId),
							),
							systemPromptTokens: Math.ceil(composeInstructions(freshRecord.kind === "practice" ? "practice" : "teacher").length / 4),
						};
					}, chatId);
			},
		});
		if (preparation) preparation.handoff(handle);
		else registerTurn(chatId, handle);
		handedOff = true;
		if (stagedAutomatic && requestCycle && !(await requestCycle.admission)) return Response.json({ error: "Automatic follow-up remains deferred in its queue." }, { status: 403 });
		return Response.json({ ok: true });
	} catch (err) {
		console.error(`[chat ${chatId}] turn failed to start:`, err);
		if (preparation && inputSaved) {
			rememberTurnFailure(chatId, "Failed to start the turn");
			return Response.json({ ok: true });
		}
		return Response.json({ error: "Failed to start the turn" }, { status: 500 });
	}
	} catch (err) {
		if (preparation && inputSaved) {
			console.error(`[chat ${chatId}] accepted answer continuation failed:`, err);
			rememberTurnFailure(chatId, "Failed to start the turn");
			return Response.json({ ok: true });
		}
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		if (preparation?.signal.aborted) {
			return Response.json({ error: preparation.signal.reason instanceof Error ? preparation.signal.reason.message : "Question unavailable" }, { status: 409 });
		}
		if (turnClaimed) {
			console.error(`[chat ${chatId}] turn failed to start:`, err);
			return Response.json({ error: "Failed to start the turn" }, { status: 500 });
		}
		throw err;
	} finally {
		if (turnClaimed && !handedOff) {
			try {
				if (!preparation || preparation.isCurrent()) applyParkedDismissal(stores.chatStore, chatId);
			} catch (err) { console.error(`[chat ${chatId}] parked dismissal failed:`, err); }
			finally {
				if (!preparation || preparation.isCurrent()) unregisterLiveAgent(chatId);
				releaseOwnership();
			}
		}
	}
}
