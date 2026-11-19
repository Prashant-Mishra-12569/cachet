# Cachet Agent Card extension, v1

**URI:** `https://github.com/Prashant-Mishra-12569/cachet/blob/main/docs/extensions/cachet-v1.md`

An [A2A](https://a2a-protocol.org) `AgentExtension` placed in an Agent Card's `capabilities.extensions`,
next to the Concordium "Verified by Concordium" badge extension. It describes an AI **phone caller** that seals
its calls with Cachet. A call from this agent is genuine only if the person receives a matching Cachet seal.

```json
{
  "uri": "https://github.com/Prashant-Mishra-12569/cachet/blob/main/docs/extensions/cachet-v1.md",
  "description": "Cachet: every call from this AI caller carries a seal people can check. No seal means it is not this caller.",
  "required": false,
  "params": {
    "version": 1,
    "company": {
      "legalName": "Northwind Energy BV",
      "legalCountry": "NL",
      "issuer": "did:ccd:testnet:idp:4",
      "proofTx": "<Verification Audit Anchor transaction hash>"
    },
    "purposes": ["billing", "support"],
    "language": "en",
    "callingNumbers": ["+31201234567"],
    "agentAccount": "ccd:4221332d34e1694168c2a0c0b3fd0f27:<base58 account>",
    "neverCalls": false
  }
}
```

| Field            | Meaning                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`        | Always `1` for this URI. A breaking change gets a new URI.                                                                                                                                                     |
| `company`        | The legal name and country **revealed by a Concordium zero-knowledge proof** of a company identity (Verify & Access). `issuer` is the identity provider; `proofTx` is the on-chain audit anchor of that proof. |
| `purposes`       | Why this agent may call: `billing`, `delivery`, `appointments`, `support`, `account_alerts`.                                                                                                                   |
| `language`       | ISO 639-1 language the agent speaks.                                                                                                                                                                           |
| `callingNumbers` | E.164 numbers the agent calls from. A number alone proves nothing (caller ID can be spoofed); only a seal does.                                                                                                |
| `agentAccount`   | CAIP-10 Concordium account of the AI itself. It prepays seals via x402 and signs seal requests.                                                                                                                |
| `neverCalls`     | `true` if the company declares it never makes AI calls. Any call claiming to be it is a scam.                                                                                                                  |

The card's SHA-256 is pinned on chain in the CIS-8004 Agent Registry (`setAgentURI`), so any change to these
values needs a new on-chain pin. Payments for a sealed call go only to the agent's on-chain `agentWallet`.
