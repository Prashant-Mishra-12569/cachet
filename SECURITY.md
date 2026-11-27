# Security

Cachet protects people from scam calls, so its own security matters. Thank you for helping.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately on GitHub:
**Security** tab → **Report a vulnerability** (private vulnerability reporting is turned on for this repository).

Please include what you found, how to reproduce it, and what an attacker could do with it. You will get an answer
within a few days.

## Scope

- The website and API: `getcachet.site`, `api.getcachet.site`
- The Telegram bot `@CachetSealBot` and its Mini App
- The code in this repository (server, website, SDK, MCP server)

Cachet runs on the Concordium **testnet**; no real money is at risk. Please don't run load tests or automated scans
against the live site, and never use other people's phone numbers or data.

## How Cachet is protected

The threat model (12 attacks and how each is stopped) is at
[getcachet.site/developers#threats](https://getcachet.site/developers#threats), and the design is in
[docs/architecture.md](docs/architecture.md). Besides the automated tests, `pnpm red-team` runs 1,000 simulated
calls (real and fake) against a local server and must show 0 false greens.
