import { compactionInFlight, deleteChatSession, getChat, isTurnRunning, sessionCoverage, sessionCost, stores, turnFailure, type ChatDeleteMode, pluginQuestionAvailabilityOf, reconcilePluginQuestionCompatibility, type QuestionTypeResolver, getPluginQuestionTypeResolver, getPluginHost, pluginProblemAvailabilityOf, type ProblemTypeResolver } from "@/src/server";
import { pendingPluginQuestionOf, activeProblemOf } from "@/src/core";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	await reconcilePluginQuestionCompatibility(stores.chatStore, id);
	let chat = getChat(id);
	if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	let questionResolver: QuestionTypeResolver | undefined;
	if (pendingPluginQuestionOf(chat.messages)) {
		try { questionResolver = await getPluginQuestionTypeResolver(); } catch {  }
		chat = getChat(id);
		if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	}
	let problemResolver: ProblemTypeResolver | undefined;
	if (activeProblemOf(chat.messages)?.pluginProblem) {
		try { problemResolver = (await getPluginHost()).resolveProblemType; } catch {  }
		chat = getChat(id);
		if (!chat) return Response.json({ error: "Not found" }, { status: 404 });
	}
	const { imageSnapshots: _imageSnapshots, ...record } = chat;
	return Response.json({
		...record,
		messages: chat.messages,
		pluginQuestionAvailability: pluginQuestionAvailabilityOf(chat, questionResolver),
		pluginProblemAvailability: pluginProblemAvailabilityOf(chat, problemResolver),
		pricing: sessionCost(chat),
		turnInFlight: isTurnRunning(id),
		turnError: turnFailure(id),
		compacting: compactionInFlight(id),
		coverage: sessionCoverage(id),
	});
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!getChat(id)) return Response.json({ error: "Not found" }, { status: 404 });
	const body = (await req.json().catch(() => null)) as { title?: unknown } | null;
	if (typeof body?.title !== "string" || body.title.trim() === "") {
		return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
	}
	const title = body.title.trim();
	const record = stores.chatStore.renameChat(id, title);
	return Response.json({ title: record.title });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const mode = new URL(req.url).searchParams.get("mode");
	if (mode !== "preserve-graph" && mode !== "delete-nodes") {
		return Response.json(
			{
				error: 'mode is required and must be "preserve-graph" or "delete-nodes"',
				code: "bad_mode",
			},
			{ status: 400 },
		);
	}
	const outcome = await deleteChatSession(id, mode as ChatDeleteMode);
	if (!outcome.ok) {
		return Response.json(
			{
				error: outcome.error,
				code: outcome.code,
				...("jobIds" in outcome ? { jobIds: outcome.jobIds } : {}),
		},
			{ status: outcome.status },
		);
	}
	return Response.json({
		ok: true,
		mode: outcome.mode,
		stats: outcome.stats,
		jobsRemoved: outcome.jobsRemoved,
		graphRevision: outcome.graphRevision,
	});
}
