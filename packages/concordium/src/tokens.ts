import type { ConcordiumGRPCClient } from '@concordium/web-sdk';
import { Cbor, TokenAmount } from '@concordium/web-sdk/plt';

export interface PltSummary {
  /** Token id, e.g. "EURR". This is what goes into PLT_TOKEN_ID. */
  id: string;
  /** Human name from the token module state, if set. */
  name: string | undefined;
  decimals: number;
  /** Total supply as a decimal string (already divided by 10^decimals). */
  totalSupply: string;
  metadataUrl: string | undefined;
  paused: boolean | undefined;
  allowList: boolean | undefined;
  denyList: boolean | undefined;
}

/** List every Protocol-Level Token on the connected chain, with decimals and basic flags. */
export async function listPlts(client: ConcordiumGRPCClient): Promise<PltSummary[]> {
  const out: PltSummary[] = [];
  for await (const tokenId of client.getTokenList()) {
    const info = await client.getTokenInfo(tokenId);
    const moduleState = Cbor.decode(info.state.moduleState, 'TokenModuleState');
    out.push({
      id: tokenId.toString(),
      name: typeof moduleState.name === 'string' ? moduleState.name : undefined,
      decimals: info.state.decimals,
      totalSupply: TokenAmount.toDecimal(info.state.totalSupply).toFixed(),
      metadataUrl: moduleState.metadata?.url,
      paused: moduleState.paused,
      allowList: moduleState.allowList,
      denyList: moduleState.denyList,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
