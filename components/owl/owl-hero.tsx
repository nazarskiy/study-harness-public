import { cn } from "@/lib/utils";
import { Owl } from "./owl";

export function OwlHero({ children, className }: { children?: React.ReactNode; className?: string }) {
	return (
		<div data-testid="owl-hero" className={cn("flex flex-col items-center px-4 text-center", className)}>
			<Owl mood="waving" size={168} title="Owlly waving hello" />
			<h1 className="mt-4 text-3xl font-black tracking-tight text-foreground">Hi! What do you want to learn today?</h1>
			{children}
		</div>
	);
}
