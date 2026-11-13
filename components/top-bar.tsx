"use client";


import type { ReactNode } from "react";
import { SidebarToggle } from "@/components/sidebar";

export function TopBar({
	onMouseDown,
	children,
	sidebarToggle = true,
}: {
	drag?: boolean;
	onMouseDown?: React.MouseEventHandler<HTMLElement>;
	children?: ReactNode;
	sidebarToggle?: boolean;
}) {
	return (
		<header
			onMouseDown={onMouseDown}
			className="flex h-16 select-none items-center gap-3 border-b-2 border-border bg-background px-4"
		>
			{sidebarToggle && <SidebarToggle />}
			{children}
		</header>
	);
}
