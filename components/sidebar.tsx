"use client";

import { ActivitySection } from "@/components/activity-dock";
import { DeleteSessionDialog } from "@/components/delete-session-dialog";
import { CoverageMenuBlock } from "@/components/extraction-coverage";
import { HostContentRootContext,HostRouteLifetimeProvider } from "@/components/host-content-root";
import { isInteractionScopeEligible } from "@/components/interaction-focus";
import { InteractionLayersProvider,useInteractionLayers,useOptionalInteractionLayers } from "@/components/interaction-layers";
import { KeyboardShortcuts } from "@/components/keyboard-shortcuts";
import { MenuShell } from "@/components/menu-shell";
import { Owl } from "@/components/owl/owl";
import { OwlBusy } from "@/components/owl/owl-busy";
import { useServerEvent,useServerResync } from "@/components/server-events";
import { SettingsDialogProvider,useSettingsDialog } from "@/components/settings/settings-dialog.tsx";
import { Button,buttonVariants } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import { BookOpenIcon,DumbbellIcon,PanelLeftCloseIcon,PanelLeftOpenIcon,SearchIcon,SettingsIcon,TrophyIcon,WaypointsIcon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatDeleteMode,ChatListItem } from "@/src/core";
import { fuzzyScore,kbdEventForAction } from "@/src/core";
import Link from "next/link";
import { usePathname,useRouter,useSearchParams } from "next/navigation";
import { createContext,useCallback,useContext,useEffect,useMemo,useRef,useState } from "react";


const STORAGE_KEY = "owlly:sidebar-open";

import { FilePathDropZone } from "@/components/file-path-drop-zone";

const SidebarContext = createContext<{ open: boolean; toggle: () => void }>({
	open: false,
	toggle: () => {},
});

export function useSidebar() {
	return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY);
		setOpen(stored === null ? true : stored === "1");
		setMounted(true);
	}, []);

	const toggle = useCallback(() => {
		setOpen((v) => {
			localStorage.setItem(STORAGE_KEY, v ? "0" : "1");
			return !v;
		});
	}, []);

	useEffect(() => {
		const event = kbdEventForAction("toggle-sidebar");
		const onToggle = () => toggle();
		window.addEventListener(event, onToggle);
		return () => window.removeEventListener(event, onToggle);
	}, [toggle]);

	return (
		<SidebarContext.Provider value={{ open, toggle }}>
			{ }
			<div className={cn("flex h-dvh", mounted && "[&_.sidebar-motion]:transition-[width,margin,opacity]")}>{children}</div>
		</SidebarContext.Provider>
	);
}

export function SidebarToggle() {
	const { open, toggle } = useSidebar();
	return (
		<span
			className={cn(
				"sidebar-motion relative flex h-10 shrink-0 overflow-hidden duration-200",
				open ? "w-0 -mr-3" : "w-10 mr-0",
			)}
		>
			<Hint label="Open sidebar" action="toggle-sidebar">
			<Button
				variant="ghost"
				size="icon"
				aria-label="Open sidebar"
				aria-hidden={open}
				tabIndex={open ? -1 : 0}
				onClick={toggle}
				className={cn("sidebar-motion duration-200", open ? "pointer-events-none opacity-0" : "opacity-100")}
			>
				{
}
				<PanelLeftOpenIcon className="size-4" />
			</Button>
			</Hint>
		</span>
	);
}

function SessionStatus({ busy }: { busy: boolean }) {
	if (!busy) return null;
	return <OwlBusy />;
}

function SidebarLogo() {
	const [hover, setHover] = useState(false);
	return (
		<Hint label="Home" action="jump-graph" side="right">
			<Link
				href="/"
				aria-label="Home"
				onPointerEnter={() => setHover(true)}
				onPointerLeave={() => setHover(false)}
				className="flex items-center gap-2 rounded-xl py-1 pl-1 pr-2 transition-colors hover:bg-accent"
			>
				<Owl mood={hover ? "waving" : "neutral"} size={38} animated={hover} />
				<span className="text-[22px] font-black tracking-tight text-secondary">Owlly</span>
			</Link>
		</Hint>
	);
}

export function timeAgo(iso: string, now = new Date()): string {
	const ms = now.getTime() - new Date(iso).getTime();
	if (ms < 60_000) return "just now";
	const min = Math.floor(ms / 60_000);
	if (min < 60) return `${min}m ago`;
	const h = Math.floor(min / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d ago`;
	const date = new Date(iso);
	const mm = String(date.getMonth() + 1).padStart(2, "0");
	const dd = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${mm}-${dd}`;
}

function sessionMeta(chat: ChatListItem): string {
	if (chat.compacting) return `Compacting context · ${timeAgo(chat.updatedAt)}`;
	if (chat.pendingQuestion) return `Waiting for input · ${timeAgo(chat.updatedAt)}`;
	if ((chat.kind ?? "teach") === "practice" && chat.pendingProblem) {
		return `Problem waiting · ${timeAgo(chat.updatedAt)}`;
	}
	if (chat.busy) return "Working…";
	return timeAgo(chat.updatedAt);
}

export function SessionRow({
	chat,
	active,
	onOpen,
	kbdSelected = false,
	onContextMenu,
}: {
	chat: ChatListItem;
	active: boolean;
	onOpen: () => void;
	kbdSelected?: boolean;
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
	return (
		<button
			type="button"
			onClick={onOpen}
			onContextMenu={onContextMenu}
			data-testid={kbdSelected ? "session-row-kbd" : "session-row"}
			className={cn(
				"relative mb-1 flex w-full items-center gap-2.5 rounded-xl border-2 border-transparent px-3 py-2 text-left transition-colors hover:bg-accent",
				active && "border-secondary/70 bg-secondary-soft hover:bg-secondary-soft",
				kbdSelected && !active && "border-border bg-accent",
			)}
		>
			<SessionStatus busy={chat.busy || chat.compacting} />
			<span className="min-w-0 flex-1">
				<span className={cn("block truncate text-[15px] font-bold", active && "text-secondary")}>{chat.title}</span>
				<span className="block text-xs font-semibold text-muted-foreground">{sessionMeta(chat)}</span>
			</span>
			{
}
			{(chat.kind ?? "teach") === "practice" && (
				<span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-muted" aria-label="Challenge session">
					<DumbbellIcon className="size-3.5 text-muted-foreground" />
				</span>
			)}
		</button>
	);
}

export function RenameRow({ chat, onCommit, onCancel }: { chat: ChatListItem; onCommit: (next: string) => void; onCancel: () => void }) {
	const [draft, setDraft] = useState(chat.title);
	const interactions = useOptionalInteractionLayers();
	const inputRef = useRef<HTMLInputElement | null>(null);
	useEffect(() => {
		const el = inputRef.current;
		if (el) {
			el.focus();
			el.select();
		}
	}, []);
	return (
		<div
			data-testid="session-rename-row"
			className="relative mb-1 flex w-full items-center rounded-xl border-2 border-secondary bg-card px-3 py-2"
		>
			{
}
			<span className="flex min-w-0 w-full flex-col">
				<input
					ref={inputRef}
					value={draft}
					spellCheck={false}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={() => onCommit(draft)}
					onKeyDown={(e) => {
						if (e.key === "Enter") e.currentTarget.blur();
						if (e.key === "Escape") {
							if (interactions && !interactions.isElementEligible(e.currentTarget)) return;
							interactions?.claimEscape(e);
							e.stopPropagation();
							onCancel();
						}
					}}
					aria-label="Rename session"
					data-testid="session-rename-input"
					className="ow-input w-full min-w-0 truncate border-0 border-b border-border bg-transparent px-0 text-foreground outline-none"
				/>
				<span className="block truncate text-xs text-muted-foreground">{sessionMeta(chat)}</span>
			</span>
		</div>
	);
}

export type SessionKindFilter = "teach" | "all" | "practice";
const KIND_FILTER_KEY = "owlly:session-kind-filter";

function SessionsSidebar() {
	const interactions = useInteractionLayers();
	const { open, toggle } = useSidebar();
	const [chats, setChats] = useState<ChatListItem[] | null>(null);
	const [query, setQuery] = useState("");
	const [kindFilter, setKindFilter] = useState<SessionKindFilter>("all");
	useEffect(() => {
		const stored = window.localStorage.getItem(KIND_FILTER_KEY);
		if (stored === "teach" || stored === "all" || stored === "practice") setKindFilter(stored);
	}, []);
	const setFilter = useCallback((f: SessionKindFilter) => {
		setKindFilter(f);
		window.localStorage.setItem(KIND_FILTER_KEY, f);
	}, []);
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const router = useRouter();
	const { open: openSettings } = useSettingsDialog();
	const currentChat = chats?.find((chat) => pathname === `/chat/${chat.id}`);
	const selectedSection = pathname === "/graph"
		? "graph"
		: pathname === "/"
			? "teach"
			: pathname === "/chat/new"
				? searchParams.get("mode") === "practice" ? "practice" : "teach"
				: currentChat ? currentChat.kind ?? "teach" : null;

	const newSession = useCallback(() => {
		router.push("/chat/new");
	}, [router]);

	const shown = useMemo(() => {
		const q = query.trim();
		let list = chats;
		if (list && kindFilter !== "all") {
			list = list.filter((c) => (c.kind ?? "teach") === kindFilter);
		}
		if (!list) return list;
		if (!q) return list;
		return list
			.map((c) => ({ c, score: fuzzyScore(q, c.title) }))
			.filter((r): r is { c: (typeof list)[number]; score: number } => r.score !== null)
			.sort((a, b) => b.score - a.score)
			.map((r) => r.c);
	}, [chats, query, kindFilter]);

	const refreshInFlightRef = useRef(false);
	const refresh = useCallback(async () => {
		if (refreshInFlightRef.current) return;
		refreshInFlightRef.current = true;
		try {
			const res = await fetch("/api/chats", { cache: "no-store" });
			const d = (await res.json()) as { chats: ChatListItem[] };
			setChats(d.chats);
		} catch {
			setChats((prev) => prev ?? []);
		} finally {
			refreshInFlightRef.current = false;
		}
	}, []);

	useEffect(() => {
		const onRenamed = (e: Event) => {
			const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, title } : c)) : prev));
		};
		window.addEventListener("owlly:chat-renamed", onRenamed);
		return () => window.removeEventListener("owlly:chat-renamed", onRenamed);
	}, []);

	const chatsRef = useRef(chats);
	chatsRef.current = chats;
	useEffect(() => {
		const onTurnState = (e: Event) => {
			const { id, running } = (e as CustomEvent<{ id: string; running: boolean }>).detail;
			if (running) {
				if (chatsRef.current?.some((c) => c.id === id)) {
					setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: true } : c)) : prev));
				} else {
					void refresh();
				}
				return;
			}
			setChats((prev) => (prev ? prev.map((c) => (c.id === id ? { ...c, busy: false } : c)) : prev));
			void refresh();
		};
		window.addEventListener("owlly:turn-state", onTurnState);
		return () => window.removeEventListener("owlly:turn-state", onTurnState);
	}, [refresh]);

	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const eventDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const scheduleEventRefresh = () => {
		if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		eventDebounceRef.current = setTimeout(() => {
			eventDebounceRef.current = undefined;
			void refreshRef.current();
		}, 250);
	};
	useServerEvent("chats-changed", scheduleEventRefresh);
	useServerEvent("turn-started", scheduleEventRefresh);
	useServerEvent("turn-settled", scheduleEventRefresh);
	useServerEvent("compaction-changed", scheduleEventRefresh);
	useServerResync(() => void refreshRef.current());
	useEffect(
		() => () => {
			if (eventDebounceRef.current) clearTimeout(eventDebounceRef.current);
		},
		[],
	);

	const [kbdIndex, setKbdIndex] = useState<number | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const [ctxChatId, setCtxChatId] = useState<string | null>(null);
	const ctxAnchorRef = useRef<HTMLElement | null>(null);
	const [renamingId, setRenamingId] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<ChatListItem | null>(null);

	const openContext = (e: React.MouseEvent<HTMLButtonElement>, chat: ChatListItem) => {
		e.preventDefault();
		ctxAnchorRef.current = e.currentTarget;
		setCtxChatId(chat.id);
	};

	useEffect(() => {
		if (ctxChatId === null) return;
		const onPointerDown = (e: PointerEvent) => {
			if (!interactions.isElementEligible(document.querySelector<HTMLElement>('[data-testid="session-context-menu"]'))) return;
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-owlly-menu]")) return;
			if (ctxAnchorRef.current?.contains(target)) return;
			setCtxChatId(null);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [ctxChatId, interactions]);

	const commitRename = useCallback(async (id: string, next: string) => {
		setRenamingId(null);
		const t = next.trim();
		if (t === "") return;
		try {
			const res = await fetch(`/api/chats/${id}`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: t }),
			});
			if (!res.ok) throw new Error(`rename failed: ${res.status}`);
			window.dispatchEvent(new CustomEvent("owlly:chat-renamed", { detail: { id, title: t } }));
		} catch (err) {
			console.error("rename failed:", err);
		}
	}, []);

	const onDeleted = useCallback(
		(id: string, _mode: ChatDeleteMode, graphRevision: number) => {
			setDeleting(null);
			setChats((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
			if (pathname === `/chat/${id}`) router.push("/");
			window.dispatchEvent(new CustomEvent("owlly:graph-revision", { detail: { revision: graphRevision } }));
		},
		[pathname, router],
	);

	useEffect(() => {
		const onFocusSearch = () => {
			if (interactions.getActiveModal() || interactions.getTopLayer()?.kind === "popup") return;
			if (!open) toggle();
			requestAnimationFrame(() => { if (isInteractionScopeEligible(searchRef.current, interactions)) searchRef.current?.focus(); });
		};
		window.addEventListener("owlly:kbd-sessions-search", onFocusSearch);
		return () => window.removeEventListener("owlly:kbd-sessions-search", onFocusSearch);
	}, [open, toggle, interactions]);

	useEffect(() => {
		if (kbdIndex === null) return;
		listRef.current?.querySelectorAll("button")[kbdIndex]?.scrollIntoView({ block: "nearest" });
	}, [kbdIndex]);

	useEffect(() => {
		if (!open) return;
		void refresh();
	}, [open, pathname, refresh]);

	return (
		<aside
			className={cn("sidebar-motion shrink-0 overflow-hidden duration-200", open ? "w-72" : "w-0")}
			aria-hidden={!open}
		>
			<div className="flex h-full w-72 flex-col border-r-2 bg-card">
				<div className="flex items-center justify-between px-4 pb-3 pt-4">
					<SidebarLogo />
					<Hint label="Close sidebar" action="toggle-sidebar">
						<Button variant="ghost" size="icon" aria-label="Close sidebar" onClick={toggle} className="text-muted-foreground">
							<PanelLeftCloseIcon className="size-5" />
						</Button>
					</Hint>
				</div>

				{ }
				<>
					<button
						type="button"
						data-testid="new-session"
						title="Learn"
						aria-current={selectedSection === "teach" ? "page" : undefined}
						onClick={() => void newSession()}
						className={cn(buttonVariants({ variant: selectedSection === "teach" ? "default" : "outline" }), "h-auto w-full min-w-0 justify-start rounded-2xl py-3")}
					>
						<BookOpenIcon className="size-5 shrink-0" />
						<span className="min-w-0 text-left"><span className="block font-extrabold">Learn</span><span className="block text-xs font-medium opacity-80">Explore with Owlly</span></span>
						<span className="sr-only">create a new learning session</span>
					</button>
					<button
						type="button"
						data-testid="new-session-practice"
						title="Challenge"
						aria-current={selectedSection === "practice" ? "page" : undefined}
						onClick={() => router.push("/chat/new?mode=practice")}
						className={cn(buttonVariants({ variant: selectedSection === "practice" ? "default" : "outline" }), "h-auto w-full min-w-0 justify-start rounded-2xl py-3")}
					>
						<TrophyIcon className="size-5 shrink-0" />
						<span className="min-w-0 text-left"><span className="block font-extrabold">Challenge</span><span className="block text-xs font-medium opacity-80">Test what you know</span></span>
						<span className="sr-only">create a new challenge session</span>
					</button>
					<Link
						href="/graph"
						data-testid="knowledge-graph"
						aria-current={selectedSection === "graph" ? "page" : undefined}
						className={cn(buttonVariants({ variant: selectedSection === "graph" ? "default" : "outline" }), "h-auto w-full min-w-0 justify-start rounded-2xl py-3")}
					>
						<WaypointsIcon className="size-5 shrink-0" />
						<span className="min-w-0 text-left font-extrabold">Knowledge map</span>
					</Link>
				</>

				<div className="mx-4 mb-2 mt-3 flex items-center justify-between">
					<span className="text-sm font-extrabold text-muted-foreground">Sessions</span>
				</div>
				<div className="mx-3 mb-2 flex items-center">
					<Hint label="Search sessions" action="sessions-search" side="bottom">
					<span className="relative flex-1">
						<Input
							ref={searchRef}
							data-testid="session-search"
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setKbdIndex(null);
							}}
							onKeyDown={(e) => {
								if (e.key === "Escape") {
									if (!interactions.isElementEligible(e.currentTarget)) return;
									interactions.claimEscape(e);
									e.stopPropagation();
									e.currentTarget.blur();
									return;
								}
								if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
								const n = shown?.length ?? 0;
								if (n === 0) return;
								if (e.key === "ArrowDown" || e.key === "ArrowUp") {
									e.preventDefault();
									const dir = e.key === "ArrowDown" ? 1 : -1;
									setKbdIndex((i) =>
										i === null || i >= n ? (dir === 1 ? 0 : n - 1) : (i + dir + n) % n,
										);
									return;
								}
								if (e.key === "Enter") {
									const target = shown![kbdIndex !== null && kbdIndex < n ? kbdIndex : 0];
									if (!target) return;
									e.preventDefault();
									router.push(`/chat/${target.id}`);
									setKbdIndex(null);
									e.currentTarget.blur();
								}
							}}
							placeholder="Search…"
							aria-label="Search sessions"
							className="h-9 bg-background pl-9 text-sm"
						/>
						<SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
					</span>
					</Hint>
				</div>

				{
}
				<div className="mx-3 flex items-center gap-1 rounded-xl bg-muted p-1" data-testid="session-kind-filter">
					{(["teach", "practice", "all"] as const).map((f) => (
						<button
							key={f}
							type="button"
							data-testid={`kind-filter-${f}`}
							onClick={() => setFilter(f)}
							className={cn(
								"flex-1 rounded-lg px-2 py-1 text-xs font-extrabold transition-colors",
								kindFilter === f
									? "bg-card text-secondary shadow-[0_2px_0_var(--border)]"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{f === "teach" ? "Learn" : f === "all" ? "All" : "Challenge"}
						</button>
					))}
				</div>

				<div ref={listRef} className="flex-1 overflow-y-auto p-2">
					{shown === null ? (
						<div className="px-2 py-4 text-sm font-semibold text-muted-foreground">Loading…</div>
					) : shown.length === 0 ? (
						<div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
							<Owl mood="neutral" size={56} />
							<p className="text-sm font-bold text-muted-foreground">
								{query.trim() ? "No sessions match." : "No sessions yet."}
							</p>
						</div>
					) : (
						shown.map((c, i) =>
							renamingId === c.id ? (
								<RenameRow
									key={c.id}
									chat={c}
									onCommit={(next) => void commitRename(c.id, next)}
									onCancel={() => setRenamingId(null)}
								/>
							) : (
								<SessionRow
									key={c.id}
									chat={c}
									active={pathname === `/chat/${c.id}`}
									kbdSelected={i === kbdIndex}
									onOpen={() => {
										setKbdIndex(null);
										router.push(`/chat/${c.id}`);
									}}
									onContextMenu={(e) => openContext(e, c)}
								/>
							),
						)
					)}
				</div>

					{
}
					<ActivitySection />

					{
}
					<div className="border-t-2 px-3 py-3">
						<Hint label="Settings" action="open-settings" side="right">
							<button
								type="button"
								onClick={() => openSettings()}
								data-testid="settings-entry"
								className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-extrabold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<SettingsIcon className="size-5" />
								Settings
							</button>
						</Hint>
					</div>
				</div>

				{
}
				{ctxChatId !== null && (
					<MenuShell onClose={() => { setCtxChatId(null); return "closed"; }}
						anchorRef={ctxAnchorRef}
						testid="session-context-menu"
						preferredSide="down"
						menuClass="flex w-56 flex-col gap-0.5 rounded-2xl border-2 bg-popover p-2 text-sm font-semibold shadow-xl"
					>
						{
}
						<button
							type="button"
							data-testid="ctx-rename"
							onClick={() => {
								setRenamingId(ctxChatId);
								setCtxChatId(null);
							}}
							className="flex items-center rounded-xl px-3 py-2 text-left font-bold text-foreground transition-colors hover:bg-accent"
						>
							Rename
						</button>
						{
}
						<button
							type="button"
							data-testid="ctx-export-md"
							onClick={() => {
								const chatId = ctxChatId;
								setCtxChatId(null);
								const a = document.createElement("a");
								a.href = `/api/chats/${chatId}/markdown`;
								a.download = "";
								document.body.appendChild(a);
								a.click();
								a.remove();
							}}
							className="flex items-center rounded-xl px-3 py-2 text-left font-bold text-foreground transition-colors hover:bg-accent"
						>
							Export as Markdown…
						</button>
						<button
							type="button"
							data-testid="ctx-delete"
							onClick={() => {
								const target = chats?.find((c) => c.id === ctxChatId);
								if (target) setDeleting(target);
								setCtxChatId(null);
							}}
							className="flex items-center rounded-xl px-3 py-2 text-left font-bold text-error transition-colors hover:bg-error-soft"
						>
							Delete…
						</button>
						<div className="my-1 border-t-2" aria-hidden="true" />
						<CoverageMenuBlock chatId={ctxChatId} />
					</MenuShell>
				)}

				{
}
				<DeleteSessionDialog
					chat={deleting}
					onClose={() => setDeleting(null)}
					onDeleted={onDeleted}
				/>
			</aside>
	);
}

export function AppShell({ children }: { children: React.ReactNode }) {
	const [contentRoot, setContentRoot] = useState<HTMLElement | null>(null);
	const pathname = usePathname();
	return (
		<HostRouteLifetimeProvider pathname={pathname}>
		<HostContentRootContext.Provider value={contentRoot}>
			<InteractionLayersProvider><SettingsDialogProvider>
				<SessionsSidebar />
				<FilePathDropZone className="relative isolate min-w-0 flex-1" onContentRoot={setContentRoot}>{children}</FilePathDropZone>
				{
}
				<KeyboardShortcuts />

			</SettingsDialogProvider></InteractionLayersProvider>
		</HostContentRootContext.Provider>
		</HostRouteLifetimeProvider>
	);
}
