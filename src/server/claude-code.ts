import { inspectClaudeInstallation } from "../agent/claude-code/installation.ts";
import { initAuthEnv } from "./keys.ts";
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
import { claudeCodeEnabled } from "./claude-code-config.ts";

export async function claudeCodeInstallationStatus() {
	initAuthEnv();
	return inspectClaudeInstallation();
}

export async function claudeCodeInstallationResponse(
	request: Request,
	inspect = claudeCodeInstallationStatus,
	enabled = claudeCodeEnabled,
): Promise<Response> {
	const origin = subscriptionRequestOrigin(request);
	const supplied = request.headers.get("origin");
	const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
	if (request.method !== "GET" || !origin
		|| request.headers.get("x-owlly-claude-code") !== "1"
		|| request.headers.get("sec-fetch-site") === "cross-site"
		|| (supplied !== null && supplied !== origin)) {
		return Response.json({ error: "Claude Code checks require a same-origin Owlly request." }, { status: 403, headers });
	}
	if (!enabled()) return Response.json({ error: "Claude Code is disabled." }, { status: 403, headers });
	return Response.json(await inspect(), { headers });
}
