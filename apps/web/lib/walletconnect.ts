'use client';

import type { WalletConnectConnection } from '@concordium/wallet-connectors';
import { NETWORK } from './config';

/**
 * The person's Concordium Wallet over WalletConnect.
 *
 * Phones: we show our own "Open Concordium Wallet" button with the wallet's explicit link
 * `cryptox-wc://wc?uri=…` (documented in Concordium/cryptox-android). The library's default wallet list
 * points at retired apps (`concordiumwallettest://`), which is why "Open" did nothing.
 * Computers: a QR code to scan with the wallet app.
 */

/** The current Concordium Wallet for Android/iOS (formerly CryptoX). Handles `cryptox-wc:` and `wc:`. */
const WALLET_SCHEME = 'cryptox-wc://';

export interface WalletSession {
  connection: WalletConnectConnection;
  account: string;
  /** Link that brings the wallet to a pending request: `<redirect>?requestId=<id>`. */
  requestLink(requestId: number): string;
  /** Called with the JSON-RPC id each time we send the wallet a request. */
  onRequestSent(listener: (id: number) => void): () => void;
}

export interface Pairing {
  /** Tap this on a phone to open the wallet and approve the connection. */
  walletLink: string;
  /** Show a QR code for this on a computer. */
  showQr(): Promise<void>;
  /** Resolves when the person approved in the wallet (null if cancelled). */
  approved: Promise<WalletSession | null>;
}

export async function startWalletPairing(): Promise<Pairing> {
  const wc = await import('@concordium/wallet-connectors');
  const network = NETWORK === 'mainnet' ? wc.MAINNET : wc.TESTNET;
  const projectId =
    process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] || wc.CONCORDIUM_WALLET_CONNECT_PROJECT_ID;
  const ignore = () => undefined;
  const modalConfig = wc.createWalletConnectModalConfig(network, [
    {
      id: 'concordium-wallet',
      name: 'Concordium Wallet',
      links: { native: WALLET_SCHEME, universal: '' },
    },
  ]);
  const connector = await wc.WalletConnectConnector.create(
    {
      projectId,
      metadata: {
        name: 'Cachet',
        description: 'Pay a verified company safely. No fee.',
        url: window.location.origin,
        icons: [],
      },
    },
    { onChainChanged: ignore, onAccountChanged: ignore, onConnected: ignore, onDisconnected: ignore },
    network,
    wc.FULL_WALLET_CONNECT_NAMESPACE_CONFIG,
    modalConfig,
  );

  // Same request as the library's connect(), but we keep the pairing URI to build our own links.
  const { uri, approval } = await connector.client.connect({
    requiredNamespaces: {
      ccd: { chains: [connector.chainId], ...connector.namespaceConfig },
    },
  });
  if (!uri) throw new Error('WalletConnect returned no pairing URI');

  let modal: { closeModal(): void } | null = null;
  const approved = approval()
    .then((session): WalletSession => {
      modal?.closeModal();
      const connection = new wc.WalletConnectConnection(connector, connector.chainId, session);
      connector.connections.set(session.topic, connection);
      const redirect = session.peer.metadata.redirect?.native || `${WALLET_SCHEME}r`;
      return {
        connection,
        account: connection.getConnectedAccount(),
        requestLink: (id) => `${redirect}${redirect.includes('?') ? '&' : '?'}requestId=${id}&go_back=true`,
        onRequestSent(listener) {
          const handler = (e: { topic: string; id: number }) => {
            if (e.topic === session.topic) listener(e.id);
          };
          connector.client.events.on('session_request_sent', handler);
          return () => connector.client.events.off('session_request_sent', handler);
        },
      };
    })
    .catch(() => null);

  return {
    walletLink: `${WALLET_SCHEME}wc?uri=${encodeURIComponent(uri)}&go_back=true`,
    async showQr() {
      const { WalletConnectModal } = await import('@walletconnect/modal');
      const m = new WalletConnectModal(modalConfig);
      modal = m;
      await m.openModal({ uri });
    },
    approved,
  };
}
