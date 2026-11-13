# Prompt composition

The runtime composes prompts for **prober**, **teacher** and **practice** agents. The source of truth is [`listSourceSegments`](../prompt-segments.ts); [`composeInstructions`](../teacher-agent.ts) reads built-in source text, trims each segment, drops empty segments and joins them with `\n\n---\n\n`. Non-fragment documentation such as this README never enters the prompt.

## Composition order

| Agent | Segments, in order |
|---|---|
| Prober | [`system-prompt.md`](../system-prompt.md) → sorted `prober/` fragments → sorted `shared/` fragments |
| Teacher | `system-prompt.md` → sorted `teacher/` fragments → sorted `shared/` fragments |
| Practice | sorted `practice/` fragments → the curated shared appendix below; **no teaching base** |
| Side questions | [`side-chat/00-base.md`](side-chat/00-base.md) → shared `10-voice.md`, `15-accuracy.md`, `40-formatting.md` → final side-only [`90-style.md`](side-chat/90-style.md); composed by [`src/agent/side-chat.ts`](../side-chat.ts), not by the segment loader |

Directory discovery accepts only filenames matching `^\d+-[\w.-]+\.md$` and sorts them lexicographically by filename. Keep numeric prefixes consistently padded when order matters. The teaching base supplies the agent's purpose/philosophy; voice, accuracy, mental-model, question, file and formatting guidance are separate shared fragments. The teacher's method and planning/teaching doctrine live in its own directory; probing doctrine lives in `prober/`.

Side questions use their built-in base, shared appendix, and final style fragment.

Practice has its own base and doctrine. Its shared appendix is explicitly allowlisted in the loader: `10-voice.md`, `15-accuracy.md`, `16-mental-model.md`, `35-side-conversations.md` and `40-formatting.md`, in sorted order. Other shared fragments do **not** automatically enter practice. Adding a new shared fragment includes it in prober/teacher composition, but not practice unless the allowlist changes.

## Built-in instructions

Prompts come exclusively from the application source files. Settings has no system-prompt editor, and the backend has no prompt-override API or file reader. Legacy `agent.prompts` settings are ignored during parsing/resolution; files previously saved under `data/prompts/` are not loaded.

The prober, teacher, and practice compositions are cached when their runtime module initializes. Source changes require the server module to reload or the server to restart. They do not rewrite an already-running agent's instructions. Side-question composition reads its built-in files when requested.

Directory discovery and the practice allowlist live in [`src/agent/prompt-segments.ts`](../prompt-segments.ts). Background workers and extraction retain their own built-in instructions.

## Phases and tool contracts

- Teaching sessions start with the prober. A successful `probe_done` call **and matching result** select the teacher on later turns; a bare/refused call does not. The teacher plans and teaches with its own tool registry. The displayed plan → teach boundary is the first tagged `quiz`/`explain` call, not simply `plan_init`.
- Practice sessions use the practice prompt from turn one. `problem` commits a solution before posing; `conclude` reveals it. The doctrine requires a pause after conclusion until the learner explicitly moves on. This is a conversational agent, not the retired problem-set generation/grading pipeline.
- Prompt instructions are not a substitute for structural validation. For example, `plan_init` can rewrite the map, and the conclude pause is doctrine rather than a terminating execute result. Read the actual registry and schemas before describing a behavior as enforced.

See [architecture](../../../docs/architecture.md#teaching-and-practice) for runtime phases, registry differences and pause mechanics; [teaching methodology](../../../docs/teaching-methodology.md) for the method. Background workers and extraction have their own instructions in their implementation modules; this loader is not a catalog of every prompt in the application.

## Editing fragments

- Put agent-specific doctrine in that agent's directory. Use `shared/` only for guidance appropriate to every agent that composes it; check practice's explicit allowlist.
- Match tool names and input fields to the actual schemas in `src/agent/tools.ts` and `src/agent/tools/`. Agents share history, not identical toolsets: prober `probe`/`recall` and teacher `quiz`/`explain` deliberately differ. Do not imply a tool is available merely because another phase uses it.
- Keep always-in-context text concise. Avoid duplicating the base, other fragments, tool schemas or runtime reference documentation.
- Verify composition and agent-flow behavior when changing the loader. Prompt assets must remain included in standalone packaging (`scripts/build-server.mjs`).
