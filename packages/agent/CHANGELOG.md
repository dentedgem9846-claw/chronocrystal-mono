# Changelog

## [Unreleased]

### Added
- Diagnostic logging in `bridge.ts`: `[magic_book]` on tool dispatch, `[book]` step-by-step trace through resource loader and session creation.

### Fixed
- `runBookTask` hung silently in containerised environments because `DefaultResourceLoader` was created without a `settingsManager`, falling back to `SettingsManager.create()` which looks for `~/.pi` config files that don't exist in the container. Fixed by passing `SettingsManager.inMemory()` to the loader.

### Changed
- Default model for both `witch.md` and `book.md` changed from `deepseek/deepseek-chat-v3-0324` to `google/gemma-4-31b-it`.

---

### Added
* Agent definitions via markdown files with YAML frontmatter (`agents/witch.md`, `agents/book.md`) loaded with `parseFrontmatter` from the pi SDK. Model, tools, and system prompt are now editable without touching code.
* `REFERENCES.md` with links to pi SDK examples used as implementation guides.
* Programmatic E2E test harness (`test/e2e.ts`) — 12 tests covering both agents end-to-end using the SDK directly, no child process spawning.
* `src/bridge.ts` — exported `createAgentBridge()` API: creates an isolated Shirogane agent session with a simple `prompt(text): Promise<string>` / `dispose()` interface, for use by transport packages.

### Changed
* Simplified agent to use pi SDK built-in tools (read, write, edit, ls, grep, find) with cwd sandboxing instead of custom sandboxed tool implementations.
* Default model changed from `openrouter/free` to `deepseek/deepseek-chat-v3-0324`.
* Witch prompt restructured: delegation rule moved to top of prompt before character description; witch now translates vague user requests into explicit file instructions for the book.
* Book prompt updated: added explicit rule requiring tool calls for every file operation; added per-tool usage guidance to prevent the model responding without acting.

### Removed
* Removed custom sandboxed bash tool from Magic Book (no shell access).
* Removed custom search tool with Deepseek dynamic import fallback.
* Removed old E2E harness files (`run-e2e-harness.{cjs,js,mjs}`).

