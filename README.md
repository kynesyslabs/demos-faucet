# demos-faucet

A faucet for the Demos Network

## Structure

### Server

The server is the backend of the Demos faucet.
It takes an `.env` file that defines the private key of the Demos wallet to be used by the frontend faucet and a couple of other options.

It is launched with

```bash
bun install
bun run src/index.ts
```

Tests and type checks (run inside `server/`):

```bash
bun test src
bun run typecheck
```

### Beta mainnet

DEM on the beta mainnet has no market value and the faucet is the only way users get it, so its output is capped hard. All caps share one sliding window, `TIME_INTERVAL` seconds, and are counted from the SQLite request history (`FAUCET_DB_PATH`; keep it on persistent storage, `docker-compose.yml` puts it on the `data` volume):

| Cap | Variables | Example |
| --- | --- | --- |
| Per request and per address | `MAX_AMOUNT` DEM, `NUMBER_PER_INTERVAL` requests | 100 DEM, 1 request per day |
| Per client IP (IPv6 per /64) | `MAX_AMOUNT_PER_IP` DEM, `NUMBER_PER_IP_PER_INTERVAL` requests | 300 DEM, 3 requests per day |
| Whole faucet | `GLOBAL_MAX_AMOUNT_PER_INTERVAL` DEM | 50000 DEM per day |

- The address must be `0x` + 64 hex characters (case-insensitive) and the amount a positive whole number of DEM not above `MAX_AMOUNT`.
- The client IP comes from Express `req.ip`. Set `TRUST_PROXY_HOPS` to the number of reverse proxies in front of the server (default 1); a higher value lets clients forge their IP through `X-Forwarded-For`.
- Transfers go out one at a time (the node requires the exact next nonce) and the request returns once the transaction is included or failed. A transfer that fails or is never sent does not use the allowance; one that times out (`TRANSFER_TIMEOUT_MS`) keeps it, since it may still land.
- The faucet wallet (the address derived from `MNEMONIC`) must be funded in the beta mainnet genesis; the faucet cannot mint.
- `RPC_URL` must point at a node of the target network. The server needs `@kynesyslabs/demosdk` 4.0.22 or later to sign for the mainnet chain.

See `server/.env.example` for every variable.

### Frontend (root folder)

The frontend needs to be configured with the `.env` file to call the right options on the right backend.

To run it, execute:

```bash
bun install
bun start
```

#### On webpack problems (like segfault)

**NOTE:** This is valid only for the frontend

On your local working environment, set everything (included .env) as it would be on the remote server or non working environment.

Then run:

```bash
bun run build
```

and commit/copy files in `dist/` to your non working environment.

Then, you can run:

```bash
bun run serve
```

To use the prebuilt files on production.
