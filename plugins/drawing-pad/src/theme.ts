import type { PluginFrontendContext } from "owlly-plugin-api";
import { captureBackground } from "./capture.ts";
import { mountReference } from "./reference.ts";
import type { Draft } from "./state.ts";

const colors = ["--background", "--foreground", "--muted-foreground", "--border", "--ow-ink-strong", "--ow-ink-italic",
  "--ow-ink-code", "--ow-accent", "--card", "--ow-error", "--ow-success", "--ow-warning"];
export function appPalette(): { key: string; mode: "dark" | "light" } {
  const root = typeof document === "undefined" ? undefined : document.documentElement;
  const mode = root?.classList.contains("light") ? "light" : "dark";
  const style = root ? getComputedStyle(root) : undefined;
  return { mode, key: JSON.stringify([mode, ...colors.map(name => style?.getPropertyValue(name).trim() ?? "")]) };
}

export async function recolorReference(draft: Draft, ctx: PluginFrontendContext, signal: AbortSignal): Promise<Pick<Draft, "background" | "backgroundColor">> {
  const root = document.createElement("div"); root.className = "drawing-pad-root";
  root.style.cssText = "position:fixed;inset:auto;left:-100000px;top:0;pointer-events:none";
  root.setAttribute("aria-hidden", "true"); document.body.append(root);
  let mounted: ReturnType<typeof mountReference> | undefined;
  try {
    const backgroundColor = getComputedStyle(root).backgroundColor;
    if (!draft.reference) return { background: "", backgroundColor };
    const reference = document.createElement("div"); reference.className = "drawing-pad-reference";
    reference.style.width = `${draft.width}px`; root.append(reference);
    mounted = mountReference(reference, ctx, draft.reference, signal);
    const captured = await captureBackground(reference, mounted.slots, draft.width, draft.height, backgroundColor, signal,
      { width: draft.width, height: draft.height, pixelRatio: draft.pixelRatio });
    return { background: captured.background, backgroundColor: captured.backgroundColor };
  } finally { mounted?.dispose(); root.remove(); }
}
