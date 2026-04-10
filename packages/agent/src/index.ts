import path from "node:path";
import { createInterface } from "node:readline/promises";
import { createAgentBridge, DEFAULT_MODEL } from "./bridge.js";

export type { AgentBridge, AgentBridgeOptions, AgentDef } from "./bridge.js";
export { createAgentBridge, DEFAULT_MODEL, loadAgent } from "./bridge.js";

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

const AGENTS_DIR = path.resolve("agents");
const GRIMOIRE_DIR = path.resolve("grimoire");
const model = process.argv[2] ?? DEFAULT_MODEL;

async function main(): Promise<void> {
	const bridge = await createAgentBridge({
		model,
		agentsDir: AGENTS_DIR,
		grimoireDir: GRIMOIRE_DIR,
		onBookTaskResult: (taskNum, result) => {
			console.log(`\n  ~~~ Magic Book (task #${taskNum}) ~~~`);
			console.log(result);
			console.log("  ~~~ end ~~~\n");
		},
	});

	const rl = createInterface({ input: process.stdin, output: process.stdout });

	console.log();
	console.log("  ~ Shirogane's Arcane Study ~");
	console.log(`  Grimoire workspace: ${GRIMOIRE_DIR}`);
	console.log(`  Model: openrouter/${model}`);
	console.log('  Type your message, or "quit" to leave.');
	console.log();

	// The bridge already sent the greeting prompt during initialization.
	// Print a prompt indicator so the user knows the bot is ready.
	console.log("Shirogane: *looks up from an ancient tome, eyes gleaming*\n");

	while (true) {
		const input = await rl.question("You: ");
		const trimmed = input.trim();
		if (trimmed === "") continue;
		if (trimmed.toLowerCase() === "quit" || trimmed.toLowerCase() === "exit") {
			console.log("\nShirogane: May the starlight guide your path, dear seeker... Until we meet again~\n");
			break;
		}

		process.stdout.write("Shirogane: ");
		const response = await bridge.prompt(trimmed);
		console.log(`${response}\n`);
	}

	rl.close();
	bridge.dispose();
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
