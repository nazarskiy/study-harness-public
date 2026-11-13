import { readRenderSettings, writeRenderSettings } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	return Response.json(readRenderSettings());
}

export async function PUT(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ error: "invalid JSON body" }, { status: 400 });
	}
	return Response.json(writeRenderSettings(body));
}
