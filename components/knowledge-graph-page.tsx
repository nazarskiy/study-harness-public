"use client";

import { useRef } from "react";
import { usePathname } from "next/navigation";
import { GraphView } from "@/components/graph-view";
import { MinimalHome } from "@/components/minimal-home";
import { SidebarToggle } from "@/components/sidebar";
import { SurfaceRegion, usePageSurfaceBoundary, useSurfaceChromeStyle } from "./plugin-surfaces";

export function KnowledgeGraphPage({ rendering }: { rendering: boolean }) {
	const pathname = usePathname();
	const bodyRef = useRef<HTMLDivElement>(null);
	const surfaceTarget = usePageSurfaceBoundary({ active: pathname === "/graph", viewKey: "/graph", bodyRef });
	const chromeStyle = useSurfaceChromeStyle(surfaceTarget);

	return (
		<div className="relative h-dvh">
			<div ref={bodyRef} className="absolute inset-0">
				<main className="absolute inset-0">
					{rendering ? <GraphView /> : <MinimalHome />}
				</main>
				<SurfaceRegion target={surfaceTarget} />
			</div>
			<header style={chromeStyle} className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2">
				<div className="pointer-events-auto"><SidebarToggle /></div>
			</header>
		</div>
	);
}
