# Split Architecture: Web Service + LAN Bunker

Production deployment where NSECs never leave the LAN. The web service
handles OAuth and the identity picker. The bunker handles NIP-46 signing.
They communicate via a single Nostr relay event for connection approval.

## Components

**Bunker (LAN-only, no inbound connections)**
- Holds NSECs and MASTER_KEY
- Outbound websocket connections to Nostr relays
- Handles all NIP-46 requests (connect, sign_event, etc.)
- Admin API for managing identities and assignments
- Writes to shared SQLite DB

**Web Service (internet-facing)**
- OAuth flow (Google, GitHub, Microsoft, Apple)
- Session management
- Identity picker UI
- Reads shared SQLite DB (identities + assignments, no NSECs)
- Has its own Nostr keypair for sending approval events

**Shared SQLite DB (LAN)**
- Bunker: read/write (source of truth for identities, assignments, connections)
- Web service: read-only (queries identities + assignments for the picker)
- Web service: read/write for its own tables (users, sessions)

## What each service needs to know

| Data | Bunker | Web Service |
|---|---|---|
| NSECs / MASTER_KEY | Yes | **No** |
| Identity pubkeys + labels | Yes (owns) | Yes (read-only, for picker) |
| User ↔ identity assignments | Yes (owns) | Yes (read-only, for picker) |
| OAuth credentials | No | Yes |
| Users / sessions | No | Yes (owns) |
| Pending auth requests | Yes (owns) | No |
| Connections | Yes (owns) | No |

## Connection flow

Example: Alice uses Habla (a Nostr client) to post articles with
an npub managed by the bunker.

### Step 1 — Client requests connection

```
Habla → Relay → Bunker
```

Standard NIP-46 connect request (kind 24133):

```json
{
  "id": "req_001",
  "method": "connect",
  "params": ["bunker_pk", "", "sign_event"]
}
```

Bunker creates a pending_auth record:

```
pending_auth = {
  request_id: "abc123",
  client_pubkey: "client_pk",
  relay_url: "wss://relay.damus.io",
  nip46_id: "req_001"
}
```

### Step 2 — Bunker responds with auth URL

```
Bunker → Relay → Habla
```

NIP-46 response pointing at the **web service**:

```json
{
  "id": "req_001",
  "result": "auth_url",
  "error": "https://web.example.com/auth/abc123"
}
```

Habla opens this URL in Alice's browser.

### Step 3 — OAuth + identity selection

```
Alice's browser ↔ Web Service (HTTPS only, no relay involvement)
```

1. Web service redirects Alice to Google OAuth
2. Alice authenticates, Google redirects back to callback
3. Web service exchanges code, finds/creates user, sets session cookie
4. Web service redirects to identity picker at `/auth-popup/abc123`
5. Web service queries shared DB for Alice's assigned identities
6. Alice picks `npub1_writer`

No bunker involvement in any of this. The web service reads identities
and assignments from the shared DB.

### Step 4 — Web service sends approval via relay

```
Web Service → Relay → Bunker
```

The single internal message. Encrypted to bunker's pubkey:

```json
{
  "kind": 24133,
  "pubkey": "web_pk",
  "tags": [["p", "bunker_pk"]],
  "content": nip44_encrypt(web_sk, bunker_pk, {
    "type": "connection_approved",
    "request_id": "abc123",
    "identity_id": "uuid_writer",
    "user_id": "alice_uuid"
  })
}
```

### Step 5 — Bunker completes the handshake

Bunker receives the approval, verifies it came from `web_pk` (trusted),
matches it to the pending_auth by `request_id`, and stores the connection:

```
connection = {
  user_id: "alice_uuid",
  client_pubkey: "client_pk",
  relay_url: "wss://relay.damus.io",
  identity_id: "uuid_writer"
}
```

Sends NIP-46 ack to Habla:

```
Bunker → Relay → Habla
```

```json
{
  "id": "req_001",
  "result": "ack"
}
```

Connection established.

### Step 6 — Signing (steady state)

```
Habla → Relay → Bunker → Relay → Habla
```

Standard NIP-46 sign_event. Web service is not involved at all.
Bunker decrypts nsec, signs, zeroizes, responds.

## Sequence diagram

```
Habla           Relay          Bunker (LAN)      Web (public)     Google
  │                │                │                │               │
  │──connect──────►│───────────────►│                │               │
  │                │                │ create         │               │
  │                │                │ pending_auth   │               │
  │◄──auth_url─────│◄───────────────│                │               │
  │                │                │                │               │
  │ open browser   │                │                │               │
  │───────────────────────────────────────────────►│               │
  │                │                │    redirect   │               │
  │                │                │                │──────────────►│
  │                │                │                │◄─────callback─│
  │                │                │                │ exchange code │
  │                │                │                │ create user   │
  │                │                │                │ show picker   │
  │                │                │                │ (reads shared │
  │                │                │                │  DB for       │
  │                │                │                │  identities)  │
  │                │                │                │               │
  │                │                │  Alice picks   │               │
  │                │                │  identity      │               │
  │                │  approval      │◄───────────────│               │
  │                │◄───────────────│                │               │
  │                │                │ store          │               │
  │                │                │ connection     │               │
  │◄──ack──────────│◄───────────────│                │               │
  │                │                │                │               │
  │  connected     │                │                │               │
  │                │                │                │               │
  │──sign_event───►│───────────────►│                │               │
  │                │                │ decrypt nsec   │               │
  │                │                │ sign           │               │
  │                │                │ zeroize        │               │
  │◄──signed───────│◄───────────────│                │               │
```

## Security properties

- NSECs exist only in the bunker process on the LAN
- Bunker has zero inbound network connections
- Web service never sees or handles signing keys
- The only relay message between services is the approval event,
  encrypted end-to-end (NIP-44)
- Admin endpoints (add/remove identities, manage assignments) only
  exist on the bunker, which is LAN-only
- Compromise of the web service leaks OAuth sessions but not NSECs
