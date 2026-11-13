import type { PluginFrontendContext } from "owlly-plugin-api";

export function mountSavedQuestion(container: HTMLElement, ui: Pick<PluginFrontendContext["ui"], "mountMarkdown">, question: string, signal: AbortSignal): () => void {
  if (signal.aborted) return () => {};
  const root = container.ownerDocument.createElement("div");
  root.className = "ow-coding-prompt";
  container.append(root);
  let markdown: ReturnType<PluginFrontendContext["ui"]["mountMarkdown"]> | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    try { markdown?.dispose(); }
    finally { root.remove(); }
  };
  signal.addEventListener("abort", dispose, { once: true });
  try {
    markdown = ui.mountMarkdown(root, { text: question }, { signal });
    if (disposed) markdown.dispose();
  } catch (error) { dispose(); throw error; }
  return dispose;
}
