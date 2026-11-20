import { describe, expect, it } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import { phoneHash, ulid } from '@cachet/shared/seal';
import { createMemoryKv } from '../infra/kv';
import { createMemorySealRepo } from '../seals/repo';
import { SEAL_CHANNEL } from '../seals/service';
import { createBot } from './bot';
import { createSealDelivery } from './delivery';
import { createMemoryPeopleRepo } from './people-repo';
import { createPhoneCipher } from './phone-crypto';
import { createMemoryReportsRepo } from './reports-repo';

const USER = 777;
const CHAT = 777;
const NUMBER = '+919336124858';
const PEPPER = 'test-pepper-0123456789abcdef0123456789';
const KEY = 'ab'.repeat(32);
const botInfo = {
  id: 1,
  is_bot: true,
  first_name: 'Cachet',
  username: 'CachetSealBot',
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
} as unknown as UserFromGetMe;

type Call = { method: string; payload: Record<string, unknown> };

function setup(webOrigin = 'http://localhost:3000') {
  const clock = { t: Date.parse('2026-11-20T10:00:00Z') };
  const now = () => clock.t;
  const people = createMemoryPeopleRepo();
  const reports = createMemoryReportsRepo();
  const seals = createMemorySealRepo();
  const kv = createMemoryKv(now);
  const cipher = createPhoneCipher(KEY);
  const bot = createBot(
    '123:TEST',
    { people, reports, seals, kv, phoneCipher: cipher, phonePepper: PEPPER, now },
    { botInfo },
  );
  const calls: Call[] = [];
  let messageId = 100;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result =
      method === 'sendMessage'
        ? {
            message_id: ++messageId,
            date: 0,
            chat: { id: (payload as { chat_id: number }).chat_id, type: 'private' },
            text: '',
          }
        : true;
    return { ok: true, result } as never;
  });
  const delivery = createSealDelivery({
    bot,
    kv,
    people,
    seals,
    webOrigin,
    now,
    log: { log: () => undefined, error: () => undefined },
  });

  let updateId = 1;
  const base = (chatType = 'private') => ({
    message_id: updateId,
    date: 0,
    chat:
      chatType === 'private'
        ? { id: CHAT, type: 'private', first_name: 'P' }
        : { id: -5, type: 'group', title: 'G' },
    from: { id: USER, is_bot: false, first_name: 'P' },
  });
  const send = (u: Record<string, unknown>) =>
    bot.handleUpdate({ update_id: updateId++, ...u } as unknown as Update);
  const command = (text: string, chatType?: string) =>
    send({
      message: {
        ...base(chatType),
        text,
        entities: [{ type: 'bot_command', offset: 0, length: text.length }],
      },
    });
  const contact = (userId: number, phone = '919336124858') =>
    send({ message: { ...base(), contact: { phone_number: phone, first_name: 'P', user_id: userId } } });
  const tap = (data: string) =>
    send({
      callback_query: {
        id: `cb${updateId}`,
        from: { id: USER, is_bot: false, first_name: 'P' },
        chat_instance: 'ci',
        data,
        message: { message_id: 50, date: 0, chat: { id: CHAT, type: 'private', first_name: 'P' }, text: 'x' },
      },
    });

  /** Put an open seal for NUMBER into the memory repo (as the seal service would). */
  async function openSeal(company = 'Northwind Energy BV', code = '4721', agentId = 'agent-1') {
    const id = ulid(clock.t);
    seals.credits.set(agentId, 1);
    const issuedAt = Math.floor(clock.t / 1000);
    await seals.issue(
      {
        id,
        agentId,
        businessId: 'biz',
        phoneHash: phoneHash(PEPPER, NUMBER),
        fromE164: '+31201234567',
        purpose: 'billing',
        message: 'Your November bill is ready',
        code,
        issuedAt: new Date(issuedAt * 1000),
        expiresAt: new Date((issuedAt + 900) * 1000),
        sealJson: JSON.stringify({
          id,
          company: { legalName: company },
          message: 'Your November bill is ready',
          code,
          issuedAt,
          amount: { value: '12.40', asset: 'EUDemo' },
        }),
        sealHash: id,
      },
      { kind: 'seal', refId: id, itemHash: id },
    );
    return id;
  }

  const sent = () => calls.filter((c) => c.method === 'sendMessage');
  const lastText = () => String(sent().at(-1)?.payload['text'] ?? '');
  return {
    bot,
    calls,
    sent,
    lastText,
    command,
    contact,
    tap,
    people,
    reports,
    seals,
    kv,
    cipher,
    clock,
    openSeal,
    delivery,
  };
}

describe('joining (/start + sharing your number)', () => {
  it('asks a new person to share their number with a button', async () => {
    const t = setup();
    await t.command('/start');
    expect(t.lastText()).toContain('Share your number to begin');
    const markup = t.sent().at(-1)?.payload['reply_markup'] as {
      keyboard: { request_contact?: boolean }[][];
    };
    expect(markup.keyboard[0]?.[0]?.request_contact).toBe(true);
  });

  it("refuses someone else's contact (you can only protect your own number)", async () => {
    const t = setup();
    await t.contact(999);
    expect(t.lastText()).toContain('your own');
    expect(t.people.rows.size).toBe(0);
  });

  it('stores your number only encrypted + fingerprinted, and confirms', async () => {
    const t = setup();
    await t.contact(USER); // Telegram often sends the number without "+"
    const p = t.people.rows.get(USER);
    expect(p?.phoneHash).toBe(phoneHash(PEPPER, NUMBER));
    expect(p?.phoneEnc).not.toContain('9336124858');
    expect(t.cipher.decrypt(p?.phoneEnc ?? '')).toBe(NUMBER);
    expect(t.lastText()).toContain("You're protected");
    expect(t.sent().at(-1)?.payload['reply_markup']).toEqual({ remove_keyboard: true });
  });

  it('greets a registered person as protected', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/start');
    expect(t.lastText()).toContain("You're protected");
  });

  it('ignores group chats (never reveals anything there)', async () => {
    const t = setup();
    await t.command('/start', 'group');
    expect(t.lastText()).toBe('I only work in a private chat.');
    expect(t.people.rows.size).toBe(0);
  });
});

describe('/check ("Is this call real?")', () => {
  it('asks unregistered people to share their number first', async () => {
    const t = setup();
    await t.command('/check');
    expect(t.lastText()).toContain('Share your number first');
  });

  it('red card when no verified company is calling, with a Report button', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/check');
    expect(t.lastText()).toContain('Not verified');
    expect(t.lastText()).toContain("Don't pay. Don't share OTPs. Hang up.");
    const markup = t.sent().at(-1)?.payload['reply_markup'] as {
      inline_keyboard: { callback_data: string }[][];
    };
    expect(markup.inline_keyboard[0]?.[0]?.callback_data).toBe('report');
  });

  it('green with the company and code when a seal is open', async () => {
    const t = setup();
    await t.contact(USER);
    await t.openSeal('Northwind Energy BV', '4721');
    await t.command('/check');
    expect(t.lastText()).toContain('<b>Northwind Energy BV</b> has a verified call to you right now.');
    expect(t.lastText()).toContain('<b>47-21</b>');
    expect(t.lastText()).toContain("If the caller says a different company or code, it's a scam.");
  });

  it('a closed seal is never green', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal();
    await t.seals.close(id, 'agent-1', new Date(t.clock.t), 'completed', {
      kind: 'seal_closed',
      refId: id,
      itemHash: `c${id}`,
    });
    await t.command('/check');
    expect(t.lastText()).toContain('Not verified');
  });

  it('an expired seal is never green', async () => {
    const t = setup();
    await t.contact(USER);
    await t.openSeal();
    t.clock.t += 15 * 60 * 1000 + 1;
    await t.command('/check');
    expect(t.lastText()).toContain('Not verified');
  });

  it('limits checks to 10 per 10 minutes', async () => {
    const t = setup();
    await t.contact(USER);
    for (let i = 0; i < 10; i++) await t.command('/check');
    await t.command('/check');
    expect(t.lastText()).toContain('Too many checks');
  });

  it('Report saves a report (anonymous on chain) and thanks the person', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/check');
    await t.tap('report');
    expect(t.reports.rows).toHaveLength(1);
    expect(t.reports.rows[0]).toMatchObject({
      reason: 'unverified_call',
      phoneHash: phoneHash(PEPPER, NUMBER),
    });
    expect(t.lastText()).toContain('Your report is saved');
  });
});

describe('/stop deletes your data', () => {
  it('asks first, then deletes everything', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/stop');
    expect(t.lastText()).toContain('Delete your data?');
    await t.tap('stop:yes');
    expect(t.people.rows.size).toBe(0);
    const edits = t.calls.filter((c) => c.method === 'editMessageText');
    expect(String(edits.at(-1)?.payload['text'])).toContain('Your data is deleted');
  });

  it('"Keep" changes nothing', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/stop');
    await t.tap('stop:no');
    expect(t.people.rows.size).toBe(1);
  });
});

describe('live seal cards', () => {
  it('sends the green card with company, reason, amount and code the moment a seal is issued', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal('Northwind Energy BV', '4721');
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    const card = t.sent().at(-1);
    expect(card?.payload['chat_id']).toBe(CHAT);
    expect(String(card?.payload['text'])).toBe(
      [
        '✅ <b>Verified call</b>',
        '<b>Northwind Energy BV</b> is calling you with an AI assistant.',
        'Reason: Your November bill is ready',
        'Amount: €12.40 (test euro)',
        'Your code: <b>47-21</b>',
      ].join('\n'),
    );
  });

  it('no card for a number that is not protected by Cachet', async () => {
    const t = setup();
    const id = await t.openSeal();
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    expect(t.sent()).toHaveLength(0);
  });

  it('updates the card to "Call ended" when the call ends', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal();
    const ev = { sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) };
    await t.delivery.handle(JSON.stringify({ type: 'seal.issued', ...ev }));
    await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev }));
    const edit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(String(edit?.payload['text'])).toContain('Call ended.');
  });

  it('a newer seal from the same caller replaces the old card (never two codes)', async () => {
    const t = setup();
    await t.contact(USER);
    const first = await t.openSeal('Northwind Energy BV', '4721');
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: first, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    t.clock.t += 1000;
    const second = await t.openSeal('Northwind Energy BV', '5830');
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: second, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    const edit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(String(edit?.payload['text'])).toContain('Replaced by a newer call');
    expect(t.lastText()).toContain('58-30');
  });

  it('escapes company names (no HTML injection into the card)', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal('<a href="https://evil">Bank</a>');
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    expect(t.lastText()).toContain('&lt;a href="https://evil"&gt;Bank&lt;/a&gt;');
    expect(t.lastText()).not.toContain('<a href');
  });

  it('adds a Details button only for a public https website', async () => {
    const local = setup('http://localhost:3000');
    await local.contact(USER);
    const id1 = await local.openSeal();
    await local.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id1, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    expect(local.sent().at(-1)?.payload['reply_markup']).toBeUndefined();

    const live = setup('https://cachet.example');
    await live.contact(USER);
    const id2 = await live.openSeal();
    await live.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id2, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    expect(live.sent().at(-1)?.payload['reply_markup']).toEqual({
      inline_keyboard: [[{ text: 'Details', url: `https://cachet.example/v/${id2}` }]],
    });
  });

  it('is wired to the seal channel (pub/sub)', async () => {
    const t = setup();
    await t.contact(USER);
    await t.delivery.start();
    const id = await t.openSeal();
    await t.kv.publish(
      SEAL_CHANNEL,
      JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(t.lastText()).toContain('Verified call');
  });
});

describe('phone encryption', () => {
  it('detects tampering', () => {
    const c = createPhoneCipher(KEY);
    const blob = c.encrypt(NUMBER);
    const raw = Buffer.from(blob, 'base64url');
    raw[14] = (raw[14] ?? 0) ^ 1;
    expect(() => c.decrypt(raw.toString('base64url'))).toThrow();
  });

  it('never produces the same ciphertext twice', () => {
    const c = createPhoneCipher(KEY);
    expect(c.encrypt(NUMBER)).not.toBe(c.encrypt(NUMBER));
  });
});
