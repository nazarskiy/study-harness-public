"use client";

import { CircleX } from "@/components/ui/icons";
import type { PdfResult, ResearchResult, SubagentArtifactData } from "@/src/core";
import type { OwllyViewMessage, PluginBackgroundResult, SubagentResultMeta } from "@/src/core";
import { isSubagentFailure } from "@/src/core";
import { DemoOutputCard } from "@/components/artifacts/demo-card";
import { PdfBriefCard, ResearchBriefCard } from "@/components/artifacts/job-card";
import { VisualOutputCard } from "@/components/artifacts/visual-card";
import { PluginWorkerCard } from "@/components/artifacts/plugin-worker-card";
import { WorkerResultDetails } from "@/components/artifacts/worker-result-presentation";

export function SubagentSteerCard({ message }: { message: OwllyViewMessage }) {
	const artifactPart = message.parts.find((p) => p.type === "data-subagent-artifact");
	const data = artifactPart?.data as SubagentArtifactData | undefined;
	if (!data) {
		const aborted = message.parts.find((p) => p.type === "data-subagent-aborted") as
			| { data?: { kind?: string; failure?: string } }
			| undefined;
		if (typeof aborted?.data?.failure === "string") return (
			<div data-testid="job-delivery-failure" role="alert" className="space-y-1 rounded-2xl border-2 bg-card p-4 text-sm">
				<p className="font-medium">Background job recovery/delivery failed</p>
				<p className="whitespace-pre-wrap break-words text-muted-foreground">{aborted.data.failure}</p>
			</div>
		);
		if (aborted?.data) return <AbortedBadge kind={aborted.data.kind ?? "job"} />;
		return (
				<div className="rounded-2xl border-2 bg-card p-4 text-sm text-muted-foreground">
				A sub-agent finished, but its result could not be displayed.
			</div>
		);
	}
	switch (data.kind) {
		case "plugin": {
			const meta = (message.metadata as { subagentResult?: SubagentResultMeta } | undefined)?.subagentResult;
			return <PluginWorkerCard result={data.result as PluginBackgroundResult} toolCallId={meta?.toolCallId ?? ""} />;
		}
		case "research":
			return isSubagentFailure("research", data.result as ResearchResult) ? (
				<ResearchBriefCard output={data.result} />
			) : (
				<ResearchCompleteBadge result={data.result as ResearchResult} />
			);
		case "pdf":
			return isSubagentFailure("pdf", data.result as PdfResult) ? (
				<PdfBriefCard output={data.result} />
			) : (
				<PdfCompleteBadge result={data.result as PdfResult} />
			);
		case "demo":
			return <DemoOutputCard output={data.result} messageId={message.id} initialInverted={data.ui?.inverted ?? false} />;
		case "visual":
			return <VisualOutputCard output={data.result} messageId={message.id} initialInverted={data.ui?.inverted ?? false} />;
	}
}

function AbortedBadge({ kind }: { kind: string }) {
	return (
		<div data-testid="job-aborted-badge" className="flex items-center gap-2 text-xs text-muted-foreground">
			<CircleX className="size-3.5" />
			<span className="font-extrabold">{kind}</span>
			<span>aborted by the learner</span>
		</div>
	);
}

function PdfCompleteBadge({ result }: { result: PdfResult }) {
	const readPages = result.pagesRead ?? result.pagesConsulted;
	return (
		<WorkerResultDetails testId="pdf-complete-badge" heading={<>
				<span className="font-extrabold">PDF</span>
				<span>reading complete</span>
				{readPages.length > 0 && (
					<span>
						· read {readPages.length} page{readPages.length === 1 ? "" : "s"}
					</span>
				)}
			</>}>
			<PdfBriefCard output={result} />
		</WorkerResultDetails>
	);
}

function ResearchCompleteBadge({ result }: { result: ResearchResult }) {
	return (
		<WorkerResultDetails testId="research-complete-badge" heading={<>
				<span className="font-extrabold">Research</span>
				<span>complete</span>
				{result.sources.length > 0 && <span>· {result.sources.length} sources</span>}
			</>}>
			<ResearchBriefCard output={result} />
		</WorkerResultDetails>
	);
}
