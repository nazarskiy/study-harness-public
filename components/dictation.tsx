"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, MicIcon, SquareIcon } from "@/components/ui/icons";
import { useSettingsDialog } from "@/components/settings/settings-dialog";
import { Hint } from "@/components/ui/hint";
import { deepgramListenUrl, type DictationLanguage } from "@/src/core";
import { useDictationLanguage } from "@/components/dictation-preference";
import { setDictationActive } from "@/components/dictation-state";
import { dispatchFocusedPluginShortcut } from "@/components/plugin-input-focus";
export { isDictationActive } from "@/components/dictation-state";



const METER_FLOOR_DB = -50;
const METER_CEILING_DB = -10;
export const METER_TICK_MS = 60;
export const METER_CELLS = 48;

export const DEEPGRAM_KEY_ID = "DEEPGRAM_API_KEY";

export const DICTATION_KEYLESS = "Dictation needs a Deepgram key";
export const DICTATION_ACTIVE_ELSEWHERE = "Dictation is active elsewhere";

let recordingOwner: symbol | null = null;
let recordingTarget: ((text: string) => unknown) | null = null;
const controllers = new Map<symbol, { primary: boolean; toggle: () => void; cancel: () => void }>();
function toggleGlobalDictation() {
	if (dispatchFocusedPluginShortcut("toggle-dictation")) return;
	for (const controller of controllers.values()) {
		if (controller.primary) {
			controller.toggle();
			return;
		}
	}
}
function cancelGlobalDictation() {
	if (recordingOwner) controllers.get(recordingOwner)?.cancel();
}
function registerController(id: symbol, controller: { primary: boolean; toggle: () => void; cancel: () => void }) {
	if (controllers.size === 0) {
		window.addEventListener("owlly:kbd-toggle-dictation", toggleGlobalDictation);
		window.addEventListener("owlly:kbd-cancel-dictation", cancelGlobalDictation);
	}
	controllers.set(id, controller);
	return () => {
		controllers.delete(id);
		if (controllers.size === 0) {
			window.removeEventListener("owlly:kbd-toggle-dictation", toggleGlobalDictation);
			window.removeEventListener("owlly:kbd-cancel-dictation", cancelGlobalDictation);
		}
	};
}

async function mintFreshToken(): Promise<string> {
	const res = await fetch("/api/stt/token");
	const data = (await res.json()) as { token?: string; message?: string };
	if (!res.ok || !data.token) {
		if (res.status === 503) throw new Error(DICTATION_KEYLESS);
		throw new Error(data.message ?? `token route ${res.status}`);
	}
	return data.token;
}

export const WARM_TOKEN_TTL_MS = 3 * 60_000;

export type WarmMinter = { mint: () => Promise<string>; refresh: () => void };

export function createWarmMinter(
	mint: () => Promise<string>,
	now: () => number = Date.now,
	ttlMs: number = WARM_TOKEN_TTL_MS,
): WarmMinter {
	let warm: { p: Promise<string>; at: number } | null = null;
	const m: WarmMinter = {
		mint: () => {
			if (!warm || now() - warm.at > ttlMs) {
				const p = mint().catch((e: unknown) => {
					warm = null;
					throw e;
				});
				warm = { p, at: now() };
			}
			return warm.p;
		},
		refresh: () => {
			warm = null;
			m.mint().catch(() => {});
		},
	};
	return m;
}

const warmTokens = createWarmMinter(mintFreshToken);

let sharedCtx: AudioContext | null = null;
let workletModule: Promise<void> | null = null;

function ensureAudioGraph(): { ctx: AudioContext; module: Promise<void> } {
	if (!sharedCtx) sharedCtx = new AudioContext({ sampleRate: 16000 });
	if (!workletModule) {
		workletModule = sharedCtx.audioWorklet.addModule("/worklets/pcm-capture.js").catch((e: unknown) => {
			workletModule = null;
			throw e;
		});
	}
	return { ctx: sharedCtx, module: workletModule };
}

export function rmsToMeter(rms: number): number {
	if (rms <= 0) return 0;
	const db = 20 * Math.log10(rms);
	const t = (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB);
	return Math.max(0, Math.min(1, t));
}

let questionTarget: ((text: string) => void | Promise<void>) | null = null;
let composerTarget: ((text: string) => void) | null = null;

export function appendToPrimaryInput(text: string): boolean {
	const target = questionTarget ?? composerTarget;
	if (!target) return false;
	target(text);
	return true;
}

let dictationFinisher: (() => Promise<void>) | null = null;

export function finishDictation(): Promise<void> {
	return dictationFinisher ? dictationFinisher() : Promise.resolve();
}

export function joinDictation(current: string, final: string): string {
	return current ? current.replace(/\s+$/, "") + " " + final : final;
}

export function usePluginQuestionDictationTarget(append: (text: string) => void | Promise<void>, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) {
				if (recordingTarget === append) cancelGlobalDictation();
				questionTarget = null;
			}
		};
	}, [append, claimed]);
}

export function useDictationTarget(append: (text: string) => void, claimed: boolean) {
	useEffect(() => {
		if (!claimed) return;
		questionTarget = append;
		return () => {
			if (questionTarget === append) questionTarget = null;
		};
	}, [append, claimed]);
}

export type DictationPhase = "idle" | "connecting" | "recording" | "stopping";

export interface DictationDestination { id: string; append: (text: string) => void | Promise<void> }

export type Dictation = {
	phase: DictationPhase;
	destinationId: string;
	blocked?: boolean;
	toggleFor: (destination: DictationDestination) => void;
	finishFor: (destinationId: string) => Promise<void>;
	error: string | null;
	levelRef: { current: number };
	active: boolean;
	toggle: () => void;
	stop: () => void;
	finish: () => Promise<void>;
	cancel: () => void;
	clearError: () => void;
};

export function useDictation({ append, destination = "primary", disabled = false }: {
	append: (text: string) => void;
	destination?: "primary" | "explicit";
	disabled?: boolean;
}): Dictation {
	const primary = destination === "primary";
	const owner = useRef(Symbol("dictation")).current;
	const { getLanguage } = useDictationLanguage();
	const [phase, setPhaseState] = useState<DictationPhase>("idle");
	const phaseRef = useRef<DictationPhase>("idle");
	const setPhase = useCallback((next: DictationPhase) => {
		phaseRef.current = next;
		setPhaseState(next);
	}, []);
	const [destinationId, setDestinationId] = useState("main");
	const destinationRef = useRef<DictationDestination | null>(null);
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	const [error, setError] = useState<string | null>(null);
	const levelRef = useRef(0);
	const appendRef = useRef(append);
	appendRef.current = append;
	useEffect(() => {
		if (!primary) return;
		const target = (text: string) => appendRef.current(text);
		composerTarget = target;
		return () => {
			if (composerTarget === target) composerTarget = null;
		};
	}, [primary]);

	const wsRef = useRef<WebSocket | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	const workletRef = useRef<AudioWorkletNode | null>(null);
	const pendingRef = useRef<ArrayBuffer[]>([]);
	const genRef = useRef(0);
	const safetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectsRef = useRef(0);
	const bufferRef = useRef<string[]>([]);
	const waitersRef = useRef<Array<{ resolve: () => void; reject: (error: unknown) => void }>>([]);
	const appendFailureRef = useRef<{ error: unknown } | null>(null);
	const appendPendingRef = useRef(false);

	const flush = useCallback((): unknown => {
		if (bufferRef.current.length === 0) return;
		const text = bufferRef.current.join(" ");
		bufferRef.current = [];
		return (destinationRef.current?.append ?? appendRef.current)(text);
	}, []);

	const cleanup = useCallback((warmNext = true) => {
		const endGen = ++genRef.current;
		let appended: unknown;
		let failure: { error: unknown } | null = appendPendingRef.current
			? { error: new DOMException("Dictation transcript delivery canceled", "AbortError") }
			: null;
		appendPendingRef.current = false;
		try {
			appended = flush();
		} catch (error) {
			failure = { error };
		}
		if (safetyRef.current) {
			clearTimeout(safetyRef.current);
			safetyRef.current = null;
		}
		pendingRef.current = [];
		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;
		const ws = wsRef.current;
		wsRef.current = null;
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			try {
				ws.close();
			} catch {}
		}
		const complete = (failed: { error: unknown } | null) => {
			if (endGen !== genRef.current) return;
			appendPendingRef.current = false;
			appendFailureRef.current = failed;
			if (failed) setError(failed.error instanceof Error ? failed.error.message : "Dictation transcript could not be applied");
			if (recordingOwner === owner) {
				recordingOwner = null;
				recordingTarget = null;
				setDictationActive(false);
			}
			setPhase("idle");
			for (const waiter of waitersRef.current.splice(0)) {
				if (failed) waiter.reject(failed.error);
				else waiter.resolve();
			}
			if (warmNext) warmTokens.refresh();
		};
		if (appended && typeof (appended as PromiseLike<unknown>).then === "function") {
			appendPendingRef.current = true;
			setPhase("stopping");
			void Promise.resolve(appended).then(() => complete(null), (error: unknown) => complete({ error }));
		} else complete(failure);
	}, [flush, owner, setPhase]);

	const openSocket = useCallback(
		(gen: number, token: string, language: DictationLanguage) => {
			const ws = new WebSocket(deepgramListenUrl(language), ["bearer", token]);
			wsRef.current = ws;

			ws.addEventListener("open", () => {
				if (gen !== genRef.current) return;
				for (const frame of pendingRef.current) ws.send(frame);
				pendingRef.current = [];
				setPhase("recording");
			});
			ws.addEventListener("message", (ev) => {
				if (gen !== genRef.current) return;
				let msg: any;
				try {
					msg = JSON.parse(ev.data as string);
				} catch {
					return;
				}
				if (msg.type === "Results") {
					const text: string | undefined = msg.channel?.alternatives?.[0]?.transcript;
					if (msg.is_final && text) bufferRef.current.push(text);
				}
			});
			ws.addEventListener("close", (ev) => {
				if (gen !== genRef.current) return;
				if (ev.code === 1000) {
					cleanup();
					return;
				}
				if (reconnectsRef.current < 1) {
					reconnectsRef.current++;
					mintFreshToken()
						.then((t) => {
							if (gen === genRef.current) openSocket(gen, t, language);
						})
						.catch(() => {
							if (gen === genRef.current) {
								setError("Deepgram reconnect failed");
								cleanup();
							}
						});
				} else {
					setError(`Deepgram connection lost (${ev.code})`);
					cleanup();
				}
			});
		},
		[cleanup, setPhase],
	);

	const start = useCallback(async (destination?: DictationDestination) => {
		if (disabledRef.current || phaseRef.current !== "idle") return;
		if (recordingOwner !== null && recordingOwner !== owner) {
			setError(DICTATION_ACTIVE_ELSEWHERE);
			return;
		}
		const target = destination ?? { id: "main", append: primary ? questionTarget ?? appendRef.current : (text: string) => appendRef.current(text) };
		destinationRef.current = target;
		setDestinationId(target.id);
		recordingOwner = owner;
		recordingTarget = target.append;
		setDictationActive(true);
		setError(null);
		appendFailureRef.current = null;
		setPhase("connecting");
		reconnectsRef.current = 0;
		bufferRef.current = [];
		pendingRef.current = [];
		const gen = ++genRef.current;
		let language: DictationLanguage;
		try {
			language = await getLanguage();
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(e instanceof Error ? e.message : "Dictation language unavailable");
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;

		const tokenPromise = warmTokens.mint();
		tokenPromise.catch(() => {});
		const micPromise = navigator.mediaDevices.getUserMedia({
			audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
		});
		let stream: MediaStream;
		try {
			stream = await micPromise;
			if (gen !== genRef.current) {
				for (const track of stream.getTracks()) track.stop();
				return;
			}
			streamRef.current = stream;

			const { ctx, module } = ensureAudioGraph();
			await module;
			if (ctx.state === "suspended") await ctx.resume();
			if (gen !== genRef.current) return;

			const worklet = new AudioWorkletNode(ctx, "pcm-capture");
			workletRef.current = worklet;
			worklet.port.onmessage = (e) => {
				if (gen !== genRef.current) return;
				const msg = e.data as { type: string; rms?: number; buffer?: ArrayBuffer };
				if (msg.type === "level") {
					levelRef.current = msg.rms ?? 0;
				} else if (msg.type === "audio") {
					const ws = wsRef.current;
					if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg.buffer!);
					else {
						pendingRef.current.push(msg.buffer!);
						if (pendingRef.current.length > 256) pendingRef.current.shift();
					}
				}
			};
			const source = ctx.createMediaStreamSource(stream);
			sourceRef.current = source;
			source.connect(worklet);
			worklet.connect(ctx.destination);
		} catch (e) {
			if (gen !== genRef.current) return;
			const msg =
				e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")
					? "Microphone permission denied"
					: e instanceof Error
						? e.message
						: "mic unavailable";
			setError(msg);
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		let token: string;
		try {
			token = await tokenPromise;
		} catch (e) {
			if (gen !== genRef.current) return;
			setError(e instanceof Error ? e.message : "token unavailable");
			cleanup();
			return;
		}
		if (gen !== genRef.current) return;
		openSocket(gen, token, language);
	}, [openSocket, cleanup, getLanguage, owner, primary, setPhase]);

	const stop = useCallback(() => {
		const gen = genRef.current;
		if (phaseRef.current !== "recording" && phaseRef.current !== "connecting") return;
		setPhase("stopping");

		for (const track of streamRef.current?.getTracks() ?? []) track.stop();
		streamRef.current = null;
		sourceRef.current?.disconnect();
		sourceRef.current = null;
		workletRef.current?.disconnect();
		workletRef.current = null;

		const ws = wsRef.current;
		if (ws && ws.readyState === WebSocket.OPEN) {
			try {
				ws.send(JSON.stringify({ type: "CloseStream" }));
			} catch {
				cleanup();
				return;
			}
			safetyRef.current = setTimeout(() => {
				if (gen === genRef.current) cleanup();
			}, 3000);
		} else {
			cleanup();
		}
	}, [cleanup, setPhase]);

	const cancel = useCallback(() => {
		if (phaseRef.current === "idle") return;
		bufferRef.current = [];
		cleanup();
	}, [cleanup]);

	const finishCurrent = useCallback((): Promise<void> => {
		return new Promise((resolve, reject) => {
			if (phaseRef.current === "idle") {
				if (appendFailureRef.current) reject(appendFailureRef.current.error);
				else resolve();
				return;
			}
			waitersRef.current.push({ resolve, reject });
			if (phaseRef.current === "recording" || phaseRef.current === "connecting") stop();
		});
	}, [stop]);
	const finishFor = useCallback((id: string) => destinationRef.current?.id === id ? finishCurrent() : Promise.resolve(), [finishCurrent]);
	const finish = useCallback(() => finishFor("main"), [finishFor]);

	useEffect(() => {
		if (!primary) return;
		dictationFinisher = finish;
		return () => {
			if (dictationFinisher === finish) dictationFinisher = null;
		};
	}, [finish, primary]);

	const toggleFor = useCallback((destination?: DictationDestination) => {
		if (phaseRef.current === "idle") void start(destination);
		else if (phaseRef.current === "recording" || phaseRef.current === "connecting") stop();
	}, [start, stop]);
	const toggle = useCallback(() => toggleFor(), [toggleFor]);

	useEffect(() => {
		warmTokens.refresh();
		return () => {
			bufferRef.current = [];
			cleanup(false);
		};
	}, [cleanup]);
	useEffect(() => registerController(owner, { primary, toggle, cancel }), [owner, primary, toggle, cancel]);

	return {
		phase,
		destinationId,
		toggleFor,
		finishFor,
		error,
		levelRef,
		active: phase !== "idle",
		toggle,
		stop,
		finish,
		cancel,
		clearError: () => setError(null),
	};
}

export function DictationBar({ dictation, disabled = false, iconOnly = false }: { dictation: Dictation; disabled?: boolean; iconOnly?: boolean }) {
	const { phase, error, levelRef, toggle, active, clearError, blocked } = dictation;
	const { open: openSettings } = useSettingsDialog();
	const keyless = error === DICTATION_KEYLESS;
	const [levels, setLevels] = useState<number[]>(() => new Array(METER_CELLS).fill(0));
	const [cellCount, setCellCount] = useState(METER_CELLS);
	const meterRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!active || iconOnly) return;
		setLevels(new Array(METER_CELLS).fill(0));
		const id = setInterval(() => {
			setLevels((ring) => {
				const next = ring.slice(1);
				next.push(rmsToMeter(levelRef.current));
				return next;
			});
		}, METER_TICK_MS);
		return () => clearInterval(id);
	}, [active, levelRef, iconOnly]);

	useEffect(() => {
		if (!active || iconOnly) return;
		const el = meterRef.current;
		if (!el) return;
		const fit = () => {
			const w = el.clientWidth;
			setCellCount(Math.max(8, Math.min(METER_CELLS, Math.floor(w / 4))));
		};
		fit();
		const ro = new ResizeObserver(fit);
		ro.observe(el);
		return () => ro.disconnect();
	}, [active, iconOnly]);

	if (iconOnly) {
		const label = active ? "Stop dictation" : error ? `Dictation failed: ${error}` : "Start dictation";
		return <Hint label={label} action={error ? undefined : "toggle-dictation"} side="top">
			<button type="button" aria-label={label} aria-pressed={active} data-testid="dictation-toggle"
				disabled={phase === "stopping" || (!active && (disabled || blocked))}
				onClick={() => { if (!active && keyless) { clearError(); openSettings("keys", DEEPGRAM_KEY_ID); } else toggle(); }}
				className={`flex size-11 shrink-0 items-center justify-center rounded-2xl transition-colors disabled:cursor-default disabled:opacity-40 ${active ? "bg-error-soft text-error hover:bg-destructive/20" : error ? "text-error hover:bg-error-soft" : "text-muted-foreground hover:bg-accent hover:text-secondary"}`}>
				{phase === "connecting" || phase === "stopping" ? <Loader2Icon aria-hidden className="size-5 animate-spin" /> : active ? <SquareIcon aria-hidden className="size-5" /> : <MicIcon aria-hidden className="size-5" />}
			</button>
		</Hint>;
	}

	if (!active) {
		return (
			<Hint
				label={error ?? "Dictate"}
				action={error ? undefined : "toggle-dictation"}
				side="top"
			>
				<button
					type="button"
					onClick={() => {
						if (keyless) {
							clearError();
							openSettings("keys", DEEPGRAM_KEY_ID);
						} else {
							toggle();
						}
					}}
					disabled={disabled || blocked}
					aria-label={error ? `Dictation failed: ${error}` : "Start dictation"}
					data-testid="dictation-toggle"
					className="flex h-8 w-full items-center justify-center gap-1.5 px-2 rounded-xl border border-border bg-muted/50 text-xs font-extrabold text-muted-foreground transition-colors hover:border-secondary hover:bg-secondary-soft hover:text-secondary"
				>
					<MicIcon className="size-3.5" />
					<span className="max-w-full truncate">{error ?? "Dictate"}</span>
				</button>
			</Hint>
		);
	}

	return (
		<div className="flex w-full min-w-0 items-center gap-2" data-testid="dictation-bar">
			<Hint label="Stop dictation (Esc)" side="top">
				<button
					type="button"
					onClick={toggle}
					disabled={phase === "stopping"}
					aria-label="Stop dictation"
					data-testid="dictation-toggle"
					className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-destructive/10 px-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20"
				>
					{phase === "stopping" ? <Loader2Icon className="size-3.5 animate-spin" /> : <MicIcon className="size-3.5" />}
					Stop
				</button>
			</Hint>
			<span className="size-1.5 shrink-0 animate-pulse rounded-full bg-destructive" aria-hidden />
			<div ref={meterRef} className="flex h-4 min-w-0 flex-1 items-center gap-[2px]" data-testid="dictation-meter">
				{levels.slice(-cellCount).map((v, i) => (
					<span
						key={i}
						className="min-w-0 flex-1 rounded-full bg-foreground/40"
						style={{ height: `${2 + Math.round(v * 14)}px` }}
					/>
				))}
			</div>
		</div>
	);
}
