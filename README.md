# Cachet

**The seal on every AI call.**

Banks, couriers and scammers now all call people with AI voices that sound the same, and caller ID can be faked.
Cachet gives every honest AI calling agent a verified Concordium identity. Every call carries a seal that shows up
in the person's Telegram with a matching call code. No seal? Don't trust, don't pay, don't share codes.

Built for the Concordium Trusted Agents Hackathon (Encode Club). Work in progress.

## Repository layout

```text
apps/
  server/        one Node process: api/, bot/, facilitator/, worker/
  web/           Next.js website, verify pages, business dashboard
packages/
  shared/        constants and types shared by every app
  concordium/    Concordium gRPC, token and Agent Registry helpers
scripts/         find-tokens, grpc-smoke, registry-check
infra/           docker-compose for local Postgres + Redis
```

## Quick start

Requires Node 24+ and pnpm.

```bash
pnpm install
cp .env.example .env      # then fill in values
pnpm dev                  # web on :3000, server on :8787
```

Useful checks (Concordium testnet):

```bash
pnpm registry:check       # Agent Registry service + testnet contract addresses
pnpm find-tokens          # list Protocol-Level Tokens and their decimals
pnpm smoke:grpc           # read balance + next nonce for accounts in .env
```

## Author

Prashant Mishra
