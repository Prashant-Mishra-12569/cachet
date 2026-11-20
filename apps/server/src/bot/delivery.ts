import type { Bot } from 'grammy';
import type { Seal } from '@cachet/shared/seal';
import type { KvStore } from '../infra/kv';
import type { SealRepo } from '../seals/repo';
import { SEAL_CHANNEL } from '../seals/service';
import { copy } from './copy';
import type { PeopleRepo } from './people-repo';

interface SealEvent {
  type: 'seal.issued' | 'seal.closed';
  sealId: string;
  phoneHash: string;
}

/** Where a seal card was sent, so it can be updated when the call ends or is replaced. */
interface CardRef {
  sealId: string;
  chatId: number;
  messageId: number;
  company: string;
  code: string;
}

export interface DeliveryDeps {
  bot: Bot;
  kv: KvStore;
  people: Pick<PeopleRepo, 'byPhoneHash'>;
  seals: Pick<SealRepo, 'get'>;
  webOrigin: string;
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
      if (prev.sealId !== ev.sealId) {
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
      {
        parse_mode: 'HTML',
        ...(detailsBase
          ? {
              reply_markup: {
                inline_keyboard: [[{ text: 'Details', url: `${detailsBase}/v/${ev.sealId}` }]],
              },
            }
          : {}),
      },
    );
    const ref: CardRef = {
      sealId: ev.sealId,
      chatId: person.chatId,
      messageId: sent.message_id,
      company,
      code: seal.code,
    };
    await deps.kv.set(`bot:card:${ev.sealId}`, JSON.stringify(ref), DAY);
    await deps.kv.set(lastKey, JSON.stringify(ref), DAY);
    log.log(`[bot] seal card delivered ${now() - seal.issuedAt * 1000} ms after issue`);
  }

  async function closed(ev: SealEvent) {
    const raw = await deps.kv.get(`bot:card:${ev.sealId}`);
    if (!raw) return;
    const ref = JSON.parse(raw) as CardRef;
    await deps.bot.api
      .editMessageText(ref.chatId, ref.messageId, copy.sealEnded(ref.company, ref.code), {
        parse_mode: 'HTML',
      })
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
