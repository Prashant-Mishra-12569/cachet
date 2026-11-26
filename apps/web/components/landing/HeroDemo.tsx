'use client';

import { useState, type CSSProperties } from 'react';
import { SealMark, WaxSeal } from '@/components/brand/Seal';

type Mode = 'real' | 'scam';

const at = (seconds: number): CSSProperties => ({ animationDelay: `${seconds}s` });
/** When the person picks up: just before the voice speaks. */
const answeredAt = (mode: Mode) => (mode === 'real' ? 1.95 : 0.75);

/**
 * The whole product in three seconds: a phone rings from an unknown number, the Cachet card lands
 * in Telegram, the seal stamps it, and the voice says the same code. "A scammer calls" plays the
 * other story: no card, and /check comes back red. Replays by re-mounting (key).
 */
export function HeroDemo() {
  const [mode, setMode] = useState<Mode>('real');
  const [run, setRun] = useState(0);

  const choose = (m: Mode) => {
    setMode(m);
    setRun((r) => r + 1);
  };

  return (
    <div className="hero-demo mx-auto w-full max-w-[400px]">
      <div
        role="group"
        aria-label="Choose who is calling"
        className="mx-auto mb-5 flex w-fit rounded-full border border-line bg-surface/80 p-1 text-sm shadow-soft backdrop-blur"
      >
        {(
          [
            ['real', 'A real company calls'],
            ['scam', 'A scammer calls'],
          ] as const
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => choose(m)}
            className={`demo-control min-h-11 rounded-full px-4 font-medium transition-colors ${
              mode === m
                ? m === 'real'
                  ? 'bg-seal text-white'
                  : 'bg-alert text-white'
                : 'text-ink-2 hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div key={`${mode}-${run}`} className="relative">
        <Phone mode={mode} />
        <Voice mode={mode} />
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-2 lg:mt-14">
        <p>Demo: Northwind Energy BV is a test company.</p>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="demo-control min-h-11 shrink-0 rounded-full px-3 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
        >
          Play again
        </button>
      </div>
    </div>
  );
}

function Phone({ mode }: { mode: Mode }) {
  return (
    <div className="demo-buzz relative mx-auto aspect-[9/16.5] w-full max-w-[300px] rounded-[44px] bg-night p-[10px] shadow-[0_30px_60px_-20px_rgb(20_22_19/0.45),0_10px_20px_-10px_rgb(20_22_19/0.3)]">
      <div className="relative h-full overflow-hidden rounded-[35px] bg-[linear-gradient(180deg,#2a2d29_0%,#161815_100%)] text-white">
        {/* status bar */}
        <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-medium opacity-80">
          <span>9:41</span>
          <span className="h-5 w-20 rounded-full bg-black" aria-hidden />
          <span>5G</span>
        </div>

        {/* incoming call */}
        <div className="mt-[74%] flex flex-col items-center text-center">
          <div className="demo-ring relative grid size-16 place-items-center rounded-full bg-white/10">
            <svg viewBox="0 0 24 24" className="size-8 opacity-80" aria-hidden>
              <path
                fill="currentColor"
                d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z"
              />
            </svg>
          </div>
          <p className="mt-3 text-lg font-medium">Unknown number</p>
          {/* the call is answered just before the voice speaks */}
          <p className="mt-1 grid text-sm">
            <span className="demo-out col-start-1 row-start-1 opacity-0" style={at(answeredAt(mode))}>
              <span className="opacity-60">incoming call</span>
            </span>
            <span className="demo-rise col-start-1 row-start-1 opacity-60" style={at(answeredAt(mode))}>
              on the call
            </span>
          </p>
        </div>

        {/* answer / decline */}
        <div
          className="demo-out absolute inset-x-0 bottom-8 flex justify-around px-8 opacity-0"
          style={at(answeredAt(mode))}
          aria-hidden
        >
          <span className="grid size-14 place-items-center rounded-full bg-[#e5484d]">
            <svg viewBox="0 0 24 24" className="size-6 rotate-[135deg]">
              <path
                fill="#fff"
                d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"
              />
            </svg>
          </span>
          <span className="grid size-14 place-items-center rounded-full bg-[#30a46c]">
            <svg viewBox="0 0 24 24" className="size-6">
              <path
                fill="#fff"
                d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"
              />
            </svg>
          </span>
        </div>

        {/* once answered: end call (wide screens show the caption here instead) */}
        <div
          className="demo-rise absolute inset-x-0 bottom-8 flex justify-center lg:hidden"
          style={at(answeredAt(mode))}
          aria-hidden
        >
          <span className="grid size-14 place-items-center rounded-full bg-[#e5484d]">
            <svg viewBox="0 0 24 24" className="size-6 rotate-[135deg]">
              <path
                fill="#fff"
                d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1l-2.3 2.2Z"
              />
            </svg>
          </span>
        </div>

        {/* what lands on the screen */}
        <div className="absolute inset-x-3 top-10">{mode === 'real' ? <SealedCard /> : <CheckRed />}</div>
      </div>
    </div>
  );
}

/** The Telegram card, as the bot really sends it. */
function SealedCard() {
  return (
    <div className="demo-drop relative" style={at(0.9)}>
      <div className="rounded-[20px] bg-white/95 p-3.5 text-ink shadow-[0_12px_30px_-8px_rgb(0_0_0/0.5)] backdrop-blur">
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <SealMark className="size-5" />
          <span className="font-semibold text-ink">Cachet</span>
          <span className="ml-auto">now</span>
        </div>
        <p className="mt-2 text-sm font-semibold text-seal">Verified call</p>
        <p className="mt-0.5 text-[13px] leading-snug">
          <b>Northwind Energy BV</b> is calling you with an AI assistant.
        </p>
        <p className="mt-0.5 text-[13px] leading-snug text-ink-2">Reason: Your November bill is ready</p>
        <div className="mt-2.5 flex items-baseline gap-2">
          <span className="text-[13px] text-ink-2">Your code</span>
          <span className="font-mono text-[28px] leading-none font-semibold tracking-tight">47-21</span>
        </div>
      </div>
      {/* the seal stamps onto the card */}
      <div className="pointer-events-none absolute -right-3 -bottom-6 size-[84px]">
        <span
          className="demo-ripple absolute inset-0 rounded-full border-2 border-gold opacity-0"
          style={at(1.75)}
          aria-hidden
        />
        <div className="demo-stamp size-full rotate-[-12deg]" style={at(1.45)}>
          <WaxSeal id="hero-seal" className="size-full drop-shadow-[0_8px_10px_rgb(0_0_0/0.35)]" />
        </div>
      </div>
    </div>
  );
}

/** What /check answers when no verified company is calling. */
function CheckRed() {
  return (
    <div className="demo-drop" style={at(2.1)}>
      <div className="rounded-[20px] bg-white/95 p-3.5 text-ink shadow-[0_12px_30px_-8px_rgb(0_0_0/0.5)]">
        <div className="flex items-center gap-2 text-xs text-ink-2">
          <SealMark className="size-5 grayscale" />
          <span className="font-semibold text-ink">Cachet</span>
          <span className="ml-auto">now</span>
        </div>
        <p className="mt-2 text-sm font-semibold text-alert">Not verified</p>
        <p className="mt-0.5 text-[13px] leading-snug">No verified company is calling you right now.</p>
        <p className="mt-0.5 text-[13px] leading-snug font-medium">
          Don&apos;t pay. Don&apos;t share OTPs. Hang up.
        </p>
      </div>
    </div>
  );
}

/** What the caller says, and what it means. */
function Voice({ mode }: { mode: Mode }) {
  const real = mode === 'real';
  return (
    <div
      className="mt-6 space-y-2 lg:absolute lg:-bottom-10 lg:-left-16 lg:mt-0 lg:w-[300px] lg:drop-shadow-[0_18px_30px_rgb(20_22_19/0.18)]"
      aria-live="polite"
    >
      <figure className="demo-rise rounded-[18px] bg-surface p-4 shadow-soft" style={at(real ? 2.2 : 1.0)}>
        <figcaption className="text-xs text-ink-2">{real ? 'The AI says' : 'The caller says'}</figcaption>
        <blockquote className="mt-1 font-serif text-[19px] leading-snug italic">
          {real
            ? '“Hi, this is Northwind Energy BV’s AI assistant. Your Cachet code is four-seven, two-one.”'
            : '“This is your bank’s security team. Your account is blocked. Read me the OTP we just sent.”'}
        </blockquote>
      </figure>
      <p
        className={`demo-rise flex items-start gap-2 rounded-[14px] px-4 py-3 text-sm leading-snug font-medium ${
          real ? 'bg-seal-soft text-seal' : 'bg-alert-soft text-alert'
        }`}
        style={at(real ? 2.8 : 2.7)}
      >
        <span aria-hidden>{real ? '✓' : '!'}</span>
        {real
          ? 'Same company, same code as your card. It’s really them.'
          : 'No card arrived, and /check says not verified. Hang up.'}
      </p>
    </div>
  );
}
