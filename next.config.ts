import { readFileSync } from "node:fs";
import type { NextConfig } from "next";
import { MAX_IMPORT_BODY_BYTES } from "./lib/notes-import-limits.ts";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string; homepage: string };

const nextConfig: NextConfig = {
	env: { OWLLY_VERSION: pkg.version, OWLLY_HOMEPAGE: pkg.homepage },
	experimental: { proxyClientMaxBodySize: MAX_IMPORT_BODY_BYTES },
	output: "standalone",
	outputFileTracingExcludes: {
		"*": [
			"**/data/**/*",
			"auth.json",
			"chatgpt-credentials.json*",
			"github-copilot-credentials.json*",
			"xai-credentials.json*",
			".env*",
		],
	},
	outputFileTracingIncludes: {
		"*": [
			"node_modules/@puppeteer/browsers/lib/browser-data/**/*.js",
			"node_modules/pdfjs-dist/legacy/**/*",
			"node_modules/pdfjs-dist/standard_fonts/**/*",
			"node_modules/@napi-rs/canvas-*/**/*",
			"src/agent/prompts/side-chat/*.md",
			"src/agent/image-processing/*.mjs",
			"src/agent/image-processing/LICENSE",
			"node_modules/@silvia-odwyer/photon-node/**/*",
			"node_modules/@resvg/resvg-js-*/**/*",
			"node_modules/@earendil-works/pi-ai/dist/providers/data/**/*",
			"node_modules/@earendil-works/pi-ai/dist/auth/oauth/{load,github-copilot,xai,device-code}.js",
			"node_modules/@earendil-works/pi-ai/dist/utils/sleep.js",
			"node_modules/@earendil-works/pi-agent-core/dist/**/*.json",
			"node_modules/gcp-metadata/**/*",
			"node_modules/json-bigint/**/*",
			"node_modules/bignumber.js/**/*",
		],
	},
	serverExternalPackages: [
		"@earendil-works/pi-ai",
		"@earendil-works/pi-agent-core",
		"pdfjs-dist",
		"@napi-rs/canvas",
		"@silvia-odwyer/photon-node",
		"@resvg/resvg-js",
	],
};

export default nextConfig;