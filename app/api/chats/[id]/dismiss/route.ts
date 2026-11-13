import { assertPluginQuestionInputAllowed,ChatInputError,dismissAppends,emit,parseDismissInput } from "@/src/core";
import { getChat,isTurnRunning,parkDismissal,stores } from "@/src/server";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	let chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });

	let input;
	try {
		const body = (await req.json().catch(() => null)) as { input?: unknown } | null;
		input = parseDismissInput(body?.input ?? null);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	chat = getChat(id);
	if (!chat) return Response.json({ error: "Unknown chat" }, { status: 404 });

	let appends;
	try {
		assertPluginQuestionInputAllowed(chat.messages, input);
		if (input.type === "dismiss-plugin-question") throw new ChatInputError("Unsupported input type");
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	if (isTurnRunning(id)) {
		parkDismissal(id, input);
		return Response.json({ ok: true, parked: true }, { status: 202 });
	}

	try {
		appends ??= dismissAppends(chat, input);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}

	stores.chatStore.saveMessages(id, [...chat.messages, ...appends]);
	emit("record-changed", { chatId: id });
	return Response.json({ ok: true });
}
