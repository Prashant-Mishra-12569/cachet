/**
 * Bolna (bolna.ai) voice-agent API, just what Cachet's demo caller needs (plan §12).
 * Docs: https://www.bolna.ai/docs (POST /call, GET /executions/{id}, /v2/agent, /user/me).
 *
 * Bolna's webhooks are not signed, so we don't use them: the caller asks GET /executions/{id}
 * (authenticated with our key) until the call is over. Nothing anyone else sends us can end a seal.
 */

export type BolnaStatus =
  | 'scheduled'
  | 'queued'
  | 'rescheduled'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'call-disconnected'
  | 'completed'
  | 'balance-low'
  | 'busy'
  | 'no-answer'
  | 'canceled'
  | 'failed'
  | 'stopped'
  | 'error';

/** The phone call itself is over (cost/recording may still be filled in later). */
const ENDED: ReadonlySet<string> = new Set([
  'call-disconnected',
  'completed',
  'balance-low',
  'busy',
  'no-answer',
  'canceled',
  'failed',
  'stopped',
  'error',
]);
export const callIsOver = (status: string) => ENDED.has(status);

/** Cachet's seal close reasons (POST /v1/seals/:id/close). */
export type CloseReason = 'completed' | 'no_answer' | 'failed' | 'cancelled';

export function closeReasonFor(e: Pick<Execution, 'status' | 'durationSeconds'>): CloseReason {
  switch (e.status) {
    case 'completed':
      return 'completed';
    case 'call-disconnected':
      return (e.durationSeconds ?? 0) > 0 ? 'completed' : 'no_answer';
    case 'no-answer':
    case 'busy':
      return 'no_answer';
    case 'canceled':
    case 'stopped':
      return 'cancelled';
    default:
      return 'failed';
  }
}

export interface Execution {
  id: string;
  status: string;
  terminationReason: string | null;
  durationSeconds: number | null;
  /** The caller ID the person saw, when Bolna reports it. */
  fromNumber: string | null;
  toNumber: string | null;
  hangupBy: string | null;
  raw: Record<string, unknown>;
}

export class BolnaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BolnaError';
  }
}

export interface BolnaOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function toExecution(raw: Record<string, unknown>): Execution {
  const tel = (raw['telephony_data'] ?? {}) as Record<string, unknown>;
  return {
    id: String(raw['id'] ?? raw['execution_id'] ?? ''),
    status: String(raw['status'] ?? 'unknown'),
    terminationReason: str(raw['termination_reason']),
    durationSeconds: num(raw['conversation_duration']) ?? num(Number(tel['duration'])),
    fromNumber: str(tel['from_number']),
    toNumber: str(tel['to_number']),
    hangupBy: str(tel['hangup_by']),
    raw,
  };
}

export function createBolna(options: BolnaOptions) {
  const base = (options.baseUrl ?? 'https://api.bolna.ai').replace(/\/+$/, '');
  const http = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await http(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) {
      const message =
        (json && typeof json === 'object' && ('message' in json || 'detail' in json)
          ? String(
              (json as Record<string, unknown>)['message'] ?? (json as Record<string, unknown>)['detail'],
            )
          : text.slice(0, 300)) || res.statusText;
      throw new BolnaError(res.status, `Bolna ${method} ${path} → ${res.status}: ${message}`);
    }
    return json as T;
  }

  async function getExecution(id: string): Promise<Execution> {
    return toExecution(await call<Record<string, unknown>>('GET', `/executions/${encodeURIComponent(id)}`));
  }

  return {
    me: () => call<{ wallet: number; concurrency: { max: number; current: number } }>('GET', '/user/me'),
    listAgents: () => call<{ id: string; agent_name: string }[]>('GET', '/v2/agent/all'),
    createAgent: (body: unknown) => call<{ agent_id: string }>('POST', '/v2/agent', body),
    updateAgent: (id: string, body: unknown) => call<unknown>('PUT', `/v2/agent/${id}`, body),

    /** Ask Bolna to dial. `userData` fills the {variables} in the agent's welcome message and prompt. */
    async startCall(input: {
      agentId: string;
      to: string;
      from?: string | undefined;
      userData: Record<string, string>;
    }): Promise<string> {
      const res = await call<{ execution_id?: string; status?: string }>('POST', '/call', {
        agent_id: input.agentId,
        recipient_phone_number: input.to,
        ...(input.from ? { from_phone_number: input.from } : {}),
        user_data: input.userData,
      });
      if (!res.execution_id)
        throw new BolnaError(502, 'Bolna accepted the call but returned no execution_id');
      return res.execution_id;
    },

    getExecution,

    /** Poll until the phone call is over (or the timeout). Calls `onStatus` when the status changes. */
    async waitUntilOver(
      id: string,
      opts: { pollMs?: number; timeoutMs?: number; onStatus?: (e: Execution) => void } = {},
    ): Promise<Execution> {
      const deadline = Date.now() + (opts.timeoutMs ?? 6 * 60_000);
      let last = '';
      for (;;) {
        let e: Execution | null = null;
        try {
          e = await getExecution(id);
        } catch (err) {
          // A brief API hiccup must not abandon an open seal: keep asking until the deadline.
          if (!(err instanceof BolnaError) || err.status < 500) throw err;
        }
        if (e) {
          if (e.status !== last) {
            last = e.status;
            opts.onStatus?.(e);
          }
          if (callIsOver(e.status)) return e;
        }
        if (Date.now() > deadline) throw new BolnaError(504, `call ${id} not over after the timeout`);
        await sleep(opts.pollMs ?? 2_000);
      }
    },
  };
}

export type Bolna = ReturnType<typeof createBolna>;
