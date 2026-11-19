import { sql } from 'drizzle-orm';
import { boolean, check, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
