# OAuth Nostr Remote Signer — Design Document

## Overview

A NIP-46 remote signer (bunker) in Rust that authenticates users via Google/GitHub OAuth. Users type a domain into any NIP-46-compatible Nostr client, authenticate via an OAuth popup, and get a fully managed Nostr identity — no key management required.

**Target users:**
- New Nostr users who don't want to manage keys
- Enterprises/teams that want organizational control via SSO

## Architecture

Single Rust binary containing all components:

```
┌──────────────────────────────────────────────────┐
│              OAuth Signer (Rust)                  │
│                                                   │
│  ┌─────────────┐    ┌─────────────────────────┐   │
│  │  Web Layer  │    │     NIP-46 Bunker       │   │
│  │  (Axum)     │    │                         │   │
│  │             │    │  - Subscribe to relays   │   │
│  │  - OAuth    │    │  - Decrypt requests      │   │
│  │    callback │    │  - Sign events           │   │
│  │  - Web UI   │    │  - Encrypt responses     │   │
│  │  - API      │    │  - Auto-detect NIP-04/44 │   │
│  │  - Static   │    │  - Verify signatures     │   │
│  │    assets   │    │                         │   │
│  └──────┬──────┘    └────────┬────────────────┘   │
│         │                    │                    │
│         ▼                    ▼                    │
│  ┌────────────────────────────────────────────┐   │
│  │          Key Store (SQLite + AES-256-GCM)  │   │
│  │                                            │   │
│  │  users: oauth_id → encrypted_nsec          │   │
│  │  sessions: client_pubkey → user_id         │   │
│  │  connections: active NIP-46 connections     │   │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
         │                         │
    OAuth Providers           Nostr Relays
   (Google, GitHub)      (relay.nsec.app, etc.)
```

## User Flow

Domain-based, two-interaction flow:

1. User opens any NIP-46 compatible Nostr client (Coracle, Yakihonne, etc.)
2. Types `signer.example.com` in the remote signer / bunker login field
3. Client resolves `/.well-known/nostr.json` → gets bunker pubkey + relays
4. Client sends NIP-46 `connect` → bunker responds with `auth_url`
5. OAuth popup opens → user clicks "Sign in with Google" or "Sign in with GitHub"
6. **First-time user:** bunker generates keypair, encrypts nsec, stores user record
7. **Returning user:** bunker finds existing user by OAuth identity
8. Connection approved → client receives `ack` → ready to sign

```
┌─────────────────────────────────────────────────────┐
│  Any NIP-46 Nostr Client                            │
│                                                     │
│  "Login with remote signer"                         │
│  ┌───────────────────────────────┐                  │
│  │ signer.example.com            │                  │
│  └───────────────────────────────┘                  │
│                    │                                │
│                    ▼                                │
│  ┌───────────────────────────────┐                  │
│  │   OAuth popup opens           │◄── auth_url      │
│  │   ┌─────────────────────┐    │    from bunker    │
│  │   │ Sign in with Google │    │                   │
│  │   │ Sign in with GitHub │    │                   │
│  │   └─────────────────────┘    │                   │
│  └───────────────────────────────┘                  │
│                    │                                │
│                    ▼                                │
│  Connected! You are npub1abc...                     │
└─────────────────────────────────────────────────────┘
```

## NIP-46 Protocol

### Supported Methods

| Method | Behavior |
|---|---|
| `connect` | Validate secret → check session → if none, return `auth_url` → on OAuth, create session, reply `ack` |
| `get_public_key` | Return user's hex pubkey from session |
| `sign_event` | Decrypt nsec, sign event, zeroize key, return signed event JSON |
| `nip44_encrypt` | Encrypt using user's key + recipient pubkey |
| `nip44_decrypt` | Decrypt using user's key + sender pubkey |
| `nip04_encrypt` | Legacy NIP-04 encrypt (backward compat) |
| `nip04_decrypt` | Legacy NIP-04 decrypt (backward compat) |
| `ping` | Return `pong` |

### Default Relays

Configurable via environment variable `NOSTR_RELAYS`:

- `wss://relay.nsec.app` — NIP-46 optimized
- `wss://relay.damus.io` — high availability
- `wss://nos.lol` — popular general relay

### Connection Flow

```
Client                          Bunker                        OAuth Provider
  │                               │                               │
  │ 1. GET /.well-known/nostr.json│                               │
  │ ◄─────────────────────────────│                               │
  │    {bunker_pubkey, relays}    │                               │
  │                               │                               │
  │ 2. kind:24133 connect         │                               │
  │    [bunker_pubkey, secret]    │                               │
  │ ──────────────────────────────►                               │
  │                               │                               │
  │ 3. No session → auth_url      │                               │
  │    /auth/{request_id}         │                               │
  │ ◄──────────────────────────── │                               │
  │                               │                               │
  │ 4. Client opens popup ────────┼──► OAuth login page           │
  │                               │        │                      │
  │                               │        │ 5. User authenticates│
  │                               │        │──────────────────────►
  │                               │        │                      │
  │                               │        │ 6. Callback          │
  │                               │◄───────┘                      │
  │                               │                               │
  │                               │ 7. Create/find user,          │
  │                               │    generate keypair if new,   │
  │                               │    create session             │
  │                               │                               │
  │ 8. kind:24133 result: "ack"   │                               │
  │ ◄──────────────────────────── │                               │
```

### Encryption Handling

- Auto-detect incoming: check for `?iv=` → NIP-04, otherwise NIP-44
- Always respond with NIP-44
- Always verify signatures on incoming kind:24133 events

### Reconnection Strategy

- Exponential backoff: 1s base, 2x multiplier, 30s max, with jitter
- Max 20 attempts before 5-minute cooldown
- Periodic relay health check every 60s

## Key Management

### Generation & Import

- On first OAuth login: generate secp256k1 keypair using `nostr` Rust crate
- Users can optionally import their own nsec via web UI

### Encryption at Rest

- Each nsec encrypted with AES-256-GCM
- Encryption key derived via HKDF from server master key + user ID as context
- Each user has a unique derived encryption key
- Master key loaded from environment variable or file (never in DB)

### Key Lifecycle

- **Create:** OAuth login → generate keypair → encrypt nsec → store in SQLite
- **Use:** NIP-46 request → load encrypted nsec → decrypt in memory → sign → zeroize via `zeroize` crate
- **Import:** Web UI → user pastes nsec → encrypt → store (replaces generated key)
- **No export:** Server-generated keys are managed by the service. Users who imported keys already have them.

### Database Schema

```sql
users (
    id              TEXT PRIMARY KEY,     -- UUID
    oauth_provider  TEXT NOT NULL,        -- "google" | "github"
    oauth_sub       TEXT NOT NULL,        -- OAuth subject ID
    encrypted_nsec  BLOB NOT NULL,        -- AES-256-GCM encrypted
    nonce           BLOB NOT NULL,        -- GCM nonce
    pubkey          TEXT NOT NULL,        -- hex pubkey for lookups
    created_at      INTEGER NOT NULL,
    UNIQUE(oauth_provider, oauth_sub)
)

connections (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    client_pubkey   TEXT NOT NULL,        -- connecting client's pubkey
    shared_secret   TEXT,                 -- NIP-46 connection secret
    relay_url       TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    last_used_at    INTEGER NOT NULL
)

sessions (
    token           TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id),
    expires_at      INTEGER NOT NULL
)
```

## Web UI

### Tech Stack

React + TypeScript + Shadcn/ui + Tailwind CSS, built at compile time and embedded into the Rust binary as static assets (via `rust-embed` or `include_dir`). Axum serves them at `/`.

### Pages

**Landing (`/`):** Explains the service. "Sign in with Google" / "Sign in with GitHub" buttons.

**Dashboard (`/dashboard`):**
- Your identity: npub (copyable), OAuth profile info (name, avatar)
- Connection domain: `signer.example.com` with copy button + instructions
- Connected apps: list of NIP-46 clients (with app name resolved via NIP-89 kind:0, last used, revoke button)
- Import key: form to paste existing nsec (with confirmation warning)

**Auth popup (`/auth/{request_id}`):** Opened by NIP-46 auth_url flow. Shows OAuth buttons. After auth, approves pending connection and closes popup.

### API Endpoints

```
GET    /api/me                  → Current user info + npub
GET    /api/connections         → List connected clients
DELETE /api/connections/:id     → Revoke a connection
POST   /api/import-key          → Import nsec
GET    /.well-known/nostr.json  → Bunker pubkey + relays (NIP-05 style)
GET    /health                  → Relay + DB status
```

## Security

### Authentication

| Concern | Mitigation |
|---|---|
| OAuth token theft | Short-lived codes, server-side validation only. No long-term token storage |
| Session hijacking | Sessions tied to `client_pubkey`. 32-byte cryptographically random IDs (`rand::OsRng`) |
| Connection spoofing | NIP-46 `secret` required on connect, verified against pending auth requests |
| Replay attacks | Signature verification on all kind:24133 events. Deduplicate by event ID |
| auth_url phishing | CSRF token in auth_url, validated on OAuth callback. 10-minute TTL on pending requests |

### Key Protection

| Concern | Mitigation |
|---|---|
| Database compromise | AES-256-GCM encryption, unique derived key per user |
| Memory exposure | `zeroize` crate wipes keys immediately after signing |
| Master key protection | Loaded from env/file at startup, never in DB or logs |
| Key in logs | Never log private keys or decrypted material |

### Rate Limiting

In-memory token bucket (no Redis):

```
NIP-46 requests:  30/min per client_pubkey
OAuth attempts:    5/min per IP
API endpoints:    60/min per session
Failed connects:   3/min per IP
```

### Error Handling

| Layer | Approach |
|---|---|
| NIP-46 protocol | NIP-46 error responses, human-readable. Never expose internals |
| OAuth flow | Redirect to generic error page. Log details server-side |
| Key operations | Isolate per-user failures. Log + NIP-46 error, don't crash bunker |
| Relay disconnection | Reconnect with backoff. Buffer responses briefly (5s) |
| Database | SQLite WAL mode. Retry transient failures 3x. Cache active sessions in memory |

### Startup Validation

- Verify master encryption key is set and valid
- Test SQLite database is accessible and migrated
- Test connectivity to at least 1 configured relay
- Fail fast with clear error messages

### Monitoring

- Structured JSON logging to stdout
- Metrics: active connections, signing ops/min, relay health, auth failures
- `GET /health` endpoint

## Competitor Comparison

| | nsecBunkerd | Noauth (nsec.app) | OpenBunker | This project |
|---|---|---|---|---|
| OAuth login | "OAuth-like" (app auth, not identity) | OAuth-like flow | Discord only | Google + GitHub |
| Key custody | Self-hosted, user-managed | Non-custodial (browser) | Custodial (plaintext DB!) | Custodial (AES-256-GCM) |
| Tech stack | TypeScript/Node.js | TypeScript monorepo | Next.js/Supabase | Rust single binary |
| Auto key gen | No | Yes (in browser) | Yes (plaintext) | Yes (encrypted) |
| Signature verification | Yes | Yes | Disabled (TODO) | Yes |
| Session expiry | Unknown | Unknown | Not enforced | Enforced (24h sliding) |
| Deployment | Docker + external UI | Web app | Docker + Supabase | Single binary |

## Tech Stack

- **Language:** Rust
- **Web framework:** Axum
- **Database:** SQLite (via `rusqlite` or `sqlx`)
- **Nostr:** `nostr` + `nostr-sdk` crates
- **Crypto:** `aes-gcm`, `hkdf`, `sha2`, `zeroize`
- **OAuth:** Custom implementation (token exchange via `reqwest`)
- **Frontend:** React + TypeScript + Shadcn/ui + Tailwind CSS
- **Embedding:** `rust-embed` or `include_dir` for static assets
