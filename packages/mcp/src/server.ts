import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CachetError, type CachetClient } from '@cachet/sdk';

/**
 * The Cachet MCP server: any MCP-capable AI agent (a desktop assistant, LangChain, a voice-AI platform…) can seal
 * its phone calls, close them, and check companies and seals.
 *
 * Tools:
 *   cachet_seal_call      right before dialling: get the seal, the code and the sentence to say first
 *   cachet_close_seal     when the call ends
 *   cachet_check_company  is a company verified, does it make AI calls, from which numbers?
 *   cachet_check_seal     what Cachet checked for one seal (public view)
 */

/** Call purposes an AI caller can register (the API refuses anything else). */
export const PURPOSES = ['billing', 'delivery', 'appointments', 'support', 'account_alerts'] as const;

const E164 = /^\+[1-9]\d{6,14}$/;
const ULID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
const EURO = /^\d{1,7}(\.\d{1,2})?$/;

export interface CachetMcpDeps {
  /** The AI caller's Cachet client (signs with its own key; pays seals with x402 when credits run out). */
  cachet: Pick<CachetClient, 'sealCall' | 'closeSeal'>;
  /** Cachet API base, e.g. https://api.getcachet.site */
  apiBase: string;
  /** Plain fetch for public lookups. */
  http?: typeof fetch;
  /** Default calling number (must be registered for this AI caller). */
  callerId?: string | undefined;
  /** The payment token for amounts, e.g. "EUDemo". */
  token: string;
  version?: string;
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const refusal = (t: string) => ({ ...text(t), isError: true });

function explain(err: unknown): string {
  if (err instanceof CachetError) return `${err.message} (${err.code}, HTTP ${err.status})`;
  return err instanceof Error ? err.message : String(err);
}

export function createCachetMcpServer(deps: CachetMcpDeps): McpServer {
  const http = deps.http ?? fetch;
  const api = deps.apiBase.replace(/\/+$/, '');
  const server = new McpServer({ name: 'cachet', version: deps.version ?? '0.1.0' });

  server.registerTool(
    'cachet_seal_call',
    {
      title: 'Seal a phone call',
      description:
        'Call this RIGHT BEFORE your AI dials a person. Cachet checks your verified company and AI caller on ' +
        'Concordium and sends the person a card in Telegram with a 4-digit code. Returns `firstLine`: the AI ' +
        'MUST say it as its very first sentence (it says the caller is an AI and gives the code). When the call ' +
        'ends, call cachet_close_seal. If Cachet refuses, do not present the call as verified.',
      inputSchema: {
        to: z.string().regex(E164).describe('The person to call, in E.164 format, e.g. +31612345678'),
        from: z
          .string()
          .regex(E164)
          .optional()
          .describe(
            'The number the call comes from (registered for your AI caller). Defaults to the configured one.',
          ),
        purpose: z.enum(PURPOSES).describe('Why you are calling'),
        message: z
          .string()
          .min(1)
          .max(80)
          .describe('Shown on the card, at most 80 characters, no links or long numbers'),
        amount: z
          .string()
          .regex(EURO)
          .optional()
          .describe('If the call is about paying something: the amount in euros, e.g. "12.40"'),
      },
      outputSchema: {
        sealId: z.string(),
        company: z.string(),
        code: z.string(),
        spokenCode: z.string(),
        firstLine: z.string(),
        expiresAt: z.string(),
        verifyUrl: z.string(),
        creditsLeft: z.number(),
        paidWithX402: z.string().nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ to, from, purpose, message, amount }) => {
      const caller = from ?? deps.callerId;
      if (!caller) return refusal('No calling number: pass `from`, or set CACHET_CALLER_ID for this server.');
      try {
        const seal = await deps.cachet.sealCall({
          to,
          from: caller,
          purpose,
          message,
          amount: amount ? { value: amount, asset: deps.token } : undefined,
        });
        const out = {
          sealId: seal.sealId,
          company: seal.company,
          code: seal.code,
          spokenCode: seal.spokenCode,
          firstLine: seal.firstLine,
          expiresAt: seal.expiresAt,
          verifyUrl: seal.verifyUrl,
          creditsLeft: seal.creditsLeft,
          paidWithX402: seal.x402Tx,
        };
        return {
          ...text(
            `Sealed. Say this first, word for word: "${seal.firstLine}"\n` +
              `Code ${seal.code}, seal ${seal.sealId}, valid until ${seal.expiresAt}. ` +
              `Close it with cachet_close_seal when the call ends.`,
          ),
          structuredContent: out,
        };
      } catch (err) {
        return refusal(`Cachet refused the seal: ${explain(err)}. Do not present this call as verified.`);
      }
    },
  );

  server.registerTool(
    'cachet_close_seal',
    {
      title: 'Close a sealed call',
      description:
        "Call this when the phone call ends, so the person's card stops showing a verified call. " +
        'Safe to repeat: a seal that already ended is reported as such.',
      inputSchema: {
        sealId: z.string().regex(ULID).describe('The sealId returned by cachet_seal_call'),
        reason: z
          .enum(['completed', 'no_answer', 'failed', 'cancelled'])
          .describe(
            'completed = the person answered; no_answer; failed = did not connect; cancelled = not placed',
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ sealId, reason }) => {
      try {
        const result = await deps.cachet.closeSeal(sealId, reason);
        return text(
          result === 'closed' ? `Seal ${sealId} closed (${reason}).` : `Seal ${sealId} had already ended.`,
        );
      } catch (err) {
        return refusal(`Could not close the seal: ${explain(err)}. It ends by itself within 15 minutes.`);
      }
    },
  );

  server.registerTool(
    'cachet_check_company',
    {
      title: 'Check a company',
      description:
        'Is a company verified in Cachet, does it make AI calls, and from which numbers? Use it when someone ' +
        'says they are calling for a company. A company that "never makes AI calls" means any AI call claiming ' +
        'to be it is a scam.',
      inputSchema: { query: z.string().min(2).max(60).describe('The company name, or part of it') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ query }) => {
      const res = await http(`${api}/v1/companies?query=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return refusal(`Cachet answered HTTP ${res.status}.`);
      const { companies } = (await res.json()) as {
        companies: {
          legalName: string;
          legalCountry: string;
          neverCalls: boolean;
          proofTxUrl: string;
          aiCallers: { name: string; callingNumbers: string[]; purposes: string[] }[];
        }[];
      };
      if (companies.length === 0) {
        return text(
          `No verified company matches "${query}". Treat AI calls claiming to be them as NOT verified.`,
        );
      }
      const lines = companies.map((c) => {
        if (c.neverCalls) {
          return `${c.legalName} (${c.legalCountry}) is verified and has told Cachet it NEVER makes AI calls: any AI call claiming to be them is a scam.`;
        }
        const callers = c.aiCallers.length
          ? c.aiCallers
              .map(
                (a) => `${a.name} (calls from ${a.callingNumbers.join(', ')}; for ${a.purposes.join(', ')})`,
              )
              .join('; ')
          : 'no AI caller switched on right now';
        return `${c.legalName} (${c.legalCountry}) is a verified company. AI callers: ${callers}. Proof: ${c.proofTxUrl}`;
      });
      return {
        ...text(
          lines.join('\n') +
            "\nA real call from them always arrives with a Cachet card in the person's Telegram.",
        ),
        structuredContent: { companies },
      };
    },
  );

  server.registerTool(
    'cachet_check_seal',
    {
      title: 'Check a seal',
      description:
        'What Cachet checked for one sealed call: the company, whether its AI caller is switched on in the ' +
        'Concordium registry right now, the signature, and the permanent public record. Never shows the ' +
        "person's number or the call code.",
      inputSchema: { sealId: z.string().regex(ULID).describe('The seal id') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ sealId }) => {
      const res = await http(`${api}/v1/seals/${sealId}`, { signal: AbortSignal.timeout(10_000) });
      if (res.status === 404)
        return refusal(`No seal ${sealId}. If someone sent you this id, don't trust it.`);
      if (!res.ok) return refusal(`Cachet answered HTTP ${res.status}.`);
      const s = (await res.json()) as {
        status: string;
        signatureValid: boolean;
        company: { legalName: string; status: string };
        agent: { name: string | null; onChain: string };
        purpose: string;
        message: string;
        issuedAt: string;
        anchor: { status: string; txUrl?: string };
      };
      const record =
        s.anchor.status === 'finalized' && s.anchor.txUrl
          ? `in the permanent record (${s.anchor.txUrl})`
          : 'joining the permanent record within minutes';
      return {
        ...text(
          [
            `Seal ${sealId}: ${s.status}.`,
            `Company: ${s.company.legalName} (${s.company.status}).`,
            `AI caller: ${s.agent.name ?? 'unnamed'}, ${s.agent.onChain === 'active' ? 'switched on in the Concordium registry' : `registry status: ${s.agent.onChain}`}.`,
            `Signature: ${s.signatureValid ? 'valid, not changed' : 'INVALID'}. Record: ${record}.`,
            `Reason: ${s.purpose}, "${s.message}", sealed ${s.issuedAt}.`,
          ].join('\n'),
        ),
        structuredContent: s,
      };
    },
  );

  return server;
}
