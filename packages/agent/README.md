# @dentedgemclaw9846/chronocrystal-agent-core

A chatbot with two agents powered by the [pi SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md) and OpenRouter.

## Agents

**Shirogane** — A white-haired witch scribe. She is the conversational agent and always talks to the user. She cannot read/write files or run commands herself.

**Magic Book** — A living grimoire (subagent). When the user needs anything written, created, or searched, Shirogane delegates to the book. The book has access to file tools (read, write, edit, ls, grep, find) restricted to the `grimoire/` directory. No bash/shell access.

## Architecture

```
User <-> Shirogane (chat-only, has magic_book tool)
              |
              v  (async, fire-and-forget)
         Magic Book (sub-session, cwd=grimoire/)
              |
              v
         grimoire/  (the book's workspace)
```

- Shirogane calls the `magic_book` tool when writing/searching is needed
- The tool returns immediately so Shirogane stays responsive
- The book works in the background and prints its result when done
- All file operations are scoped to `grimoire/` via cwd

## Setup

Set your OpenRouter API key:

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

## Usage

```bash
cd packages/agent
npx tsx src/index.ts                                      # default: deepseek/deepseek-chat-v3-0324
npx tsx src/index.ts google/gemini-2.5-flash              # pass any OpenRouter model ID
```

Talk to Shirogane normally. When you ask her to write, create, or search something, she delegates to the Magic Book automatically.
