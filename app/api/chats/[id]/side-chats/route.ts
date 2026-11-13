import { parseSideAskInput, SideChatInputError } from "@/src/core";
import { sideChats } from "@/src/server";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	const listed = sideChats.list(id);
	if (!listed) return Response.json({ error: "Unknown chat" }, { status: 404 });
	return Response.json(listed);
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
	const { id } = await ctx.params;
	let input;
	try {
		input = parseSideAskInput(await request.json().catch(() => null));
	} catch (err) {
		if (err instanceof SideChatInputError) return Response.json({ error: err.message }, { status: 400 });
		throw err;
	}
	return sideChats.ask(id, input);
}
