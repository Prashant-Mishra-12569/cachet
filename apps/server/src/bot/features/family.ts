import { createHash, randomBytes } from 'node:crypto';
import { InlineKeyboard, type Bot, type Context } from 'grammy';
import type { KvStore } from '../../infra/kv';
import { copy } from '../copy';
import type { FamilyRepo } from '../family-repo';
import type { PeopleRepo, PersonRow } from '../people-repo';

export interface FamilyDeps {
  family: FamilyRepo;
  people: PeopleRepo;
  kv: KvStore;
  now: () => number;
}

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_LINKS = 5;
/** A name a person would type: letters (any language), digits, spaces, a few marks. */
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} .'-]{0,29}$/u;
export const INVITE_PREFIX = 'fam_';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Family protection (plan §5.4 F), with consent: the guardian gets a one-time link; the ward must
 * open it in THEIR OWN Telegram and tap Allow. Nobody can watch a number without its owner agreeing.
 */
export function createFamilyFeature(deps: FamilyDeps) {
  async function me(ctx: Context): Promise<PersonRow | null> {
    return ctx.from ? deps.people.byTelegramId(ctx.from.id) : null;
  }

  /** /start fam_<token>: show "X wants an alert… Allow?" to the person who opened the link. */
  async function openInvite(ctx: Context, token: string) {
    const person = await me(ctx);
    if (!person || !ctx.from) return;
    const invite = await deps.family.openInvite(hashToken(token), new Date(deps.now()));
    if (!invite) {
      await ctx.reply(copy.familyInviteGone);
      return;
    }
    if (invite.guardianPersonId === person.id) {
      await ctx.reply(copy.familySelf);
      return;
    }
    // Only someone who was SHOWN this invite may accept it (callback data alone is not proof).
    await deps.kv.set(`bot:invite-shown:${ctx.from.id}:${invite.id}`, '1', 60 * 60);
    await ctx.reply(copy.familyAsk(invite.guardianName), {
      parse_mode: 'HTML',
      reply_markup: new InlineKeyboard()
        .text(copy.familyAllow, `fam:ok:${invite.id}`)
        .text(copy.familyDecline, `fam:no:${invite.id}`),
    });
  }

  /** Send an alert to everyone protecting this person (after an unverified /check). */
  async function alertGuardians(bot: Bot, ward: PersonRow) {
    const window = Math.floor(deps.now() / 600_000);
    if ((await deps.kv.incr(`bot:rl:alert:${ward.id}:${window}`, 600)) > 3) return; // no alert storms
    const links = (await deps.family.linksOf(ward.id)).filter((l) => l.wardPersonId === ward.id);
    await Promise.allSettled(
      links.map((l) =>
        bot.api.sendMessage(l.guardianChatId, copy.guardianAlert(l.wardLabel), { parse_mode: 'HTML' }),
      ),
    );
  }

  function register(bot: Bot) {
    bot.command('family', async (ctx) => {
      const person = await me(ctx);
      if (!person) {
        await ctx.reply(copy.needNumber);
        return;
      }
      const label = ctx.match.trim();
      if (!label) {
        const links = await deps.family.linksOf(person.id);
        if (links.length === 0) {
          await ctx.reply(copy.familyHelp, { parse_mode: 'HTML' });
          return;
        }
        const protects = links.filter((l) => l.guardianPersonId === person.id);
        const protectedBy = links.filter((l) => l.wardPersonId === person.id);
        const kb = new InlineKeyboard();
        for (const l of protects) kb.text(copy.familyRemoveButton(l.wardLabel), `fam:rm:${l.id}`).row();
        for (const l of protectedBy) kb.text(copy.familyRemoveButton(l.guardianName), `fam:rm:${l.id}`).row();
        await ctx.reply(
          copy.familyList(
            protects.map((l) => l.wardLabel),
            protectedBy.map((l) => l.guardianName),
          ),
          { parse_mode: 'HTML', reply_markup: kb },
        );
        return;
      }
      if (!LABEL.test(label)) {
        await ctx.reply(copy.familyLabelBad, { parse_mode: 'HTML' });
        return;
      }
      if ((await deps.family.countForGuardian(person.id)) >= MAX_LINKS) {
        await ctx.reply(copy.familyLimit);
        return;
      }
      const token = randomBytes(24).toString('base64url'); // 32 chars; deep links allow 64
      await deps.family.createInvite({
        guardianPersonId: person.id,
        guardianName: (ctx.from?.first_name ?? 'Someone').slice(0, 64),
        wardLabel: label,
        tokenHash: hashToken(token),
        expiresAt: new Date(deps.now() + INVITE_TTL_MS),
      });
      const link = `https://t.me/${bot.botInfo.username}?start=${INVITE_PREFIX}${token}`;
      await ctx.reply(copy.familyInvite(label, link), {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
      });
    });

    bot.callbackQuery(/^fam:ok:([0-9a-f-]{36})$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const inviteId = ctx.match[1] ?? '';
      const person = await me(ctx);
      if (!person) return;
      if (!(await deps.kv.take(`bot:invite-shown:${ctx.from.id}:${inviteId}`))) {
        await ctx.reply(copy.familyInviteGone);
        return;
      }
      const result = await deps.family.accept(inviteId, person.id, new Date(deps.now()));
      if (result === 'gone') {
        await ctx.editMessageText(copy.familyInviteGone).catch(() => ctx.reply(copy.familyInviteGone));
        return;
      }
      if (result === 'already') {
        await ctx.editMessageText(copy.familyAlready).catch(() => ctx.reply(copy.familyAlready));
        return;
      }
      const link = (await deps.family.linksOf(person.id)).find((l) => l.id === inviteId);
      if (!link) return;
      await ctx
        .editMessageText(copy.familyAllowed(link.guardianName), { parse_mode: 'HTML' })
        .catch(() => undefined);
      await ctx.api
        .sendMessage(link.guardianChatId, copy.familyGuardianTold(link.wardLabel), { parse_mode: 'HTML' })
        .catch(() => undefined);
    });

    bot.callbackQuery(/^fam:no:([0-9a-f-]{36})$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const inviteId = ctx.match[1] ?? '';
      if (await deps.kv.take(`bot:invite-shown:${ctx.from.id}:${inviteId}`))
        await deps.family.deleteInvite(inviteId);
      await ctx.editMessageText(copy.familyDeclined).catch(() => ctx.reply(copy.familyDeclined));
    });

    bot.callbackQuery(/^fam:rm:([0-9a-f-]{36})$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      const person = await me(ctx);
      if (!person) return;
      const removed = await deps.family.remove(ctx.match[1] ?? '', person.id);
      if (!removed) return;
      await ctx.reply(copy.familyRemoved);
      // Tell the other side, kindly.
      const iAmGuardian = removed.guardianPersonId === person.id;
      await ctx.api
        .sendMessage(
          iAmGuardian ? removed.wardChatId : removed.guardianChatId,
          iAmGuardian
            ? copy.familyGuardianLeft(removed.guardianName)
            : copy.familyWardLeft(removed.wardLabel),
          { parse_mode: 'HTML' },
        )
        .catch(() => undefined);
    });
  }

  return { register, openInvite, alertGuardians };
}

export type FamilyFeature = ReturnType<typeof createFamilyFeature>;
