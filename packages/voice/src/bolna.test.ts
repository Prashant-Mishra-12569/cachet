import { describe, expect, it } from 'vitest';
import { NORTHWIND_AGENT, bolnaAgentBody } from './agents';
import { BolnaError, callIsOver, closeReasonFor, createBolna, toExecution } from './bolna';

const KEY = 'bn-secret-key-never-in-logs';

/** A fake Bolna API: answers from a queue per path and records every request. */
function fakeApi(responses: Record<string, { status: number; body: unknown }[]>) {
  const requests: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    requests.push({
      method: init.method ?? 'GET',
      url: path,
      auth: new Headers(init.headers).get('authorization'),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses[path]?.shift() ?? { status: 404, body: { message: 'not found' } };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, requests };
}

describe('Bolna client', () => {
  it('starts a call with the agent, number and per-call variables', async () => {
    const api = fakeApi({ '/call': [{ status: 200, body: { status: 'queued', execution_id: 'ex-1' } }] });
    const bolna = createBolna({ apiKey: KEY, fetch: api.fetch });
    const id = await bolna.startCall({
      agentId: 'ag-1',
      to: '+919999999999',
      userData: { first_line: 'Hi' },
    });
    expect(id).toBe('ex-1');
    expect(api.requests[0]).toEqual({
      method: 'POST',
      url: '/call',
      auth: `Bearer ${KEY}`,
      body: { agent_id: 'ag-1', recipient_phone_number: '+919999999999', user_data: { first_line: 'Hi' } },
    });
  });

  it('errors are readable and never contain the API key', async () => {
    const api = fakeApi({ '/call': [{ status: 400, body: { message: 'recipient not verified' } }] });
    const bolna = createBolna({ apiKey: KEY, fetch: api.fetch });
    const err = await bolna.startCall({ agentId: 'a', to: '+1', userData: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BolnaError);
    expect(String((err as Error).message)).toContain('recipient not verified');
    expect(String((err as Error).message)).not.toContain(KEY);
  });

  it('waits until the call is over, riding out a brief server error', async () => {
    const api = fakeApi({
      '/executions/ex-1': [
        { status: 200, body: { id: 'ex-1', status: 'ringing' } },
        { status: 503, body: { message: 'busy' } },
        { status: 200, body: { id: 'ex-1', status: 'in-progress' } },
        {
          status: 200,
          body: {
            id: 'ex-1',
            status: 'call-disconnected',
            conversation_duration: 21,
            telephony_data: { from_number: '+918000000000', to_number: '+919999999999', hangup_by: 'user' },
          },
        },
      ],
    });
    const seen: string[] = [];
    const bolna = createBolna({ apiKey: KEY, fetch: api.fetch, sleep: async () => undefined });
    const e = await bolna.waitUntilOver('ex-1', { onStatus: (x) => seen.push(x.status) });
    expect(seen).toEqual(['ringing', 'in-progress', 'call-disconnected']);
    expect(e).toMatchObject({ durationSeconds: 21, fromNumber: '+918000000000', hangupBy: 'user' });
    expect(closeReasonFor(e)).toBe('completed');
  });

  it('an answered call is "completed" even though Bolna reports 0 s at disconnect (seen live)', async () => {
    const api = fakeApi({
      '/executions/ex-2': [
        { status: 200, body: { id: 'ex-2', status: 'ringing' } },
        { status: 200, body: { id: 'ex-2', status: 'in-progress' } },
        { status: 200, body: { id: 'ex-2', status: 'call-disconnected', conversation_duration: 0 } },
      ],
    });
    const bolna = createBolna({ apiKey: KEY, fetch: api.fetch, sleep: async () => undefined });
    const e = await bolna.waitUntilOver('ex-2');
    expect(e.answered).toBe(true);
    expect(closeReasonFor(e)).toBe('completed');
  });

  it('ended without being seen answered: waits for the final status instead of guessing', async () => {
    const api = fakeApi({
      '/executions/ex-3': [
        { status: 200, body: { id: 'ex-3', status: 'ringing' } },
        { status: 200, body: { id: 'ex-3', status: 'call-disconnected', conversation_duration: 0 } },
        { status: 200, body: { id: 'ex-3', status: 'call-disconnected' } },
        { status: 200, body: { id: 'ex-3', status: 'no-answer' } },
      ],
    });
    const bolna = createBolna({ apiKey: KEY, fetch: api.fetch, sleep: async () => undefined });
    const e = await bolna.waitUntilOver('ex-3');
    expect(e.status).toBe('no-answer');
    expect(closeReasonFor(e)).toBe('no_answer');
  });

  it('a client error while waiting stops (no endless loop)', async () => {
    const api = fakeApi({ '/executions/x': [{ status: 404, body: { message: 'no such call' } }] });
    const bolna = createBolna({ apiKey: KEY, fetch: api.fetch, sleep: async () => undefined });
    await expect(bolna.waitUntilOver('x')).rejects.toBeInstanceOf(BolnaError);
  });
});

describe('call outcome → seal close reason', () => {
  it.each([
    ['completed', 30, 'completed'],
    ['call-disconnected', 12, 'completed'],
    ['call-disconnected', 0, 'no_answer'],
    ['no-answer', 0, 'no_answer'],
    ['busy', 0, 'no_answer'],
    ['canceled', 0, 'cancelled'],
    ['stopped', 0, 'cancelled'],
    ['failed', 0, 'failed'],
    ['balance-low', 0, 'failed'],
    ['error', 0, 'failed'],
  ])('%s (%ss) → %s', (status, duration, reason) => {
    expect(closeReasonFor({ status, durationSeconds: duration })).toBe(reason);
    expect(callIsOver(status)).toBe(true);
  });

  it('still running is not over', () => {
    for (const s of ['queued', 'initiated', 'ringing', 'in-progress', 'scheduled'])
      expect(callIsOver(s)).toBe(false);
  });

  it('parses missing telephony fields as null', () => {
    expect(toExecution({ id: 'e', status: 'queued' })).toMatchObject({
      fromNumber: null,
      durationSeconds: null,
    });
  });
});

describe('demo agents', () => {
  it("Northwind's first sentence is exactly the seal's firstLine (code always matches the card)", () => {
    const body = bolnaAgentBody(NORTHWIND_AGENT);
    expect(body.agent_config.agent_welcome_message).toBe('{first_line}');
    expect(body.agent_prompts.task_1.system_prompt).toContain('Never ask for OTPs');
    expect(body.agent_config.tasks[0]?.task_config.call_terminate).toBe(150);
  });
});
