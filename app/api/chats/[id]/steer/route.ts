import { ChatInputError, parseUserSteerInput } from "@/src/core";
import { getChat, prepareAndSteerChat } from "@/src/server";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	if (!getChat(id)) return Response.json({ error: "unknown chat" }, { status: 404 });
	let input;
	try {
		const body = (await request.json()) as { input?: unknown };
		input = parseUserSteerInput(body?.input);
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	try {
		const result = await prepareAndSteerChat(id, input);
		if (result === "stale") return Response.json({ code: "submission-stale", error: "The live submission target changed. Your input has been kept." }, { status: 412 });
		if (result === "settled") return Response.json({ error: "no live turn to steer" }, { status: 409 });
		return Response.json({ ok: true });
	} catch (err) {
		if (err instanceof ChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
}
