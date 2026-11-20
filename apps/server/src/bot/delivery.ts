import { GrammyError, type Bot } from 'grammy';
import { explorerTxUrl, type Network } from '@cachet/shared';
import { ulidTime, type Seal } from '@cachet/shared/seal';
import type { KvStore } from '../infra/kv';
import type { SealRepo, SealRow } from '../seals/repo';
import { SEAL_CHANNEL } from '../seals/service';
import { copy } from './copy';
import type { PeopleRepo } from './people-repo';

interface SealEvent {
  type: 'seal.issued' | 'seal.closed' | 'seal.paid';
  sealId: string;
  phoneHash: string;
  /** seal.closed only: why it ended (e.g. 'completed', 'blocked_by_callee'). */
  reason?: string;
  /** seal.paid only. */
  txHash?: string;
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
  /** The card already shows how the call ended: never edit it again. */
  final?: boolean;
}

export interface DeliveryDeps {
  bot: Bot;
  kv: KvStore;
  people: Pick<PeopleRepo, 'byPhoneHash'>;
  seals: Pick<SealRepo, 'get' | 'issuedSince'>;
  webOrigin: string;
  /** For receipt links on the explorer. */
  network: Network;
  /** https base of the Telegram Mini App; when set, cards open it (Details, Pay safely). */
  miniAppUrl?: string | undefined;
  now?: () => number;
  log?: Pick<Console, 'log' | 'error'>;
}

const DAY = 24 * 60 * 60;
/** How far back the sweep looks: covers a server that was down for up to ~2 hours. */
const SWEEP_WINDOW_MS = 2 * 60 * 60 * 1000;
export const SWEEP_EVERY_MS = 15_000;

/**
 * Seal cards in the person's Telegram chat:
 * - sent the moment a seal is issued (Redis pub/sub from the seal service);
 * - updated when the call ends, is replaced, or the seal expires, so a card is never green for a
 *   call that is no longer verified.
 * Pub/sub is fast but not durable (messages sent while the server restarts are lost) and a call can
 * end before its card has even reached Telegram. The sweep (every 15 s) repairs both from the database.
 */
export function createSealDelivery(deps: DeliveryDeps) {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? console;
  // Telegram only accepts public https links in buttons (not http://localhost).
  const detailsBase = deps.webOrigin.startsWith('https://') ? deps.webOrigin : null;
  const isLive = (row: SealRow) => row.status === 'open' && row.expiresAt.getTime() > now();
  const cardKey = (sealId: string) => `bot:card:${sealId}`;

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

  /** What an ended card says, from the database (the source of truth), not from an event. */
  function endedText(ref: CardRef, row: SealRow): string {
    if (row.status === 'superseded') return copy.sealReplaced(ref.company);
    if (row.status === 'open') return copy.sealExpired(ref.company, ref.code); // open but past expiry
    if (row.closeReason === 'blocked_by_callee') return copy.sealEndedBlocked(ref.company, ref.code);
    return copy.sealEnded(ref.company, ref.code);
  }

  /** Turn a green card into its final state (removes the buttons too). Safe to call twice. */
  async function finish(ref: CardRef, row: SealRow) {
    if (ref.final || isLive(row)) return;
    try {
      await deps.bot.api.editMessageText(ref.chatId, ref.messageId, endedText(ref, row), {
        parse_mode: 'HTML',
      });
    } catch (err) {
      // "not modified" / "not found" / "can't be edited": nothing more we can do, so it's final.
      // Anything else (network, Telegram busy): leave it for the next sweep.
      if (!(err instanceof GrammyError && err.error_code === 400)) throw err;
    }
    await deps.kv.set(cardKey(row.id), JSON.stringify({ ...ref, final: true }), DAY);
  }

  async function issued(sealId: string) {
    const row = await deps.seals.get(sealId);
    if (!row || !isLive(row)) return;
    if (await deps.kv.get(cardKey(sealId))) return; // already delivered
    const person = await deps.people.byPhoneHash(row.phoneHash);
    if (!person) return; // this number isn't protected by Cachet (yet)
    // The live event and the sweep can both get here: only one sends the card.
    if (!(await deps.kv.claim(`bot:deliver:${sealId}`, 60))) return;
    const seal = JSON.parse(row.sealJson) as Seal;
    const company = seal.company.legalName;

    // A newer seal from the same AI caller: the old card must not keep showing a code as valid.
    const lastKey = `bot:lastcard:${row.phoneHash}:${row.agentId}`;
    const previous = await deps.kv.get(lastKey);
    if (previous) {
      const prev = JSON.parse(previous) as CardRef;
      const prevRaw = prev.sealId !== sealId ? await deps.kv.get(cardKey(prev.sealId)) : null;
      const prevRow = prevRaw ? await deps.seals.get(prev.sealId) : null;
      if (prevRaw && prevRow) await finish(JSON.parse(prevRaw) as CardRef, prevRow).catch(() => undefined);
    }

    let sent;
    try {
      sent = await deps.bot.api.sendMessage(
        person.chatId,
        copy.sealCard({
          company,
          message: seal.message,
          code: seal.code,
          ...(seal.amount ? { amount: seal.amount } : {}),
        }),
        { parse_mode: 'HTML', ...cardButtons(sealId, seal) },
      );
    } catch (err) {
      await deps.kv.del(`bot:deliver:${sealId}`); // let the sweep try again
      throw err;
    }
    const ref: CardRef = {
      sealId,
      chatId: person.chatId,
      messageId: sent.message_id,
      company,
      code: seal.code,
      // The ULID carries the creation time to the millisecond (issuedAt only has whole seconds).
      deliveredMs: now() - ulidTime(sealId),
    };
    await deps.kv.set(cardKey(sealId), JSON.stringify(ref), DAY);
    await deps.kv.set(lastKey, JSON.stringify(ref), DAY);
    log.log(`[bot] seal card delivered ${ref.deliveredMs} ms after the seal was created`);

    // The call may have ended while the card was on its way (e.g. no answer): its "ended" event found
    // no card yet. Check again now that the card exists.
    const after = await deps.seals.get(sealId);
    if (after && !isLive(after)) await finish(ref, after);
  }

  async function closed(sealId: string) {
    const raw = await deps.kv.get(cardKey(sealId));
    if (!raw) return; // no card yet: issued() re-checks right after sending
    const row = await deps.seals.get(sealId);
    if (row) await finish(JSON.parse(raw) as CardRef, row);
  }

  /** A safe payment was confirmed on chain: send a receipt and take the Pay button off the card. */
  async function paid(ev: SealEvent) {
    if (!ev.txHash) return;
    const row = await deps.seals.get(ev.sealId);
    if (!row) return;
    const seal = JSON.parse(row.sealJson) as Seal;
    if (!seal.amount) return;
    const person = await deps.people.byPhoneHash(row.phoneHash);
    if (!person) return;
    if (!(await deps.kv.claim(`bot:paid:${ev.sealId}`, DAY))) return; // one receipt per payment
    await deps.bot.api.sendMessage(person.chatId, copy.paid(seal.amount, seal.company.legalName), {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [[{ text: copy.receiptButton, url: explorerTxUrl(deps.network, ev.txHash) }]],
      },
    });
    const raw = await deps.kv.get(cardKey(ev.sealId));
    const ref = raw ? (JSON.parse(raw) as CardRef) : null;
    if (ref && !ref.final && deps.miniAppUrl) {
      await deps.bot.api
        .editMessageReplyMarkup(ref.chatId, ref.messageId, {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Details', web_app: { url: `${deps.miniAppUrl}/tg/seal/${ev.sealId}` } }],
            ],
          },
        })
        .catch(() => undefined);
    }
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
      if (ev.type === 'seal.issued') await issued(ev.sealId);
      else if (ev.type === 'seal.closed') await closed(ev.sealId);
      else if (ev.type === 'seal.paid') await paid(ev);
    } catch (err) {
      log.error('[bot] seal delivery failed:', err instanceof Error ? err.message : err);
    }
  }

  let sweeping = false;
  /**
   * Repair pass over recent seals: deliver cards that were missed, and end cards whose call ended
   * or whose seal expired. Returns what it did (for logs and tests).
   */
  async function sweep() {
    if (sweeping) return { delivered: 0, ended: 0 };
    sweeping = true;
    let delivered = 0;
    let ended = 0;
    try {
      for (const row of await deps.seals.issuedSince(new Date(now() - SWEEP_WINDOW_MS))) {
        try {
          const raw = await deps.kv.get(cardKey(row.id));
          if (isLive(row)) {
            if (!raw) {
              await issued(row.id);
              if (await deps.kv.get(cardKey(row.id))) delivered++;
            }
          } else if (raw) {
            const ref = JSON.parse(raw) as CardRef;
            if (!ref.final) {
              await finish(ref, row);
              ended++;
            }
          }
        } catch (err) {
          log.error(`[bot] sweep: seal ${row.id} failed:`, err instanceof Error ? err.message : err);
        }
      }
    } finally {
      sweeping = false;
    }
    if (delivered || ended) log.log(`[bot] sweep: ${delivered} card(s) delivered late, ${ended} ended`);
    return { delivered, ended };
  }

  return {
    handle,
    sweep,
    async start() {
      await deps.kv.subscribe(SEAL_CHANNEL, (raw) => void handle(raw));
      void sweep(); // catch up on anything missed while the server was down
      setInterval(() => void sweep(), SWEEP_EVERY_MS).unref();
    },
  };
}
