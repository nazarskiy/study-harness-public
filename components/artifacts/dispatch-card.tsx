"use client";

import { useContext } from "react";
import { CheckIcon, SettingsIcon, XIcon } from "@/components/ui/icons";
import { JobsContext } from "@/components/jobs-context";
import { ChatActionsContext } from "@/components/chat";
import { isModelsRefusal, isProviderKeyRefusal, type JobKind, type JobRecord } from "@/src/core";
import { OwlBusy } from "@/components/owl/owl-busy";

const KIND_LABEL: Record<JobKind, string> = {
	research: "Research agent",
	demo: "Demo agent",
	visual: "Figure agent",
	pdf: "PDF reader",
	plugin: "Plugin worker",
};

export function DispatchCard({ toolCallId, kind }: { toolCallId: string; kind: JobKind }) {
	const jobs = useContext(JobsContext);
	const job = jobs.find((j) => j.toolCallId === toolCallId) ?? null;
	const label = kind === "plugin" ? job?.plugin?.label || job?.plugin?.toolName || KIND_LABEL.plugin : KIND_LABEL[kind];

	if (!job || job.status === "running") {
		return <DispatchActivityCard job={job} label={label} />;
	}
	if (isModelsRefusal(job.error)) {
		return <DispatchRefusedCard label={label} line="needs model setup" button="Set up models" />;
	}
	if (isProviderKeyRefusal(job.error)) {
		return <DispatchRefusedCard label={label} line="needs a provider key" button="Add a key" />;
	}
	const failed = job.status === "error";
	return (
		<div
			className="flex items-center gap-2 text-xs text-muted-foreground"
			data-testid="dispatch-settled"
		>
			{failed ? <XIcon className="size-3.5 text-error" /> : <CheckIcon className="size-3.5" />}
			<span className="font-extrabold">{label}</span>
			<span>{failed ? "failed" : "finished"}</span>
		</div>
	);
}

function DispatchRefusedCard({ label, line, button }: { label: string; line: string; button: string }) {
	const ctx = useContext(ChatActionsContext);
	return (
		<div
			className="flex items-center gap-2 text-xs text-muted-foreground"
			data-testid="dispatch-refused"
		>
			<SettingsIcon className="size-3.5" />
			<span className="font-extrabold">{label}</span>
			<span>{line}</span>
			{ctx && (
				<button
					type="button"
					data-testid="dispatch-setup-link"
					onClick={ctx.openSetup}
					className="ml-1 rounded-lg border-2 border-border bg-card px-2 py-0.5 normal-case tracking-normal text-foreground transition-colors hover:border-muted-foreground/50"
				>
					{button}
				</button>
			)}
		</div>
	);
}

function DispatchActivityCard({ job, label }: { job: JobRecord | null; label: string }) {
	const elapsed =
		job && job.createdAt ? Math.max(0, Math.round((Date.now() - Date.parse(job.createdAt)) / 1000)) : null;
	return (
		<div
			className="rounded-2xl border-2 bg-card p-4 text-card-foreground"
			data-testid="dispatch-card"
		>
			<div className="flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
				{
}
				<OwlBusy label={`${label} running`} />
				{label}
				{elapsed !== null && <span className="font-normal">· {elapsed}s</span>}
			</div>
			{job?.activity && (
				<div className="mt-1 truncate text-sm text-muted-foreground" data-testid="dispatch-activity-line">
					{job.activity}
				</div>
			)}
			{!job && (
				<div className="mt-1 text-sm text-muted-foreground" data-testid="dispatch-pending">
					Dispatched…
				</div>
			)}
		</div>
	);
}
