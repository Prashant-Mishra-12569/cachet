'use client';

import { useEffect, useRef, useState } from 'react';

const STEPS = [
  {
    title: 'A verified company',
    body: 'The company proves who it is with a private proof from its Concordium identity. It shows its legal name and country, nothing more.',
    plate: 'Verified company',
  },
  {
    title: 'A verified AI caller',
    body: 'It registers its AI caller in Concordium’s public registry, with the phone numbers it calls from and the wallet it gets paid into.',
    plate: 'Verified AI caller ID',
  },
  {
    title: 'A seal on every call',
    body: 'Right before dialling, the AI pays one cent for a seal. It lands in your Telegram with a 4-digit code, and the voice says the same code.',
    plate: 'Sealed call',
  },
  {
    title: 'Pay safely, if you want',
    body: 'If the call is about a bill, you can pay inside the card. The money can only go to the company’s registered wallet, and the fee is on us.',
    plate: 'Safe payment',
  },
];

/**
 * Four checks stand behind every green card. On wide screens the glass layers build up as you read;
 * on phones they sit above the steps, all lit.
 */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset['step']));
        }
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    for (const el of refs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-8 bg-surface">
      <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 sm:py-28">
        <h2
          id="how-title"
          className="max-w-[20ch] text-[28px] leading-[1.1] font-semibold tracking-[-0.02em] sm:text-[44px]"
        >
          Four checks stand behind every green card.
        </h2>
        <p className="mt-4 max-w-[60ch] text-lg text-ink-2">
          Each one is recorded on Concordium, so anyone can check it. You don’t need to know how any of it
          works to use it.
        </p>

        <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-16">
          <div className="lg:sticky lg:top-[18vh] lg:h-[64vh]">
            <LayerStack active={active} />
          </div>
          <ol className="space-y-6 lg:space-y-[22vh] lg:py-[18vh]">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                data-step={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                className={`rounded-[20px] p-5 transition-colors duration-300 sm:p-6 ${
                  active === i ? 'lg:bg-seal-soft' : ''
                }`}
              >
                <p className="text-sm font-medium text-seal">Step {i + 1} of 4</p>
                <h3 className="mt-1 text-[22px] leading-tight font-semibold sm:text-[28px]">{s.title}</h3>
                <p className="mt-2 max-w-[52ch] text-[17px] leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function LayerStack({ active }: { active: number }) {
  return (
    <div
      className="layer-stack relative mx-auto grid h-[300px] w-full max-w-[460px] place-items-center sm:h-[380px] lg:h-full"
      aria-hidden
    >
      {STEPS.map((s, i) => {
        // Phones: all layers lit. Wide screens: lit up to the step being read.
        const on = i <= active;
        return (
          <div
            key={s.plate}
            data-above={i > active}
            style={{ ['--i' as string]: i - 1.5 }}
            className={`layer-plate absolute flex h-[150px] w-[230px] items-end rounded-[22px] border p-4 backdrop-blur-md sm:h-[180px] sm:w-[280px] ${
              on
                ? 'border-seal/30 bg-[rgb(227_241_234/0.72)] shadow-[0_20px_40px_-20px_rgb(15_107_79/0.45)]'
                : 'max-lg:border-seal/30 max-lg:bg-[rgb(227_241_234/0.72)] border-line bg-[rgb(255_255_255/0.55)]'
            }`}
          >
            <span className={`text-[15px] font-semibold ${on ? 'text-seal' : 'max-lg:text-seal text-ink-2'}`}>
              {s.plate}
            </span>
          </div>
        );
      })}
    </div>
  );
}
