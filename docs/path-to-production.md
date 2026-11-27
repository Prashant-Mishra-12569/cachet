# Path to production

Cachet runs today on the Concordium **testnet**, with a real test company, a real AI phone agent, real Telegram
users and real on-chain payments. This page explains what it takes to go live on **mainnet** with real companies and
real people, and how Cachet makes money.

## 1. What already works (and stays the same on mainnet)

| Part                            | Today (testnet)                                             | On mainnet                                                                                              |
| ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Company identity                | Zero-knowledge proof from a Global FinReg **test** identity | The same proof from a real Global FinReg company identity (LEI or registry documents plus owner checks) |
| AI caller registry              | Concordium Agent Registry `<12802,0>`, Verified badge       | Mainnet registry `<10082,0>`: same contract, same code path                                             |
| Seal fees                       | x402, 0.01 test euro (EUDemo)                               | x402 in a regulated euro token (for example EURQ, MiCA-regulated)                                       |
| Bill payments                   | Sponsored transfer, the person pays 0 CCD                   | The same; the company can sponsor its own customers' fees                                               |
| Records                         | Merkle roots with RegisterData every 5 minutes              | The same                                                                                                |
| Authorised AI Caller credential | Cachet's CIS-4 registry `<13167,0>`                         | A new registry on mainnet from the same template module                                                 |
| People                          | Telegram bot and Mini App                                   | The same, plus an Android app (below)                                                                   |

Moving the code to mainnet is configuration, not a rewrite: the network, the registry address, the token, the
credential registry and funded sponsor and verifier accounts are all settings.

## 2. Mainnet checklist

1. **Identities**: onboard the first companies with real Global FinReg identities; keep the "company identity providers
   only" rule in the proof request.
2. **Accounts**: fund the fee sponsor and the verifier account on mainnet; turn on the low-balance alert (already built)
   to the operator's Telegram.
3. **Token**: switch seal fees and bills to a regulated euro token; request allow-listing where the token needs it.
4. **Calling numbers**: prove that a company owns each number it lists (a one-time call or SMS to that number, or the
   telecom operator's records). Today numbers are declared by the verified company.
5. **Credential registry**: create Cachet's "Authorised AI Caller" registry on mainnet and point the server at it.
6. **Legal**: a data-processing agreement for companies, a final privacy notice (the current one already says exactly
   what is stored), and terms for paid seals.
7. **Operations**: more than one server copy behind the same database and Redis (anchoring, card delivery and
   credential jobs already take Redis locks so they never run twice; the Telegram bot moves from polling to a webhook,
   because polling allows only one copy), daily database backups, uptime alerts on `/healthz`.

## 3. How people get it

- **Telegram first**: no app to install, the card arrives where people already chat. Joining takes under 30 seconds.
- **Companies invite their own customers**: every company gets an invite link, a QR code and ready-to-send SMS, email
  and website texts (already built). The people a company calls are exactly the people it can invite.
- **Families**: one person protects their parents with `/family`; the parent agrees in their own Telegram.
- **Next**: an Android call-screening app that warns on an incoming call automatically when no seal exists, and
  partnerships with caller-ID apps and telecom operators.

## 4. How companies get it

- **Voice-AI platforms are the shortcut**: one integration with a platform (Bolna, Vapi, Retell, Twilio, Exotel) seals
  calls for all of its customers. Cachet already runs real calls through Bolna, and offers an SDK and an MCP server.
- **Regulation pulls demand**:
  - EU AI Act Art. 50: an AI must say it is an AI. Every seal gives the AI its opening sentence, which does this.
  - EU AI Act Art. 12 and TRAI and FCC rules: records and consent. Cachet's anchored records and the printable
    compliance report (already built) give a company proof for every call.
- **Brand protection**: a company that never uses AI callers can say so, and Cachet tells people any such call is a
  scam. The company sees "scam calls using your name" on its dashboard.

## 5. Business model

| Who                | Pays                                                        | Why                                                                                                        |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Companies          | **0.01 euro per sealed call** via x402 (volume tiers later) | More answered calls, fewer people hanging up on real calls, proof of compliance, protection of their brand |
| People             | **Nothing**                                                 | Cachet only works if everyone can use it                                                                   |
| Voice-AI platforms | Nothing extra; they resell sealed calls                     | A trust feature their customers ask for                                                                    |

Each seal costs Cachet very little on chain: the records of thousands of calls fit in one 39-byte RegisterData every
5 minutes, and seal fees settle through x402. The fee sponsor's costs (people's bill payments) can be passed to the
company that asked for the payment.

## 6. Next 90 days

1. **Pilot** with one or two voice-AI agencies (starting with calling-agent clients the founder already works with).
2. **Calling-number ownership** checks and the Android call-screening companion.
3. **Apply to Concordium's grants programme** with pilot numbers.
4. **Mainnet launch** with the first verified companies.
