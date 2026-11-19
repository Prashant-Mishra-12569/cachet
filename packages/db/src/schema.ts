import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
