import { svgImageSource } from "../../lib/svg-image-source";

export { svgImageSource };

export function SvgImage({
	svg,
	className,
	width,
}: {
	svg: string;
	className?: string;
	width?: number;
}) {
	// eslint-disable-next-line @next/next/no-img-element
	return <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgImageSource(svg))}`} alt="Figure" className={className} width={width} draggable={false} />;
}
