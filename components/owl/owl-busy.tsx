import { cn } from "@/lib/utils";
import { Owl } from "./owl";

export function OwlBusy({
	className,
	label = "Working",
	withOwl = false,
	showLabel = false,
}: {
	className?: string;
	label?: string;
	withOwl?: boolean;
	showLabel?: boolean;
}) {
	return (
		<span
			role="status"
			aria-label={label}
			data-testid="owl-busy"
			className={cn("inline-flex shrink-0 items-center gap-2 text-secondary", className)}
		>
			{withOwl && <Owl mood="talking" size={28} />}
			<span className="ow-dots inline-flex items-center gap-1" aria-hidden>
				<span />
				<span />
				<span />
			</span>
			{showLabel && <span className="text-sm font-bold text-muted-foreground">{label}…</span>}
		</span>
	);
}
