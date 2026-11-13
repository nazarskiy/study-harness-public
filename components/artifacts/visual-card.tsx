"use client";

import { useContext, useState } from "react";
import { ChatActionsContext } from "@/components/chat";
import { DownloadIcon, MaximizeIcon } from "@/components/ui/icons";
import { InvertDiscIcon } from "@/components/artifacts/invert-disc";
import { Toggle } from "@/components/settings/controls";
import { useSessionMermaid } from "@/components/session-overlay";
import { downloadFile } from "@/components/artifacts/download";
import { DispatchCard } from "@/components/artifacts/dispatch-card";
import { SvgImage } from "@/components/artifacts/svg-image";
import { embedLearnerImage, type ArtifactPartProps, type VisualResult } from "@/src/core";
import { useImageSnapshot } from "./use-image-snapshot";


export function svgNaturalWidth(svg: string): number | null {
	const m = /<svg\b[^>]*?\bwidth\s*=\s*["']([^"']+)["'][^>]*>/i.exec(svg);
	if (!m) return null;
	const value = m[1]!.trim();
	const px = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
	if (!px) return null;
	const n = Number.parseFloat(px[1]!);
	return Number.isFinite(n) && n > 0 ? n : null;
}

export function VisualCard({ part }: ArtifactPartProps) {
	if (part.state !== "output-available") return null;
	return <DispatchCard toolCallId={part.toolCallId} kind="visual" />;
}

export function VisualOutputCard({
	output,
	messageId,
	initialInverted = false,
}: {
	output: unknown;
	messageId?: string;
	initialInverted?: boolean;
}) {
	const result = output as VisualResult | undefined;
	const snapshot = useImageSnapshot(result?.image?.snapshotId);
	const svg = result?.image && snapshot.image ? embedLearnerImage(result.svg, snapshot.image) : result?.svg ?? "";
	const overlay = useSessionMermaid();
	const actions = useContext(ChatActionsContext);
	const [inverted, setInverted] = useState(initialInverted);
	const toggleInverted = (next: boolean) => {
		setInverted(next);
		if (!actions?.chatId || !messageId) return;
		void fetch(`/api/chats/${actions.chatId}/artifact-ui`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ input: { messageId, inverted: next } }),
		}).catch(() => {});
	};
	const natural = result && typeof result.svg === "string" ? svgNaturalWidth(result.svg) : null;
	if (!result || typeof result.svg !== "string") {
		return (
			<div className="rounded-2xl border-2 bg-card p-4 text-sm text-muted-foreground">
				Figure completed, but the result could not be displayed.
			</div>
		);
	}
	const failed = result.svg.length === 0;
	const invertible = result.image === undefined;
	const shownInverted = invertible && inverted;
	if (failed) {
		return (
			<div className="rounded-2xl border-2 bg-card p-4 text-card-foreground" data-testid="visual-card-failed">
				<div className="flex items-center gap-2 text-xs font-extrabold text-muted-foreground">
					Figure
					<span className="rounded-md bg-error/15 px-1.5 py-0.5 text-error">failed</span>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">{result.notes ?? "The figure could not be drawn."}</p>
			</div>
		);
	}
	if (result.image && !snapshot.image) return <div className="my-4 text-sm text-muted-foreground" role="status">{snapshot.failed ? "Image snapshot could not be loaded." : "Loading image…"}</div>;
	return (
		<div
			className={
				!invertible || natural !== null
					? "my-4 mx-auto w-fit max-w-full"
					: "my-4 w-full"
			}
			data-testid="visual-card"
		>
			{
}
			<div
				className={
					!invertible || natural !== null
						? "w-fit max-w-full overflow-hidden rounded-lg bg-white"
						: "w-full overflow-hidden rounded-lg bg-white"
				}
				style={{ filter: shownInverted ? "invert(1) hue-rotate(180deg)" : undefined }}
				data-testid="visual-svg"
			>
				<SvgImage
					svg={svg}
					width={natural ?? undefined}
					className={
						!invertible
							? "block h-auto w-auto max-h-[60vh] max-w-full"
							: natural !== null ? "block h-auto max-w-full" : "block h-auto w-full"
					}
				/>
			</div>
			<div className={
				!invertible
					? "mt-2 flex w-0 min-w-full flex-wrap items-center justify-between gap-2"
					: "mt-2 flex items-center justify-between gap-2"
			}>
				<div className="text-xs font-extrabold text-muted-foreground">Figure</div>
				<div className={!invertible ? "ml-auto flex items-center gap-1.5" : "flex items-center gap-1.5"}>
					{
}
					{invertible && (
						<Toggle
							checked={inverted}
							onChange={toggleInverted}
							label="Invert figure brightness"
							title="Invert colors"
							discIcon={<InvertDiscIcon className="size-3" />}
						/>
					)}
					<button
						type="button"
						aria-label="Download figure as SVG"
						title="Download as SVG"
						onClick={() => downloadFile("figure.svg", svg, "image/svg+xml")}
						data-testid="visual-download"
						className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<DownloadIcon className="size-3.5" />
					</button>
					{overlay && (
						<button
							type="button"
							aria-label="Open figure fullscreen"
							title="Open fullscreen"
							onClick={() => overlay.openFigure(svg, shownInverted)}
							data-testid="visual-open"
							className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
						>
							<MaximizeIcon className="size-3.5" />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
