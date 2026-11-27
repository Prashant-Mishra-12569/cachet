/**
 * Two AI agents using Cachet over MCP, like real agents would:
 *  - the CALLER (a company's AI) checks a company, seals a call, and closes it at the end;
 *  - the RECEPTIONIST (an AI answering calls for that number, with no Cachet key at all) hears the code
 *    and verifies the caller: with Cachet, and the caller's badge directly with Concordium's Agent Registry.
 *
 *   pnpm --filter @cachet/mcp example +919336124858
 *
 * No phone rings: this only seals (the person's Telegram card arrives) and then closes the seal as
 * "cancelled", which is the truth (no call was placed).
 */
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type ToolResult = {
  content: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function main() {
  const to = process.argv[2];
  if (!to || !/^\+[1-9]\d{6,14}$/.test(to)) {
    console.error('Usage: pnpm --filter @cachet/mcp example +<number to seal a call to>');
    process.exitCode = 1;
    return;
  }

  const env = Object.fromEntries(
    Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
  );
  const start = async (name: string, extra: Record<string, string> = {}) => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', fileURLToPath(new URL('./index.ts', import.meta.url))],
      env: { ...env, ...extra },
      stderr: 'inherit',
    });
    const c = new Client({ name, version: '1.0.0' });
    await c.connect(transport);
    return c;
  };
  const client = await start('caller-agent');
  // No AI caller key: the receptionist can only verify, never seal.
  const receptionist = await start('receptionist-agent', { CCD_AGENT_KEY_PATH: '', CACHET_AGENT_BADGE: '' });

  const call = async (name: string, args: Record<string, unknown>, who = client) => {
    const r = (await who.callTool({ name, arguments: args })) as ToolResult;
    const text = r.content.map((c) => c.text ?? '').join('\n');
    const role = who === client ? 'caller' : 'receptionist';
    console.log(`\n[${role}] → ${name} ${JSON.stringify(args)}\n${r.isError ? '✗' : '✓'} ${text}`);
    return r;
  };

  try {
    const { tools } = await client.listTools();
    console.log(`Connected to the Cachet MCP server. Tools: ${tools.map((t) => t.name).join(', ')}`);

    await call('cachet_check_company', { query: 'Northwind' });
    const sealed = await call('cachet_seal_call', {
      to,
      purpose: 'billing',
      message: 'MCP test: no call will ring',
    });
    const sealId = sealed.structuredContent?.['sealId'];
    if (sealed.isError || typeof sealId !== 'string') {
      process.exitCode = 1;
      return;
    }
    await call('cachet_check_seal', { sealId });
    // The receptionist hears the code the caller says first and verifies it, then a scammer's guess.
    const heard = String(sealed.structuredContent?.['code'] ?? '');
    await call('cachet_verify_incoming_call', { to, code: heard }, receptionist);
    const guess = heard === '12-34' ? '43-21' : '12-34';
    await call('cachet_verify_incoming_call', { to, code: guess }, receptionist);
    await call('cachet_close_seal', { sealId, reason: 'cancelled' });
    console.log(`\nDone. Public page of this seal: ${String(sealed.structuredContent?.['verifyUrl'])}`);
  } finally {
    await client.close();
    await receptionist.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
