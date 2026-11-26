import { explorerTxUrl, type Network } from '@cachet/shared';
import type { AgentRepo } from '../agents/repo';
import type { BusinessRepo } from './repo';

/**
 * The public company directory: "is this company real, does it make AI calls, and from which
 * numbers?". Only verified, active companies; only public facts (what their Agent Card says anyway).
 */
export interface CompanyView {
  legalName: string;
  legalCountry: string;
  verifiedAt: string;
  proofTxUrl: string;
  /** The company told Cachet it never makes AI calls: any AI call claiming to be it is a scam. */
  neverCalls: boolean;
  /** Its live AI callers (empty when it never calls, or has none switched on). */
  aiCallers: { name: string; callingNumbers: string[]; purposes: string[]; badgeCheckUrl: string | null }[];
}

export function createCompanyDirectory(deps: {
  businesses: Pick<BusinessRepo, 'searchByName'>;
  agents: Pick<AgentRepo, 'listByBusiness'>;
  network: Network;
  registryUrl?: string | undefined;
}) {
  return {
    /** Up to 5 matches for a name (2–60 characters). */
    async search(query: string): Promise<CompanyView[]> {
      const found = (await deps.businesses.searchByName(query, 5)).filter((b) => b.status === 'active');
      return Promise.all(
        found.map(async (b) => {
          const callers = b.neverCalls
            ? []
            : (await deps.agents.listByBusiness(b.id)).filter((a) => a.status === 'active');
          return {
            legalName: b.legalName,
            legalCountry: b.legalCountry,
            verifiedAt: b.verifiedAt.toISOString(),
            proofTxUrl: explorerTxUrl(deps.network, b.proofTx),
            neverCalls: b.neverCalls,
            aiCallers: callers.map((a) => ({
              name: a.name,
              callingNumbers: a.callingNumbers,
              purposes: a.purposes,
              badgeCheckUrl:
                deps.registryUrl && a.badge
                  ? `${deps.registryUrl}/v1/check-badge/${a.badge.split(':').at(-1) ?? ''}`
                  : null,
            })),
          };
        }),
      );
    },
  };
}

export type CompanyDirectory = ReturnType<typeof createCompanyDirectory>;
