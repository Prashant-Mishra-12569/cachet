import type { Bot } from 'grammy';
import { ulidTime, type Seal } from '@cachet/shared/seal';
import type { KvStore } from '../infra/kv';
import type { SealRepo } from '../seals/repo';
import { SEAL_CHANNEL } from '../seals/service';
import { copy } from './copy';
import type { PeopleRepo } from './people-repo';

interface SealEvent {
  type: 'seal.issued' | 'seal.closed';
  sealId: string;
  phoneHash: string;
  /** seal.closed only: why it ended (e.g. 'completed', 'blocked_by_callee'). */
  reason?: string;
}

/** Where a seal card was sent, so it can be updated when the call ends or is replaced. */
interface CardRef {
  sealId: string;
  chatId: number;
  messageId: number;
  company: string;
  code: string;
  /** Milliseconds from the seal's creation (its ULID time) to Telegram accepting the card. */
  deliveredMs?: number;
}

export interface DeliveryDeps {
  bot: Bot;
  kv: KvStore;
  people: Pick<PeopleRepo, 'byPhoneHash'>;
  seals: Pick<SealRepo, 'get'>;
  webOrigin: string;
  /** https base of the Telegram Mini App; when set, cards open it (Details, Pay safely). */
  miniAppUrl?: string | undefined;
  now?: () => number;
  log?: Pick<Console, 'log' | 'error'>;
}

const DAY = 24 * 60 * 60;

/**
 * Sends the green seal card the moment a seal is issued (Redis pub/sub from the seal service),
 * and updates it when the call ends or a newer seal replaces it.
 */
export function createSealDelivery(deps: DeliveryDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  // Telegram only accepts public https links in buttons (not http://localhost).
  const detailsBase = deps.webOrigin.startsWith('https://') ? deps.webOrigin : null;

  /**
   * Buttons under the card. With the Mini App: [Pay €12.40 safely] [Details], opening INSIDE Telegram
   * (Telegram signs who opened it). Without it: a plain public Details link when the site is https.
   */
  function cardButtons(sealId: string, seal: Seal) {
    if (deps.miniAppUrl) {
      const row = [{ text: 'Details', web_app: { url: `${deps.miniAppUrl}/tg/seal/${sealId}` } }];
      if (seal.amount) {
        row.unshift({
          text: copy.payButton(seal.amount),
          web_app: { url: `${deps.miniAppUrl}/tg/pay/${sealId}` },
        });
      }
      return { reply_markup: { inline_keyboard: [row] } };
    }
    if (detailsBase) {
      return {
        reply_markup: { inline_keyboard: [[{ text: 'Details', url: `${detailsBase}/v/${sealId}` }]] },
      };
    }
    return {};
  }

  async function issued(ev: SealEvent) {
    const person = await deps.people.byPhoneHash(ev.phoneHash);
    if (!person) return; // this number isn't protected by Cachet (yet)
    const row = await deps.seals.get(ev.sealId);
    if (!row || row.status !== 'open') return;
    const seal = JSON.parse(row.sealJson) as Seal;
    const company = seal.company.legalName;

    // A newer seal from the same AI caller replaces the old card's code: say so, never leave two codes.
    const lastKey = `bot:lastcard:${ev.phoneHash}:${row.agentId}`;
    const previous = await deps.kv.get(lastKey);
    if (previous) {
      const prev = JSON.parse(previous) as CardRef;
      // Only if the old seal really was replaced: a call that already ended keeps its "Call ended" card.
      const prevRow = prev.sealId !== ev.sealId ? await deps.seals.get(prev.sealId) : null;
      if (prevRow?.status === 'superseded') {
        await deps.bot.api
          .editMessageText(prev.chatId, prev.messageId, copy.sealReplaced(prev.company), {
            parse_mode: 'HTML',
          })
          .catch(() => undefined);
      }
    }

    const sent = await deps.bot.api.sendMessage(
      person.chatId,
      copy.sealCard({
        company,
        message: seal.message,
        code: seal.code,
        ...(seal.amount ? { amount: seal.amount } : {}),
      }),
      { parse_mode: 'HTML', ...cardButtons(ev.sealId, seal) },
    );
    const ref: CardRef = {
      sealId: ev.sealId,
      chatId: person.chatId,
      messageId: sent.message_id,
      company,
      code: seal.code,
      // The ULID carries the creation time to the millisecond (issuedAt only has whole seconds).
      deliveredMs: now() - ulidTime(ev.sealId),
    };
    await deps.kv.set(`bot:card:${ev.sealId}`, JSON.stringify(ref), DAY);
    await deps.kv.set(lastKey, JSON.stringify(ref), DAY);
    log.log(`[bot] seal card delivered ${ref.deliveredMs} ms after the seal was created`);
  }

  async function closed(ev: SealEvent) {
    const raw = await deps.kv.get(`bot:card:${ev.sealId}`);
    if (!raw) return;
    const ref = JSON.parse(raw) as CardRef;
    await deps.bot.api
      .editMessageText(
        ref.chatId,
        ref.messageId,
        ev.reason === 'blocked_by_callee'
          ? copy.sealEndedBlocked(ref.company, ref.code)
          : copy.sealEnded(ref.company, ref.code),
        { parse_mode: 'HTML' },
      )
      .catch(() => undefined); // already edited / deleted by the person: fine
  }

  /** Handle one pub/sub message. Exposed for tests. */
  async function handle(raw: string) {
    let ev: SealEvent;
    try {
      ev = JSON.parse(raw) as SealEvent;
    } catch {
      return;
    }
    try {
      if (ev.type === 'seal.issued') await issued(ev);
      else if (ev.type === 'seal.closed') await closed(ev);
    } catch (err) {
      log.error('[bot] seal delivery failed:', err instanceof Error ? err.message : err);
    }
  }

  return {
    handle,
    start: () => deps.kv.subscribe(SEAL_CHANNEL, (raw) => void handle(raw)),
  };
}
