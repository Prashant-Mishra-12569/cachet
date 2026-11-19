/**
 * Where Agent Cards are published. Concordium's badge checker downloads the card from a public
 * URL and compares the SHA-256 of the served bytes with the hash pinned on chain.
 *
 * Every card version gets a NEW slot (URL), so no cache can ever serve stale bytes for it.
 * Temporary host: GitHub Gist. Phase 5 replaces it with Cachet's own domain.
 */

export interface CardSlot {
  /** Public URL where the card will be served. Known before the card is written (it goes inside it). */
  url: string;
  write(content: string): Promise<void>;
}

export interface CardHost {
  readonly name: string;
  reserve(label: string): Promise<CardSlot>;
  /** Download exactly what the public URL serves (no caching). */
  fetchServed(url: string): Promise<Uint8Array>;
}

export class CardHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CardHostError';
  }
}

const FILE = 'agent-card.json';
const GITHUB_API = 'https://api.github.com';

/** GitHub Gist host. Needs a token with ONLY the "gist" scope. */
export function createGistCardHost(options: { token: string; fetch?: typeof fetch }): CardHost {
  const doFetch = options.fetch ?? fetch;
  const headers = {
    Authorization: `Bearer ${options.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cachet-server',
    'Content-Type': 'application/json',
  };

  async function github<T>(method: string, path: string, body: unknown): Promise<T> {
    let res: Response;
    try {
      res = await doFetch(`${GITHUB_API}${path}`, {
        method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new CardHostError(`GitHub unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) throw new CardHostError(`GitHub ${method} ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    name: 'github-gist',
    async reserve(label) {
      // Placeholder first, to learn the URL. It is never fetched before the real card replaces it.
      const gist = await github<{ id?: string; owner?: { login?: string } }>('POST', '/gists', {
        description: `Cachet Agent Card · ${label}`,
        public: true,
        files: { [FILE]: { content: '{}' } },
      });
      if (!gist.id || !gist.owner?.login) throw new CardHostError('GitHub returned no gist id/owner');
      const id = gist.id;
      return {
        url: `https://gist.githubusercontent.com/${gist.owner.login}/${id}/raw/${FILE}`,
        async write(content) {
          await github('PATCH', `/gists/${id}`, { files: { [FILE]: { content } } });
        },
      };
    },
    async fetchServed(url) {
      const res = await doFetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new CardHostError(`card URL returned HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

/** In-memory host for tests. */
export function createMemoryCardHost(): CardHost & { served: Map<string, string> } {
  const served = new Map<string, string>();
  let n = 0;
  return {
    name: 'memory',
    served,
    async reserve() {
      const url = `https://cards.test/${++n}/${FILE}`;
      served.set(url, '{}');
      return {
        url,
        write: async (content) => {
          served.set(url, content);
        },
      };
    },
    async fetchServed(url) {
      const content = served.get(url);
      if (content === undefined) throw new CardHostError('404');
      return new TextEncoder().encode(content);
    },
  };
}
