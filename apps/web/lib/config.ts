import { isNetwork, type Network } from '@cachet/shared';

const raw = process.env['NEXT_PUBLIC_CCD_NETWORK'];

/** Which Concordium network the site works with. Testnet unless set otherwise. */
export const NETWORK: Network = isNetwork(raw) ? raw : 'testnet';
