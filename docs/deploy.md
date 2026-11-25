# Deploying Cachet

- **Website + Telegram Mini App** → Vercel, at `https://getcachet.site`
- **Server** (API, Telegram bot, x402 facilitator, anchoring worker), **Postgres**, **Redis** and the
  **Concordium verifier** → Railway, with the API at `https://api.getcachet.site`

The website forwards `/v1/*` to the API, so browsers only ever talk to `getcachet.site`.
Secrets live only in Railway / Vercel variables. Nothing secret is in the repository or the images.

## 1. Railway project

Create one project with four services:

| Service    | How                                                            | Public domain        |
| ---------- | -------------------------------------------------------------- | -------------------- |
| `Postgres` | Railway's PostgreSQL template                                  | no                   |
| `Redis`    | Railway's Redis template                                       | no                   |
| `verifier` | GitHub repo, config file `infra/verifier/railway.toml`         | no (private network) |
| `server`   | GitHub repo, config file `apps/server/railway.toml`, port 8787 | `api.getcachet.site` |

Keep exactly **one** replica of `server`: the Telegram bot and the anchoring worker must not run twice.

Each service also gets `RAILWAY_DOCKERFILE_PATH` (`apps/server/Dockerfile` / `infra/verifier/Dockerfile`)
so Railway always builds with our Dockerfiles; without it Railway's auto-builder guesses and fails on
the monorepo ("No start command detected"). Root Directory stays empty (the repository root).
`server` also gets `PORT=8787`, the same port its custom domain targets (Railway otherwise assigns 8080
and the domain answers 502).

On Vercel, `getcachet.site` must be the **primary** domain and `www` must redirect to it: the server
only accepts sign-in requests from `WEB_ORIGIN` (`https://getcachet.site`).

### `verifier` variables

| Variable                                             | Value                                                 |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `VERIFIER_KEY_B64`                                   | the verifier account's wallet export, base64 (secret) |
| `CREDENTIAL_VERIFICATION_SERVICE_NODE_GRPC_ENDPOINT` | `https://grpc.testnet.concordium.com:20000`           |

### `server` variables

| Variable                                                                                                                                                                                                               | Value                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                                                                                                                             | `production`                                                                                                              |
| `TRUST_PROXY`                                                                                                                                                                                                          | `true`                                                                                                                    |
| `WEB_ORIGIN`, `MINIAPP_URL`                                                                                                                                                                                            | `https://getcachet.site`                                                                                                  |
| `DATABASE_URL`                                                                                                                                                                                                         | `${{Postgres.DATABASE_URL}}`                                                                                              |
| `REDIS_URL`                                                                                                                                                                                                            | `${{Redis.REDIS_URL}}`                                                                                                    |
| `VERIFIER_URL`                                                                                                                                                                                                         | `http://${{verifier.RAILWAY_PRIVATE_DOMAIN}}:8000`                                                                        |
| `VERIFIER_HEALTH_URL`                                                                                                                                                                                                  | `http://${{verifier.RAILWAY_PRIVATE_DOMAIN}}:8001/health`                                                                 |
| `CCD_SPONSOR_KEY_B64`                                                                                                                                                                                                  | the sponsor account's wallet export, base64 (secret)                                                                      |
| `TELEGRAM_BOT_TOKEN`, `GIST_TOKEN`                                                                                                                                                                                     | secrets                                                                                                                   |
| `SEAL_SIGNING_KEY`, `CALL_CODE_SECRET`, `PHONE_PEPPER`, `PHONE_ENC_KEY`, `SESSION_SECRET`                                                                                                                              | **the same values as the database they serve** (phone fingerprints, encrypted numbers and seal signatures depend on them) |
| account addresses (`CCD_*_ADDRESS`, `CACHET_TREASURY_ADDRESS`), `CCD_NETWORK`, `PLT_TOKEN_ID`, `PLT_DECIMALS`, `COMPANY_ID_ISSUERS`, `AGENT_REGISTRY_API`, `X402_FACILITATOR`, `SEAL_PRICE`, `ANCHOR_INTERVAL_SECONDS` | public settings, see `.env.example`                                                                                       |

Shortcut: `pnpm deploy:env server` (or `verifier`) builds these from the local `.env` and copies
them to the clipboard without printing them; paste into the service's **Variables → Raw Editor**.

Key files are never uploaded. To put a wallet export into a variable, base64 it on your own machine and
paste it into Railway (PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("<path>")) | Set-Clipboard`).

## 2. Existing data

A fresh database would lose what is already proven and registered on chain. Copy it once, after
`Postgres` is up and before `server` first starts:

```powershell
$env:TARGET_DATABASE_URL = "<Postgres → Variables → DATABASE_PUBLIC_URL>"
pnpm db:copy
```

## 3. Vercel project

Import the GitHub repo, **Root Directory** `apps/web`, Node.js 24. `apps/web/vercel.json` sets the
install and build commands.

| Variable                            | Value                                         |
| ----------------------------------- | --------------------------------------------- |
| `API_URL`                           | `https://api.getcachet.site`                  |
| `NEXT_PUBLIC_CCD_NETWORK`           | `testnet`                                     |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | the bot's username                            |
| `WALLETCONNECT_PROJECT_ID`          | the WalletConnect (Reown) project id (public) |
| `ENABLE_EXPERIMENTAL_COREPACK`      | `1` (uses the repo's pnpm version)            |

## 4. Domains (DNS at the registrar)

- `getcachet.site` → Vercel (add the domain in Vercel, then create the records it shows).
- `api.getcachet.site` → Railway (add the custom domain on `server`, then create the CNAME it shows).

## 5. After the first deploy

- `https://api.getcachet.site/healthz` → `"database":"ok","redis":"ok","verifier":"ok"`.
- The bot runs on Railway now. A second copy with the same token (e.g. a local `pnpm dev`) makes
  Telegram refuse one of them: leave `TELEGRAM_BOT_TOKEN` empty locally, or use a separate dev bot.
- Command-line tools target the live API with `CACHET_API_URL=https://api.getcachet.site`.
