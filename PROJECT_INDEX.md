# Project Index: demos-faucet

Generated: 2026-02-19

## 📁 Project Structure

```
demos-faucet/
├── src/                    # Frontend source
│   ├── server.ts          # Hono server (serves HTML, injects env)
│   ├── index.html         # Main HTML page
│   ├── styles/main.css    # Styles
│   └── scripts/main.ts    # Frontend App class (API calls)
├── server/                 # Backend source
│   ├── src/
│   │   ├── index.ts       # Express API + FaucetServer class
│   │   ├── safeguards.ts  # Rate limiting, quotas, SQLite DB
│   │   ├── security.ts    # DDoS, validation, logging middleware
│   │   └── test.ts        # Test file
│   ├── faucet.db          # SQLite database (runtime)
│   └── package.json
├── dist/                   # Built frontend JS
├── docker-compose.yml      # Multi-container setup
├── Dockerfile.frontend     # Frontend container
└── Dockerfile.client       # Client container
```

## 🚀 Entry Points

| Service | Path | Port | Description |
|---------|------|------|-------------|
| Frontend | `src/server.ts` | 4442 | Hono server, serves UI, injects backend URL |
| Backend | `server/src/index.ts` | 3010 | Express API, token transfers, safeguards |

## 📦 Core Modules

### Frontend

| Module | Path | Purpose |
|--------|------|---------|
| App | `src/scripts/main.ts` | UI logic, form handling, API calls to backend |
| Server | `src/server.ts` | Static file serving, env injection into HTML |

### Backend

| Module | Path | Exports | Purpose |
|--------|------|---------|---------|
| FaucetServer | `server/src/index.ts:93` | `FaucetServer`, `transferTokens()` | Main server class, wallet connection |
| Safeguards | `server/src/safeguards.ts` | `Safeguards` | Rate limiting, quota tracking, SQLite |
| Security | `server/src/security.ts` | `logger`, `createRateLimit`, `DDoSProtection`, `validateFaucetRequest` | Express security middleware |

## 🔌 API Endpoints

### Backend (port 3010)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | API info |
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

## 🔧 Configuration

| File | Purpose |
|------|---------|
| `.env` (root) | `REMOTE_BACKEND_URL` for frontend |
| `server/.env` | `MNEMONIC`, `PUBLIC_KEY`, `RPC_URL`, `TIME_INTERVAL`, `NUMBER_PER_INTERVAL`, `MAX_AMOUNT`, `PORT` |
| `docker-compose.yml` | Container orchestration |

## 🔗 Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| @kynesyslabs/demosdk | ^2.2.70 | Demos blockchain SDK |
| hono | ^4.0.0 | Frontend web framework |
| express | ^4.19.2 | Backend web framework |
| bun:sqlite | - | Database (via Bun runtime) |
| helmet | ^7.0.0 | Security headers |
| winston | ^3.11.0 | Logging |

## 📝 Quick Start

```bash
# Install dependencies
bun install && cd server && bun install

# Development (runs both services)
bun run dev

# Or run separately:
bun run dev:frontend    # Frontend on :4442
bun run dev:backend     # Backend on :3010

# Production with Docker
docker-compose up --build
```

## 🔒 Security Features

- Server-controlled token amounts (50 DEM base, 100 DEM with identity)
- Two-phase commit: check → transfer → record
- Rate limiting per IP and address
- DDoS protection with auto-blocking
- Input validation (66-char hex addresses)
- SQLite transactions for quota safety

## 📊 Data Flow

```
User → Frontend (:4442) → Backend API (:3010) → Demos Network
                              ↓
                         SQLite (faucet.db)
```
