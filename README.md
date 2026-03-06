# OAuth Signer

A Nostr bunker service that bridges OAuth providers (Google, GitHub, Microsoft, Apple) with Nostr identity management via [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md) remote signing.

Users authenticate with familiar OAuth providers and gain access to Nostr identities managed on a secure LAN-based bunker. Signing operations happen through the NIP-46 protocol, keeping private keys isolated from the internet-facing web service.

## Architecture

The project uses a split architecture for security:

- **Bunker** (LAN-only) — Holds encrypted NSECs, connects outbound to Nostr relays, handles NIP-46 signing requests. Admin API lives here.
- **Web Service** (internet-facing) — Handles OAuth authentication, session management, and the identity picker UI. Communicates with the bunker via NIP-44 encrypted relay events.

NSECs never leave the bunker process. A web service compromise does not leak signing keys.

### Connection Flow

1. A Nostr client sends a NIP-46 connect request to a relay
2. The bunker receives it, creates a pending auth record, and responds with an auth URL
3. The user completes OAuth in the browser and selects an identity
4. The web service sends an encrypted approval to the bunker via relay
5. The bunker completes the NIP-46 handshake — the client can now sign events

## Tech Stack

**Backend:** Rust, Axum, nostr-sdk, SQLite (rusqlite), AES-GCM encryption

**Frontend:** React 19, TypeScript, Vite, Tailwind CSS, Radix UI / shadcn

## Prerequisites

- Rust 1.70+
- Node.js 18+

## Setup

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```bash
# Required — generate with: openssl rand -hex 32
MASTER_KEY=

# At least one OAuth provider
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional providers
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=

APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=

# Server
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=http://localhost:3000

# Nostr relays (comma-separated)
NOSTR_RELAYS=wss://relay.nsec.app,wss://relay.damus.io,wss://nos.lol

# Database
DATABASE_URL=oauth-signer.db
```

Set `ADMIN_PUBKEYS` (comma-separated hex pubkeys) to grant admin access.

## Development

Build the frontend:

```bash
cd web-ui
npm install
npm run dev
```

Run the backend:

```bash
cargo run
```

The backend serves on `http://127.0.0.1:3000`. The Vite dev server runs on `http://localhost:5173` with HMR.

## Production

```bash
cd web-ui && npm run build && cd ..
cargo build --release
./target/release/oauth-signer
```

The release binary embeds the built frontend assets — no separate web server needed.

For deployment behind Cloudflare Tunnel, see [TUNNEL-SETUP.md](TUNNEL-SETUP.md).

## Admin

The admin panel (`/admin`) is protected by [NIP-98](https://github.com/nostr-protocol/nips/blob/master/98.md) HTTP authentication. Only pubkeys listed in `ADMIN_PUBKEYS` can access it.

Admin capabilities:
- Add/remove Nostr identities
- Assign identities to users with time-based expiration
- View connections and user activity

## API

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/auth/:provider` | Start OAuth flow |
| GET | `/auth/:provider/callback` | OAuth callback |
| POST | `/api/select-identity` | Select identity for connection |
| GET | `/api/me` | Current user info |
| GET | `/api/identities` | List available identities |
| POST | `/api/logout` | End session |

### Admin (NIP-98)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/identities` | Add identity |
| DELETE | `/api/admin/identities/:id` | Remove identity |
| GET | `/api/admin/users` | List users |
| GET | `/api/admin/assignments` | List assignments |
| POST | `/api/admin/assignments` | Create assignment |
| DELETE | `/api/admin/assignments/:id` | Revoke assignment |
| GET | `/api/admin/connections` | List connections |

## Documentation

Full documentation is available at the [docs site](docs-site/) and covers OAuth provider setup, configuration reference, architecture details, deployment, and troubleshooting.

## License

MIT
