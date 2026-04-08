# References

External examples and docs used as implementation guides for this package.

## pi SDK examples

| Topic | URL |
|-------|-----|
| SDK usage (minimal, model, prompt, tools, sessions, full control) | https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/sdk |
| Subagent extension (agent markdown definitions, chain/parallel dispatch, process isolation) | https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent |

## Notes on the subagent example

The subagent example spawns a separate `pi` CLI process per agent (`--mode json -p --no-session`)
and parses JSON stdout. We don't do that — we use the SDK in-process instead — but the example
is the reference for:

- **Agent markdown definition format** — YAML frontmatter (`name`, `description`, `tools`, `model`) +
  body as system prompt. We use this format for `agents/*.md`.
- **`parseFrontmatter`** from `@mariozechner/pi-coding-agent` — parses those files.
- **Chain pattern** — passing `{previous}` output between sequential agent tasks.
- **`mapWithConcurrencyLimit`** — running N async tasks with a concurrency cap, useful if we ever
  want parallel book tasks.
- **TUI rendering** (`renderCall`/`renderResult`) — not used here (we're readline-only), but
  reference if we ever add a pi extension wrapper.
