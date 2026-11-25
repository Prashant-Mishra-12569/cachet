/**
 * The Cachet seal: a wax seal (wavy edge) pressed with a check mark.
 * SealMark = flat logo mark. WaxSeal = the glossy emerald object used in the hero.
 * Both are pure SVG (no images, no 3D runtime): crisp at any size and free to load.
 */

/** Wavy wax edge: a circle whose radius ripples `waves` times. Deterministic (same on server and client). */
function waxEdge(cx: number, cy: number, r: number, amp: number, waves: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 240; i++) {
    const t = (i / 240) * Math.PI * 2;
    const rr = r + amp * Math.sin(waves * t) + amp * 0.35 * Math.sin((waves * 2 + 1) * t + 1.3);
    pts.push(`${(cx + rr * Math.cos(t)).toFixed(2)} ${(cy + rr * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

const EDGE_100 = waxEdge(50, 50, 45, 2.2, 11);
const EDGE_200 = waxEdge(100, 100, 90, 4.2, 11);
const CHECK_100 = 'M33 51.5 L45 63 L68 38';
const CHECK_200 = 'M66 103 L90 126 L136 76';

export function SealMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path d={EDGE_100} fill="var(--color-seal)" />
      <circle cx="50" cy="50" r="33" fill="none" stroke="var(--color-gold)" strokeWidth="1.6" opacity="0.9" />
      <path
        d={CHECK_100}
        fill="none"
        stroke="#fff"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The glossy wax seal. `id` keeps gradient ids unique when more than one is on the page.
 */
export function WaxSeal({ className, id = 'wax' }: { className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden>
      <defs>
        <radialGradient id={`${id}-body`} cx="34%" cy="28%" r="80%">
          <stop offset="0" stopColor="#3aa57d" />
          <stop offset="0.45" stopColor="#13775a" />
          <stop offset="0.85" stopColor="#0b5a43" />
          <stop offset="1" stopColor="#073d2e" />
        </radialGradient>
        <radialGradient id={`${id}-well`} cx="60%" cy="66%" r="70%">
          <stop offset="0" stopColor="#1a8563" />
          <stop offset="0.7" stopColor="#0e6a4e" />
          <stop offset="1" stopColor="#084a37" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1dc9e" />
          <stop offset="0.5" stopColor="#c8a24a" />
          <stop offset="1" stopColor="#8a6a22" />
        </linearGradient>
        <radialGradient id={`${id}-shine`} cx="30%" cy="22%" r="38%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* wax body */}
      <path d={EDGE_200} fill={`url(#${id}-body)`} />
      {/* the pressed well, with a lip of light on its lower edge */}
      <circle cx="100" cy="100" r="66" fill={`url(#${id}-well)`} />
      <circle cx="100" cy="101.5" r="66" fill="none" stroke="#5fc29b" strokeOpacity="0.35" strokeWidth="2" />
      <circle cx="100" cy="98.5" r="66" fill="none" stroke="#03261c" strokeOpacity="0.45" strokeWidth="2" />
      {/* gold ring */}
      <circle cx="100" cy="100" r="58" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="2.4" />
      {/* embossed check: shadow, then the raised stroke, then its highlight */}
      <path
        d={CHECK_200}
        transform="translate(0 2.5)"
        fill="none"
        stroke="#03261c"
        strokeOpacity="0.55"
        strokeWidth="17"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={CHECK_200}
        fill="none"
        stroke="#e9f6ef"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={CHECK_200}
        transform="translate(-1 -1.5)"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.9"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* glaze */}
      <path d={EDGE_200} fill={`url(#${id}-shine)`} />
    </svg>
  );
}
