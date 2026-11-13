
import {
	buildAbortSteer,
	buildJobFailureSteer,
	buildSubagentSteer,
	isSubagentFailure,
	steerDelivered,
	type JobRecord,
	type SteerMessage,
} from "../core/contracts.ts";
import type { TurnInput, UserSteerInput } from "../core/input-events.ts";
import { hasUnresolvedQuestion, endsInDismissal, endsInQuestionRecovery, newUserSteer, type OwllyMessage } from "../core/native-messages.ts";
import { prepareSubmissionImages, submissionImagePolicyKey } from "./submission-images.ts";
import { fireJobAbort, isJobLive } from "../agent/subagents/aborts.ts";
import { stores, effectiveSettings } from "./stores.ts";
import { resolveConversationSpec } from "../core/settings-resolution.ts";
import { connectionBackgroundAllowed, isSubscriptionProvider, onSubscriptionChange } from "../agent/subscription-connections.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import type { Agent } from "@earendil-works/pi-agent-core";

export type TurnRunner = (chatId: string, input: TurnInput) => Promise<number>;

interface QueuedSteer {
	steer: SteerMessage;
	promise: Promise<void>;
	waking?: boolean;
	wakeAgent?: Agent;
	deferred?: boolean;
	resolve: () => void;
	reject: (reason: Error) => void;
	handedTo?: Agent;
}

interface WakeState {
	turnRunner?: TurnRunner;
	queues: Map<string, QueuedSteer[]>;
	userSteers: Map<string, UserSteerEntry[]>;
	liveAgents: Map<string, Agent>;
	pumping: Set<string>;
	stopConnectionWatch?: () => void;
	automaticDeferred: WeakSet<Agent>;
}

interface OwllyWakeGlobal {
	__lhWakePipeline?: WakeState;
}

function state(): WakeState {
	const g = globalThis as typeof globalThis & OwllyWakeGlobal;
	return (g.__lhWakePipeline ??= { queues: new Map(), liveAgents: new Map(), userSteers: new Map(), pumping: new Set(), automaticDeferred: new WeakSet() });
}

export function setTurnRunner(run: TurnRunner): void {
	state().turnRunner = run;
}

const POLL_MS = 400;
const GRACE_MS = 750;
const RETRY_BACKOFF_MS = [500, 1000, 2000, 5000] as const;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function jobIdOf(steer: SteerMessage): string | null {
	const details = steer.details as { jobId?: string } | undefined;
	return typeof details?.jobId === "string" ? details.jobId : null;
}

export function noteSteersDurable(chatId: string, persisted: readonly OwllyMessage[]): void {
	for (const message of persisted) {
		if (message.role === "custom") finalizeSteer(message);
	}
	for (const entry of [...(state().queues.get(chatId) ?? [])]) {
		if (persisted.some((message) => message.id === entry.steer.id)) completeEntry(chatId, entry);
	}
}

function removeEntry(chatId: string, entry: QueuedSteer): void {
	const remaining = (state().queues.get(chatId) ?? []).filter((candidate) => candidate !== entry);
	if (remaining.length > 0) state().queues.set(chatId, remaining);
	else state().queues.delete(chatId);
}

function completeEntry(chatId: string, entry: QueuedSteer): void {
	finalizeSteer(entry.steer);
	removeEntry(chatId, entry);
	entry.resolve();
}

export function discardChatDeliveries(chatId: string): void {
	const s = state();
	const queue = s.queues.get(chatId) ?? [];
	s.queues.delete(chatId);
	s.userSteers.delete(chatId);
	for (const entry of queue) entry.resolve();
}

function finalizeSteer(steer: SteerMessage): void {
	const jobId = jobIdOf(steer);
	if (jobId) finalizeJob(jobId);
}

export function deliverJobResult(steer: SteerMessage): Promise<void> {
	const chatId = chatIdOf(steer);
	const entry = queueSteer(chatId, steer);
	void pump(chatId);
	return entry.promise;
}

function queueSteer(chatId: string, steer: SteerMessage): QueuedSteer {
	const queue = state().queues.get(chatId) ?? [];
	const existing = queue.find((entry) => entry.steer.id === steer.id);
	if (existing) return existing;
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
	void promise.catch(() => undefined);
	const entry: QueuedSteer = { steer, promise, resolve, reject };
	queue.push(entry);
	state().queues.set(chatId, queue);
	return entry;
}

export function automaticFollowUpAllowed(chatId: string, agent?: Agent): boolean {
	if (agent && state().automaticDeferred.has(agent)) return false;
	const provider = agent?.state?.model?.provider ?? resolveConversationSpec(stores.chatStore.getChat(chatId)?.settings, effectiveSettings().models.strong)?.provider;
	return connectionBackgroundAllowed(provider);
}

function handOffEligible(chatId: string, agent: Agent): void {
	const queue = state().queues.get(chatId);
	if (automaticFollowUpAllowed(chatId, agent) && queue && queue.length > 0) {
		for (const entry of queue) {
			if (!entry.waking && !entry.deferred && entry.handedTo !== agent && entry.steer.customType !== "probe-handoff") {
				agent.steer(entry.steer);
				entry.handedTo = agent;
			}
		}
	}
	const userQueue = state().userSteers.get(chatId);
	if (userQueue && userQueue.length > 0) {
		for (const entry of userQueue) {
			if (entry.handedTo !== agent) {
				agent.steer(entry.message);
				entry.handedTo = agent;
			}
		}
	}
}

export function registerLiveAgent(chatId: string, agent: Agent, allowDeferred = true, wakeSteerIds?: ReadonlySet<string>): void {
	state().liveAgents.set(chatId, agent);
	restorePendingDeliveries(chatId);
	for (const entry of state().queues.get(chatId) ?? []) {
		if (allowDeferred) entry.deferred = false;
		if (entry.waking && wakeSteerIds?.has(entry.steer.id)) entry.wakeAgent = agent;
	}
	handOffEligible(chatId, agent);
}

export interface UserSteerEntry {
	message: OwllyMessage;
	handedTo?: Agent;
}

export async function prepareAndSteerChat(chatId: string, input: UserSteerInput): Promise<"accepted" | "settled" | "stale"> {
	const agent = state().liveAgents.get(chatId);
	if (!agent) return "settled";
	const model = agent.state.model;
	const session = stores.chatStore.getChat(chatId);
	if (!model || !session) return "stale";
	const policy = submissionImagePolicyKey({ model });
	const { text, id } = input;
	const images = await prepareSubmissionImages(input.images, { model });
	const currentSession = stores.chatStore.getChat(chatId);
	if (!currentSession || currentSession.createdAt !== session.createdAt || currentSession.kind !== session.kind) return "stale";
	const current = state().liveAgents.get(chatId);
	if (!current) return "settled";
	if (current !== agent || current.state.model !== model || submissionImagePolicyKey({ model }) !== policy) return "stale";
	return steerLiveChat(chatId, newUserSteer(text, id, images)) ? "accepted" : "settled";
}

export function steerLiveChat(chatId: string, message: OwllyMessage): boolean {
	const agent = state().liveAgents.get(chatId);
	if (!agent) return false;
	const entry: UserSteerEntry = { message };
	const q = state().userSteers.get(chatId) ?? [];
	q.push(entry);
	state().userSteers.set(chatId, q);
	agent.steer(message);
	entry.handedTo = agent;
	return true;
}

export function reconcileUserSteers(chatId: string, persisted: readonly OwllyMessage[]): void {
	const q = state().userSteers.get(chatId);
	if (!q || q.length === 0) return;
	const ids = new Set(persisted.map((m) => (m as { id?: string }).id));
	const kept = q.filter((e) => !ids.has(e.message.id));
	if (kept.length === 0) state().userSteers.delete(chatId);
	else state().userSteers.set(chatId, kept);
}

export function unregisterLiveAgent(chatId: string): void {
	const agent = state().liveAgents.get(chatId);
	if (agent) state().automaticDeferred.delete(agent);
	state().liveAgents.delete(chatId);
}

export function restoreUncommittedAutomatic(chatId: string, agent: Agent, automaticIds: ReadonlySet<string>, retainedIds: ReadonlySet<string>): void {
	const s = state();
	s.automaticDeferred.add(agent);
	for (const entry of s.queues.get(chatId) ?? []) {
		if (entry.handedTo === agent && automaticIds.has(entry.steer.id)) entry.handedTo = undefined;
	}
	agent.clearSteeringQueue();
	for (const entry of s.userSteers.get(chatId) ?? []) {
		if (!retainedIds.has(entry.message.id)) { agent.steer(entry.message); entry.handedTo = agent; }
	}
}

export function settleSteers(chatId: string, persisted: { id?: string }[], failed = false, settledAgent?: Agent): void {
	const queue = state().queues.get(chatId);
	if (!queue || queue.length === 0) return;
	const deliveredIds = new Set(persisted.map((m) => m.id).filter(Boolean));
	const remaining: QueuedSteer[] = [];
	for (const entry of queue) {
		if (deliveredIds.has(entry.steer.id)) {
			finalizeSteer(entry.steer);
			entry.resolve();
		} else {
			const handedHere = entry.handedTo !== undefined && (!settledAgent || entry.handedTo === settledAgent);
			const wakeHere = settledAgent !== undefined && entry.wakeAgent === settledAgent;
			if (handedHere) entry.handedTo = undefined;
			if (wakeHere) { entry.waking = false; entry.wakeAgent = undefined; }
			if (failed && (handedHere || wakeHere) && jobIdOf(entry.steer)) entry.deferred = true;
			remaining.push(entry);
		}
	}
	if (remaining.length === 0) state().queues.delete(chatId);
	else {
		state().queues.set(chatId, remaining);
		void pump(chatId);
	}
}

export interface AbortOutcome {
	ok: boolean;
	reason?: "not_found" | "not_running";
}

export function abortJob(jobId: string): AbortOutcome {
	const job = stores.jobStore.getJob(jobId);
	if (!job) return { ok: false, reason: "not_found" };
	if (job.status !== "running") return { ok: false, reason: "not_running" };
	if (job.result) {
		normalizeLegacyResult(job);
		return { ok: false, reason: "not_running" };
	}

	stores.jobStore.updateJob(jobId, {
		status: "error", error: "Aborted by learner", activity: "aborted",
		delivery: { kind: "abort", status: "pending" },
	});
	fireJobAbort(jobId);
	void deliverJobResult(buildAbortSteer(job)).catch(() => {
	});
	return { ok: true };
}

function chatIdOf(steer: SteerMessage): string {
	if (steer.customType === "probe-handoff") {
		return (steer.details as { chatId: string }).chatId;
	}
	const jobId = jobIdOf(steer);
	const job = jobId ? stores.jobStore.getJob(jobId) : undefined;
	return job?.chatId ?? "";
}

async function pump(chatId: string): Promise<void> {
	if (!chatId) return;
	const s = state();
	if (s.pumping.has(chatId)) return;
	s.pumping.add(chatId);
	let parked = false;
	try {
		for (let attempt = 0; ; ) {
			const queue = s.queues.get(chatId);
			if (!queue || queue.length === 0) {
				s.queues.delete(chatId);
				return;
			}

			const record = stores.chatStore.getChat(chatId);
			if (!record) {
				s.queues.delete(chatId);
				for (const entry of queue) {
					entry.reject(new Error(`chat ${chatId} not found — cannot deliver steer ${entry.steer.id}`));
				}
				continue;
			}

			noteSteersDurable(chatId, record.messages);
			const stillPending = (s.queues.get(chatId) ?? []).filter((entry) => !entry.waking && !entry.deferred);
			if (stillPending.length === 0) { parked = true; return; }
			if (!automaticFollowUpAllowed(chatId, s.liveAgents.get(chatId))) { parked = true; return; }

			const live = s.liveAgents.get(chatId);
			if (live && isTurnRunning(chatId)) {
				handOffEligible(chatId, live);
				const handable = stillPending.filter((e) => e.handedTo === live);
				const handoffWaits = stillPending.some(
					(e) => e.steer.customType === "probe-handoff",
				);
				if (handable.length > 0 && !handoffWaits) {
					return;
				}
				if (handable.length > 0) {
					await delay(POLL_MS);
					await waitForIdle(chatId);
					continue;
				}
			}

			await waitForIdle(chatId);

			const fresh = stores.chatStore.getChat(chatId);
			if (!fresh) {
				continue;
			}

			if (!s.turnRunner) {
				const err = new Error("wake pipeline: no turn runner wired (setTurnRunner)");
				for (const entry of stillPending) deferOrReject(chatId, entry, err);
				parked = true;
				return;
			}

			noteSteersDurable(chatId, fresh.messages);
			const fire = (s.queues.get(chatId) ?? []).filter((entry) => !entry.waking && !entry.deferred && !entry.handedTo);
			if (fire.length === 0) return;

			if (endsInDismissal(fresh.messages) || endsInQuestionRecovery(fresh.messages) || !automaticFollowUpAllowed(chatId)) {
				parked = true;
				return;
			}

			for (const entry of fire) entry.waking = true;
			const steers = fire.map((e) => e.steer);

			const status = await s.turnRunner(chatId, { type: "steers", steers }).catch((err: unknown) => {
				console.error(`[steer ${steers.map((x) => x.id).join(",")}] wake turn crashed:`, err);
				return -1;
			});
			const saved = stores.chatStore.getChat(chatId);
			if (saved) noteSteersDurable(chatId, saved.messages);
			const owned = fire.filter((entry) => s.queues.get(chatId)?.includes(entry));
			if (status === 403 || status === 409) {
				for (const entry of owned) { entry.waking = false; entry.wakeAgent = undefined; }
				if (status === 403) { parked = true; return; }
				await delay(RETRY_BACKOFF_MS[Math.min(attempt++, RETRY_BACKOFF_MS.length - 1)]!);
				continue;
			}
			attempt = 0;
			for (const entry of owned) {
				if (status === 200 && !jobIdOf(entry.steer)) {
					completeEntry(chatId, entry);
				} else if (status !== 200 || !isTurnRunning(chatId)) {
					deferOrReject(chatId, entry, new Error(`wake turn did not persist steer (status ${status})`));
				}
			}
		}
	} finally {
		s.pumping.delete(chatId);
		const q = state().queues.get(chatId) ?? [];
		if (!parked && automaticFollowUpAllowed(chatId, state().liveAgents.get(chatId)) && q.some((e) => e.handedTo === undefined && !e.waking && !e.deferred)) void pump(chatId);
	}
}

state().stopConnectionWatch?.();
state().stopConnectionWatch = onSubscriptionChange(() => {
	const s = state();
	for (const [chatId, agent] of s.liveAgents) {
		if (!isSubscriptionProvider(agent.state?.model?.provider) || automaticFollowUpAllowed(chatId, agent)) continue;
		const consumed = new Set(agent.state.messages.map((m) => (m as { id?: string }).id));
		const pending = (s.queues.get(chatId) ?? []).filter((entry) => entry.handedTo === agent && !consumed.has(entry.steer.id));
		if (pending.length === 0) continue;
		agent.clearSteeringQueue();
		for (const entry of pending) entry.handedTo = undefined;
		for (const entry of s.userSteers.get(chatId) ?? []) if (!consumed.has(entry.message.id)) entry.handedTo = undefined;
		handOffEligible(chatId, agent);
	}
	for (const chatId of s.queues.keys()) {
		if (automaticFollowUpAllowed(chatId, s.liveAgents.get(chatId))) void pump(chatId);
	}
});

function deferOrReject(chatId: string, entry: QueuedSteer, error: Error): void {
	entry.waking = false;
	entry.wakeAgent = undefined;
	if (jobIdOf(entry.steer)) {
		entry.deferred = true;
		console.error(`[steer ${entry.steer.id}] delivery remains pending:`, error.message);
	} else {
		removeEntry(chatId, entry);
		entry.reject(error);
	}
}

function finalizeJob(jobId: string): void {
	try {
		let job = stores.jobStore.getJob(jobId);
		if (!job) return;
		if (!job.delivery) job = normalizeLegacyResult(job);
		if (job.delivery?.status !== "pending") return;
		stores.jobStore.updateJob(jobId, { delivery: { ...job.delivery, status: "delivered" } });
	} catch (error) {
		console.error(`[job ${jobId}] delivery acknowledgement failed:`, error);
	}
}

function normalizeLegacyResult(job: JobRecord): JobRecord {
	if (job.delivery || job.status !== "running" || !job.result) return job;
	const failed = isSubagentFailure(job.kind, job.result as never);
	return stores.jobStore.updateJob(job.id, {
		status: failed ? "error" : "done", activity: failed ? "failed" : "finished",
		delivery: { kind: "result", status: "pending" },
	}) ?? job;
}

function restorePendingDeliveries(chatId: string): void {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return;
	noteSteersDurable(chatId, record.messages);
	for (const stored of stores.jobStore.listJobs(chatId)) {
		const live = isJobLive(stored.id);
		if (stored.kind === "plugin" && live && !(state().queues.get(chatId) ?? []).some((entry) => jobIdOf(entry.steer) === stored.id)) continue;
		const job = live ? stored : normalizeLegacyResult(stored);
		if (job.delivery?.status !== "pending") continue;
		const steer = job.delivery.kind === "abort" ? buildAbortSteer(job)
			: job.delivery.kind === "failure" ? buildJobFailureSteer(job, job.error ?? "Background job recovery or delivery failed")
			: job.result ? buildSubagentSteer(job, job.result as never) : undefined;
		if (!steer) continue;
		if (steerDelivered(record.messages, steer.id)) finalizeSteer(steer);
		else queueSteer(chatId, steer);
	}
}

async function waitForIdle(chatId: string): Promise<void> {
	for (;;) {
		const record = stores.chatStore.getChat(chatId);
		if (!record || !(state().queues.get(chatId) ?? []).some((entry) => !entry.waking && !entry.deferred && !entry.handedTo)) return;
		const blocked = isTurnRunning(chatId) || hasUnresolvedQuestion(record.messages);
		if (!blocked) {
			await delay(GRACE_MS);
			const recheck = stores.chatStore.getChat(chatId);
			if (
				!isTurnRunning(chatId) &&
				recheck &&
				!hasUnresolvedQuestion(recheck.messages)
			) {
				return;
			}
		}
		await delay(POLL_MS);
	}
}

export function listJobs(chatId: string): JobRecord[] {
	return stores.jobStore.listJobs(chatId);
}
