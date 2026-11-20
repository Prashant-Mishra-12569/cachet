import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData, webAppSecret } from './init-data';

const SECRET = webAppSecret('123456:TEST-BOT-TOKEN');
const NOW = Date.parse('2026-11-20T10:00:00Z');
const nowS = Math.floor(NOW / 1000);
const USER = JSON.stringify({ id: 777, first_name: 'Asha', language_code: 'en' });

const fields = (over: Record<string, string> = {}) => ({
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: USER,
  auth_date: String(nowS - 30),
  ...over,
});

describe('Telegram Mini App initData', () => {
  it('accepts data signed with our bot token and returns the Telegram user', () => {
    const result = verifyInitData(signInitData(fields(), SECRET), SECRET, NOW);
    expect(result).toEqual({
      ok: true,
      authDate: nowS - 30,
      user: { id: 777, firstName: 'Asha', languageCode: 'en' },
    });
  });

  it('computes the HMAC exactly as the Telegram docs describe', () => {
    // Independent re-implementation of the documented algorithm, to pin our helper to it.
    const secret = createHmac('sha256', 'WebAppData').update('123456:TEST-BOT-TOKEN').digest();
    const f = fields();
    const dcs = Object.keys(f)
      .sort()
      .map((k) => `${k}=${f[k as keyof typeof f]}`)
      .join('\n');
    const hash = createHmac('sha256', secret).update(dcs).digest('hex');
    const raw = `${new URLSearchParams(f).toString()}&hash=${hash}`;
    expect(verifyInitData(raw, SECRET, NOW).ok).toBe(true);
  });

  it('refuses changed data (someone else’s user id)', () => {
    const raw = signInitData(fields(), SECRET).replace(
      encodeURIComponent('"id":777'),
      encodeURIComponent('"id":778'),
    );
    expect(verifyInitData(raw, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('refuses data signed with another bot’s token', () => {
    const raw = signInitData(fields(), webAppSecret('999:OTHER'));
    expect(verifyInitData(raw, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_hash' });
  });

  it('accepts the newer `signature` field whether or not it is part of the signed text', () => {
    const withSig = fields({ signature: 'c2lnbmF0dXJl' });
    expect(verifyInitData(signInitData(withSig, SECRET), SECRET, NOW).ok).toBe(true);
    // Signed without `signature`, then `signature` appended (seen in some clients).
    const raw = `${signInitData(fields(), SECRET)}&signature=c2lnbmF0dXJl`;
    expect(verifyInitData(raw, SECRET, NOW).ok).toBe(true);
  });

  it('refuses old launches (a leaked string stops working) and launches from the future', () => {
    const old = signInitData(fields({ auth_date: String(nowS - 2 * 3600) }), SECRET);
    expect(verifyInitData(old, SECRET, NOW)).toEqual({ ok: false, reason: 'expired' });
    const future = signInitData(fields({ auth_date: String(nowS + 600) }), SECRET);
    expect(verifyInitData(future, SECRET, NOW)).toEqual({ ok: false, reason: 'future' });
  });

  it('refuses malformed input', () => {
    expect(verifyInitData('', SECRET, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyInitData(undefined, SECRET, NOW)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyInitData('user=x&auth_date=1', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyInitData('a'.repeat(5000), SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    // A field sent twice: two parsers could disagree on which one was signed.
    const dup = `${signInitData(fields(), SECRET)}&user=${encodeURIComponent('{"id":1}')}`;
    expect(verifyInitData(dup, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('refuses a signed launch without a user', () => {
    const raw = signInitData({ auth_date: String(nowS), chat_instance: '1' }, SECRET);
    expect(verifyInitData(raw, SECRET, NOW)).toEqual({ ok: false, reason: 'no_user' });
  });
});
