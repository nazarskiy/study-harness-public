"use client";
import { artifactRenderers } from "@/components/artifacts";
import { LiveToolCard } from "@/components/artifacts/live-tool-card";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import { QUESTION_TOOLS,type ArtifactPartProps,type OwllyViewPart } from "@/src/core";

export function ToolPartRenderer({ part }: { part: OwllyViewPart }) {
 const toolName = part.type.slice("tool-".length);
 const Builtin = Object.hasOwn(artifactRenderers, toolName) ? artifactRenderers[toolName] : undefined;
 const reserved = Builtin || toolName === "plan_init" || (QUESTION_TOOLS as readonly string[]).includes(toolName);
 if (reserved && part.state === "input-streaming") return <LiveToolCard part={part as ArtifactPartProps["part"]} />;
 if (Builtin) return <Builtin part={part as ArtifactPartProps["part"]} />;
 if (reserved) return null;
 return <ToolCallCard part={{ ...part, state: part.state ?? "input-available", toolCallId: part.toolCallId ?? "", output: part.output ?? part.result?.details ?? part.result?.content.map(block => block.type === "text" ? block.text : "[Image]").join("\n") }} />;
}
