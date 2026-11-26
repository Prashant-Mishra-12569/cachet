/**
 * Red team (plan §20): 1,000 simulated calls against a RUNNING Cachet server, real and fake mixed.
 * It counts FALSE GREENS: a person shown a verified call that is not the real one in front of them.
 *
 *   pnpm red-team
 *
 * LOCAL ONLY. It refuses to run unless the API and the database are on this computer. It registers
 * 1,000 fictional people (+44 7700 900xxx: numbers Ofcom reserves for drama, nobody owns them) and
 * deletes them at the end. Start the server first with:
 *   TELEGRAM_BOT_OFF=true  (Mini App API on, no bot, no cards sent to anyone)
 *   W3ID_REGISTRY=         (never let a local test touch the real on-chain credential)
 *   CACHET_PROXY_SECRET    (the same value here and there: each simulated phone gets its own IP)
 *
 * What a person "sees" is read two ways, and both must agree:
 *   1. the Mini App home (GET /v1/tg/me, signed like Telegram signs it), and
 *   2. the exact query the bot's /check uses (openForPhone).
 */
import { randomBytes, randomInt, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AccountAddress, signMessage } from '@concordium/web-sdk';
import { loadAccountKey } from '@cachet/concordium';
import { createDb, sql } from '@cachet/db';
import { canonicalize, formatCode, phoneHash, sealRequestMessage, sha256Hex } from '@cachet/shared/seal';
import { createCachetClient, CachetError } from '@cachet/sdk';
import { createPeopleRepo } from '../bot/people-repo';
import { createPhoneCipher } from '../bot/phone-crypto';
import { createConsentsRepo } from '../bot/consents-repo';
import { createBusinessRepo } from '../business/repo';
import { createSealRepo } from '../seals/repo';
import { webAppSecret } from '../miniapp/init-data';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOT_ENV = `${ROOT}.env`;
type Json = Record<string, unknown>;

function need(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} must be set`);
  return v;
}
const isLocal = (url: string) =>
  /^(https?|postgres(ql)?):\/\/([^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

interface Outcome {
  kind: string;
  /** The person was shown a verified call that is not the real one. Must stay 0. */
  falseGreen: boolean;
  /** Cachet behaved exactly as designed (refused, ended, showed the right company + code...). */
  asDesigned: boolean;
  note?: string;
}

async function main() {
  if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);
  const api = (process.env['CACHET_API_URL'] ?? 'http://localhost:8787').replace(/\/+$/, '');
  const dbUrl = need('DATABASE_URL');
  if (!isLocal(api) || !isLocal(dbUrl))
    throw new Error('Red team runs ONLY against a local server and database.');
  const botToken = need('TELEGRAM_BOT_TOKEN');
  const proxySecret = need('CACHET_PROXY_SECRET');
  const pepper = need('PHONE_PEPPER');
  const badge = need('CACHET_AGENT_BADGE');
  const companyAccount = need('CCD_COMPANY_ADDRESS');
  const from = need('VOICE_CALLER_ID');
  const network = (process.env['CCD_NETWORK'] ?? 'testnet') as 'testnet';
  const agentKey = await loadAccountKey({
    path: need('CCD_AGENT_KEY_PATH'),
    expectedAddress: need('CCD_AGENT_ADDRESS'),
    network,
    forbiddenDir: ROOT,
  });
  const otherKey = await loadAccountKey({
    path: need('CCD_SPONSOR_KEY_PATH'),
    expectedAddress: need('CCD_SPONSOR_ADDRESS'),
    network,
    forbiddenDir: ROOT,
  });
  const agentAccount = agentKey.address.address;

  const handle = createDb(dbUrl);
  const db = handle.db;
  const peopleRepo = createPeopleRepo(db);
  const sealRepo = createSealRepo(db);
  const businesses = createBusinessRepo(db);
  const consents = createConsentsRepo(db);
  const cipher = createPhoneCipher(need('PHONE_ENC_KEY'));
  const company = await businesses.findByAccount(companyAccount);
  if (!company) throw new Error('The demo company is not in this database.');

  // Every simulated phone / attacker gets its own IP (through the website-proxy channel), like real life.
  const ipOf = (n: number) => `198.18.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`;
  const withIp = (ip: string) => ({ 'x-cachet-proxy-secret': proxySecret, 'x-cachet-client-ip': ip });
  const AGENT_IP = '198.19.0.1';
  const agentFetch: typeof fetch = (input, init) =>
    fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...withIp(AGENT_IP) } });
  const client = createCachetClient({
    baseUrl: api,
    badge,
    account: agentAccount,
    signer: agentKey.signer,
    fetch: agentFetch,
    sleep: async () => {},
  });

  // ── 1,000 fictional people ──────────────────────────────────────────────────────────────────────
  const N = 1000;
  const TG_BASE = 9_100_000_000;
  const people: { n: number; tg: number; phone: string; hash: string; ip: string }[] = [];
  for (let n = 0; n < N; n++) {
    const phone = `+447700900${String(n).padStart(3, '0')}`;
    const p = { n, tg: TG_BASE + n, phone, hash: phoneHash(pepper, phone), ip: ipOf(n) };
    await peopleRepo.register({
      tgUserId: p.tg,
      chatId: p.tg,
      phoneHash: p.hash,
      phoneEnc: cipher.encrypt(phone),
      lang: 'en',
    });
    people.push(p);
  }
  console.log(`Registered ${N} fictional people (+447700900000–999).`);

  const secret = webAppSecret(botToken);
  function initData(tg: number, opts: { ageSeconds?: number; secretOverride?: Buffer } = {}) {
    const fields: [string, string][] = [
      ['auth_date', String(Math.floor(Date.now() / 1000) - (opts.ageSeconds ?? 0))],
      ['query_id', randomBytes(8).toString('hex')],
      ['user', JSON.stringify({ id: tg, first_name: 'Test' })],
    ];
    const check = fields.map(([k, v]) => `${k}=${v}`).join('\n');
    const hash = createHmac('sha256', opts.secretOverride ?? secret)
      .update(check)
      .digest('hex');
    return new URLSearchParams([...fields, ['hash', hash]]).toString();
  }
  const tgGet = (p: (typeof people)[number], path: string, auth = `tma ${initData(p.tg)}`) =>
    fetch(`${api}/v1/tg${path}`, { headers: { authorization: auth, ...withIp(p.ip) } });

  /** What this person sees right now: Mini App home + the bot's /check query. They must agree. */
  async function seen(p: (typeof people)[number]) {
    const res = await tgGet(p, '/me');
    if (res.status !== 200) throw new Error(`Mini App /me answered ${res.status} for person ${p.n}`);
    const me = (await res.json()) as {
      calls: { sealId: string; company: string; code: string | null; status: string }[];
    };
    const app = me.calls.filter((c) => c.status === 'open');
    const check = await sealRepo.openForPhone(p.hash, new Date());
    const a = app
      .map((c) => c.sealId)
      .sort()
      .join(',');
    const b = check
      .map((r) => r.id)
      .sort()
      .join(',');
    if (a !== b) throw new Error(`Mini App and /check disagree for person ${p.n}: [${a}] vs [${b}]`);
    return app;
  }
  const noGreen = async (p: (typeof people)[number]) => (await seen(p)).length === 0;

  const purpose = 'billing';
  const message = 'Your energy bill is ready';
  async function realCall(p: (typeof people)[number], amount?: string) {
    return client.sealCall({
      to: p.phone,
      from,
      purpose,
      message,
      ...(amount ? { amount: { value: amount, asset: process.env['PLT_TOKEN_ID'] ?? 'EUDemo' } } : {}),
    });
  }
  async function signedRequest(p: (typeof people)[number], over: Json = {}, key = agentKey) {
    const request: Json = {
      v: 'cachet-seal-request/1',
      badge,
      agentAccount,
      to: p.phone,
      from,
      purpose,
      message,
      nonce: randomBytes(16).toString('hex'),
      ts: Math.floor(Date.now() / 1000),
      ...over,
    };
    const signature = await signMessage(
      AccountAddress.fromBase58(String(request['agentAccount'])),
      sealRequestMessage(sha256Hex(canonicalize(request))),
      key.signer,
    );
    return { request, signature };
  }
  async function postSeal(body: unknown, ip: string) {
    const res = await fetch(`${api}/v1/seals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...withIp(ip) },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Json;
    return {
      status: res.status,
      code: (json['error'] as Json | undefined)?.['code'] as string | undefined,
      json,
    };
  }
  const attackerIp = () => `203.0.113.${randomInt(1, 255)}`;
  const randomCode = () => formatCode(String(randomInt(0, 10_000)).padStart(4, '0'));

  // ── the scenarios ────────────────────────────────────────────────────────────────────────────────
  type P = (typeof people)[number];
  const scenarios: {
    kind: string;
    count: number;
    run: (p: P, i: number) => Promise<Omit<Outcome, 'kind'>>;
  }[] = [
    {
      kind: 'real sealed call (then hang up)',
      count: 150,
      run: async (p, i) => {
        const seal = await realCall(p, i % 4 === 0 ? '12.40' : undefined);
        const v = await seen(p);
        const right =
          v.length === 1 &&
          v[0]?.sealId === seal.sealId &&
          v[0]?.company === company.legalName &&
          v[0]?.code === seal.code;
        let payOk = true;
        if (i % 4 === 0) {
          const d = (await (await tgGet(p, `/seals/${seal.sealId}`)).json()) as {
            pay?: { recipient: string | null };
          };
          payOk = d.pay?.recipient === companyAccount; // only ever the registry's agentWallet
        }
        await client.closeSeal(seal.sealId, 'completed');
        const after = await noGreen(p);
        return { falseGreen: !after, asDesigned: right && payOk && after };
      },
    },
    {
      kind: 'spoofed caller ID, no seal',
      count: 100,
      run: async (p) => {
        const green = !(await noGreen(p));
        return { falseGreen: green, asDesigned: !green };
      },
    },
    {
      kind: 'replay of a captured signed request',
      count: 60,
      run: async (p) => {
        const body = await signedRequest(p);
        const first = await postSeal(body, AGENT_IP);
        if (first.status !== 201) throw new Error(`real seal refused: ${first.code}`);
        await client.closeSeal(String(first.json['sealId']), 'completed');
        const replay = await postSeal(body, attackerIp());
        const green = !(await noGreen(p));
        return {
          falseGreen: green || replay.status === 201,
          asDesigned: replay.code === 'seal_replay' && !green,
          note: replay.code,
        };
      },
    },
    {
      kind: 'captured request re-pointed at another person',
      count: 60,
      run: async (p, i) => {
        const victim = people[(p.n + 500) % N] as P;
        const body = await signedRequest(p);
        const res = await postSeal({ ...body, request: { ...body.request, to: victim.phone } }, attackerIp());
        const green = !(await noGreen(victim)) || !(await noGreen(p));
        void i;
        return {
          falseGreen: green || res.status === 201,
          asDesigned: res.code === 'seal_bad_signature' && !green,
          note: res.code,
        };
      },
    },
    {
      kind: 'old (stale) signed request',
      count: 40,
      run: async (p) => {
        const res = await postSeal(
          await signedRequest(p, { ts: Math.floor(Date.now() / 1000) - 600 }),
          attackerIp(),
        );
        const green = !(await noGreen(p));
        return {
          falseGreen: green || res.status === 201,
          asDesigned: res.code === 'seal_stale' && !green,
          note: res.code,
        };
      },
    },
    {
      kind: 'expired seal (15 minutes passed)',
      count: 50,
      run: async (p) => {
        const seal = await realCall(p);
        await db.execute(
          sql`update seals set expires_at = now() - interval '1 second' where id = ${seal.sealId}`,
        );
        const green = !(await noGreen(p));
        const pub = (await (await fetch(`${api}/v1/seals/${seal.sealId}`)).json()) as Json;
        return { falseGreen: green, asDesigned: !green && pub['status'] === 'expired' && !('code' in pub) };
      },
    },
    {
      kind: 'closed seal (call ended)',
      count: 50,
      run: async (p) => {
        const seal = await realCall(p);
        await client.closeSeal(seal.sealId, 'no_answer');
        const green = !(await noGreen(p));
        const pub = (await (await fetch(`${api}/v1/seals/${seal.sealId}`)).json()) as Json;
        return { falseGreen: green, asDesigned: !green && pub['status'] === 'closed' && !('code' in pub) };
      },
    },
    {
      kind: 'scammer calls while a real seal is open',
      count: 100,
      run: async (p, i) => {
        const seal = await realCall(p);
        const claimed = i % 2 === 0 ? company.legalName : 'Saffron Trust Bank (demo)';
        const saidCode = randomCode();
        const v = await seen(p);
        // The person sees the REAL company + code; a scammer must match both to fool them.
        const fooled = v.some((c) => c.company === claimed && c.code === saidCode);
        const showsReal = v.length === 1 && v[0]?.company === company.legalName && v[0]?.code === seal.code;
        await client.closeSeal(seal.sealId, 'completed');
        return {
          falseGreen: fooled,
          asDesigned: showsReal && !fooled,
          note: fooled ? 'code guessed' : undefined,
        };
      },
    },
    {
      kind: 'AI caller switched off (revoked)',
      count: 50,
      run: async (p) => {
        const res = await client.sealCall({ to: p.phone, from, purpose, message }).catch((e: unknown) => e);
        const code = res instanceof CachetError ? res.code : 'issued';
        const green = !(await noGreen(p));
        return {
          falseGreen: green || code === 'issued',
          asDesigned: code === 'agent_unknown' && !green,
          note: code,
        };
      },
    },
    {
      kind: 'company suspended',
      count: 50,
      run: async (p) => {
        const res = await client.sealCall({ to: p.phone, from, purpose, message }).catch((e: unknown) => e);
        const code = res instanceof CachetError ? res.code : 'issued';
        const green = !(await noGreen(p));
        return {
          falseGreen: green || code === 'issued',
          asDesigned: code === 'business_suspended' && !green,
          note: code,
        };
      },
    },
    {
      kind: "someone else's seal (wrong person)",
      count: 80,
      run: async (p) => {
        const other = people[(p.n + 333) % N] as P;
        const seal = await realCall(p);
        const greenForOther = !(await noGreen(other));
        const peek = (await tgGet(other, `/seals/${seal.sealId}`)).status;
        const rep = await fetch(`${api}/v1/tg/seals/${seal.sealId}/report`, {
          method: 'POST',
          headers: {
            authorization: `tma ${initData(other.tg)}`,
            'content-type': 'application/json',
            ...withIp(other.ip),
          },
          body: JSON.stringify({ category: 'pressure' }),
        });
        await client.closeSeal(seal.sealId, 'completed');
        return {
          falseGreen: greenForOther,
          asDesigned: !greenForOther && peek === 404 && rep.status === 404,
        };
      },
    },
    {
      kind: 'forged signature',
      count: 100,
      run: async (p, i) => {
        let res;
        if (i % 3 === 0) {
          const body = await signedRequest(p);
          res = await postSeal(
            { ...body, signature: { 0: { 0: randomBytes(64).toString('hex') } } },
            attackerIp(),
          );
        } else if (i % 3 === 1) {
          res = await postSeal(await signedRequest(p, {}, otherKey), attackerIp()); // signed with someone else's key
        } else {
          const body = await signedRequest(p);
          res = await postSeal(
            { ...body, request: { ...body.request, message: 'Pay now to avoid cut-off' } },
            attackerIp(),
          );
        }
        const green = !(await noGreen(p));
        return {
          falseGreen: green || res.status === 201,
          asDesigned: res.code === 'seal_bad_signature' && !green,
          note: res.code,
        };
      },
    },
    {
      kind: "probing someone's calls",
      count: 50,
      run: async (p, i) => {
        const seal = await realCall(p);
        const fake = randomBytes(32);
        const probes = [
          (await tgGet(p, '/me', `tma ${initData(p.tg, { secretOverride: fake })}`)).status === 401, // forged Telegram login
          (await tgGet(p, '/me', `tma ${initData(p.tg, { ageSeconds: 7200 })}`)).status === 401, // old login replayed
          (await tgGet({ ...p, tg: TG_BASE + 50_000 + i }, '/me')).status === 403, // a Telegram user who never registered
        ];
        const pub = (await (await fetch(`${api}/v1/seals/${seal.sealId}`)).json()) as Json;
        const leak = JSON.stringify(pub);
        const noLeak =
          !('code' in pub) && !leak.includes(p.phone) && !leak.includes(p.hash) && !leak.includes(seal.code);
        await client.closeSeal(seal.sealId, 'completed');
        return { falseGreen: !noLeak, asDesigned: probes.every(Boolean) && noLeak };
      },
    },
    {
      kind: 'person blocked this company',
      count: 20,
      run: async (p) => {
        await consents.set(p.hash, company.id, 'revoked', new Date());
        const res = await client.sealCall({ to: p.phone, from, purpose, message }).catch((e: unknown) => e);
        const code = res instanceof CachetError ? res.code : 'issued';
        const green = !(await noGreen(p));
        return {
          falseGreen: green || code === 'issued',
          asDesigned: code === 'consent_revoked' && !green,
          note: code,
        };
      },
    },
    {
      kind: 'rule-breaking seal (number, purpose, link, money)',
      count: 40,
      run: async (p, i) => {
        const bad: [Json, string][] = [
          [{ from: '+911234567890' }, 'number_not_allowed'],
          [{ purpose: 'appointments' }, 'purpose_not_allowed'],
          [{ message: 'Pay at www.example.com now' }, 'message_not_allowed'],
          [{ amount: { value: '10', asset: 'USDC' } }, 'amount_not_allowed'],
        ];
        const [over, expected] = bad[i % bad.length] as [Json, string];
        const res = await postSeal(await signedRequest(p, over), AGENT_IP);
        const green = !(await noGreen(p));
        return {
          falseGreen: green || res.status === 201,
          asDesigned: res.code === expected && !green,
          note: res.code,
        };
      },
    },
  ];
  const total = scenarios.reduce((s, x) => s + x.count, 0);
  if (total !== N) throw new Error(`scenarios add up to ${total}, not ${N}`);

  // ── run ─────────────────────────────────────────────────────────────────────────────────────────
  const results: Outcome[] = [];
  let next = 0;
  const started = Date.now();
  try {
    for (const s of scenarios) {
      const isRevoked = s.kind.startsWith('AI caller switched off');
      const isSuspended = s.kind.startsWith('company suspended');
      if (isRevoked) await db.execute(sql`update agents set status = 'revoked' where badge = ${badge}`);
      if (isSuspended) {
        // Real calls are live first: suspension must end them at once (same steps as `pnpm company:status`).
        for (const p of people.slice(next, next + 10)) await realCall(p);
        const now = new Date();
        await businesses.setStatus(company.id, 'suspended', 'red-team test', now);
        for (const row of await sealRepo.openForBusiness(company.id, now)) {
          const item = {
            v: 'cachet-seal-closed/1',
            sealId: row.id,
            closedAt: now.toISOString(),
            reason: 'company_suspended',
          };
          await sealRepo.close(row.id, row.agentId, now, 'company_suspended', {
            kind: 'seal_closed',
            refId: row.id,
            itemHash: sha256Hex(canonicalize(item)),
          });
        }
      }
      try {
        for (let i = 0; i < s.count; i++) {
          const p = people[next++] as P;
          results.push({ kind: s.kind, ...(await s.run(p, i)) });
        }
      } finally {
        if (isRevoked) await db.execute(sql`update agents set status = 'active' where badge = ${badge}`);
        if (isSuspended)
          await businesses.setStatus(company.id, 'active', 'red-team test finished', new Date());
      }
      const mine = results.filter((r) => r.kind === s.kind);
      console.log(
        `${s.kind.padEnd(52)} ${String(mine.length).padStart(4)} calls  false greens ${mine.filter((r) => r.falseGreen).length}  as designed ${mine.filter((r) => r.asDesigned).length}`,
      );
      const odd = mine.filter((r) => !r.asDesigned).slice(0, 3);
      for (const o of odd) console.log(`    ! not as designed: ${o.note ?? '(see code)'}`);
    }
  } finally {
    // Clean up: the fictional people and their choices (seal records stay: they are part of the ledger).
    await db.execute(
      sql`delete from consents where phone_hash in (select phone_hash from people where tg_user_id >= ${TG_BASE} and tg_user_id < ${TG_BASE + N})`,
    );
    await db.execute(sql`delete from people where tg_user_id >= ${TG_BASE} and tg_user_id < ${TG_BASE + N}`);
    await handle.close();
  }

  const falseGreens = results.filter((r) => r.falseGreen).length;
  const designed = results.filter((r) => r.asDesigned).length;
  console.log('─'.repeat(90));
  console.log(`${results.length} simulated calls in ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(`FALSE GREENS: ${falseGreens}`);
  console.log(`Behaved exactly as designed: ${designed}/${results.length}`);
  if (falseGreens > 0 || designed !== results.length) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error(`✗ ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exitCode = 1;
});
