# End-to-End Tests

Programmatic E2E tests using the pi SDK directly. No child process spawning.

## What's tested

| # | Test | What it verifies |
|---|------|-----------------|
| 1 | Model discovery | OpenRouter API key works, model is findable |
| 2 | Book: basic chat | Book agent responds to simple prompts |
| 3 | Book: write file | Book writes a file to grimoire/ via write tool |
| 4 | Book: read file | Book reads pre-existing files via read tool |
| 5 | Book: edit file | Book edits file content via edit tool |
| 6 | Book: grep search | Book searches files via grep tool |
| 7 | Book: ls + find | Book lists and finds files |
| 8 | Book: no bash | Book has no access to bash tool |
| 9 | Witch: basic chat | Witch responds without triggering book |
| 10 | Witch: delegates | Witch calls magic_book, book writes file in background |
| 11 | Streaming | Text delta events accumulate correctly |
| 12 | Persistence | Files survive session disposal |

## Prerequisites

```bash
export OPENROUTER_API_KEY="sk-or-..."
```

## Running

```bash
cd packages/agent
npx tsx test/e2e.ts                                      # default model
npx tsx test/e2e.ts google/gemini-2.5-flash              # specific model
```

## Exit codes

- `0` — all tests passed
- `1` — one or more tests failed
- `2` — setup error (missing API key, model not found)

## Notes

- Each test creates fresh sessions (in-memory, no persistence)
- `grimoire/` is cleaned between tests that write files
- Timeout is 60s per test (LLM calls can be slow)
- Tests are sequential — no parallel execution
- For reliable tool calling, `google/gemini-2.5-flash` is recommended over free models
