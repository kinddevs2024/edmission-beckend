/**
 * Quick v0 SDK smoke test (server-side only).
 * Usage:
 *   1) Set V0_API_KEY in edmission-beckend/.env
 *   2) npm run v0:chat -- "Create a todo app with React"
 */
import dotenv from 'dotenv';
import { createClient } from 'v0-sdk';

dotenv.config();

async function main() {
  const apiKey = process.env.V0_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('V0_API_KEY is missing. Add it to edmission-beckend/.env');
  }

  const prompt = process.argv.slice(2).join(' ').trim() || 'Create a todo app with React';
  const v0 = createClient({ apiKey });
  const result = await v0.chats.create({ message: prompt, responseMode: 'sync' });

  if (result instanceof ReadableStream) {
    throw new Error('Unexpected streaming response. Keep responseMode as "sync" for this script.');
  }

  console.log(`v0 chat created: ${result.id}`);
  console.log(`open: ${result.webUrl}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
