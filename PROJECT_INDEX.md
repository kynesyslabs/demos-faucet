# Project Index: demos-faucet

Generated: 2026-04-04 (Updated)

## Project Structure

```
demos-faucet/
├── src/                    # Frontend source
│   ├── server.ts          # Hono server (serves HTML, injects env)
│   ├── index.html         # Main HTML page (accessible, ARIA labels)
│   ├── styles/
│   │   ├── main.css       # Styles (glassmorphism, animations)
│   │   ├── demos-logo.svg # Logo asset
│   │   └── fonts/         # Neue Machina + Inter Variable
│   └── scripts/
│       ├── main.ts        # Frontend App class (API calls, UI effects)
│       └── dist/main.js   # Pre-built browser bundle
├── server/                 # Backend source
│   ├── src/
│   │   ├── index.ts       # Express API + FaucetServer class
│   │   ├── safeguards.ts  # Rate limiting, quotas, identity checks
│   │   ├── security.ts    # DDoS, validation, logging middleware
│   │   └── test.ts        # Backend tests
│   ├── faucet.db          # SQLite database (runtime)
│   ├── Dockerfile         # Backend container
│   └── package.json
├── dist/                   # Built frontend JS (webpack output)
├── ANALYSIS_REPORT.md     # Security/UX/Code quality report
├── docker-compose.yml     # Multi-container setup (frontend + backend)
├── Dockerfile.frontend    # Frontend container
├── Dockerfile.client      # Alternative client container
├── run.sh / stop.sh / restart.sh  # Docker convenience scripts
├── webpack.config.js      # Frontend build config
└── package.json           # Frontend dependencies + dev scripts
```

## Entry Points

| Service | Path | Port | Description |
|---------|------|------|-------------|
| Frontend | `src/server.ts` | 4442 | Hono server, serves UI, injects backend URL |
| Backend | `server/src/index.ts` | 3010 | Express API, token transfers, safeguards |

## Core Modules

### Frontend

| Module | Path | Purpose |
|--------|------|---------|
| App | `src/scripts/main.ts` | UI logic, form handling, tilt effects, cleanup |
| Server | `src/server.ts` | Static file serving, env injection into HTML |

### Backend

| Module | Path | Exports | Purpose |
|--------|------|---------|---------|
| FaucetServer | `server/src/index.ts` | `FaucetServer`, `transferTokens()` | Main server class, wallet connection |
| Safeguards | `server/src/safeguards.ts` | `Safeguards` | Rate limiting, identity-based amounts, SQLite |
| Security | `server/src/security.ts` | `logger`, `createRateLimit`, `DDoSProtection` | Express security middleware |

## API Endpoints

### Backend (port 3010)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | API info |
| GET | `/api/test` | Backend connectivity test |
| GET | `/api/health` | Health check |
| GET | `/api/balance` | Faucet wallet balance |
| POST | `/api/request` | Request tokens (body: `{address}`) |
| GET | `/api/stats/address?address=...` | Address statistics |
| GET | `/api/stats/global` | Global faucet statistics |

### Frontend (port 4442)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Main UI (HTML with injected env) |
| GET | `/health` | Health check |
| GET | `/dist/main.js` | Bundled frontend JS |
| GET | `/styles/*` | CSS files |

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MNEMONIC` | - | Wallet seed phrase |
| `PUBLIC_KEY` | - | Wallet public key |
| `RPC_URL` | `https://node2.demos.sh` | Blockchain RPC endpoint |
| `TIME_INTERVAL` | `86400` | Rate limit window (24h) |
| `NUMBER_PER_INTERVAL` | `1` | Max requests per window |
| `MAX_AMOUNT` | `50` | Max DEMOS per window (100 with identity) |
| `PORT` | `3000` | Backend port |
| `REMOTE_BACKEND_URL` | `https://faucetbackend.demos.sh` | Frontend: backend URL to inject |

## Security Features

| Layer | Limit | Scope |
|-------|-------|-------|
| DDoS Protection | 50 req/min | IP |
| General Rate Limit | 100 req/15min | IP |
| Slow Down | +1s delay after 5 req | IP |
| Faucet Rate Limit | 30 req/min | IP |
| Safeguards | Configurable | Address |
| Identity Bonus | 50 → 100 DEMOS | Address |

### Additional Security
- Server-controlled token amounts
- Two-phase commit: check → transfer → record
- SQLite transactions for quota safety
- Input validation (66-char hex addresses)
- Generic error messages to clients
- HSTS, CSP headers (Helmet)

## Design System

### Typography
- **Display**: Neue Machina (300, 400, 800)
- **Body**: Inter Variable (100-900)

### Colors
```css
--background: #02060f;
--accent-primary: #00d4ff;    /* Cyan */
--accent-secondary: #7c4dff;  /* Purple */
--text-muted: #8b99b8;        /* WCAG AA compliant */
--success-green: #19f3a2;
--error-red: #ff4d6d;
```

## Quick Start

```bash
# Install dependencies
bun install && cd server && bun install

# Development (runs both services)
bun run dev

# Or run separately:
bun run dev:frontend    # Frontend on :4442
bun run dev:backend     # Backend on :3010

# Build frontend
bun run build

# Production with Docker
docker-compose up --build
```

## Tech Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Frontend server | Hono | ^4.0.0 |
| Backend server | Express | ^4.19.2 |
| Runtime | Bun | latest |
| Blockchain SDK | @kynesyslabs/demosdk | ^2.4.26 (frontend), ^2.2.70 (server) |
| Database | SQLite (bun:sqlite) | built-in |
| Bundler | Webpack / Bun build | - |
| Logging | Winston | ^3.11.0 |
| Security | Helmet, express-rate-limit, express-slow-down | - |

## Data Flow

```
User → Frontend (:4442) → Backend API (:3010) → Demos Network
                               ↓
                    SQLite (faucet.db)
                    Safeguards (identity check)
```

## Key Architecture Decisions

- **Two-phase commit for token requests**: check quota -> transfer tokens -> record request. Quota only consumed on successful transfer.
- **Server-controlled amounts**: Client only sends address; server determines amount (50 DEM base, 100 DEM with verified identity).
- **Backend URL injection**: Frontend server reads `REMOTE_BACKEND_URL` at runtime and injects it as `window.__BACKEND_URL__` via script tag.
- **Balance caching**: Periodic background updates (30s interval) with retry+exponential backoff; also forced updates before/after transfers.
- **Identity bonus**: `Safeguards.hasConnectedIdentity()` checks address identities via Demos SDK; verified addresses get 2x tokens.

## Known Issues

See `ANALYSIS_REPORT.md` for remaining items:
- Mnemonic getter (`getMnemonic()`) is exposed on FaucetServer class
- DemoSDK version mismatch between frontend (^2.4.26) and server (^2.2.70)
