/**
 * E2E Test Harness for ChronoCrystal Agent
 *
 * Programmatic tests using the pi SDK directly. No child process spawning.
 * Tests the witch (Shirogane) and book (Magic Book) agents end-to-end
 * against a live OpenRouter model.
 *
 * Usage:
 *   cd packages/agent
 *   OPENROUTER_API_KEY="sk-or-..." npx tsx test/e2e.ts
 *   OPENROUTER_API_KEY="sk-or-..." npx tsx test/e2e.ts google/gemini-2.5-flash
 *
 * Exit codes:
 *   0 = all tests passed
 *   1 = one or more tests failed
 *   2 = setup error (missing API key, model not found)
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import {
	AuthStorage,
	createAgentSession,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	defineTool,
	ModelRegistry,
	parseFrontmatter,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MODEL = process.argv[2] ?? "deepseek/deepseek-chat-v3-0324";
const AGENTS_DIR = path.resolve("agents");
const GRIMOIRE_DIR = path.resolve("grimoire");
const TEST_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Agent loading (mirrors index.ts)
// ---------------------------------------------------------------------------

interface AgentFrontmatter extends Record<string, unknown> {
	name: string;
	description?: string;
	model?: string;
	tools?: string;
}

interface AgentDef {
	name: string;
	model: string;
	tools: string[];
	systemPrompt: string;
}

function loadAgent(name: string): AgentDef {
	const filePath = path.join(AGENTS_DIR, `${name}.md`);
	const content = fs.readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
	return {
		name: frontmatter.name ?? name,
		model: (frontmatter.model as string | undefined) ?? DEFAULT_MODEL,
		tools: frontmatter.tools
			? (frontmatter.tools as string)
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: [],
		systemPrompt: body.trim(),
	};
}

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

interface TestResult {
	name: string;
	passed: boolean;
	durationMs: number;
	error?: string;
}

const results: TestResult[] = [];

function log(msg: string): void {
	console.log(`  ${msg}`);
}

function assert(condition: boolean, message: string): void {
	if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertIncludes(haystack: string, needle: string, label: string): void {
	if (!haystack.includes(needle)) {
		throw new Error(`${label}: expected to contain "${needle}", got: "${haystack.slice(0, 200)}"`);
	}
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer!);
	}
}

async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
	const start = Date.now();
	console.log(`\n>> ${name}`);
	try {
		await withTimeout(fn(), TEST_TIMEOUT_MS, name);
		const durationMs = Date.now() - start;
		results.push({ name, passed: true, durationMs });
		log(`PASS (${durationMs}ms)`);
	} catch (e: unknown) {
		const durationMs = Date.now() - start;
		const error = e instanceof Error ? e.message : String(e);
		results.push({ name, passed: false, durationMs, error });
		log(`FAIL (${durationMs}ms): ${error}`);
	}
}

function cleanGrimoire(): void {
	if (fs.existsSync(GRIMOIRE_DIR)) {
		fs.rmSync(GRIMOIRE_DIR, { recursive: true });
	}
	fs.mkdirSync(GRIMOIRE_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

function collectText(session: AgentSession): { getText: () => string } {
	let text = "";
	session.subscribe((ev) => {
		if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
			text += ev.assistantMessageEvent.delta;
		}
	});
	return { getText: () => text };
}

interface ToolEvent {
	type: "start" | "end";
	toolName: string;
	result?: unknown;
	isError?: boolean;
}

function collectToolEvents(session: AgentSession): { getEvents: () => ToolEvent[] } {
	const events: ToolEvent[] = [];
	session.subscribe((ev) => {
		if (ev.type === "tool_execution_start") {
			events.push({ type: "start", toolName: ev.toolName });
		}
		if (ev.type === "tool_execution_end") {
			events.push({ type: "end", toolName: ev.toolName, result: ev.result, isError: ev.isError });
		}
	});
	return { getEvents: () => events };
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let authStorage: ReturnType<typeof AuthStorage.create>;
let modelRegistry: ReturnType<typeof ModelRegistry.create>;

function setup(): void {
	if (!process.env.OPENROUTER_API_KEY) {
		console.error("ERROR: OPENROUTER_API_KEY not set");
		process.exit(2);
	}

	authStorage = AuthStorage.create();
	modelRegistry = ModelRegistry.create(authStorage);

	const bookAgent = loadAgent("book");
	const model = modelRegistry.find("openrouter", bookAgent.model);
	if (!model) {
		console.error(`ERROR: model not found: openrouter/${bookAgent.model}`);
		process.exit(2);
	}

	cleanGrimoire();
}

// ---------------------------------------------------------------------------
// Book session factory (mirrors index.ts)
// ---------------------------------------------------------------------------

const toolFactories = {
	read: (cwd: string) => createReadTool(cwd),
	write: (cwd: string) => createWriteTool(cwd),
	edit: (cwd: string) => createEditTool(cwd),
	ls: (cwd: string) => createLsTool(cwd),
	grep: (cwd: string) => createGrepTool(cwd),
	find: (cwd: string) => createFindTool(cwd),
} as const;

type ToolName = keyof typeof toolFactories;

async function createBookSession(): Promise<AgentSession> {
	const agent = loadAgent("book");
	const model = modelRegistry.find("openrouter", agent.model)!;

	const tools =
		agent.tools.length > 0
			? agent.tools.filter((t): t is ToolName => t in toolFactories).map((t) => toolFactories[t](GRIMOIRE_DIR))
			: Object.values(toolFactories).map((f) => f(GRIMOIRE_DIR));

	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => agent.systemPrompt,
		appendSystemPromptOverride: () => [],
		noSkills: true,
	});
	await loader.reload();

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		cwd: GRIMOIRE_DIR,
		tools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	return session;
}

// ---------------------------------------------------------------------------
// Witch session factory (mirrors index.ts)
// ---------------------------------------------------------------------------

async function createWitchSession(): Promise<{
	session: AgentSession;
	bookResults: Array<{ taskNum: number; result: string; error: boolean }>;
	bookDone: () => Promise<void>;
}> {
	const witchAgent = loadAgent("witch");
	const model = modelRegistry.find("openrouter", witchAgent.model)!;

	const bookResults: Array<{ taskNum: number; result: string; error: boolean }> = [];
	const bookPromises: Array<Promise<void>> = [];
	let taskCounter = 0;

	const magicBookTool = defineTool({
		name: "magic_book",
		label: "Magic Book",
		description: `${loadAgent("book").name} — delegate file/writing tasks`,
		parameters: Type.Object({
			task: Type.String({ description: "Describe what the book should do" }),
		}),
		execute: async (_toolCallId, params) => {
			const taskNum = ++taskCounter;

			const promise = (async () => {
				try {
					const bookSession = await createBookSession();
					const collector = collectText(bookSession);
					await bookSession.prompt(params.task);
					bookResults.push({ taskNum, result: collector.getText(), error: false });
					bookSession.dispose();
				} catch (err: unknown) {
					bookResults.push({ taskNum, result: (err as Error).message, error: true });
				}
			})();
			bookPromises.push(promise);

			return {
				content: [{ type: "text" as const, text: `Task #${taskNum} dispatched to the Magic Book.` }],
				details: {},
			};
		},
	});

	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => witchAgent.systemPrompt,
		appendSystemPromptOverride: () => [],
		noSkills: true,
	});
	await loader.reload();

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		tools: [],
		customTools: [magicBookTool],
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: false },
			retry: { enabled: true, maxRetries: 2 },
		}),
	});

	const bookDone = async () => {
		await Promise.all(bookPromises);
	};

	return { session, bookResults, bookDone };
}

// ---------------------------------------------------------------------------
// Wait for file to appear on disk
// ---------------------------------------------------------------------------

async function waitForFile(filePath: string, timeoutMs: number = 30_000): Promise<void> {
	const start = Date.now();
	while (!fs.existsSync(filePath)) {
		if (Date.now() - start > timeoutMs) {
			throw new Error(`File not created within ${timeoutMs}ms: ${filePath}`);
		}
		await new Promise((r) => setTimeout(r, 500));
	}
}

// ===========================================================================
// TESTS
// ===========================================================================

// 1. Model discovery
async function testModelDiscovery(): Promise<void> {
	const agent = loadAgent("book");
	const model = modelRegistry.find("openrouter", agent.model);
	assert(model !== undefined, `Model openrouter/${agent.model} should be discoverable`);
	assert(model!.provider === "openrouter", `Provider should be openrouter`);
	log(`Model: ${model!.provider}/${model!.id}`);
}

// 2. Book agent: basic chat (no tools needed)
async function testBookBasicChat(): Promise<void> {
	const session = await createBookSession();
	const collector = collectText(session);

	await session.prompt("Say hello in one sentence.");

	const text = collector.getText();
	assert(text.length > 0, "Book should produce non-empty response");
	log(`Response (${text.length} chars): ${text.slice(0, 100)}...`);
	session.dispose();
}

// 3. Book agent: write a file
async function testBookWriteFile(): Promise<void> {
	cleanGrimoire();
	const session = await createBookSession();
	const tools = collectToolEvents(session);

	await session.prompt('Create a file called "test-write.txt" with the exact content: HELLO_E2E');

	const toolEvents = tools.getEvents();
	const writeEvents = toolEvents.filter((e) => e.type === "end" && e.toolName === "write");
	assert(writeEvents.length > 0, "Write tool should have been called");

	const filePath = path.join(GRIMOIRE_DIR, "test-write.txt");
	assert(fs.existsSync(filePath), "File should exist on disk");

	const content = fs.readFileSync(filePath, "utf-8");
	assertIncludes(content, "HELLO_E2E", "File content");

	log(`File written: ${content.trim()}`);
	session.dispose();
}

// 4. Book agent: read a file
async function testBookReadFile(): Promise<void> {
	// Pre-create a file
	const filePath = path.join(GRIMOIRE_DIR, "pre-existing.txt");
	fs.writeFileSync(filePath, "SECRET_CONTENT_42", "utf-8");

	const session = await createBookSession();
	const collector = collectText(session);
	const tools = collectToolEvents(session);

	await session.prompt('Read the file "pre-existing.txt" and tell me what it contains.');

	const text = collector.getText();
	assertIncludes(text, "SECRET_CONTENT_42", "Response should contain file content");

	const readEvents = tools.getEvents().filter((e) => e.type === "end" && e.toolName === "read");
	assert(readEvents.length > 0, "Read tool should have been called");

	log(`Content correctly read back`);
	session.dispose();
}

// 5. Book agent: edit a file
async function testBookEditFile(): Promise<void> {
	const filePath = path.join(GRIMOIRE_DIR, "edit-target.txt");
	fs.writeFileSync(filePath, "The quick brown fox jumps over the lazy dog.", "utf-8");

	const session = await createBookSession();

	const tools = collectToolEvents(session);
	await session.prompt('Edit "edit-target.txt": replace "brown fox" with "red cat".');

	const editCalled = tools.getEvents().some((e) => e.type === "end" && e.toolName === "edit");
	assert(editCalled, "Edit tool should have been called");

	const content = fs.readFileSync(filePath, "utf-8");
	assertIncludes(content, "red cat", "File should contain edited text");
	assert(!content.includes("brown fox"), "Original text should be replaced");

	log(`Edit verified: ${content.trim()}`);
	session.dispose();
}

// 6. Book agent: grep search
async function testBookGrep(): Promise<void> {
	fs.writeFileSync(path.join(GRIMOIRE_DIR, "a.txt"), "alpha bravo charlie", "utf-8");
	fs.writeFileSync(path.join(GRIMOIRE_DIR, "b.txt"), "delta echo foxtrot", "utf-8");

	const session = await createBookSession();
	const collector = collectText(session);

	await session.prompt('Search all files for "echo" and tell me which file contains it.');

	const text = collector.getText();
	assertIncludes(text, "b.txt", "Response should reference the correct file");

	log(`Grep search correct`);
	session.dispose();
}

// 7. Book agent: ls + find
async function testBookListAndFind(): Promise<void> {
	fs.mkdirSync(path.join(GRIMOIRE_DIR, "subdir"), { recursive: true });
	fs.writeFileSync(path.join(GRIMOIRE_DIR, "subdir", "nested.md"), "# Nested", "utf-8");

	const session = await createBookSession();
	const collector = collectText(session);

	await session.prompt("List all files and find any markdown files. Tell me what you found.");

	const text = collector.getText();
	assertIncludes(text, "nested.md", "Response should mention the markdown file");

	log(`List/find correct`);
	session.dispose();
}

// 8. Book agent: no bash access
async function testBookNoBash(): Promise<void> {
	const session = await createBookSession();
	const tools = collectToolEvents(session);

	await session.prompt('Run the shell command "echo hello" using bash.');

	const bashEvents = tools.getEvents().filter((e) => e.toolName === "bash");
	assert(bashEvents.length === 0, "Bash tool should not be available to book agent");

	log(`Bash correctly unavailable`);
	session.dispose();
}

// 9. Witch agent: basic chat
async function testWitchBasicChat(): Promise<void> {
	const { session, bookResults } = await createWitchSession();
	const collector = collectText(session);

	await session.prompt("Hello, how are you?");

	const text = collector.getText();
	assert(text.length > 0, "Witch should produce non-empty response");
	assert(bookResults.length === 0, "Simple chat should not trigger book");

	log(`Witch responded (${text.length} chars)`);
	session.dispose();
}

// 10. Witch agent: delegates to book
async function testWitchDelegatesToBook(): Promise<void> {
	cleanGrimoire();
	const { session, bookResults, bookDone } = await createWitchSession();
	const tools = collectToolEvents(session);

	await session.prompt('Write a file called "witch-test.txt" containing "WITCH_DELEGATED_OK".');

	// Witch should have called magic_book
	const bookToolEvents = tools.getEvents().filter((e) => e.toolName === "magic_book");
	assert(bookToolEvents.length > 0, "Witch should call magic_book tool");

	// Wait for background book task to complete
	await withTimeout(bookDone(), 45_000, "Book task completion");

	// Check the file was created
	const filePath = path.join(GRIMOIRE_DIR, "witch-test.txt");
	await waitForFile(filePath, 5_000);

	const content = fs.readFileSync(filePath, "utf-8");
	assertIncludes(content, "WITCH_DELEGATED_OK", "File content from delegated task");

	assert(bookResults.length > 0, "Book should have completed at least one task");
	assert(!bookResults[0].error, "Book task should not have errored");

	log(`Delegation successful, file verified`);
	session.dispose();
}

// 11. Streaming: text deltas accumulate
async function testStreaming(): Promise<void> {
	const session = await createBookSession();
	let deltaCount = 0;
	let accumulated = "";

	session.subscribe((ev) => {
		if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
			deltaCount++;
			accumulated += ev.assistantMessageEvent.delta;
		}
	});

	await session.prompt("Count from 1 to 5, one number per line.");

	assert(deltaCount > 0, "Should receive at least one text_delta event");
	assert(accumulated.length > 0, "Accumulated text should be non-empty");
	log(`Received ${deltaCount} text_delta events, ${accumulated.length} chars total`);
	session.dispose();
}

// 12. Persistence: files survive session disposal
async function testPersistence(): Promise<void> {
	cleanGrimoire();
	const session = await createBookSession();

	await session.prompt('Write a file "persist.txt" with content "PERSIST_CHECK".');
	session.dispose();

	const filePath = path.join(GRIMOIRE_DIR, "persist.txt");
	assert(fs.existsSync(filePath), "File should persist after session dispose");

	const content = fs.readFileSync(filePath, "utf-8");
	assertIncludes(content, "PERSIST_CHECK", "Persisted file content");

	log(`File persists after session disposal`);
}

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
	console.log("=== ChronoCrystal Agent E2E Tests ===");
	console.log(`Model: openrouter/${DEFAULT_MODEL} (default, overridden per agent by agents/*.md)`);
	console.log(`Grimoire: ${GRIMOIRE_DIR}`);
	console.log(`Timeout: ${TEST_TIMEOUT_MS}ms per test`);

	setup();

	await runTest("1. Model discovery", testModelDiscovery);
	await runTest("2. Book: basic chat", testBookBasicChat);
	await runTest("3. Book: write file", testBookWriteFile);
	await runTest("4. Book: read file", testBookReadFile);
	await runTest("5. Book: edit file", testBookEditFile);
	await runTest("6. Book: grep search", testBookGrep);
	await runTest("7. Book: ls + find", testBookListAndFind);
	await runTest("8. Book: no bash access", testBookNoBash);
	await runTest("9. Witch: basic chat", testWitchBasicChat);
	await runTest("10. Witch: delegates to book", testWitchDelegatesToBook);
	await runTest("11. Streaming: text deltas", testStreaming);
	await runTest("12. Persistence after dispose", testPersistence);

	// Summary
	console.log("\n=== Results ===");
	const passed = results.filter((r) => r.passed).length;
	const failed = results.filter((r) => !r.passed).length;

	for (const r of results) {
		const status = r.passed ? "PASS" : "FAIL";
		const extra = r.error ? ` -- ${r.error}` : "";
		console.log(`  [${status}] ${r.name} (${r.durationMs}ms)${extra}`);
	}

	console.log(`\n  ${passed} passed, ${failed} failed, ${results.length} total`);

	if (failed > 0) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(2);
});
