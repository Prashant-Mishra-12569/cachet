import { describe, expect, it, vi } from 'vitest';
import type { Update, UserFromGetMe } from 'grammy/types';
import { phoneHash, ulid } from '@cachet/shared/seal';
import { createMemoryAgentRepo } from '../agents/repo';
import { createMemoryBusinessRepo } from '../business/repo';
import { createMemoryKv } from '../infra/kv';
import { createMemorySealRepo } from '../seals/repo';
import { SEAL_CHANNEL } from '../seals/service';
import { createBot } from './bot';
import { createMemoryConsentsRepo } from './consents-repo';
import { createSealDelivery } from './delivery';
import { createMemoryFamilyRepo } from './family-repo';
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

function setup(webOrigin = 'http://localhost:3000', miniAppUrl?: string) {
  const clock = { t: Date.parse('2026-11-20T10:00:00Z') };
  const now = () => clock.t;
  const people = createMemoryPeopleRepo();
  const reports = createMemoryReportsRepo();
  const seals = createMemorySealRepo();
  const kv = createMemoryKv(now);
  const cipher = createPhoneCipher(KEY);
  const family = createMemoryFamilyRepo((id) => people.byId(id));
  const consents = createMemoryConsentsRepo();
  const businesses = createMemoryBusinessRepo();
  const agents = createMemoryAgentRepo();
  const bot = createBot(
    '123:TEST',
    {
      people,
      reports,
      seals,
      family,
      consents,
      businesses,
      agents,
      kv,
      // What the seal service's endForCallee does (tested in seals.test.ts): close + tell the bot.
      endSealsFrom: async (hash, businessId) => {
        const open = (await seals.openForPhone(hash, new Date(clock.t))).filter(
          (r) => r.businessId === businessId,
        );
        for (const r of open) {
          await seals.close(r.id, r.agentId, new Date(clock.t), 'blocked_by_callee', {
            kind: 'seal_closed',
            refId: r.id,
            itemHash: `closed-${r.id}`,
          });
          await delivery.handle(
            JSON.stringify({
              type: 'seal.closed',
              sealId: r.id,
              phoneHash: hash,
              reason: 'blocked_by_callee',
            }),
          );
        }
        return open.length;
      },
      phoneCipher: cipher,
      phonePepper: PEPPER,
      now,
    },
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
    network: 'testnet',
    miniAppUrl,
    now,
    log: { log: () => undefined, error: () => undefined },
  });

  let updateId = 1;
  /** `as` = which Telegram user sends it (their private chat id equals their user id). */
  const base = (chatType = 'private', as = USER, name = 'P') => ({
    message_id: updateId,
    date: 0,
    chat:
      chatType === 'private'
        ? { id: as, type: 'private', first_name: name }
        : { id: -5, type: 'group', title: 'G' },
    from: { id: as, is_bot: false, first_name: name },
  });
  const send = (u: Record<string, unknown>) =>
    bot.handleUpdate({ update_id: updateId++, ...u } as unknown as Update);
  const command = (text: string, chatType?: string, as = USER, name = 'P') =>
    send({
      message: {
        ...base(chatType, as, name),
        text,
        entities: [{ type: 'bot_command', offset: 0, length: text.split(' ')[0]?.length ?? text.length }],
      },
    });
  const contact = (userId: number, phone = '919336124858', as = USER) =>
    send({
      message: { ...base('private', as), contact: { phone_number: phone, first_name: 'P', user_id: userId } },
    });
  const tap = (data: string, as = USER) =>
    send({
      callback_query: {
        id: `cb${updateId}`,
        from: { id: as, is_bot: false, first_name: 'P' },
        chat_instance: 'ci',
        data,
        message: { message_id: 50, date: 0, chat: { id: as, type: 'private', first_name: 'P' }, text: 'x' },
      },
    });

  /** Put an open seal for NUMBER into the memory repo (as the seal service would). */
  async function openSeal(
    company = 'Northwind Energy BV',
    code = '4721',
    agentId = 'agent-1',
    businessId = 'biz',
  ) {
    const id = ulid(clock.t);
    seals.credits.set(agentId, 1);
    const issuedAt = Math.floor(clock.t / 1000);
    await seals.issue(
      {
        id,
        agentId,
        businessId,
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
          purpose: 'billing',
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

  /** End a seal the way the seal service does (in the database). */
  const closeSeal = (id: string, reason = 'completed', agentId = 'agent-1') =>
    seals.close(id, agentId, new Date(clock.t), reason, {
      kind: 'seal_closed',
      refId: id,
      itemHash: `c-${id}`,
    });

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
    closeSeal,
    delivery,
    family,
    consents,
    businesses,
    agents,
    /** Messages sent to one chat. */
    to: (chatId: number) =>
      sent()
        .filter((c) => c.payload['chat_id'] === chatId)
        .map((c) => String(c.payload['text'])),
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
    await t.closeSeal(id);
    await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev }));
    const edit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(String(edit?.payload['text'])).toContain('Call ended.');
    // A repeated event (or the sweep) never edits it again.
    await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev }));
    await t.delivery.sweep();
    expect(t.calls.filter((c) => c.method === 'editMessageText')).toHaveLength(1);
  });

  it('a call that ends while its card is still on the way gets the card ended right after (race)', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal();
    const ev = { sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) };
    // The "ended" event arrives first (no card yet), then the card is delivered.
    await t.closeSeal(id);
    await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev }));
    await t.delivery.handle(JSON.stringify({ type: 'seal.issued', ...ev }));
    // Closed before delivery: no green card is sent at all.
    expect(t.sent()).toHaveLength(1); // only the "You're protected" reply
  });

  it('a call that ends during sending: the card is ended as soon as it exists', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal();
    const ev = { sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) };
    // Close the seal at the moment Telegram accepts the card (before the bot stores it).
    t.bot.api.config.use(async (prev, method, payload, signal) => {
      const res = await prev(method, payload, signal);
      if (method === 'sendMessage' && String((payload as { text?: string }).text).includes('Verified call')) {
        await t.closeSeal(id);
        await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev })); // finds no card yet
      }
      return res;
    });
    await t.delivery.handle(JSON.stringify({ type: 'seal.issued', ...ev }));
    const edits = t.calls.filter((c) => c.method === 'editMessageText');
    expect(edits).toHaveLength(1);
    expect(String(edits[0]?.payload['text'])).toContain('Call ended.');
  });

  it('the sweep ends cards whose seal expired (no "call ended" ever came)', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal();
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    expect(await t.delivery.sweep()).toEqual({ delivered: 0, ended: 0 }); // still valid
    t.clock.t += 15 * 60 * 1000 + 1000;
    expect(await t.delivery.sweep()).toEqual({ delivered: 0, ended: 1 });
    const edit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(String(edit?.payload['text'])).toContain('has expired. (Code was 47-21.)');
  });

  it('the sweep delivers a card whose live event was lost (server restart), exactly once', async () => {
    const t = setup();
    await t.contact(USER);
    await t.openSeal(); // no event delivered
    expect(await t.delivery.sweep()).toEqual({ delivered: 1, ended: 0 });
    expect(await t.delivery.sweep()).toEqual({ delivered: 0, ended: 0 });
    expect(t.sent().filter((c) => String(c.payload['text']).includes('Verified call'))).toHaveLength(1);
  });

  it('the live event and the sweep at the same moment still send only one card', async () => {
    const t = setup();
    await t.contact(USER);
    const id = await t.openSeal();
    await Promise.all([
      t.delivery.handle(
        JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
      ),
      t.delivery.sweep(),
    ]);
    expect(t.sent().filter((c) => String(c.payload['text']).includes('Verified call'))).toHaveLength(1);
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

  it('after a safe payment: one receipt with an explorer link, and the Pay button is removed', async () => {
    const t = setup('http://localhost:3000', 'https://tg.cachet.example');
    await t.contact(USER);
    const id = await t.openSeal();
    const ev = { sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) };
    await t.delivery.handle(JSON.stringify({ type: 'seal.issued', ...ev }));
    const paid = JSON.stringify({ type: 'seal.paid', ...ev, txHash: 'ab'.repeat(32) });
    await t.delivery.handle(paid);
    await t.delivery.handle(paid); // repeated event: no second receipt
    const receipts = t.sent().filter((c) => String(c.payload['text']).startsWith('✅ Paid'));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.payload['text']).toBe(
      '✅ Paid €12.40 (test euro) to <b>Northwind Energy BV</b>.\nNo fee for you: Cachet covered it.',
    );
    expect(JSON.stringify(receipts[0]?.payload['reply_markup'])).toContain(
      `ccdexplorer.io/testnet/transaction/${'ab'.repeat(32)}`,
    );
    const markup = t.calls.find((c) => c.method === 'editMessageReplyMarkup');
    expect(markup?.payload['reply_markup']).toEqual({
      inline_keyboard: [[{ text: 'Details', web_app: { url: `https://tg.cachet.example/tg/seal/${id}` } }]],
    });
  });

  it('a call that already ended keeps its "Call ended" card when a new call comes later', async () => {
    const t = setup();
    await t.contact(USER);
    const first = await t.openSeal('Northwind Energy BV', '4721');
    const ev = { sealId: first, phoneHash: phoneHash(PEPPER, NUMBER) };
    await t.delivery.handle(JSON.stringify({ type: 'seal.issued', ...ev }));
    await t.seals.close(first, 'agent-1', new Date(t.clock.t), 'completed', {
      kind: 'seal_closed',
      refId: first,
      itemHash: 'x',
    });
    await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev }));
    t.clock.t += 60_000;
    const second = await t.openSeal('Northwind Energy BV', '5830');
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: second, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    const edits = t.calls.filter((c) => c.method === 'editMessageText').map((c) => String(c.payload['text']));
    expect(edits).toHaveLength(1);
    expect(edits[0]).toContain('Call ended.');
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

  it('with the Mini App: [Pay €12.40 safely] [Details] open inside Telegram; gone when the call ends', async () => {
    const t = setup('http://localhost:3000', 'https://tg.cachet.example');
    await t.contact(USER);
    const id = await t.openSeal();
    const ev = { sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) };
    await t.delivery.handle(JSON.stringify({ type: 'seal.issued', ...ev }));
    expect(t.sent().at(-1)?.payload['reply_markup']).toEqual({
      inline_keyboard: [
        [
          { text: 'Pay €12.40 safely', web_app: { url: `https://tg.cachet.example/tg/pay/${id}` } },
          { text: 'Details', web_app: { url: `https://tg.cachet.example/tg/seal/${id}` } },
        ],
      ],
    });
    await t.closeSeal(id);
    await t.delivery.handle(JSON.stringify({ type: 'seal.closed', ...ev }));
    const edit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(edit).toBeDefined();
    // Editing without reply_markup removes the buttons: no Pay button on an ended call.
    expect(edit?.payload).not.toHaveProperty('reply_markup');
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

const MOM = 888;
const MOM_NUMBER = '919000000001';

/** Guardian (USER) creates an invite for "Mom"; returns the deep-link token. */
async function invite(t: ReturnType<typeof setup>, label = 'Mom') {
  await t.contact(USER);
  await t.command(`/family ${label}`);
  const text = t.lastText();
  const token = /start=fam_([A-Za-z0-9_-]+)/.exec(text)?.[1];
  if (!token) throw new Error(`no invite link in: ${text}`);
  return token;
}

/** Mom opens the link (registering first), and taps Allow. */
async function momAccepts(t: ReturnType<typeof setup>, token: string) {
  await t.command(`/start fam_${token}`, 'private', MOM, 'Mom');
  await t.contact(MOM, MOM_NUMBER, MOM);
  const ask = t
    .sent()
    .filter((c) => c.payload['chat_id'] === MOM)
    .at(-1);
  const data = (
    ask?.payload['reply_markup'] as { inline_keyboard: { callback_data: string }[][] } | undefined
  )?.inline_keyboard[0]?.[0]?.callback_data;
  if (!data) throw new Error('no Allow button');
  await t.tap(data, MOM);
  return data;
}

describe('/family: protect someone, with their consent', () => {
  it('explains how, when nobody is linked yet', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/family');
    expect(t.lastText()).toContain('/family Mom');
  });

  it('gives a one-time invite link; only a HASH of the token is stored', async () => {
    const t = setup();
    const token = await invite(t);
    expect(t.lastText()).toContain(`https://t.me/CachetSealBot?start=fam_${token}`);
    const row = [...t.family.rows.values()][0];
    expect(row?.inviteTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.inviteTokenHash).not.toContain(token);
  });

  it.each(['<b>x</b>', 'a'.repeat(31), '   '])('refuses the label %j', async (label) => {
    const t = setup();
    await t.contact(USER);
    await t.command(`/family ${label}`);
    expect(t.lastText()).toMatch(/short name|\/family Mom/);
    expect(t.family.rows.size).toBe(0);
  });

  it('a new person opening the link registers first, then is asked; Allow links them', async () => {
    const t = setup();
    const token = await invite(t);
    await momAccepts(t, token);
    expect(t.to(MOM).some((m) => m.includes('<b>P</b> wants an alert'))).toBe(true);
    const edits = t.calls.filter((c) => c.method === 'editMessageText').map((c) => String(c.payload['text']));
    expect(edits.at(-1)).toContain('will get an alert');
    expect(t.to(USER).at(-1)).toContain('<b>Mom</b> said yes');
  });

  it('alerts the guardian when Mom checks a call that is NOT verified', async () => {
    const t = setup();
    await momAccepts(t, await invite(t));
    await t.command('/check', 'private', MOM, 'Mom');
    expect(t.to(MOM).at(-1)).toContain('Not verified');
    expect(t.to(USER).at(-1)).toContain('<b>Mom</b> just checked a call that is NOT verified');
  });

  it('no alert when Mom has a verified call (green)', async () => {
    const t = setup();
    await momAccepts(t, await invite(t));
    const before = t.to(USER).length;
    // A seal for Mom's number:
    const id = ulid(t.clock.t);
    t.seals.credits.set('agent-1', 1);
    await t.seals.issue(
      {
        id,
        agentId: 'agent-1',
        businessId: 'biz',
        phoneHash: phoneHash(PEPPER, `+${MOM_NUMBER}`),
        fromE164: '+31201234567',
        purpose: 'billing',
        message: 'Bill',
        code: '4721',
        issuedAt: new Date(t.clock.t),
        expiresAt: new Date(t.clock.t + 900_000),
        sealJson: JSON.stringify({
          company: { legalName: 'Northwind Energy BV' },
          code: '4721',
          purpose: 'billing',
        }),
        sealHash: id,
      },
      { kind: 'seal', refId: id, itemHash: id },
    );
    await t.command('/check', 'private', MOM, 'Mom');
    expect(t.to(MOM).at(-1)).toContain('has a verified call to you right now');
    expect(t.to(USER).length).toBe(before);
  });

  it('limits alerts to 3 per 10 minutes (no alert storms)', async () => {
    const t = setup();
    await momAccepts(t, await invite(t));
    for (let i = 0; i < 5; i++) await t.command('/check', 'private', MOM, 'Mom');
    expect(t.to(USER).filter((m) => m.includes('NOT verified'))).toHaveLength(3);
  });

  it('an invite works only once', async () => {
    const t = setup();
    const token = await invite(t);
    await momAccepts(t, token);
    const STRANGER = 999;
    await t.contact(STRANGER, '919000000002', STRANGER);
    await t.command(`/start fam_${token}`, 'private', STRANGER);
    expect(t.to(STRANGER).at(-1)).toContain('expired or was already used');
  });

  it('an invite expires after 24 hours', async () => {
    const t = setup();
    const token = await invite(t);
    t.clock.t += 24 * 60 * 60 * 1000 + 1;
    await t.contact(MOM, MOM_NUMBER, MOM);
    await t.command(`/start fam_${token}`, 'private', MOM, 'Mom');
    expect(t.to(MOM).at(-1)).toContain('expired or was already used');
  });

  it('opening your own invite does nothing', async () => {
    const t = setup();
    const token = await invite(t);
    await t.command(`/start fam_${token}`);
    expect(t.lastText()).toContain("That's your own invite link");
  });

  it('a forged "Allow" (never shown the invite) links nothing', async () => {
    const t = setup();
    await invite(t);
    const inviteId = [...t.family.rows.keys()][0] ?? '';
    await t.contact(MOM, MOM_NUMBER, MOM);
    await t.tap(`fam:ok:${inviteId}`, MOM);
    expect([...t.family.rows.values()][0]?.wardPersonId).toBeNull();
    expect(t.to(MOM).at(-1)).toContain('expired or was already used');
  });

  it('either side can remove the link, and the other side is told', async () => {
    const t = setup();
    await momAccepts(t, await invite(t));
    await t.command('/family', 'private', MOM, 'Mom');
    const list = t
      .sent()
      .filter((c) => c.payload['chat_id'] === MOM)
      .at(-1);
    expect(String(list?.payload['text'])).toContain('Protecting you: <b>P</b>');
    const rm = (list?.payload['reply_markup'] as { inline_keyboard: { callback_data: string }[][] })
      .inline_keyboard[0]?.[0]?.callback_data;
    await t.tap(rm ?? '', MOM);
    expect(t.to(USER).at(-1)).toContain('<b>Mom</b> stopped sharing call alerts with you.');
    expect(await t.family.linksOf([...t.people.rows.values()][0]?.id ?? '')).toHaveLength(0);
  });

  it('at most 5 people per guardian', async () => {
    const t = setup();
    await t.contact(USER);
    for (let i = 0; i < 5; i++) await t.command(`/family Person${i}`);
    await t.command('/family Sixth');
    expect(t.lastText()).toContain('up to 5 people');
  });
});

describe('/history', () => {
  it('lists recent sealed calls in plain words', async () => {
    const t = setup();
    await t.contact(USER);
    await t.openSeal('Northwind Energy BV');
    await t.command('/history');
    expect(t.lastText()).toContain('• <b>Northwind Energy BV</b> · Billing · just now · in progress');
  });

  it('says so when there are none', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/history');
    expect(t.lastText()).toBe('No sealed calls yet.');
  });
});

describe('/company', () => {
  async function withCompany(neverCalls = false) {
    const t = setup();
    const biz = await t.businesses.upsertVerified({
      concordiumAccount: '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa',
      legalName: neverCalls ? 'Demo Exchange (demo)' : 'Northwind Energy BV',
      legalCountry: 'NL',
      issuer: 'did:ccd:testnet:idp:4',
      proofTx: 'a'.repeat(64),
      requestTx: 'b'.repeat(64),
      verifiedAt: new Date(),
    });
    if (neverCalls) (biz as { neverCalls: boolean }).neverCalls = true;
    const agent = await t.agents.create({
      businessId: biz.id,
      name: 'Billing assistant',
      description: 'x',
      purposes: ['billing'],
      language: 'en',
      callingNumbers: ['+31201234567'],
      agentAccount: '33Rcud5xa7UZT3JQawDw9rhp5X14H8MPmfGR9E1uHQ59mr1jVq',
    });
    await t.agents.transition(agent.id, 'draft', { status: 'active' });
    return { t, biz };
  }

  it('shows a verified company and the numbers its AI calls from', async () => {
    const { t } = await withCompany();
    await t.command('/company north');
    expect(t.lastText()).toContain('✅ <b>Northwind Energy BV</b> (NL) is a verified company.');
    expect(t.lastText()).toContain('Billing assistant (calls from +31201234567)');
  });

  it('says clearly when a company is unknown', async () => {
    const { t } = await withCompany();
    await t.command('/company Binance');
    expect(t.lastText()).toContain('I don\'t know a verified company called "Binance"');
  });

  it('a company that never calls → scam warning', async () => {
    const { t } = await withCompany(true);
    await t.command('/company demo exchange');
    expect(t.lastText()).toContain('has told Cachet it never makes AI calls');
  });

  it('asks for a name when none is given', async () => {
    const { t } = await withCompany();
    await t.command('/company');
    expect(t.lastText()).toContain('/company Northwind');
  });
});

describe('/consent: who may call me', () => {
  it('lists companies that sealed calls to you; Block and Allow work', async () => {
    const t = setup();
    await t.contact(USER);
    const biz = await t.businesses.upsertVerified({
      concordiumAccount: '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa',
      legalName: 'Northwind Energy BV',
      legalCountry: 'NL',
      issuer: 'x',
      proofTx: 'a'.repeat(64),
      requestTx: 'b'.repeat(64),
      verifiedAt: new Date(),
    });
    await t.openSeal('Northwind Energy BV', '4721', 'agent-1', biz.id);
    await t.command('/consent');
    expect(t.lastText()).toContain('• <b>Northwind Energy BV</b>: not set');
    await t.tap(`cons:block:${biz.id}`);
    expect(await t.consents.statusFor(phoneHash(PEPPER, NUMBER), biz.id)).toBe('revoked');
    expect(t.lastText()).toContain('can no longer get a seal to call you');
    // The list updates in place: now "blocked", and only the Allow (undo) button is left.
    const edit = t.calls.filter((c) => c.method === 'editMessageText').at(-1);
    expect(String(edit?.payload['text'])).toContain('• <b>Northwind Energy BV</b>: blocked');
    expect(JSON.stringify(edit?.payload['reply_markup'])).toContain(`cons:allow:${biz.id}`);
    expect(JSON.stringify(edit?.payload['reply_markup'])).not.toContain('cons:block:');
    await t.tap(`cons:allow:${biz.id}`);
    expect(await t.consents.statusFor(phoneHash(PEPPER, NUMBER), biz.id)).toBe('granted');
  });

  it('blocking during an open call ends that call: card updated, /check turns red', async () => {
    const t = setup();
    await t.contact(USER);
    const biz = await t.businesses.upsertVerified({
      concordiumAccount: '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa',
      legalName: 'Northwind Energy BV',
      legalCountry: 'NL',
      issuer: 'x',
      proofTx: 'a'.repeat(64),
      requestTx: 'b'.repeat(64),
      verifiedAt: new Date(),
    });
    const id = await t.openSeal('Northwind Energy BV', '4721', 'agent-1', biz.id);
    await t.delivery.handle(
      JSON.stringify({ type: 'seal.issued', sealId: id, phoneHash: phoneHash(PEPPER, NUMBER) }),
    );
    await t.command('/check');
    expect(t.lastText()).toContain('has a verified call to you right now');

    await t.tap(`cons:block:${biz.id}`);
    expect(t.lastText()).toContain('Their open verified call to you is now ended.');
    const cardEdit = t.calls.find(
      (c) => c.method === 'editMessageText' && String(c.payload['text']).startsWith('Ended. You blocked'),
    );
    expect(cardEdit).toBeDefined();
    await t.command('/check');
    expect(t.lastText()).toContain('Not verified');
  });

  it('tapping an old button twice does not record the same choice twice', async () => {
    const t = setup();
    await t.contact(USER);
    const biz = await t.businesses.upsertVerified({
      concordiumAccount: '3tCvWPDYchFULvGXKc6Q3MzofopAgMzzL3KeRU66G2dM2LqcNa',
      legalName: 'Northwind Energy BV',
      legalCountry: 'NL',
      issuer: 'x',
      proofTx: 'a'.repeat(64),
      requestTx: 'b'.repeat(64),
      verifiedAt: new Date(),
    });
    await t.openSeal('Northwind Energy BV', '4721', 'agent-1', biz.id);
    const set = vi.spyOn(t.consents, 'set');
    await t.tap(`cons:block:${biz.id}`);
    await t.tap(`cons:block:${biz.id}`);
    expect(set).toHaveBeenCalledTimes(1);
  });

  it("can't block or allow a company that never called you", async () => {
    const t = setup();
    await t.contact(USER);
    await t.tap('cons:block:00000000-0000-0000-0000-000000000000');
    expect(t.consents.rows.size).toBe(0);
  });

  it('says so when no company has called yet', async () => {
    const t = setup();
    await t.contact(USER);
    await t.command('/consent');
    expect(t.lastText()).toContain('No company has sealed a call to you yet');
  });
});
