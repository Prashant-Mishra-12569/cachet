import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Telegram Mini App sign-in check (core.telegram.org/bots/webapps, "Validating data received via
 * the Mini App"): Telegram signs the launch data ("initData") with a key derived from OUR bot token,
 * so only Telegram can produce a valid one, and it names the Telegram user who opened the app.
 *
 *   secret_key = HMAC_SHA256(key = "WebAppData", msg = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, msg = data_check_string))
 *   data_check_string = every received field except `hash`, sorted by key, "key=value", joined by "\n"
 */

export interface MiniAppUser {
  id: number;
  firstName: string;
  languageCode?: string;
}

export type InitDataResult =
  | { ok: true; user: MiniAppUser; authDate: number; startParam?: string }
  | { ok: false; reason: 'missing' | 'malformed' | 'bad_hash' | 'expired' | 'future' | 'no_user' };

/** initData strings are ~0.5–1.5 KB; anything much bigger is not from Telegram. */
const MAX_LENGTH = 4096;

export function webAppSecret(botToken: string): Buffer {
  return createHmac('sha256', 'WebAppData').update(botToken).digest();
}

function checkString(fields: [string, string][]): string {
  return fields
    .slice()
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * Verify initData and return the Telegram user. `maxAgeSeconds` limits how long one launch can be
 * used (the docs leave this to us): a leaked initData string stops working after that.
 */
export function verifyInitData(
  raw: string | undefined | null,
  secret: Buffer,
  nowMs: number,
  maxAgeSeconds = 60 * 60,
): InitDataResult {
  if (!raw) return { ok: false, reason: 'missing' };
  if (raw.length > MAX_LENGTH) return { ok: false, reason: 'malformed' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const hashes = params.getAll('hash');
  const hash = hashes[0]?.toLowerCase();
  if (hashes.length !== 1 || !hash || hash.length !== 64) return { ok: false, reason: 'malformed' };

  const fields = [...params.entries()].filter(([k]) => k !== 'hash');
  // Each key once: a duplicated key could make two parsers disagree about what was signed.
  if (new Set(fields.map(([k]) => k)).size !== fields.length) return { ok: false, reason: 'malformed' };

  const sign = (list: [string, string][]) =>
    createHmac('sha256', secret).update(checkString(list)).digest('hex');
  // The docs say "all received fields" except hash, which includes the newer `signature` field.
  // Some clients have been seen to sign without it; accept that form too. Both are HMACs keyed by
  // our bot token, so neither can be forged without it.
  const valid =
    sameHex(sign(fields), hash) ||
    (params.has('signature') && sameHex(sign(fields.filter(([k]) => k !== 'signature')), hash));
  if (!valid) return { ok: false, reason: 'bad_hash' };

  const authDate = Number(params.get('auth_date'));
  if (!Number.isInteger(authDate) || authDate <= 0) return { ok: false, reason: 'malformed' };
  const nowS = Math.floor(nowMs / 1000);
  if (authDate > nowS + 60) return { ok: false, reason: 'future' };
  if (nowS - authDate > maxAgeSeconds) return { ok: false, reason: 'expired' };

  let user: unknown;
  try {
    user = JSON.parse(params.get('user') ?? 'null');
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    !user ||
    typeof user !== 'object' ||
    !Number.isSafeInteger((user as { id?: unknown }).id) ||
    (user as { id: number }).id <= 0
  ) {
    return { ok: false, reason: 'no_user' };
  }
  const u = user as { id: number; first_name?: unknown; language_code?: unknown };
  const startParam = params.get('start_param');
  return {
    ok: true,
    authDate,
    user: {
      id: u.id,
      firstName: typeof u.first_name === 'string' ? u.first_name.slice(0, 64) : '',
      ...(typeof u.language_code === 'string' ? { languageCode: u.language_code.slice(0, 8) } : {}),
    },
    ...(startParam ? { startParam } : {}),
  };
}

/** Build a valid initData string (tests and local tools only; real ones come from Telegram). */
export function signInitData(fields: Record<string, string>, secret: Buffer): string {
  const list = Object.entries(fields);
  const hash = createHmac('sha256', secret).update(checkString(list)).digest('hex');
  const params = new URLSearchParams(list);
  params.set('hash', hash);
  return params.toString();
}
