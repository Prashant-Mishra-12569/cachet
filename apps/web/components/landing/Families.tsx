import { SealMark } from '@/components/brand/Seal';
import { BOT_URL } from './links';

/** Family alerts, as the bot really sends them. */
export function Families() {
  return (
    <section aria-labelledby="family-title" className="bg-lilac-soft">
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-2 lg:items-center">
        <div>
          <h2
            id="family-title"
            className="max-w-[18ch] text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
          >
            Look out for the people who answer every call.
          </h2>
          <p className="mt-4 max-w-[52ch] text-lg text-ink-2">
            Send{' '}
            <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[0.9em]">/family Mom</code> to
            the Cachet bot and share the link with her. When she says yes in her own Telegram, you get an
            alert if she ever checks a call that isn’t verified.
          </p>
          <p className="mt-4 max-w-[52ch] text-lg text-ink-2">
            You never see her calls or her number. Either of you can stop it at any time.
          </p>
          <a
            href={BOT_URL}
            className="mt-8 inline-flex min-h-12 items-center rounded-full bg-seal px-6 font-medium text-white transition-transform active:scale-[0.98]"
          >
            Set up family alerts in Telegram
          </a>
        </div>

        <div
          className="mx-auto w-full max-w-[420px] space-y-3"
          aria-label="Example: a family alert in Telegram"
        >
          <ChatBubble>
            <p>
              <b>Mom</b> said yes. I’ll alert you if she’s ever on an unverified call.
            </p>
          </ChatBubble>
          <ChatBubble alert>
            <p className="font-semibold text-alert">Mom just checked a call that is NOT verified.</p>
            <p className="mt-1">You may want to call her now.</p>
          </ChatBubble>
          <p className="pl-12 text-sm text-ink-2">Example messages from the Cachet bot.</p>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ children, alert = false }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <div className="flex items-end gap-2.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface shadow-soft">
        <SealMark className="size-6" />
      </span>
      <div
        className={`rounded-[18px] rounded-bl-[6px] bg-surface px-4 py-3 text-[16px] leading-snug shadow-soft ${
          alert ? 'ring-1 ring-alert/25' : ''
        }`}
      >
        {children}
      </div>
    </div>
  );
}
