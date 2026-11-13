export interface QueuedSteerLine {
	id: string;
	text: string;
}

export function QueuedSteersBody({ steers }: { steers: QueuedSteerLine[] }) {
	if (steers.length === 0) return null;
	return (
		<div className="flex flex-col items-end gap-0.5 pb-1 pr-4" data-testid="queued-steers">
			{steers.map((s) => (
				<span
					key={s.id}
					title={s.text}
					className="block max-w-[240px] truncate text-xs text-muted-foreground/60"
				>
					{s.text}
				</span>
			))}
		</div>
	);
}
