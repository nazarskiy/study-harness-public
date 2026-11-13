"use client";


import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import type { Simulation, SimulationLinkDatum } from "d3-force";
import { clusterHue, type Pt } from "./cluster-geometry.ts";
import type { RenderedMode } from "@/src/core";
import {
	CHARGE_STRENGTH,
	CLUSTER_PULL_STRENGTH,
	createGraphSimulation,
	DEFAULT_PHYSICS_TUNING,
	DEFAULT_REGION_TUNING,
	sanitizePhysicsTuning,
	sanitizeRegionTuning,
	type PhysicsTuning,
	type RegionTuning,
	INCREMENTAL_GRAVITY,
	LINK_DISTANCE,
	type DepthAnchorMode,
	type GraphRenderSettings,
	type LayoutNode,
	type Position,
} from "@/src/core";

export type { GraphRenderSettings };


export interface CanvasNode {
	id: string;
	x: number;
	y: number;
	label: string;
}

export interface CanvasEdge {
	from: string;
	to: string;
}

export const isImpNodeId = (id: string): boolean => id.startsWith("arg_");

export interface CanvasCluster {
	id: string;
	label: string | null;
	members: string[];
}

export interface ClusterLightness {
	ring: number;
	label: number;
}

export const CLUSTER_LIGHTNESS: Record<RenderedMode, ClusterLightness> = {
	dark: { ring: 60, label: 78 },
	light: { ring: 42, label: 30 },
};

export interface CanvasColors {
	node: string;
	edge: string;
	label: string;
	hoverText: string;
	clusterLightness: ClusterLightness;
}

export interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	logicalEdges?: CanvasEdge[];
	impLinks?: ReadonlyArray<{ id: string; premises: ReadonlyArray<string>; conclusion: string }>;
	clusters: CanvasCluster[];
	colors: CanvasColors;
	fontFamily: string;
}

export interface RendererCallbacks {
	onSelect: (nodeId: string, screenPos: Pt) => void;
	onContext: (nodeId: string | null, screenPos: Pt) => void;
	onStageClick: () => void;
	onCameraMove: (transform: { k: number; x: number; y: number }) => void;
	onCommit: (positions: Record<string, Position>) => void;
}


const LABEL_SIZE = 12;
const LABEL_WEIGHT = "500";

const REGION_LABEL_MAX_WIDTH = 220;
const REGION_LABEL_MAX_LINES = 3;
const REGION_LABEL_LINE_HEIGHT = 1.3;

export function wrapRegionLabel(
	text: string,
	maxWidth: number,
	maxLines: number,
	measure: (s: string) => number,
): string[] {
	if (maxLines < 1) return [text];
	if (measure(text) <= maxWidth) return [text];
	const lines: string[] = [];
	const pending: string[] = text.split(/\s+/).filter(Boolean);
	while (pending.length > 0 && lines.length < maxLines - 1) {
		let line = "";
		while (pending.length > 0) {
			let word = pending[0]!;
			const candidate = line ? `${line} ${word}` : word;
			if (measure(candidate) <= maxWidth) {
				line = candidate;
				pending.shift();
				continue;
			}
			if (!line) {
				let chunk = "";
				while (word.length > 0 && measure(chunk + word[0]) <= maxWidth) {
					chunk += word[0];
					word = word.slice(1);
				}
				if (chunk) {
					lines.push(chunk);
					pending[0] = word;
				} else {
					lines.push(word);
					pending.shift();
				}
				line = "";
			}
			break;
		}
		if (line) lines.push(line);
		if (!line && lines.length > 0 && pending.length > 0) continue;
		if (!line && lines.length === 0) break;
	}
	let rest = pending.join(" ");
	if (!rest) return lines;
	if (measure(rest) <= maxWidth) {
		lines.push(rest);
		return lines;
	}
	let tail = rest;
	while (tail.length > 1 && measure(`${tail}…`) > maxWidth) tail = tail.slice(0, -1);
	lines.push(`${tail}…`);
	return lines;
}

export function applyClusterLabels(
	clusters: { id: string; label: string | null }[],
	regionMeta: { id: string; label: string | null; lines: string[] | null }[],
	labels: ReadonlyMap<string, string | null>,
	maxWidth: number,
	maxLines: number,
	measure: (s: string) => number,
): boolean {
	let changed = false;
	for (const cluster of clusters) {
		if (!labels.has(cluster.id)) continue;
		if (cluster.label == null) continue;
		const label = labels.get(cluster.id) ?? null;
		if (label === cluster.label) continue;
		cluster.label = label;
		changed = true;
	}
	if (!changed) return false;
	for (const rm of regionMeta) {
		if (!labels.has(rm.id)) continue;
		if (rm.label == null) continue;
		const label = labels.get(rm.id) ?? null;
		rm.label = label;
		rm.lines = label
			? wrapRegionLabel(label, maxWidth, maxLines, measure)
			: null;
	}
	return true;
}
const LABEL_MAX_WIDTH = 170;
const LABEL_GAP = 2.9;
const LABEL_LINE_HEIGHT = 1.3;
export const LABELS_FADE_RATIO = 0.5;

const GLOW_SCALE = 1.7;
const GLOW_ALPHA = 0.3;
const HOVER_FADE_MS = 180;
const ZOOM_EASE_MS = 45;

const PICKING_PAD = 10;

const CLICK_SLOP = 4;
const LIVE_ALPHA_DECAY = 0.05;
const DRAG_ALPHA_TARGET = 0.3;
const SIM_SETTLE_ALPHA = 0.005;
const COMMIT_DEBOUNCE_MS = 250;

const REGION_EVERY = 3;



export function boxBlurRound(
	src: Float32Array,
	tmp: Float32Array,
	dst: Float32Array,
	w: number,
	h: number,
	radius: number,
): void {
	if (radius <= 0) {
		dst.set(src);
		return;
	}
	const div = radius * 2 + 1;
	for (let y = 0; y < h; y++) {
		const row = y * w * 4;
		let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
		for (let x = -radius; x <= radius; x++) {
			const i = row + Math.min(Math.max(x, 0), w - 1) * 4;
			sum0 += src[i]!;
			sum1 += src[i + 1]!;
			sum2 += src[i + 2]!;
			sum3 += src[i + 3]!;
		}
		for (let x = 0; x < w; x++) {
			const o = row + x * 4;
			tmp[o] = sum0 / div;
			tmp[o + 1] = sum1 / div;
			tmp[o + 2] = sum2 / div;
			tmp[o + 3] = sum3 / div;
			const addI = row + Math.min(x + radius + 1, w - 1) * 4;
			const subI = row + Math.max(x - radius, 0) * 4;
			sum0 += src[addI]! - src[subI]!;
			sum1 += src[addI + 1]! - src[subI + 1]!;
			sum2 += src[addI + 2]! - src[subI + 2]!;
			sum3 += src[addI + 3]! - src[subI + 3]!;
		}
	}
	for (let x = 0; x < w; x++) {
		const col = x * 4;
		let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
		for (let y = -radius; y <= radius; y++) {
			const i = col + Math.min(Math.max(y, 0), h - 1) * w * 4;
			sum0 += tmp[i]!;
			sum1 += tmp[i + 1]!;
			sum2 += tmp[i + 2]!;
			sum3 += tmp[i + 3]!;
		}
		for (let y = 0; y < h; y++) {
			const o = col + y * w * 4;
			dst[o] = sum0 / div;
			dst[o + 1] = sum1 / div;
			dst[o + 2] = sum2 / div;
			dst[o + 3] = sum3 / div;
			const addI = col + Math.min(y + radius + 1, h - 1) * w * 4;
			const subI = col + Math.max(y - radius, 0) * w * 4;
			sum0 += tmp[addI]! - tmp[subI]!;
			sum1 += tmp[addI + 1]! - tmp[subI + 1]!;
			sum2 += tmp[addI + 2]! - tmp[subI + 2]!;
			sum3 += tmp[addI + 3]! - tmp[subI + 3]!;
		}
	}
}


const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);


export function zoomRatioOf(kFit: number, k: number): number {
	return kFit / k;
}

export function labelAlpha(
	ratio: number,
	labelZoom: number,
	span = labelZoom * LABELS_FADE_RATIO,
): number {
	return clamp01(1 - (ratio - labelZoom) / span);
}

export function fitTransform(
	bbox: { minX: number; maxX: number; minY: number; maxY: number },
	w: number,
	h: number,
	padding: number,
): { x: number; y: number; k: number } {
	const bw = Math.max(bbox.maxX - bbox.minX, 1e-6);
	const bh = Math.max(bbox.maxY - bbox.minY, 1e-6);
	const k = Math.min((w - 2 * padding) / bw, (h - 2 * padding) / bh);
	const cx = (bbox.minX + bbox.maxX) / 2;
	const cy = (bbox.minY + bbox.maxY) / 2;
	return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
}

export interface ArrowGeom {
	shaftFrom: Pt;
	shaftTo: Pt;
	tip: Pt;
	left: Pt;
	right: Pt;
}

export function arrowGeometry(
	a: Pt,
	b: Pt,
	fromRadius: number,
	toRadius: number,
	headLength: number,
): ArrowGeom | null {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = Math.hypot(dx, dy);
	if (len < 1e-6) return null;
	const ux = dx / len;
	const uy = dy / len;
	const tip = { x: b.x - ux * toRadius, y: b.y - uy * toRadius };
	const base = { x: tip.x - ux * headLength, y: tip.y - uy * headLength };
	const halfW = 0.4 * headLength;
	return {
		shaftFrom: { x: a.x + ux * fromRadius, y: a.y + uy * fromRadius },
		shaftTo: base,
		tip,
		left: { x: base.x - uy * halfW, y: base.y + ux * halfW },
		right: { x: base.x + uy * halfW, y: base.y - ux * halfW },
	};
}


export function pickNearest<T extends { id: string; x: number; y: number }>(
	nodes: T[],
	px: number,
	py: number,
	maxDist: number,
): T | null {
	let best: T | null = null;
	let bestD = maxDist * maxDist;
	for (const n of nodes) {
		const d = (n.x - px) ** 2 + (n.y - py) ** 2;
		if (d < bestD) {
			bestD = d;
			best = n;
		}
	}
	return best;
}


function rgbaFromHex(hex: string, alpha: number): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wrapLabel(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
	const lines: string[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) {
		const last = lines.length > 0 ? lines[lines.length - 1]! : null;
		if (last !== null) {
			const joined = `${last} ${word}`;
			if (context.measureText(joined).width <= maxWidth) {
				lines[lines.length - 1] = joined;
				continue;
			}
		}
		let chunk = "";
		for (const char of word) {
			if (chunk && context.measureText(`${chunk}${char}`).width > maxWidth) {
				lines.push(chunk);
				chunk = char;
			} else {
				chunk += char;
			}
		}
		if (chunk) lines.push(chunk);
	}
	return lines;
}

interface WorldSizes {
	nodeR: number;
	glowOuter: number;
	labelSize: number;
	labelGap: number;
}

function drawNameLines(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	lines: string[],
	world: WorldSizes,
	color: string,
): void {
	context.fillStyle = color;
	context.textAlign = "center";
	context.textBaseline = "top";
	const firstTop = y + world.nodeR + world.labelGap;
	for (let i = 0; i < lines.length; i++) {
		context.fillText(lines[i]!, x, firstTop + i * world.labelSize * LABEL_LINE_HEIGHT);
	}
}


export class GraphCanvasRenderer {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private callbacks: RendererCallbacks;
	private zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;
	private transform: ZoomTransform = zoomIdentity;
	private hasFit = false;
	private viewW = 0;
	private viewH = 0;
	private kFit = 1;
	private worldBBox: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

	private data: CanvasData | null = null;
	private nodeById = new Map<string, CanvasNode>();
	private settings: GraphRenderSettings | null = null;
	private visible: ReadonlySet<string> | null = null;

	private sim: Simulation<LayoutNode, SimulationLinkDatum<LayoutNode>> | null = null;
	private simById = new Map<string, LayoutNode>();
	private simActive = false;
	private dragId: string | null = null;
	private dragOrigin: Pt | null = null;
	private simMoved = false;
	private commitTimer: ReturnType<typeof setTimeout> | null = null;

	private frameId: number | null = null;
	private dirty = true;
	private inTick = false;

	private hoverId: string | null = null;
	private hoverNode: CanvasNode | null = null;
	private hoverFade = 0;
	private hoverFrom = 0;
	private hoverTarget = 0;
	private hoverStart = 0;
	private zoomTarget: { k: number; x: number; y: number } | null = null;
	private lastTickAt = 0;
	private animating = false;

	private resizeObserver: ResizeObserver;
	private downPos: Pt | null = null;

	private geoVersion = 0;
	private builtVersion = -1;
	private nodesPath: Path2D | null = null;
	private shaftsPath: Path2D = new Path2D();
	private headsPath: Path2D = new Path2D();
	private regionCanvas: HTMLCanvasElement | null = null;
	private regionRect: { minX: number; minY: number; w: number; h: number } | null = null;
	private regionMeta: { id: string; label: string | null; lines: string[] | null; cx: number; cy: number; hue: number }[] = [];
	private regionTuning: RegionTuning = DEFAULT_REGION_TUNING;
	private physicsTuning: PhysicsTuning = DEFAULT_PHYSICS_TUNING;
	private simCenter: Pt = { x: 0, y: 0 };
	private regionBuiltVersion = -1;
	private frameCount = 0;
	private labelLines = new Map<string, string[]>();
	private worldLabelFont = "";
	private world: WorldSizes = { nodeR: 0, glowOuter: 0, labelSize: 0, labelGap: 0 };

	constructor(
		canvas: HTMLCanvasElement,
		callbacks: RendererCallbacks,
		initialCamera?: { k: number; x: number; y: number } | null,
	) {
		this.canvas = canvas;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("2d context unavailable");
		this.ctx = ctx;
		this.callbacks = callbacks;

		this.zoomBehavior = zoom<HTMLCanvasElement, unknown>()
			.scaleExtent([0.02, 40])
			.on("zoom", ({ transform }) => {
				this.transform = transform;
				this.markDirty();
				this.callbacks.onCameraMove(transform);
			});
		select(canvas)
			.call(this.zoomBehavior)
			.on("dblclick.zoom", null)
			.on("wheel.zoom", null);

		canvas.addEventListener("wheel", this.onWheel, { passive: false });
		canvas.addEventListener("pointermove", this.onPointerMove);
		canvas.addEventListener("pointerdown", this.onPointerDown);
		canvas.addEventListener("pointerup", this.onPointerUp);
		canvas.addEventListener("pointerleave", this.onPointerLeave);
		canvas.addEventListener("contextmenu", this.onContextMenu);

		if (
			initialCamera &&
			typeof initialCamera.k === "number" && Number.isFinite(initialCamera.k) && initialCamera.k > 0 &&
			typeof initialCamera.x === "number" && Number.isFinite(initialCamera.x) &&
			typeof initialCamera.y === "number" && Number.isFinite(initialCamera.y)
		) {
			this.hasFit = true;
			select(canvas).call(
				this.zoomBehavior.transform,
				zoomIdentity.translate(initialCamera.x, initialCamera.y).scale(initialCamera.k),
			);
		}

		this.resizeObserver = new ResizeObserver(() => {
			const prevW = this.viewW;
			const prevH = this.viewH;
			const { x: tx, y: ty, k } = this.transform;
			const wx = (prevW / 2 - tx) / k;
			const wy = (prevH / 2 - ty) / k;
			this.syncSize();
			if (!this.hasFit) this.fit();
			else {
				this.refreshFitZoom();
				if (prevW > 0 && prevH > 0 && this.viewW > 0 && this.viewH > 0) {
					select(canvas).call(
						this.zoomBehavior.transform,
						zoomIdentity.translate(this.viewW / 2 - wx * k, this.viewH / 2 - wy * k).scale(k),
					);
				}
			}
			this.draw();
		});
		this.resizeObserver.observe(canvas);
		this.syncSize();
	}


	setData(data: CanvasData): void {
		this.data = data;
		this.nodeById = new Map(data.nodes.map((n) => [n.id, n]));
		let minX = Infinity;
		let minY = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		for (const n of data.nodes) {
			if (n.x < minX) minX = n.x;
			if (n.y < minY) minY = n.y;
			if (n.x > maxX) maxX = n.x;
			if (n.y > maxY) maxY = n.y;
		}
		this.worldBBox = { minX, maxX, minY, maxY };
		if (!this.hasFit && data.nodes.length > 0) this.fit();
		else this.refreshFitZoom();
		if (this.commitTimer) {
			clearTimeout(this.commitTimer);
			this.commitTimer = null;
		}
		this.simActive = false;
		this.dragId = null;
		this.simMoved = false;
		this.simCenter = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
		this.buildSim();
		this.geoVersion++;
		this.markDirty();
	}

	setSettings(settings: GraphRenderSettings): void {
		this.settings = settings;
		this.geoVersion++;
		this.markDirty();
	}

	setRegionTuning(input: Partial<RegionTuning>): void {
		this.regionTuning = sanitizeRegionTuning(input);
		this.regionBuiltVersion = -2;
		if (!this.regionTuning.enabled) {
			this.regionCanvas = null;
			this.regionRect = null;
		}
		this.markDirty();
	}

	setPhysicsTuning(input: Partial<PhysicsTuning>): void {
		this.physicsTuning = sanitizePhysicsTuning(input);
		this.buildSim();
		if (this.sim) {
			this.sim.alpha(1);
			this.simActive = true;
		}
		this.markDirty();
	}

	setClusterLabels(labels: ReadonlyMap<string, string | null>): void {
		const data = this.data;
		if (!data) return;
		const settings = this.settings;
		if (!settings) {
			applyClusterLabels(data.clusters, [], labels, REGION_LABEL_MAX_WIDTH, REGION_LABEL_MAX_LINES, () => 0);
			return;
		}
		const ctx = this.ctx;
		const prevFont = ctx.font;
		ctx.font = `${LABEL_WEIGHT} ${settings.clusterLabelSize}px ${data.fontFamily}`;
		const changed = applyClusterLabels(
			data.clusters,
			this.regionMeta,
			labels,
			REGION_LABEL_MAX_WIDTH,
			REGION_LABEL_MAX_LINES,
			(s) => ctx.measureText(s).width,
		);
		ctx.font = prevFont;
		if (changed) this.markDirty();
	}

	setVisible(visible: ReadonlySet<string> | null): void {
		this.visible = visible;
		this.geoVersion++;
		this.markDirty();
	}

	fit(): void {
		if (!this.data || this.data.nodes.length === 0 || !this.worldBBox) return;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w < 10 || h < 10) return;
		const t = fitTransform(this.worldBBox, w, h, 40);
		this.kFit = t.k;
		this.hasFit = true;
		select(this.canvas).call(
			this.zoomBehavior.transform,
			zoomIdentity.translate(t.x, t.y).scale(t.k),
		);
	}

	private refreshFitZoom(): void {
		if (!this.worldBBox) return;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		if (w >= 10 && h >= 10) this.kFit = fitTransform(this.worldBBox, w, h, 40).k;
	}

	destroy(): void {
		if (this.frameId !== null) cancelAnimationFrame(this.frameId);
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.sim = null;
		this.simActive = false;
		this.dragId = null;
		this.resizeObserver.disconnect();
		select(this.canvas).on(".zoom", null);
		this.canvas.removeEventListener("wheel", this.onWheel);
		this.canvas.removeEventListener("pointermove", this.onPointerMove);
		this.canvas.removeEventListener("pointerdown", this.onPointerDown);
		this.canvas.removeEventListener("pointerup", this.onPointerUp);
		this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
		this.canvas.removeEventListener("contextmenu", this.onContextMenu);
		this.canvas.style.cursor = "";
	}


	private onWheel = (e: WheelEvent) => {
		e.preventDefault();
		const delta = -e.deltaY * (e.deltaMode === 1 ? 0.05 : e.deltaMode ? 1 : 0.002);
		const { x, y } = this.eventPos(e);
		const current = this.zoomTarget?.k ?? this.transform.k;
		const k = Math.min(Math.max(current * Math.exp(delta), 0.02), 40);
		this.zoomTarget = { k, x, y };
		this.lastTickAt = performance.now();
		this.markDirty();
	};

	private onPointerMove = (e: PointerEvent) => {
		const pos = this.eventPos(e);
		if (this.dragId) {
			const n = this.simById.get(this.dragId);
			if (n) {
				const moved =
					this.dragOrigin !== null &&
					Math.hypot(pos.x - this.dragOrigin.x, pos.y - this.dragOrigin.y) > CLICK_SLOP;
				if (moved) {
					if (this.commitTimer) {
						clearTimeout(this.commitTimer);
						this.commitTimer = null;
					}
					this.sim?.alphaTarget(DRAG_ALPHA_TARGET);
					this.simActive = true;
					this.markDirty();
				}
				const { x: tx, y: ty, k } = this.transform;
				n.fx = (pos.x - tx) / k;
				n.fy = (pos.y - ty) / k;
			}
			return;
		}
		const node = this.pickAt(pos.x, pos.y);
		if ((node?.id ?? null) !== this.hoverId) this.setHover(node?.id ?? null);
		this.canvas.style.cursor = node ? "pointer" : "";
	};

	private onPointerDown = (e: PointerEvent) => {
		if (e.button !== 0) return;
		const pos = this.eventPos(e);
		const node = this.pickAt(pos.x, pos.y);
		if (node && this.sim) {
			e.preventDefault();
			try {
				this.canvas.setPointerCapture(e.pointerId);
			} catch {
			}
			this.dragId = node.id;
			this.dragOrigin = pos;
			const n = this.simById.get(node.id);
			if (n) {
				n.fx = n.x;
				n.fy = n.y;
			}
			this.canvas.style.cursor = "grabbing";
			this.markDirty();
			return;
		}
		this.downPos = pos;
		this.zoomTarget = null;
	};

	private onPointerUp = (e: PointerEvent) => {
		if (e.button !== 0) return;
		if (this.dragId) {
			const id = this.dragId;
			this.dragId = null;
			this.dragOrigin = null;
			try {
				this.canvas.releasePointerCapture(e.pointerId);
			} catch {
			}
			this.canvas.style.cursor = "";
			const n = this.simById.get(id);
			if (n) {
				n.fx = null;
				n.fy = null;
			}
			if (this.simActive) {
				this.sim?.alphaTarget(0);
				this.markDirty();
			} else {
				this.callbacks.onSelect(id, this.eventPos(e));
			}
			return;
		}
		if (!this.downPos) return;
		const pos = this.eventPos(e);
		const moved = Math.hypot(pos.x - this.downPos.x, pos.y - this.downPos.y);
		this.downPos = null;
		if (moved > CLICK_SLOP) return;
		const node = this.pickAt(pos.x, pos.y);
		if (node) this.callbacks.onSelect(node.id, pos);
		else this.callbacks.onStageClick();
	};

	private onContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		const pos = this.eventPos(e);
		const node = this.pickAt(pos.x, pos.y);
		this.callbacks.onContext(node?.id ?? null, pos);
	};

	private onPointerLeave = () => {
		if (this.dragId) return;
		this.downPos = null;
		this.setHover(null);
	};


	private eventPos(e: { clientX: number; clientY: number }): Pt {
		const rect = this.canvas.getBoundingClientRect();
		return { x: e.clientX - rect.left, y: e.clientY - rect.top };
	}

	private pickAt(px: number, py: number): CanvasNode | null {
		if (!this.data || !this.settings) return null;
		const { x: tx, y: ty, k } = this.transform;
		const maxDist = this.settings.nodeSize * k + PICKING_PAD;
		const projected: { id: string; x: number; y: number }[] = [];
		for (const n of this.data.nodes) {
			if (this.visible && !this.visible.has(n.id)) continue;
			if (isImpNodeId(n.id)) continue;
			projected.push({ id: n.id, x: n.x * k + tx, y: n.y * k + ty });
		}
		const hit = pickNearest(projected, px, py, maxDist);
		if (!hit) return null;
		return this.nodeById.get(hit.id) ?? null;
	}

	private setHover(nodeId: string | null): void {
		if (nodeId === this.hoverId && this.hoverTarget === (nodeId ? 1 : 0)) return;
		this.hoverId = nodeId;
		if (nodeId) this.hoverNode = this.nodeById.get(nodeId) ?? null;
		this.hoverFrom = this.hoverFade;
		this.hoverTarget = nodeId ? 1 : 0;
		this.hoverStart = performance.now();
		this.animating = true;
		this.markDirty();
	}

	private markDirty(): void {
		this.dirty = true;
		if (this.frameId === null && !this.inTick) {
			this.frameId = requestAnimationFrame(() => {
				this.frameId = null;
				this.tick();
			});
		}
	}

	private tick(): void {
		this.inTick = true;
		try {
			const now = performance.now();
			const dt = Math.min(Math.max(now - this.lastTickAt, 8), 100);
			this.lastTickAt = now;
			const hoverAnim = this.advanceHover();
			const zoomAnim = this.advanceZoom(dt);
			const simAnim = this.advanceSim();
			this.draw();
			this.animating = hoverAnim || zoomAnim || simAnim;
		} finally {
			this.inTick = false;
		}
		if (this.animating) {
			this.frameId = requestAnimationFrame(() => {
				this.frameId = null;
				this.tick();
			});
		}
	}

	private advanceSim(): boolean {
		if (!this.sim || !this.simActive) return false;
		this.sim.tick();
		for (const n of this.sim.nodes()) {
			if (n.vx || n.vy) {
				this.simMoved = true;
				break;
			}
		}
		this.geoVersion++;
		if (!this.dragId && this.sim.alpha() < SIM_SETTLE_ALPHA) {
			this.simActive = false;
			this.scheduleCommit();
			return false;
		}
		return true;
	}

	private scheduleCommit(): void {
		if (this.commitTimer) clearTimeout(this.commitTimer);
		this.commitTimer = setTimeout(() => {
			this.commitTimer = null;
			if (!this.data || !this.simMoved) return;
			this.simMoved = false;
			const positions: Record<string, Position> = {};
			for (const n of this.data.nodes) positions[n.id] = { x: n.x, y: n.y };
			this.callbacks.onCommit(positions);
		}, COMMIT_DEBOUNCE_MS);
	}

	private advanceHover(): boolean {
		if (this.hoverFade === this.hoverTarget) return false;
		const t = Math.min((performance.now() - this.hoverStart) / HOVER_FADE_MS, 1);
		this.hoverFade = this.hoverFrom + (this.hoverTarget - this.hoverFrom) * t;
		if (this.hoverTarget === 0 && this.hoverFade === 0) this.hoverNode = null;
		return t < 1;
	}

	private advanceZoom(dt: number): boolean {
		const target = this.zoomTarget;
		if (!target) return false;
		const t = this.transform;
		const blend = 1 - Math.exp(-dt / ZOOM_EASE_MS);
		let k = t.k + (target.k - t.k) * blend;
		let done = false;
		if (Math.abs(target.k - k) / target.k < 0.002) {
			k = target.k;
			done = true;
		}
		const scale = k / t.k;
		const x = target.x - (target.x - t.x) * scale;
		const y = target.y - (target.y - t.y) * scale;
		if (done) this.zoomTarget = null;
		select(this.canvas).call(
			this.zoomBehavior.transform,
			zoomIdentity.translate(x, y).scale(k),
		);
		return !done;
	}

	private syncSize(): void {
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		const bw = Math.max(1, Math.round(w * dpr));
		const bh = Math.max(1, Math.round(h * dpr));
		if (this.canvas.width !== bw || this.canvas.height !== bh) {
			this.canvas.width = bw;
			this.canvas.height = bh;
		}
		this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		this.viewW = w;
		this.viewH = h;
	}

	private buildGeometry(): void {
		this.builtVersion = this.geoVersion;
		const data = this.data;
		const settings = this.settings;
		if (!data || !settings) return;

		const nodeR = settings.nodeSize;
		this.worldLabelFont = `${LABEL_WEIGHT} ${settings.labelSize}px ${data.fontFamily}`;
		this.world = {
			nodeR,
			glowOuter: nodeR * GLOW_SCALE,
			labelSize: settings.labelSize,
			labelGap: LABEL_GAP,
		};
		const visible = this.visible;
		const isVisible = (id: string) => !visible || visible.has(id);

		const nodesPath = new Path2D();
		for (const n of data.nodes) {
			if (!isVisible(n.id) || isImpNodeId(n.id)) continue;
			nodesPath.moveTo(n.x + nodeR, n.y);
			nodesPath.arc(n.x, n.y, nodeR, 0, Math.PI * 2);
		}
		this.nodesPath = nodesPath;

		const arrowLen = settings.arrowLength;
		const shafts = new Path2D();
		const heads = new Path2D();
		for (const e of data.edges) {
			if (!isVisible(e.from) || !isVisible(e.to)) continue;
			const a = this.nodeById.get(e.from);
			const b = this.nodeById.get(e.to);
			if (!a || !b) continue;
			const intoImp = isImpNodeId(e.to);
			const outOfImp = isImpNodeId(e.from);
			const g = arrowGeometry(a, b, outOfImp ? 0 : nodeR, intoImp ? 0 : nodeR, arrowLen);
			if (!g) continue;
			shafts.moveTo(g.shaftFrom.x, g.shaftFrom.y);
			if (intoImp) {
				shafts.lineTo(g.tip.x, g.tip.y);
			} else {
				shafts.lineTo(g.shaftTo.x, g.shaftTo.y);
				heads.moveTo(g.tip.x, g.tip.y);
				heads.lineTo(g.left.x, g.left.y);
				heads.lineTo(g.right.x, g.right.y);
				heads.closePath();
			}
		}
		this.shaftsPath = shafts;
		this.headsPath = heads;


		this.labelLines = new Map();
		const ctx = this.ctx;
		const prevFont = ctx.font;
		ctx.font = this.worldLabelFont;
		const maxW = LABEL_MAX_WIDTH * (settings.labelSize / LABEL_SIZE);
		for (const n of data.nodes) {
			if (isVisible(n.id) && !isImpNodeId(n.id)) this.labelLines.set(n.id, wrapLabel(ctx, n.label, maxW));
		}
		ctx.font = prevFont;
	}

	private buildSim(): void {
		const data = this.data;
		if (!data || data.nodes.length === 0) {
			this.sim = null;
			this.simById = new Map();
			return;
		}
		const t = this.physicsTuning;
		this.sim = createGraphSimulation(data.nodes, data.edges, {
			logicalEdges: data.logicalEdges,
			impLinks: data.impLinks,
			gravity: { x: this.simCenter.x, y: this.simCenter.y, strength: t.gravity },
			alphaDecay: LIVE_ALPHA_DECAY,
			velocityDecay: t.velocityDecay,
			chargeStrength: t.chargeStrength,
			linkStrength: t.linkStrength,
			linkDistance: t.linkDistance,
			clusterPull:
				data.clusters.length > 0 ? { clusters: data.clusters, strength: t.clusterPull } : undefined,
			depthAnchor:
				t.depthMode === "off"
					? undefined
					: {
							mode: t.depthMode,
							strength: t.depthStrength,
							spacing: t.depthSpacing,
							baseRadius: t.depthBaseRadius,
							center: this.simCenter,
						},
		});
		this.simById = new Map(data.nodes.map((n) => [n.id, n as LayoutNode]));
		this.sim.alpha(SIM_SETTLE_ALPHA);
	}

	private buildRegions(): void {
		const data = this.data;
		if (!data || data.clusters.length === 0) {
			this.regionCanvas = null;
			this.regionRect = null;
			this.regionMeta = [];
			return;
		}
		const visible = this.visible;
		const isVisible = (id: string): boolean => !visible || visible.has(id);

		const tuning = this.regionTuning;

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const c of data.clusters) {
			for (const id of c.members) {
				if (!isVisible(id)) continue;
				const n = this.nodeById.get(id);
				if (!n) continue;
				if (n.x < minX) minX = n.x;
				if (n.x > maxX) maxX = n.x;
				if (n.y < minY) minY = n.y;
				if (n.y > maxY) maxY = n.y;
			}
		}
		if (minX > maxX) {
			this.regionCanvas = null;
			this.regionRect = null;
			this.regionMeta = [];
			return;
		}

		const clusterOf = new Map<string, number>();
		data.clusters.forEach((c, i) => {
			for (const id of c.members) clusterOf.set(id, i);
		});

		this.regionMeta = [];
		data.clusters.forEach((cluster) => {
			let members = 0;
			let sumX = 0;
			let sumY = 0;
			for (const id of cluster.members) {
				if (!isVisible(id)) continue;
				const n = this.nodeById.get(id);
				if (!n) continue;
				members++;
				sumX += n.x;
				sumY += n.y;
			}
			if (members > 0) {
				this.regionMeta.push({
					id: cluster.id,
					label: cluster.label || null,
					cx: sumX / members,
					cy: sumY / members,
					hue: clusterHue(cluster.id),
					lines: null,
				});
			}
		});

		const settings = this.settings;
		if (settings) {
			const ctx = this.ctx;
			const prevFont = ctx.font;
			ctx.font = `${LABEL_WEIGHT} ${settings.clusterLabelSize}px ${data.fontFamily}`;
			for (const rm of this.regionMeta) {
				rm.lines = rm.label
					? wrapRegionLabel(rm.label, REGION_LABEL_MAX_WIDTH, REGION_LABEL_MAX_LINES, (s) => ctx.measureText(s).width)
					: null;
			}
			ctx.font = prevFont;
		}

		if (!tuning.enabled) {
			this.regionCanvas = null;
			this.regionRect = null;
			return;
		}

		const dilationW = tuning.dilation;
		const blurW = tuning.blur;
		const padWorld = dilationW + blurW * 2;
		const spanNow = Math.max(maxX - minX, maxY - minY);
		const cell = Math.max(spanNow, padWorld * 2) / tuning.bitmap;
		minX -= padWorld;
		minY -= padWorld;
		maxX += padWorld;
		maxY += padWorld;
		const spanX = maxX - minX;
		const spanY = maxY - minY;
		const bw = Math.max(1, Math.ceil(spanX / cell));
		const bh = Math.max(1, Math.ceil(spanY / cell));
		let rc = this.regionCanvas;
		if (!rc) {
			rc = document.createElement("canvas");
			this.regionCanvas = rc;
		}
		if (rc.width !== bw || rc.height !== bh) {
			rc.width = bw;
			rc.height = bh;
		}
		const rctx = rc.getContext("2d", { willReadFrequently: true });
		if (!rctx) return;
		rctx.clearRect(0, 0, bw, bh);
		rctx.lineCap = "round";
		rctx.lineWidth = (dilationW * 2) / cell;

		data.clusters.forEach((cluster, ci) => {
			const hue = clusterHue(cluster.id);
			rctx.strokeStyle = `hsla(${hue}, 65%, ${data.colors.clusterLightness.ring}%, 1)`;
			rctx.beginPath();
			const touched = new Set<string>();
			for (const e of data.edges) {
				if (clusterOf.get(e.from) !== ci) continue;
				if (clusterOf.get(e.to) !== ci) continue;
				if (!isVisible(e.from) || !isVisible(e.to)) continue;
				const a = this.nodeById.get(e.from);
				const b = this.nodeById.get(e.to);
				if (!a || !b) continue;
				rctx.moveTo((a.x - minX) / cell, (a.y - minY) / cell);
				rctx.lineTo((b.x - minX) / cell, (b.y - minY) / cell);
				touched.add(e.from);
				touched.add(e.to);
			}
			rctx.stroke();

			rctx.fillStyle = `hsla(${hue}, 65%, ${data.colors.clusterLightness.ring}%, 1)`;
			const discR = dilationW / cell;
			for (const id of cluster.members) {
				if (touched.has(id) || !isVisible(id)) continue;
				const n = this.nodeById.get(id);
				if (!n) continue;
				rctx.beginPath();
				rctx.arc((n.x - minX) / cell, (n.y - minY) / cell, discR, 0, Math.PI * 2);
				rctx.fill();
			}
		});

		{
			const blurPx = tuning.blur > 0 ? Math.max(1, Math.round(blurW / cell)) : 0;
			const img = rctx.getImageData(0, 0, bw, bh);
			const n = bw * bh * 4;
			const a = new Float32Array(n);
			for (let i = 0; i < n; i += 4) {
				const alpha = img.data[i + 3]! / 255;
				a[i] = img.data[i]! * alpha;
				a[i + 1] = img.data[i + 1]! * alpha;
				a[i + 2] = img.data[i + 2]! * alpha;
				a[i + 3] = img.data[i + 3]!;
			}
			const b = new Float32Array(n);
			const tmp = new Float32Array(n);
			boxBlurRound(a, tmp, b, bw, bh, blurPx);
			boxBlurRound(b, tmp, a, bw, bh, blurPx);
			boxBlurRound(a, tmp, b, bw, bh, blurPx);
			for (let i = 0; i < n; i += 4) {
				const alpha = b[i + 3]!;
				if (alpha <= 0) {
					img.data[i] = 0;
					img.data[i + 1] = 0;
					img.data[i + 2] = 0;
					img.data[i + 3] = 0;
				} else {
					img.data[i] = Math.round((b[i]! / alpha) * 255);
					img.data[i + 1] = Math.round((b[i + 1]! / alpha) * 255);
					img.data[i + 2] = Math.round((b[i + 2]! / alpha) * 255);
					img.data[i + 3] = Math.round(alpha * tuning.edgeAlpha);
				}
			}
			rctx.putImageData(img, 0, 0);
		}
		this.regionRect = { minX, minY, w: spanX, h: spanY };
	}

	private draw(): void {
		this.dirty = false;
		const data = this.data;
		const settings = this.settings;
		if (!data || !settings) return;
		const w = this.canvas.clientWidth;
		const h = this.canvas.clientHeight;
		const dpr = window.devicePixelRatio || 1;
		const ctx = this.ctx;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		this.frameCount++;
		if (
			this.regionBuiltVersion !== this.geoVersion &&
			(!this.simActive || this.frameCount % REGION_EVERY === 0)
		) {
			this.buildRegions();
			this.regionBuiltVersion = this.geoVersion;
		}
		if (this.builtVersion !== this.geoVersion) this.buildGeometry();
		if (!this.nodesPath) return;

		const { x: tx, y: ty, k } = this.transform;
		ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * tx, dpr * ty);

		const ratio = zoomRatioOf(this.kFit, k);
		const nodeAlpha = labelAlpha(ratio, settings.labelZoom);
		const regionAlpha = 1 - nodeAlpha;
		const { nodeR, glowOuter } = this.world;

		if (this.regionCanvas && this.regionRect) {
			const { minX, minY, w, h } = this.regionRect;
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(this.regionCanvas, minX, minY, w, h);
		}

		if (settings.edgeWidth > 0) {
			ctx.strokeStyle = data.colors.edge;
			ctx.fillStyle = data.colors.edge;
			ctx.lineWidth = settings.edgeWidth / k;
			ctx.lineCap = "round";
			ctx.stroke(this.shaftsPath);
			ctx.fill(this.headsPath);
		}

		ctx.fillStyle = data.colors.node;
		ctx.fill(this.nodesPath);

		if (nodeAlpha > 0.01) {
			ctx.save();
			ctx.globalAlpha = nodeAlpha;
			ctx.font = this.worldLabelFont;
			for (const [id, lines] of this.labelLines) {
				const n = this.nodeById.get(id);
				if (!n) continue;
				drawNameLines(ctx, n.x, n.y, lines, this.world, data.colors.label);
			}
			ctx.restore();
		}

		if (this.hoverNode && this.hoverFade > 0.02) {
			const n = this.visible && !this.visible.has(this.hoverNode.id)
				? null
				: this.hoverNode;
			if (n) {
				const glow = ctx.createRadialGradient(n.x, n.y, nodeR, n.x, n.y, glowOuter);
				glow.addColorStop(0, rgbaFromHex(data.colors.node, GLOW_ALPHA * this.hoverFade));
				glow.addColorStop(1, rgbaFromHex(data.colors.node, 0));
				ctx.fillStyle = glow;
				ctx.beginPath();
				ctx.arc(n.x, n.y, glowOuter, 0, Math.PI * 2);
				ctx.arc(n.x, n.y, nodeR, 0, Math.PI * 2, true);
				ctx.fill("evenodd");
				ctx.save();
				ctx.globalAlpha = this.hoverFade;
				ctx.font = this.worldLabelFont;
				drawNameLines(ctx, n.x, n.y, this.labelLines.get(n.id) ?? [], this.world, data.colors.hoverText);
				ctx.restore();
			}
		}

		if (settings.clusterLabels && regionAlpha > 0.01) {
			ctx.save();
			ctx.globalAlpha = regionAlpha;
			ctx.font = `${LABEL_WEIGHT} ${settings.clusterLabelSize / k}px ${data.fontFamily}`;
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			const lineH = (settings.clusterLabelSize * REGION_LABEL_LINE_HEIGHT) / k;
			for (const rm of this.regionMeta) {
				if (!rm.lines) continue;
				ctx.fillStyle = `hsla(${rm.hue}, 55%, ${data.colors.clusterLightness.label}%, 0.85)`;
				const firstOffset = (-(rm.lines.length - 1) / 2) * lineH;
				for (let i = 0; i < rm.lines.length; i++) {
					ctx.fillText(rm.lines[i]!, rm.cx, rm.cy + firstOffset + i * lineH);
				}
			}
			ctx.restore();
		}
	}
}
