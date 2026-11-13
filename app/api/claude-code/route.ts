import { claudeCodeInstallationResponse } from "@/src/server";

export async function GET(request: Request) {
	return claudeCodeInstallationResponse(request);
}
