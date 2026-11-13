import { ActivityProvider } from "@/components/activity-dock";
import { ServerEventsProvider } from "@/components/server-events";
import { AppearanceProvider } from "@/components/settings/appearance";
import { AppShell,SidebarProvider } from "@/components/sidebar";
import { FACTORY_SETTINGS } from "@/src/core";
import { readAppearanceBoot } from "@/src/server";
import "katex/dist/katex.min.css";
import type { Metadata } from "next";
import { JetBrains_Mono,Nunito } from "next/font/google";
import Script from "next/script";
import { connection } from "next/server";
import "./globals.css";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });
const code = JetBrains_Mono({ subsets: ["latin"], variable: "--font-code" });

export const metadata: Metadata = {
	title: "Owlly",
	description: "Learn anything with Owlly — a patient owl tutor that remembers what you know.",
};

const THEME_SCRIPT = `(function(){try{var d=document.documentElement;if(d.dataset.owllyTheme!=="system")return;var m=window.matchMedia("(prefers-color-scheme: dark)").matches;d.classList.add(m?"dark":"light");}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
	await connection();
	const appearance = readAppearanceBoot();
	const mode = appearance?.mode ?? FACTORY_SETTINGS.appearance.mode;
	const proseSize = appearance?.proseFontSize ?? FACTORY_SETTINGS.appearance.proseFontSize;
	return (
		<html
			lang="en"
			className={`${mode === "system" ? "" : mode} ${nunito.variable} ${code.variable}`}
			data-owlly-theme={mode}
			style={{ "--ow-prose-size": `${proseSize}px` } as React.CSSProperties}
			suppressHydrationWarning
		>
			<body className="min-h-dvh antialiased">
				<Script id="owlly-theme" strategy="beforeInteractive">{THEME_SCRIPT}</Script>
				<ServerEventsProvider>

						<AppearanceProvider initialAppearance={appearance}>
							<SidebarProvider>
								<ActivityProvider>
									<AppShell>{children}</AppShell>
								</ActivityProvider>
							</SidebarProvider>
						</AppearanceProvider>

				</ServerEventsProvider>
			</body>
		</html>
	);
}
