import { NewSession } from "@/components/new-session";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

export const dynamic = "force-dynamic";

export default async function NewSessionPage({
	searchParams,
}: {
	searchParams: Promise<{ mode?: string }>;
}) {
	const { mode } = await searchParams;
	return (
		<NewSession
			initialConfigured={slotsConfigured(readSettingsRecord()?.models)}
			mode={mode === "practice" ? "practice" : "teach"}
		/>
	);
}
