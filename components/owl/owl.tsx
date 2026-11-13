"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";


export type OwlMood = "neutral" | "happy" | "unimpressed" | "talking" | "waving";

const INK = "var(--ow-owl-ink)";
const NAVY = "var(--ow-owl-navy)";
const AMBER = "var(--ow-owl-amber)";
const BEAK = "var(--ow-owl-beak)";
const MOUTH = "var(--ow-owl-mouth)";
const SCREEN = "var(--ow-owl-screen)";
const DECK = "var(--ow-owl-deck)";
const SW = 11;

const BODY =
	"M512 220C650 220 742 318 740 440C738 560 694 640 652 700C616 750 572 766 512 766C452 766 408 750 372 700C330 640 286 560 284 440C282 318 374 220 512 220Z";
const TUFT =
	"M310 330C292 306 282 282 290 262C300 266 309 268 316 266C313 252 315 240 323 230C333 239 342 245 352 247C358 239 366 234 375 233C381 246 392 255 405 262Z";
const WING_REST =
	"M622 578C652 566 686 560 708 566C726 602 730 642 720 672L712 698Q702 686 693 690L684 702Q676 688 667 692C646 662 630 622 622 578Z";
const WING_WAVE =
	"M628 586C664 566 700 540 728 508C742 492 766 478 784 488C802 500 800 520 788 530L800 540Q804 558 786 558L792 570Q788 588 768 582C730 604 686 616 642 616Z";
const WING_LEFT =
	"M406 580C380 566 346 560 322 570C300 594 292 632 300 662L310 692Q320 678 330 684L340 702Q350 686 360 692L372 702Q380 682 388 668C400 640 410 610 406 580Z";
const EYE_X = [425, 598] as const;

const outline = { stroke: INK, strokeWidth: SW, strokeLinejoin: "round" as const };

function lidPath(x: number) {
	return `M${x - 52} 410L${x + 52} 410C${x + 52} 442 ${x + 28} 460 ${x} 460C${x - 28} 460 ${x - 52} 442 ${x - 52} 410Z`;
}

function Eyes({ mood, uid }: { mood: OwlMood; uid: string }) {
	if (mood === "happy") {
		return (
			<g>
				{EYE_X.map((x) => (
					<path
						key={x}
						d={`M${x - 33} 424Q${x} 380 ${x + 33} 424`}
						style={{ fill: "none", stroke: INK, strokeWidth: 13, strokeLinecap: "round" }}
					/>
				))}
			</g>
		);
	}
	if (mood === "unimpressed") {
		return (
			<g>
				{EYE_X.map((x, i) => (
					<g key={x}>
						<clipPath id={`${uid}-lid${i}`}>
							<path d={lidPath(x)} />
						</clipPath>
						<path d={lidPath(x)} style={{ fill: "#fff" }} />
						<ellipse cx={x + 4} cy={440} rx={24} ry={22} style={{ fill: INK }} clipPath={`url(#${uid}-lid${i})`} />
						<path d={lidPath(x)} style={{ fill: "none", stroke: INK, strokeWidth: 9 }} />
						<path d={`M${x - 60} 408L${x + 60} 410`} style={{ stroke: INK, strokeWidth: 14, strokeLinecap: "round" }} />
					</g>
				))}
			</g>
		);
	}
	return (
		<g className="ow-owl-eyes">
			{EYE_X.map((x) => (
				<g key={x}>
					<ellipse cx={x} cy={412} rx={35} ry={45} style={{ fill: INK }} />
					<circle cx={x - 11} cy={391} r={11.5} style={{ fill: "#fff" }} />
				</g>
			))}
		</g>
	);
}

function Beak({ open }: { open: boolean }) {
	if (open) {
		return (
			<g>
				<path
					d="M482 440Q512 426 542 440Q550 462 537 482Q525 500 512 500Q499 500 487 482Q474 462 482 440Z"
					style={{ fill: BEAK, stroke: INK, strokeWidth: 9, strokeLinejoin: "round" }}
				/>
				<path
					className="ow-owl-mouth"
					d="M495 470Q512 462 529 470Q526 488 512 489Q498 488 495 470Z"
					style={{ fill: MOUTH, stroke: INK, strokeWidth: 6, strokeLinejoin: "round" }}
				/>
			</g>
		);
	}
	return (
		<path
			d="M480 443Q512 428 544 443Q549 450 544 458L521 494Q512 506 503 494L480 458Q475 450 480 443Z"
			style={{ fill: BEAK, stroke: INK, strokeWidth: 9, strokeLinejoin: "round" }}
		/>
	);
}

function Foot({ cx }: { cx: number }) {
	return (
		<path
			d={`M${cx - 32} 782Q${cx - 34} 762 ${cx - 14} 758L${cx + 14} 758Q${cx + 34} 762 ${cx + 32} 782Q${cx + 24} 794 ${cx + 16} 786Q${cx + 8} 802 ${cx} 790Q${cx - 8} 802 ${cx - 16} 786Q${cx - 24} 794 ${cx - 32} 782Z`}
			style={{ fill: BEAK, ...outline }}
		/>
	);
}

export function Owl({
	mood = "neutral",
	size,
	className,
	animated = true,
	title,
}: {
	mood?: OwlMood;
	size?: number;
	className?: string;
	animated?: boolean;
	title?: string;
}) {
	const uid = useId().replace(/:/g, "");
	const open = mood === "talking" || mood === "waving";
	return (
		<svg
			viewBox="215 200 595 610"
			width={size}
			height={size}
			className={cn("ow-owl shrink-0 overflow-visible", className)}
			data-mood={mood}
			data-animated={animated ? "" : undefined}
			role={title ? "img" : undefined}
			aria-label={title}
			aria-hidden={title ? undefined : true}
		>
			<defs>
				<clipPath id={`${uid}-body`}>
					<path d={BODY} />
				</clipPath>
			</defs>
			<g className="ow-owl-bob">
				<path d={TUFT} style={{ fill: NAVY, ...outline }} />
				<path d={TUFT} transform="translate(1024 0) scale(-1 1)" style={{ fill: NAVY, ...outline }} />
				<path d={BODY} style={{ fill: NAVY, stroke: INK, strokeWidth: SW }} />
				<ellipse cx={554} cy={676} rx={100} ry={90} style={{ fill: AMBER }} clipPath={`url(#${uid}-body)`} />
				<ellipse cx={424} cy={418} rx={95} ry={105} style={{ fill: AMBER }} />
				<ellipse cx={600} cy={418} rx={95} ry={105} style={{ fill: AMBER }} />
				<Eyes mood={mood} uid={uid} />
				<Beak open={open} />
				<Foot cx={446} />
				<Foot cx={578} />
				<path
					className={mood === "waving" ? "ow-owl-wave" : undefined}
					d={mood === "waving" ? WING_WAVE : WING_REST}
					style={{ fill: NAVY, ...outline }}
				/>
				<path d="M266 606L440 602L462 712L292 716Z" style={{ fill: SCREEN, ...outline }} />
				<rect x={284} y={708} width={254} height={22} rx={9} style={{ fill: DECK, stroke: INK, strokeWidth: SW }} />
				<path d={WING_LEFT} style={{ fill: NAVY, ...outline }} />
			</g>
		</svg>
	);
}
