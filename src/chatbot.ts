import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";

import * as readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const rl = readline.createInterface({ input: stdin, output: stdout });

async function main() {
  const agent = new Agent({
    initialState: {
      systemPrompt: "You are a helpful chatbot that responds concisely and politely.",
      model: getModel("openrouter", "auto"),
    },
    getApiKey: async (provider) => {
      if (provider === "openrouter") {
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
          throw new Error("OPENROUTER_API_KEY environment variable is not set.");
        }
        return apiKey;
      }
      return undefined;
    },
  });

  console.log("Chatbot initialized. Type 'exit' to quit.");
  console.log("Please set the OPENROUTER_API_KEY environment variable.");

  // Full observability: log all events
  agent.subscribe((event) => {
    // Log the full event for observability
    console.log("--- Agent Event ---");
    console.log(JSON.stringify(event, null, 2));
    console.log("-------------------");

    // Stream assistant text for a more natural chat experience
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  let userInput: string;
  while ((userInput = await rl.question("You: ")) !== "exit") {
    if (userInput.trim() === "") {
      continue;
    }
    await agent.prompt(userInput);
    process.stdout.write("\n"); // New line after agent response for readability
  }

  rl.close();
  console.log("Chatbot session ended.");
}

main().catch(console.error);

