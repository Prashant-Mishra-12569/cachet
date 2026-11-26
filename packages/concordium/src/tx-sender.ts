import {
  AccountAddress,
  CcdAmount,
  ContractAddress,
  DataBlob,
  Energy,
  ModuleReference,
  ContractName,
  type Parameter,
  type ReceiveName,
  Transaction,
  TransactionExpiry,
  TransactionHash,
  type AccountSigner,
  type BlockItemSummaryInBlock,
  type ConcordiumGRPCClient,
} from '@concordium/web-sdk';

/**
 * Sends transactions from ONE account, one at a time.
 *
 * Every transaction needs the account's next sequence number (nonce). Two parts of the server
 * sending from the same account at once (e.g. the anchoring worker and the x402 facilitator) would
 * pick the same nonce and one would fail. All sends for an account must go through one TxSender.
 */
export interface TxSender {
  readonly address: string;
  /** Submit a RegisterData transaction (max 256 bytes). Returns the transaction hash (hex). */
  registerData(data: Uint8Array): Promise<string>;
  /** Create a smart contract instance from a module already on chain. Returns the transaction hash. */
  initContract(input: {
    moduleRef: string;
    contractName: string;
    parameter: Parameter.Type;
    energy: bigint;
  }): Promise<string>;
  /** Call a smart contract entrypoint (no CCD sent). Returns the transaction hash. */
  updateContract(input: {
    contract: { index: bigint; subindex: bigint };
    receiveName: ReceiveName.Type;
    parameter: Parameter.Type;
    energy: bigint;
  }): Promise<string>;
  /** Wait until the transaction is finalized. */
  waitForFinal(txHash: string, timeoutMs?: number): Promise<BlockItemSummaryInBlock>;
}

export function createTxSender(input: {
  client: ConcordiumGRPCClient;
  address: string;
  signer: AccountSigner;
}): TxSender {
  const sender = AccountAddress.fromBase58(input.address);
  let queue: Promise<unknown> = Promise.resolve();

  /** Run sends strictly one after another (in-process lock). */
  function serialized<T>(fn: () => Promise<T>): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  }

  return {
    address: input.address,

    registerData(data) {
      if (data.byteLength === 0 || data.byteLength > 256) {
        return Promise.reject(new Error('RegisterData payload must be 1–256 bytes'));
      }
      return serialized(async () => {
        // The node's "next nonce" includes our own pending transactions, so sequential sends are safe.
        const { nonce } = await input.client.getNextAccountNonce(sender);
        const tx = Transaction.registerData({ data: new DataBlob(Uint8Array.from(data).buffer) })
          .addMetadata({ sender, nonce, expiry: TransactionExpiry.futureMinutes(10) })
          .build();
        const finalized = await Transaction.signAndFinalize(tx, input.signer);
        const hash = await input.client.sendTransaction(finalized);
        return TransactionHash.toHexString(hash);
      });
    },

    initContract({ moduleRef, contractName, parameter, energy }) {
      return serialized(async () => {
        const { nonce } = await input.client.getNextAccountNonce(sender);
        const tx = Transaction.initContract(
          {
            amount: CcdAmount.zero(),
            moduleRef: ModuleReference.fromHexString(moduleRef),
            initName: ContractName.fromString(contractName),
            param: parameter,
          },
          Energy.create(energy),
        )
          .addMetadata({ sender, nonce, expiry: TransactionExpiry.futureMinutes(10) })
          .build();
        const finalized = await Transaction.signAndFinalize(tx, input.signer);
        return TransactionHash.toHexString(await input.client.sendTransaction(finalized));
      });
    },

    updateContract({ contract, receiveName, parameter, energy }) {
      return serialized(async () => {
        const { nonce } = await input.client.getNextAccountNonce(sender);
        const tx = Transaction.updateContract(
          {
            amount: CcdAmount.zero(),
            address: ContractAddress.create(contract.index, contract.subindex),
            receiveName,
            message: parameter,
          },
          Energy.create(energy),
        )
          .addMetadata({ sender, nonce, expiry: TransactionExpiry.futureMinutes(10) })
          .build();
        const finalized = await Transaction.signAndFinalize(tx, input.signer);
        return TransactionHash.toHexString(await input.client.sendTransaction(finalized));
      });
    },

    waitForFinal(txHash, timeoutMs = 120_000) {
      return input.client.waitForTransactionFinalization(TransactionHash.fromHexString(txHash), timeoutMs);
    },
  };
}

/** Read back the bytes a RegisterData transaction stored on chain (null if it is not one). */
export function registeredDataOf(outcome: BlockItemSummaryInBlock): Uint8Array | null {
  const summary = outcome.summary as unknown as {
    transactionType?: string;
    dataRegistered?: { data?: string };
  } | null;
  if (summary?.transactionType !== 'registerData' || typeof summary.dataRegistered?.data !== 'string')
    return null;
  return Uint8Array.from(Buffer.from(summary.dataRegistered.data, 'hex'));
}
