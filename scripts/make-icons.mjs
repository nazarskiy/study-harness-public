import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = readFileSync(path.join(root, "build", "icon-flat.svg"), "utf8");

const render = (size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render(size, size).asPng();

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const pngs = ICO_SIZES.map(render);
const header = Buffer.alloc(6 + ICO_SIZES.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(ICO_SIZES.length, 4);
let offset = header.length;
ICO_SIZES.forEach((size, i) => {
	const e = 6 + i * 16;
	header.writeUInt8(size === 256 ? 0 : size, e);
	header.writeUInt8(size === 256 ? 0 : size, e + 1);
	header.writeUInt8(0, e + 2);
	header.writeUInt8(0, e + 3);
	header.writeUInt16LE(1, e + 4);
	header.writeUInt16LE(32, e + 6);
	header.writeUInt32LE(pngs[i].length, e + 8);
	header.writeUInt32LE(offset, e + 12);
	offset += pngs[i].length;
});
const ico = Buffer.concat([header, ...pngs]);
writeFileSync(path.join(root, "build", "icon.ico"), ico);
console.log(`build/icon.ico  ${ICO_SIZES.join("/")} — ${(ico.length / 1024).toFixed(1)} KB`);

const png512 = render(512);
writeFileSync(path.join(root, "build", "icon.png"), png512);
console.log(`build/icon.png  512×512 — ${(png512.length / 1024).toFixed(1)} KB`);
