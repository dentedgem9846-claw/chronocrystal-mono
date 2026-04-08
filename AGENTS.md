# Development Rules

## First Message

If the user did not give you a concrete task in their first message, read README.md, then ask which module(s) to work on. Based on the answer, read the relevant README.md files in parallel.

* [packages/foo/README.md]
* [packages/bar/README.md]

## Code Quality

* No `any` types unless absolutely necessary
* Check node_modules for external API type definitions instead of guessing
* **NEVER use inline imports** - no `await import("./foo.js")`, no `import("pkg").Type` in type positions, no dynamic imports for types. Always use standard top-level imports.
* NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
* Always ask before removing functionality or code that appears to be intentional
* Do not preserve backward compatibility unless the user explicitly asks for it
* Never hardcode key checks with, eg. `matchesKey(keyData, "ctrl+x")`. All keybindings must be configurable. Add default to matching object (`DEFAULT_EDITOR_KEYBINDINGS` or `DEFAULT_APP_KEYBINDINGS`)

## Commands

* After code changes (not documentation changes): `npm run check` (get full output, no tail). Fix all errors, warnings, and infos before committing.
* Note: `npm run check` does not run tests.
* NEVER run: `[npm run dev]`, `[npm run build]`, `[npm test]`
* Only run specific tests if user instructs: `npx tsx ../../node_modules/vitest/dist/cli.js --run test/specific.test.ts`
* Run tests from the package root, not the repo root.
* If you create or modify a test file, you MUST run that test file and iterate until it passes.
* When writing tests, run them, identify issues in either the test or implementation, and iterate until fixed.
* NEVER commit unless user asks

## GitHub Issues

When reading issues:

* Always read all comments on the issue
* Use this command to get everything in one call:

```
gh issue view <number> --json title,body,comments,labels,state
```

When creating issues:

* Add `pkg:*` labels to indicate which package(s) the issue affects
* Available labels: `[pkg:foo]`, `[pkg:bar]`
* If an issue spans multiple packages, add all relevant labels

When posting issue/PR comments:

* Write the full comment to a temp file and use `gh issue comment --body-file` or `gh pr comment --body-file`
* Never pass multi-line markdown directly via `--body` in shell commands
* Preview the exact comment text before posting
* Post exactly one final comment unless the user explicitly asks for multiple comments
* If a comment is malformed, delete it immediately, then post one corrected comment
* Keep comments concise, technical, and in the user's tone

When closing issues via commit:

* Include `fixes #<number>` or `closes #<number>` in the commit message
* This automatically closes the issue when the commit is merged

## PR Workflow

* Analyze PRs without pulling locally first
* If the user approves: create a feature branch, pull PR, rebase on main, apply adjustments, commit, merge into main, push, close PR, and leave a comment in the user's tone
* You never open PRs yourself. We work in feature branches until everything is according to the user's requirements, then merge into main, and push.

## Tools

* GitHub CLI for issues/PRs
* Add package labels to issues/PRs: `[pkg:foo]`, `[pkg:bar]`

## Style

* Keep answers short and concise
* No emojis in commits, issues, PR comments, or code
* No fluff or cheerful filler text
* Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")

## Changelog

Location: `packages/*/CHANGELOG.md` (each package has its own)

### Format

Use these sections under `## [Unreleased]`:

* `### Breaking Changes` - API changes requiring migration
* `### Added` - New features
* `### Changed` - Changes to existing functionality
* `### Fixed` - Bug fixes
* `### Removed` - Removed features

### Rules

* Before adding entries, read the full `[Unreleased]` section to see which subsections already exist
* New entries ALWAYS go under `## [Unreleased]` section
* Append to existing subsections (e.g., `### Fixed`), do not create duplicates
* NEVER modify already-released version sections (e.g., `## [0.1.0]`)
* Each version section is immutable once released

### Attribution

* **Internal changes (from issues)**: `Fixed foo bar ([#123](https://github.com/[your-org]/[your-repo]/issues/123))`
* **External contributions**: `Added feature X ([#456](https://github.com/[your-org]/[your-repo]/pull/456) by [@username](https://github.com/username))`

## Releasing

**Lockstep versioning**: All packages always share the same version number. Every release updates all packages together.

**Version semantics** (no major releases):

* `patch`: Bug fixes and new features
* `minor`: API breaking changes

### Steps

1. **Update CHANGELOGs**: Ensure all changes since last release are documented in the `[Unreleased]` section of each affected package's CHANGELOG.md
2. **Run release script**:

```
npm run release:patch  # Fixes and additions
npm run release:minor  # API breaking changes
```

The script handles: version bump, CHANGELOG finalization, commit, tag, publish, and adding new `[Unreleased]` sections.

## **CRITICAL** Tool Usage Rules **CRITICAL**

* NEVER use sed/cat to read a file or a range of a file. Always use the read tool (use offset + limit for ranged reads).
* You MUST read every file you modify in full before editing.

## **CRITICAL** Git Rules for Parallel Agents **CRITICAL**

Multiple agents may work on different files in the same worktree simultaneously. You MUST follow these rules:

### Committing

* **ONLY commit files YOU changed in THIS session**
* ALWAYS include `fixes #<number>` or `closes #<number>` in the commit message when there is a related issue or PR
* NEVER use `git add -A` or `git add .` - these sweep up changes from other agents
* ALWAYS use `git add <specific-file-paths>` listing only files you modified
* Before committing, run `git status` and verify you are only staging YOUR files
* Track which files you created/modified/deleted during the session

### Forbidden Git Operations

These commands can destroy other agents' work:

* `git reset --hard` - destroys uncommitted changes
* `git checkout .` - destroys uncommitted changes
* `git clean -fd` - deletes untracked files
* `git stash` - stashes ALL changes including other agents' work
* `git add -A` / `git add .` - stages other agents' uncommitted work
* `git commit --no-verify` - bypasses required checks and is never allowed

### Safe Workflow

```
# 1. Check status first
git status

# 2. Add ONLY your specific files
git add packages/[foo]/src/[file].ts
git add packages/[foo]/CHANGELOG.md

# 3. Commit
git commit -m "fix([scope]): description"

# 4. Push (pull --rebase if needed, but NEVER reset/checkout)
git pull --rebase && git push
```

### If Rebase Conflicts Occur

* Resolve conflicts in YOUR files only
* If conflict is in a file you didn't modify, abort and ask the user
* NEVER force push

### User override

If the user instructions conflict with rules set out here, ask for confirmation that they want to override the rules. Only then execute their instructions.
