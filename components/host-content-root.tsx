"use client";

import { createContext, useLayoutEffect, useState, type ReactNode } from "react";

export const HostContentRootContext = createContext<HTMLElement | null>(null);

export interface HostRouteLifetime { pathname: string; signal: AbortSignal }
export const HostRouteLifetimeContext = createContext<HostRouteLifetime | null>(null);

export function HostRouteLifetimeProvider({ pathname, children }: { pathname: string; children: ReactNode }) {
	const [current, setCurrent] = useState<HostRouteLifetime | null>(null);
	useLayoutEffect(() => {
		const lifetime = new AbortController();
		setCurrent({ pathname, signal: lifetime.signal });
		return () => lifetime.abort();
	}, [pathname]);
	return <HostRouteLifetimeContext.Provider value={current?.pathname === pathname ? current : null}>{children}</HostRouteLifetimeContext.Provider>;
}
