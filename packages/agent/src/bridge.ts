import fs from "node:fs";
import path from "node:path";
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
// Agent definition format
// ---------------------------------------------------------------------------

interface AgentFrontmatter extends Record<string, unknown> {
	name: string;
	description: string;
	model?: string;
	tools?: string;
}

export interface AgentDef {
	name: string;
	description: string;
	model: string;
	tools: string[];
	systemPrompt: string;
}

export function loadAgent(filePath: string, defaultModel: string): AgentDef {
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
// Book session (fire-and-forget sub-agent)
// ---------------------------------------------------------------------------

async function runBookTask(
	task: string,
	agent: AgentDef,
	grimoireDir: string,
	authStorage: ReturnType<typeof AuthStorage.create>,
	modelRegistry: ReturnType<typeof ModelRegistry.create>,
): Promise<string> {
	console.log(`[book] task start: ${task.slice(0, 120)}`);
	const model = modelRegistry.find("openrouter", agent.model);
	if (!model) throw new Error(`Model not found: openrouter/${agent.model}`);

	const toolMap = {
		read: createReadTool(grimoireDir),
		write: createWriteTool(grimoireDir),
		edit: createEditTool(grimoireDir),
		ls: createLsTool(grimoireDir),
		grep: createGrepTool(grimoireDir),
		find: createFindTool(grimoireDir),
	} as const;

	type ToolName = keyof typeof toolMap;

	const tools =
		agent.tools.length > 0
			? agent.tools.filter((t): t is ToolName => t in toolMap).map((t) => toolMap[t])
			: Object.values(toolMap);

	const settingsManager = SettingsManager.inMemory({
		compaction: { enabled: false },
		retry: { enabled: true, maxRetries: 2 },
	});
	console.log(`[book] creating resource loader`);
	const loader = new DefaultResourceLoader({
		systemPromptOverride: () => agent.systemPrompt,
		appendSystemPromptOverride: () => [],
		noSkills: true,
		settingsManager,
	});
	console.log(`[book] reloading resource loader`);
	await loader.reload();
	console.log(`[book] creating agent session`);

	const { session } = await createAgentSession({
		model,
		thinkingLevel: "off",
		authStorage,
		modelRegistry,
		cwd: grimoireDir,
		tools,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(),
		settingsManager,
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
// Public API
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL = "deepseek/deepseek-chat-v3-0324";

export interface AgentBridgeOptions {
	/** OpenRouter model ID. Defaults to DEFAULT_MODEL. */
	model?: string;
	/** Directory containing witch.md and book.md. Defaults to <cwd>/agents. */
	agentsDir?: string;
	/** Sandboxed workspace for the book sub-agent. Defaults to <cwd>/grimoire. */
	grimoireDir?: string;
	/** Called after each book task completes, for logging purposes. */
	onBookTaskResult?: (taskNum: number, result: string) => void;
}

/** A single conversation session with Shirogane. One bridge = one user session. */
export interface AgentBridge {
	/** Send a message and receive the full response text. */
	prompt(userMessage: string): Promise<string>;
	/** Free the underlying session. */
	dispose(): void;
}

/**
 * Create a programmatic bridge to the Shirogane agent.
 * Each call returns an independent session — create one per user/contact.
 *
 * Requires OPENROUTER_API_KEY in the environment.
 */
export async function createAgentBridge(options: AgentBridgeOptions = {}): Promise<AgentBridge> {
	const agentsDir = options.agentsDir ?? path.resolve("agents");
	const grimoireDir = options.grimoireDir ?? path.resolve("grimoire");
	const defaultModel = options.model ?? DEFAULT_MODEL;
	const onBookTaskResult = options.onBookTaskResult ?? (() => {});

	fs.mkdirSync(grimoireDir, { recursive: true });

	const authStorage = AuthStorage.create();
	const modelRegistry = ModelRegistry.create(authStorage);

	const witchAgent = loadAgent(path.join(agentsDir, "witch.md"), defaultModel);
	const bookAgent = loadAgent(path.join(agentsDir, "book.md"), defaultModel);

	const model = modelRegistry.find("openrouter", witchAgent.model);
	if (!model) throw new Error(`Model not found: openrouter/${witchAgent.model}`);

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
			console.log(`[magic_book] task #${taskNum} dispatched: ${params.task.slice(0, 120)}`);
			runBookTask(params.task, bookAgent, grimoireDir, authStorage, modelRegistry)
				.then((result) => onBookTaskResult(taskNum, result))
				.catch((err: Error) => {
					console.error(`[magic_book] task #${taskNum} threw:`, err.message);
					onBookTaskResult(taskNum, `ERROR: ${err.message}`);
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

	let currentResponse = "";

	session.subscribe((event) => {
		if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
			currentResponse += event.assistantMessageEvent.delta;
		}
	});

	// Prime the session with the greeting prompt (response is discarded).
	await session.prompt("*a seeker enters the library*");
	currentResponse = "";

	return {
		async prompt(userMessage: string): Promise<string> {
			currentResponse = "";
			await session.prompt(userMessage);
			return currentResponse.trim();
		},
		dispose() {
			session.dispose();
		},
	};
}
