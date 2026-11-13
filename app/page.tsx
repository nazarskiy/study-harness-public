import { Home } from "@/components/home";
import { readSettingsRecord } from "@/src/server";
import { slotsConfigured } from "@/src/core";

export const dynamic = "force-dynamic";

export default function HomePage() {
	const record = readSettingsRecord();
	return (
		<Home initialConfigured={slotsConfigured(record?.models)} />
	);
}
