import { KnowledgeGraphPage } from "@/components/knowledge-graph-page";
import { readSettingsRecord } from "@/src/server";
import { resolveSettings } from "@/src/core";

export const dynamic = "force-dynamic";

export default function GraphPage() {
	const rendering = resolveSettings(readSettingsRecord() ?? null).graph.rendering;
	return <KnowledgeGraphPage rendering={rendering} />;
}
