import fs from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
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
// Agent definition format (see agents/*.md and REFERENCES.md)
// ---------------------------------------------------------------------------

interface AgentFrontmatter extends Record<string, unknown> {
	name: string;
	description: string;
	model?: string;
	tools?: string;
}

interface AgentDef {
	name: string;
	description: string;
	model: string;
	tools: string[];
	systemPrompt: string;
}

function loadAgent(filePath: string, defaultModel: string): AgentDef {
	const content = fs.readFileSync(filePath, "utf-8");
	const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
	if (!frontmatter.name) throw new Error(`Agent file missing 'name': ${filePath}`);
	return {
		name: frontmatter.name,
		description: frontmatter.description ?? "",
		model: frontmatter.model ?? defaultModel,
		tools: frontmatter.tools
			? frontmatter.tools
					.split(",")
					.map((t) => t.trim())
					.filter(Boolean)
			: [],
		systemPrompt: body.trim(),
	};
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const AGENTS_DIR = path.resolve("agents");
const GRIMOIRE_DIR = path.resolve("grimoire");
const DEFAULT_MODEL = process.argv[2] ?? "deepseek/deepseek-chat-v3-0324";

fs.mkdirSync(GRIMOIRE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Book session
// ---------------------------------------------------------------------------

async function runBookTask(
	task: string,
	agent: AgentDef,
	authStorage: ReturnType<typeof AuthStorage.create>,
	modelRegistry: ReturnType<typeof ModelRegistry.create>,
): Promise<string> {
	const model = modelRegistry.find("openrouter", agent.model);
	if (!model) throw new Error(`Model not found: openrouter/${agent.model}`);

	const toolMap = {
		read: createReadTool(GRIMOIRE_DIR),
		write: createWriteTool(GRIMOIRE_DIR),
		edit: createEditTool(GRIMOIRE_DIR),
		ls: createLsTool(GRIMOIRE_DIR),
		grep: createGrepTool(GRIMOIRE_DIR),
		find: createFindTool(GRIMOIRE_DIR),
	} as const;

	type ToolName = keyof typeof toolMap;

	const tools =
		agent.tools.length > 0
			? agent.tools.filter((t): t is ToolName => t in toolMap).map((t) => toolMap[t])
			: Object.values(toolMap);

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

	let output = "";
	session.subscribe((ev) => {
		if (ev.type === "message_update" && ev.assistantMessageEvent.type === "text_delta") {
			output += ev.assistantMessageEvent.delta;
		}
	});

	await session.prompt(task);
	session.dispose();
	return output.trim() || "(no output)";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);

	const witchAgent = loadAgent(path.join(AGENTS_DIR, "witch.md"), DEFAULT_MODEL);
	const bookAgent = loadAgent(path.join(AGENTS_DIR, "book.md"), DEFAULT_MODEL);

	const model = modelRegistry.find("openrouter", witchAgent.model);
	if (!model) {
		console.error(`Model not found: openrouter/${witchAgent.model}`);
		console.error("Set OPENROUTER_API_KEY and pass a valid model ID.");
		process.exit(1);
	}

	let taskCounter = 0;

	const magicBookTool = defineTool({
		name: "magic_book",
		label: "Magic Book",
		description: bookAgent.description,
		parameters: Type.Object({
			task: Type.String({ description: "Describe what the book should do" }),
		}),
		execute: async (_toolCallId, params) => {
			const taskNum = ++taskCounter;

			runBookTask(params.task, bookAgent, authStorage, modelRegistry)
				.then((result) => {
					console.log(`\n  ~~~ Magic Book (task #${taskNum}) ~~~`);
					console.log(result);
					console.log("  ~~~ end ~~~\n");
				})
				.catch((err: Error) => {
					console.log(`\n  ~~~ Magic Book (task #${taskNum}) ERROR ~~~`);
					console.log(err.message);
					console.log("  ~~~ end ~~~\n");
				});

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
			retry: { enabled: true, maxRetries: 3 },
		}),
	});

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	console.log();
	console.log("  ~ Shirogane's Arcane Study ~");
	console.log(`  Grimoire workspace: ${GRIMOIRE_DIR}`);
	console.log(`  Model: openrouter/${witchAgent.model}`);
	console.log('  Type your message, or "quit" to leave.');
	console.log();

	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			process.stdout.write(event.assistantMessageEvent.delta);
		}
		if (event.type === "message_end") {
			console.log("\n");
		}
	});

	process.stdout.write("Shirogane: ");
	await session.prompt("*a seeker enters the library*");

	while (true) {
		const input = await rl.question("You: ");
		const trimmed = input.trim();
		if (trimmed === "") continue;
		if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
			console.log("\nShirogane: May the starlight guide your path, dear seeker... Until we meet again~\n");
			break;
		}

		process.stdout.write("Shirogane: ");
		await session.prompt(trimmed);
	}

	rl.close();
	session.dispose();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
