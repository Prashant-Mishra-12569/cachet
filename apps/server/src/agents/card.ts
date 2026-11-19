import { createHash } from 'node:crypto';
import { AGENT_PURPOSES, type AgentPurpose } from '@cachet/db';

/**
 * Identity + version of Cachet's own Agent Card extension (A2A AgentExtension).
 * The URI resolves to the public spec in this repository.
 */
export const CACHET_EXTENSION_URI =
  'https://github.com/Prashant-Mishra-12569/cachet/blob/main/docs/extensions/cachet-v1.md';

const SKILLS: Record<AgentPurpose, { name: string; description: string; tags: string[] }> = {
  billing: {
    name: 'Billing calls',
    description: 'Calls about bills and payments that are due.',
    tags: ['billing', 'payments'],
  },
  delivery: {
    name: 'Delivery updates',
    description: 'Calls about deliveries and rescheduling.',
    tags: ['delivery'],
  },
  appointments: {
    name: 'Appointment reminders',
    description: 'Calls to confirm or remind about appointments.',
    tags: ['appointments'],
  },
  support: {
    name: 'Customer support',
    description: 'Follow-up calls about support requests.',
    tags: ['support'],
  },
  account_alerts: {
    name: 'Account alerts',
    description: 'Calls about account changes or security.',
    tags: ['security', 'alerts'],
  },
};

export const PURPOSE_LABELS: Record<AgentPurpose, string> = Object.fromEntries(
  AGENT_PURPOSES.map((p) => [p, SKILLS[p].name]),
) as Record<AgentPurpose, string>;

export function skillsFor(purposes: readonly AgentPurpose[]) {
  return purposes.map((id) => ({ id, ...SKILLS[id] }));
}

export interface CachetExtensionParams {
  version: 1;
  company: { legalName: string; legalCountry: string; issuer: string; proofTx: string };
  purposes: AgentPurpose[];
  language: string;
  callingNumbers: string[];
  /** CAIP-10 account of the AI itself (pays seal fees, signs seal requests). */
  agentAccount: string;
  neverCalls: boolean;
}

export const sha256Hex = (bytes: Uint8Array | string) =>
  createHash('sha256')
    .update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes)
    .digest('hex');

/**
 * Add Cachet's extension to the card the registry built (which already carries the
 * "Verified by Concordium" badge in capabilities.extensions). Returns the exact bytes to publish
 * and their SHA-256 — the value pinned on chain.
 */
export function withCachetExtension(
  registryCardJson: string,
  params: CachetExtensionParams,
): { cardJson: string; metadataHash: string } {
  const card = JSON.parse(registryCardJson) as Record<string, unknown>;
  const capabilities = (card['capabilities'] ?? {}) as Record<string, unknown>;
  const extensions = Array.isArray(capabilities['extensions'])
    ? [...(capabilities['extensions'] as unknown[])]
    : [];
  const others = extensions.filter((e) => (e as { uri?: unknown } | null)?.uri !== CACHET_EXTENSION_URI);
  others.push({
    uri: CACHET_EXTENSION_URI,
    description:
      'Cachet: every call from this AI caller carries a seal people can check. No seal means it is not this caller.',
    required: false,
    params,
  });
  card['capabilities'] = { ...capabilities, extensions: others };
  // Same layout as the registry's own output: 2-space indent, no trailing newline.
  const cardJson = JSON.stringify(card, null, 2);
  return { cardJson, metadataHash: sha256Hex(cardJson) };
}
