/** Placeholder home page. The real landing page is built in Phase 5. */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-medium tracking-wide text-seal uppercase">Coming soon</p>
      <h1 className="text-4xl leading-tight font-semibold tracking-tight sm:text-6xl">
        Every AI call, <em className="font-serif font-normal">sealed.</em>
      </h1>
      <p className="max-w-prose text-lg text-ink-2">
        Know in one second if an AI caller is really your bank, or a scammer.
      </p>
    </main>
  );
}
