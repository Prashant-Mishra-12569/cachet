/**
 * An MCP client using Cachet like any AI agent would: it starts the Cachet MCP server over stdio,
 * lists its tools, checks a company, seals a call, checks the seal, and closes it.
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

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('./index.ts', import.meta.url))],
    env: Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    stderr: 'inherit',
  });
  const client = new Client({ name: 'cachet-example-agent', version: '1.0.0' });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as ToolResult;
    const text = r.content.map((c) => c.text ?? '').join('\n');
    console.log(`\n→ ${name} ${JSON.stringify(args)}\n${r.isError ? '✗' : '✓'} ${text}`);
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
    await call('cachet_close_seal', { sealId, reason: 'cancelled' });
    console.log(`\nDone. Public page of this seal: ${String(sealed.structuredContent?.['verifyUrl'])}`);
  } finally {
    await client.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
