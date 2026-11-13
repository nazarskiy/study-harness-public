
import { settingsStore, fileAccessConfigurationError } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET() {
	const fileAccessError = fileAccessConfigurationError();
	return Response.json({ settings: settingsStore.readSettings(), ...(fileAccessError ? { fileAccessError } : {}) });
}
