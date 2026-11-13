# Getting started

Owlly runs from source as a local web app: see [Development](development.md), or the quick start in the [README](../README.md#run-it).

## Connect models

Open **Settings → Providers** and configure a connection:

- **Provider API keys:** use your own account and pay that provider's rates.
- **Subscription connections:** ChatGPT, GitHub Copilot, and Grok use their respective sign-in flows and account limits. They do not silently fall back to API-key billing.
- **[Claude Code](claude-code.md):** use a separately installed and authenticated CLI. Its own configuration controls routing and billing; this is not a subscription-only guarantee.
- **[Custom endpoint](custom-providers.md):** connect one OpenAI-compatible server, including a local model server. Owlly does not install or download models.

Choose **Strong**, **Cheap**, and **Vision** models in Settings. There are no factory model selections. New sessions start with Strong; background roles use their assigned slots or role overrides. A model selected inside an existing session belongs to that session and does not change background-role choices.

Optional web search supports Tavily, Brave, Exa, Firecrawl, and hosted Ollama search; configure a key for the engine you want to use. Research can still fetch known URLs without a search key. Dictation has its own service key below.

## Start a session

Choose **Learn** and describe what you want to understand. The agent probes your starting point, presents a plan, and teaches through explanations and checks. Reply naturally to accept or revise the plan.

Use the chat input or the Challenge answer box to explain your reasoning. There are no separate thinking or reading-notes fields. You can type or dictate into the available answer inputs.

Choose **Challenge** for problems rather than a lesson. Start from selected knowledge map material or describe material directly. Submit your thinking as you work; the model's committed solution is revealed when the problem concludes. Use **Next problem** when ready to continue.

Sessions are saved locally, including earlier messages when context is compacted. The [keyboard guide](keyboard.md) covers submission, focus, question controls, and cancellation.

## Dictation

1. Create a [Deepgram API key](https://console.deepgram.com/) with the **Member role or higher**, required for [short-lived token minting](https://developers.deepgram.com/reference/auth/tokens/grant).
2. Add it under **Settings → Providers → Dictation** and choose the language below the key. **Multilingual** supports automatic recognition and mixed-language speech.
3. Use the microphone icon beside **Attach files** or **Mod+D** to start and stop. Review the text before sending. **Esc cancellation discards the pending transcript**; stop normally to keep it.

Audio streams from your browser directly to Deepgram using a short-lived token. A `403 Insufficient permissions` error while obtaining that token can mean the key's role is insufficient.

## Use local files in a session

Use the paperclip to choose one or more files, or drag files into the conversation. Each batch can contain up to 25 MB. Owlly uploads copies into its local attachment storage and inserts file chips in the active message or answer box without sending it. Wait for the upload to finish before sending. Uploaded copies remain available for saved conversations after a restart, even if you move the originals.

You can remove a file chip from the draft before sending; this does not delete the uploaded copy. Folder uploads are not supported. You can still paste an absolute local path. The tutor reads supported content using the existing file-access tools and restrictions; uploading does not change those restrictions. Attachments are separate from knowledge-graph imports.

The teacher can show a local raster image or request an annotated visual based on it. Displayed/annotated pictures are saved as session-owned snapshots, so those saved results no longer depend on the original file. This does not snapshot every file attachment. Offline regression tests cover snapshot/payload behavior, not the quality of model-generated annotations.

File tools are read-only but have broad filesystem access under the server's user; they are not confined to a selected folder. The sensitive-path guard blocks known credential/private locations, not all sensitive content. Review what you make available: file content read by an agent may be sent to its configured model provider. See [file-access boundaries](architecture.md#file-access-and-external-services).

## Extract into the knowledge map

Open **Knowledge map** below **Challenge** in the sidebar to view your knowledge map. Home keeps the owl welcome and session composer. **Settings → Knowledge map → Map rendering** switches the Knowledge map page between the interactive map and its summary/Chains view.

For lessons, attach material to a session instead. Use the knowledge map's **Extract files… → Files** or **Folder** picker for Markdown, plain text, or PDFs. This is a separate import flow, not the session's path attachments. Extract files accepts `.txt`, `.md`, `.markdown`, `.rst`, `.org`, `.adoc`, `.tex` and `.pdf` (any letter case); other extensions are turned away with a short message. Each supported file is uploaded for processing; folders organize imported sources.

- Files are limited to **25 MiB each**. Imports queue independently, with up to three files in flight.
- Within the accepted extensions, PDFs are recognized by their `%PDF-` header and converted locally, without OCR. Image-only pages are skipped and counted; scanner text can be inaccurate. Check the import's notices.
- Other files are read as UTF-8. A zero byte in the first 8 KiB causes rejection before source registration or model calls. This catches many binary files renamed to `.txt`, but is not complete binary detection; UTF-16 text is not decoded correctly and is often rejected. Save text as UTF-8.
- Imported text then goes through model-based proposition/chain extraction. Local PDF conversion does not make the whole import offline.
- Completed chunks survive later failures. Retry is explicit and reprocesses the file; unchanged content is not automatically skipped. The file queue does not survive a page reload.

The knowledge map stores propositions and reasoning chains with source provenance, **not mastery scores**. A proposition's presence is not proof that you understood or retained it. Automatic session extraction can be disabled independently of map rendering.

## Data, privacy, and usage

Chats, knowledge map records, settings, and credentials live on your machine. Data lives in the repository's `data/` folder by default, or wherever `OWLLY_DATA_DIR` points:

| OS | Learning-data folder |
| --- | --- |
| any | repository `data/`, or `$OWLLY_DATA_DIR` |

API-key files sit beside `data`, not inside it. They are plaintext with restrictive file permissions, not an encrypted vault. Keep complete profiles private; do not share credential files or raw debug captures in bug reports.

**Local storage does not mean local-only processing.** Configured models, subscription/CLI services, web research, and dictation can receive content. A local custom model is a separate setup choice, not an offline guarantee for other enabled services.

Click the context/cost row beneath the composer for Session stats. Dollar figures estimate known API costs; subscription, CLI, and custom-endpoint usage are not treated as free. See [context, caching, and costs](compaction-accounting.md) for the details.

Packaged apps support updates under **Settings → General**. Development builds do not run the updater. Report problems through this repository's issue tracker, with reproduction steps and the app/OS version rather than private learning records or keys.
