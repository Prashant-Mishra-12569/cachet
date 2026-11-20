import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const businessStatus = pgEnum('business_status', ['active', 'suspended']);

/**
 * A business that proved it is a real company. legal_name and legal_country come ONLY from a
 * Concordium zero-knowledge proof (Verify & Access), never from typed input.
 */
export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The Concordium account that signed in and proved the company identity. */
    concordiumAccount: text('concordium_account').notNull().unique(),
    legalName: text('legal_name').notNull(),
    /** ISO 3166-1 alpha-2, e.g. "NL". */
    legalCountry: text('legal_country').notNull(),
    /** Identity provider that issued the company identity, e.g. "did:ccd:testnet:idp:4". */
    issuer: text('issuer').notNull(),
    /** Verification Audit Anchor transaction (the on-chain record of the verified proof). */
    proofTx: text('proof_tx').notNull(),
    /** Verification Request Anchor transaction (the on-chain record of the request). */
    requestTx: text('request_tx').notNull(),
    status: businessStatus('status').notNull().default('active'),
    neverCalls: boolean('never_calls').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('legal_country_iso2', sql`${t.legalCountry} ~ '^[A-Z]{2}$'`),
    check('legal_name_length', sql`char_length(${t.legalName}) between 1 and 200`),
  ],
);

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;

/** Why an AI caller may call people. Shown on every seal card. */
export const AGENT_PURPOSES = ['billing', 'delivery', 'appointments', 'support', 'account_alerts'] as const;
export type AgentPurpose = (typeof AGENT_PURPOSES)[number];

/**
 * draft      = created in Cachet, not on chain yet
 * registered = CIS-8004 agent minted (has token_id), Agent Card not pinned yet
 * active     = Agent Card hosted and its SHA-256 pinned on chain (badge can be valid)
 * revoked    = switched off on chain
 */
export const agentStatus = pgEnum('agent_status', ['draft', 'registered', 'active', 'revoked']);

/** An AI calling agent owned by a verified business, registered in the Concordium Agent Registry. */
export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    purposes: text('purposes').array().notNull(),
    /** ISO 639-1, e.g. "en". */
    language: text('language').notNull().default('en'),
    /** E.164 numbers this agent calls from, e.g. "+31201234567". */
    callingNumbers: text('calling_numbers')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The AI's own Concordium account (pays seal fees, signs seal requests). */
    agentAccount: text('agent_account').notNull(),
    status: agentStatus('status').notNull().default('draft'),
    /** CIS-8004 token id (u64), set once registered on chain. */
    tokenId: bigint('token_id', { mode: 'bigint' }).unique(),
    /** Base58 CIS-2 token address = the "Verified by Concordium" badge string. */
    badge: text('badge'),
    registerTx: text('register_tx').unique(),
    /** On-chain payment wallet (CIS-8004 agentWallet). Register sets it to the owner. */
    agentWallet: text('agent_wallet'),
    agentUri: text('agent_uri'),
    /** SHA-256 (hex) of the exact Agent Card bytes served at agent_uri. */
    metadataHash: text('metadata_hash'),
    /** The exact Agent Card bytes we published (so we can always re-serve / re-check them). */
    cardJson: text('card_json'),
    cardTx: text('card_tx').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agents_business_idx').on(t.businessId),
    index('agents_calling_numbers_idx').using('gin', t.callingNumbers),
    check('agent_name_length', sql`char_length(${t.name}) between 1 and 80`),
    check('agent_description_length', sql`char_length(${t.description}) between 1 and 500`),
    check('agent_language_iso', sql`${t.language} ~ '^[a-z]{2}$'`),
    check('agent_purposes_nonempty', sql`cardinality(${t.purposes}) >= 1`),
  ],
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

/**
 * open       = the call may be happening now (shown green to the callee)
 * closed     = the agent said the call ended
 * superseded = a newer seal for the same agent + callee replaced it
 * (expiry is not a status: a seal is simply no longer open once expires_at has passed)
 */
export const sealStatus = pgEnum('seal_status', ['open', 'closed', 'superseded']);

/** Anchors: on-chain records (RegisterData) of a Merkle root over a batch of ledger items. */
export const anchorStatus = pgEnum('anchor_status', ['pending', 'submitted', 'finalized', 'failed']);

export const anchors = pgTable('anchors', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  merkleRoot: text('merkle_root').notNull().unique(),
  itemCount: integer('item_count').notNull(),
  status: anchorStatus('status').notNull().default('pending'),
  txHash: text('tx_hash').unique(),
  blockHash: text('block_hash'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finalizedAt: timestamp('finalized_at', { withTimezone: true }),
});

export const seals = pgTable(
  'seals',
  {
    /** ULID */
    id: text('id').primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    /** hmac-sha256 fingerprint of the callee's number (never the number). */
    phoneHash: text('phone_hash').notNull(),
    fromE164: text('from_e164').notNull(),
    purpose: text('purpose').notNull(),
    message: text('message').notNull(),
    amountValue: text('amount_value'),
    amountAsset: text('amount_asset'),
    code: text('code').notNull(),
    status: sealStatus('status').notNull().default('open'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closeReason: text('close_reason'),
    /** The full signed seal, canonical JSON (RFC 8785): exactly what was signed and anchored. */
    sealJson: text('seal_json').notNull(),
    /** sha256(seal_json), hex. */
    sealHash: text('seal_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('seals_phone_open_idx').on(t.phoneHash, t.expiresAt),
    index('seals_agent_issued_idx').on(t.agentId, t.issuedAt),
    // The bot's card sweep reads the last couple of hours of seals every 15 s.
    index('seals_issued_idx').on(t.issuedAt),
    // At most ONE open seal per agent + callee, even when two requests race.
    uniqueIndex('seals_one_open_per_callee')
      .on(t.agentId, t.phoneHash)
      .where(sql`${t.status} = 'open'`),
    check('seal_code_4_digits', sql`${t.code} ~ '^[0-9]{4}$'`),
    check('seal_message_length', sql`char_length(${t.message}) between 1 and 80`),
  ],
);

/**
 * Everything we anchor on chain: seals, seal closings (later: consents, reports, status changes).
 * item_hash = sha256 of the canonical item; anchors group items into a Merkle tree.
 */
export const ledgerItems = pgTable(
  'ledger_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    kind: text('kind').notNull(),
    refId: text('ref_id').notNull(),
    itemHash: text('item_hash').notNull().unique(),
    anchorId: bigint('anchor_id', { mode: 'number' }).references(() => anchors.id),
    leafIndex: integer('leaf_index'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ledger_unanchored_idx')
      .on(t.id)
      .where(sql`${t.anchorId} is null`),
    index('ledger_ref_idx').on(t.kind, t.refId),
  ],
);

/** Prepaid seals per agent, bought with x402 payments. */
export const sealCredits = pgTable(
  'seal_credits',
  {
    agentId: uuid('agent_id')
      .primaryKey()
      .references(() => agents.id),
    balance: integer('balance').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('seal_credits_non_negative', sql`${t.balance} >= 0`)],
);

/** Each x402 credit purchase (one on-chain payment = one row; the tx can never be counted twice). */
export const creditPurchases = pgTable('credit_purchases', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id),
  credits: integer('credits').notNull(),
  amount: text('amount').notNull(),
  asset: text('asset').notNull(),
  txHash: text('tx_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Safe payments (plan §13.2): a person paid the amount a seal asked for, to the AI caller's on-chain
 * agentWallet, with the memo "cachet:<sealId>". Only written after the transaction is finalized on chain
 * and checked. One payment per seal; a transaction can never be counted twice.
 */
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  sealId: text('seal_id')
    .notNull()
    .unique()
    .references(() => seals.id),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  txHash: text('tx_hash').notNull().unique(),
  payer: text('payer').notNull(),
  recipient: text('recipient').notNull(),
  /** Decimal string, e.g. "12.40". */
  amount: text('amount').notNull(),
  asset: text('asset').notNull(),
  /** True when Cachet's sponsor paid the transaction fee. */
  sponsored: boolean('sponsored').notNull(),
  paidAt: timestamp('paid_at', { withTimezone: true }).notNull().defaultNow(),
});
export type PaymentRow = typeof payments.$inferSelect;

/**
 * People protected by Cachet (Telegram users who shared their own number).
 * The number is stored ONLY encrypted (AES-256-GCM) plus a keyed fingerprint for lookups.
 */
export const people = pgTable('people', {
  id: uuid('id').primaryKey().defaultRandom(),
  tgUserId: bigint('tg_user_id', { mode: 'number' }).notNull().unique(),
  /** Private chat with the bot (where seal cards go). */
  chatId: bigint('chat_id', { mode: 'number' }).notNull(),
  /** hmac-sha256 fingerprint of the E.164 number (same as seals.phone_hash). One person per number. */
  phoneHash: text('phone_hash').notNull().unique(),
  /** AES-256-GCM(iv | ciphertext | tag), base64url. */
  phoneEnc: text('phone_enc').notNull(),
  lang: text('lang').notNull().default('en'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PersonRow = typeof people.$inferSelect;

/**
 * A guardian gets an alert when their ward is on an unverified call.
 * The WARD must agree in their own Telegram (one-time invite link), so nobody can watch a number
 * without that person's consent. Deleting either person deletes the link.
 */
export const guardians = pgTable(
  'guardians',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    guardianPersonId: uuid('guardian_person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    /** Telegram first name of the guardian at invite time (shown to the ward when asked to allow). */
    guardianName: text('guardian_name').notNull(),
    /** What the guardian calls the ward, e.g. "Mom". */
    wardLabel: text('ward_label').notNull(),
    /** Null until the ward accepts. */
    wardPersonId: uuid('ward_person_id').references(() => people.id, { onDelete: 'cascade' }),
    /** sha256 of the invite token (the token itself is only in the link). Null once used. */
    inviteTokenHash: text('invite_token_hash').unique(),
    inviteExpiresAt: timestamp('invite_expires_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('guardians_pair_idx').on(t.guardianPersonId, t.wardPersonId),
    index('guardians_ward_idx').on(t.wardPersonId),
    check('guardian_label_length', sql`char_length(${t.wardLabel}) between 1 and 30`),
  ],
);

/** "Who may call me": a person allows or blocks sealed AI calls from a company (plan §9 consents). */
export const consentStatus = pgEnum('consent_status', ['granted', 'revoked']);
export const consents = pgTable(
  'consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    phoneHash: text('phone_hash').notNull(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    status: consentStatus('status').notNull(),
    source: text('source').notNull().default('bot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('consents_phone_business_idx').on(t.phoneHash, t.businessId)],
);
export type ConsentRow = typeof consents.$inferSelect;
export type GuardianRow = typeof guardians.$inferSelect;

/** "Report this call": a person flags a call. Deleted with the person on /stop (the anchored hash stays). */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    phoneHash: text('phone_hash').notNull(),
    /** Set when the reported call had a seal. */
    sealId: text('seal_id'),
    /** e.g. "unverified_call" */
    reason: text('reason').notNull(),
    claimedCompany: text('claimed_company'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reports_phone_idx').on(t.phoneHash, t.createdAt)],
);
export type SealRow = typeof seals.$inferSelect;
export type AnchorRow = typeof anchors.$inferSelect;
export type LedgerItemRow = typeof ledgerItems.$inferSelect;
