import { cn } from "@/lib/utils";

export function StatusBadge({ text, color }: { text: string; color?: string }) {
	return (
		<span
			data-slot="status-badge"
			className={cn(
				"rounded-full px-2 py-0.5 text-xs font-extrabold",
				color === undefined && "bg-muted text-muted-foreground",
			)}
			style={color === undefined ? undefined : {
				color,
				backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)`,
			}}
		>
			{text}
		</span>
	);
}
