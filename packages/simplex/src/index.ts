import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { ChatEvent } from "@simplex-chat/types";
import { T } from "@simplex-chat/types";
import { ChatClient } from "simplex-chat";
import type { AgentBridge } from "../../agent/src/bridge.js";
import { createAgentBridge } from "../../agent/src/bridge.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SIMPLEX_HOST = process.env.SIMPLEX_HOST ?? "localhost";
const SIMPLEX_PORT = process.env.SIMPLEX_PORT ?? "5225";
const SIMPLEX_URL = `ws://${SIMPLEX_HOST}:${SIMPLEX_PORT}`;
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME ?? "Shirogane";
const AGENTS_DIR = path.resolve(process.env.AGENTS_DIR ?? "../../agent/agents");
const GRIMOIRE_DIR = path.resolve(process.env.GRIMOIRE_DIR ?? "../../agent/grimoire");
const DEFAULT_MODEL = process.env.DEFAULT_MODEL;
const ADDRESS_FILE = process.env.ADDRESS_FILE;
const HEALTH_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// ---------------------------------------------------------------------------
// Per-contact session management
// ---------------------------------------------------------------------------

const bridges = new Map<number, AgentBridge>();

/** Serializes concurrent messages from the same contact. */
const locks = new Map<number, Promise<void>>();

async function getOrCreateBridge(contactId: number): Promise<AgentBridge> {
	const existing = bridges.get(contactId);
	if (existing) return existing;

	console.log(`[bridge] creating session for contact ${contactId}`);
	const bridge = await createAgentBridge({
		...(DEFAULT_MODEL ? { model: DEFAULT_MODEL } : {}),
		agentsDir: AGENTS_DIR,
		grimoireDir: GRIMOIRE_DIR,
		onBookTaskResult: (taskNum, result) => {
			console.log(`[book #${taskNum}] contact=${contactId}\n${result}`);
		},
	});
	bridges.set(contactId, bridge);
	return bridge;
}

function disposeBridge(contactId: number): void {
	const bridge = bridges.get(contactId);
	if (bridge) {
		bridge.dispose();
		bridges.delete(contactId);
		locks.delete(contactId);
		console.log(`[bridge] disposed session for contact ${contactId}`);
	}
}

/**
 * Enqueue work for a contact so messages are processed one at a time,
 * even if multiple arrive before the first reply is sent.
 */
function enqueue(contactId: number, work: () => Promise<void>): void {
	const prev = locks.get(contactId) ?? Promise.resolve();
	const next = prev.then(work).catch((err: Error) => {
		console.error(`[error] contact=${contactId}`, err.message);
	});
	locks.set(contactId, next);
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function onContactRequest(chat: ChatClient, event: T.UserContactRequest): Promise<void> {
	console.log(`[contact-request] id=${event.contactRequestId} name=${event.profile.displayName}`);
	try {
		await chat.apiAcceptContactRequest(event.contactRequestId);
	} catch (err) {
		console.error("[contact-request] accept failed:", (err as Error).message);
	}
}

async function onContactConnected(chat: ChatClient, contact: T.Contact): Promise<void> {
	console.log(`[connected] contact=${contact.contactId} name=${contact.localDisplayName}`);
	enqueue(contact.contactId, async () => {
		const bridge = await getOrCreateBridge(contact.contactId);
		// Send welcome — the bridge already primed itself with the greeting prompt,
		// so the first real message here is the contact connection event.
		const welcome = await bridge.prompt(`*${contact.localDisplayName} has connected*`);
		if (welcome) {
			await chat.apiSendTextMessage(T.ChatType.Direct, contact.contactId, welcome);
		}
	});
}

async function onNewChatItems(chat: ChatClient, chatItems: T.AChatItem[]): Promise<void> {
	for (const { chatInfo, chatItem } of chatItems) {
		// Only handle direct chats.
		if (chatInfo.type !== "direct") continue;

		const contact = (chatInfo as T.ChatInfo.Direct).contact;

		// Only handle messages received by the bot (not sent by it).
		if (chatItem.chatDir.type !== "directRcv") continue;

		// Only handle text messages.
		if (chatItem.content.type !== "rcvMsgContent") continue;
		const msgContent = (chatItem.content as T.CIContent.RcvMsgContent).msgContent;
		if (msgContent.type !== "text") continue;

		const text = (msgContent as T.MsgContent.Text).text.trim();
		if (!text) continue;

		console.log(`[message] contact=${contact.contactId} text="${text.slice(0, 80)}"`);

		enqueue(contact.contactId, async () => {
			const bridge = await getOrCreateBridge(contact.contactId);
			const response = await bridge.prompt(text);
			if (response) {
				console.log(`[reply] contact=${contact.contactId} chars=${response.length}`);
				await chat.apiSendTextMessage(T.ChatType.Direct, contact.contactId, response);
			} else {
				console.warn(`[reply] contact=${contact.contactId} empty response`);
			}
		});
	}
}

// ---------------------------------------------------------------------------
// Bot lifecycle
// ---------------------------------------------------------------------------

async function setupBot(chat: ChatClient): Promise<string> {
	let user = await chat.apiGetActiveUser();
	if (!user) {
		console.log(`[setup] creating bot profile "${BOT_DISPLAY_NAME}"`);
		user = await chat.apiCreateActiveUser({ displayName: BOT_DISPLAY_NAME, fullName: "" });
	} else {
		console.log(`[setup] using existing profile "${user.profile.displayName}"`);
	}

	let address = await chat.apiGetUserAddress(user.userId);
	if (!address) {
		console.log("[setup] creating contact address");
		address = await chat.apiCreateUserAddress(user.userId);
	}

	await chat.enableAddressAutoAccept(user.userId);
	console.log(`[setup] auto-accept enabled`);
	console.log(`[setup] contact address: ${address}`);

	if (ADDRESS_FILE) {
		const content = `# ${BOT_DISPLAY_NAME} — SimpleX Address\n\n\`\`\`\n${address}\n\`\`\`\n\nIn SimpleX: **New chat → Connect via link**, paste the address above.\n`;
		fs.mkdirSync(path.dirname(ADDRESS_FILE), { recursive: true });
		fs.writeFileSync(ADDRESS_FILE, content);
		console.log(`[setup] address written to ${ADDRESS_FILE}`);
	}

	return address;
}

async function processEvents(chat: ChatClient): Promise<void> {
	for await (const event of chat.msgQ) {
		const resp = (event instanceof Promise ? await event : event) as ChatEvent;

		switch (resp.type) {
			case "receivedContactRequest":
				await onContactRequest(chat, resp.contactRequest);
				break;

			case "contactConnected":
				await onContactConnected(chat, resp.contact);
				break;

			case "newChatItems":
				await onNewChatItems(chat, resp.chatItems);
				break;

			default:
				// Ignore all other events.
				break;
		}
	}
}

async function run(): Promise<void> {
	console.log(`[simplex] connecting to ${SIMPLEX_URL}`);
	const chat = await ChatClient.create(SIMPLEX_URL);
	console.log("[simplex] connected");

	const address = await setupBot(chat);
	console.log(`\n  ~ Shirogane on SimpleX ~`);
	console.log(`  Address: ${address}`);
	console.log("  Waiting for messages...\n");

	await processEvents(chat);
	await chat.disconnect();
}

// ---------------------------------------------------------------------------
// Health server — Railway probes this to confirm the process is alive.
// ---------------------------------------------------------------------------

function startHealthServer(): void {
	const server = http.createServer((_req, res) => {
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("ok");
	});
	server.listen(HEALTH_PORT, () => {
		console.log(`[health] listening on port ${HEALTH_PORT}`);
	});
	server.on("error", (err) => {
		console.error("[health] server error:", err.message);
	});
}

// Retry loop — reconnect if the server drops the connection.
async function main(): Promise<void> {
	const RETRY_DELAY_MS = 5_000;
	while (true) {
		try {
			await run();
			console.log("[simplex] disconnected — retrying in 5s");
		} catch (err) {
			console.error("[simplex] error:", (err as Error).message, "— retrying in 5s");
			// Dispose all bridges on disconnect so they are recreated fresh on reconnect.
			for (const [contactId] of bridges) {
				disposeBridge(contactId);
			}
		}
		await new Promise<void>((r) => setTimeout(r, RETRY_DELAY_MS));
	}
}

startHealthServer();
main().catch((err: Error) => {
	console.error("Fatal:", err.message);
	process.exit(1);
});
