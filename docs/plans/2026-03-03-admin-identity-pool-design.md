# Admin-Managed Identity Pool Design

## Summary

Replace per-user nsec generation with an admin-managed pool of Nostr identities. Users authenticate via OAuth and then choose which identity to impersonate from the pool. Multiple users can share the same identity.

## Data Model

### New `identities` table

```sql
CREATE TABLE identities (
    id             TEXT PRIMARY KEY,     -- UUID
    encrypted_nsec BLOB NOT NULL,        -- AES-256-GCM (same KeyEncryptor scheme)
    nonce          BLOB NOT NULL,        -- 12-byte GCM nonce
    pubkey         TEXT NOT NULL UNIQUE,  -- hex pubkey derived from nsec
    label          TEXT,                  -- optional admin label
    created_at     INTEGER NOT NULL
)
```

### Modified `connections` table

Add `identity_id` foreign key:

```sql
ALTER TABLE connections ADD COLUMN identity_id TEXT REFERENCES identities(id);
```

### Simplified `users` table

Remove crypto columns (`encrypted_nsec`, `nonce`, `pubkey`). Users are purely OAuth accounts:

```sql
users (id, oauth_provider, oauth_sub, email, created_at)
```

### `pending_auth` — unchanged

Still used for the NIP-46 auth_url flow with 10-minute TTL.

## Admin Page

- Route: `/admin` in the existing React app
- No authentication (open for now)
- Features:
  - List all identities: pubkey (truncated), label, created_at, delete button
  - Add identity form: paste `nsec1...` bech32 + optional label
  - Delete identity (warn if active connections exist)

## Modified NIP-46 Connection Flow

1. Client sends `connect` → bunker returns `auth_url`
2. Popup opens at `/auth-popup/:requestId`
3. User clicks OAuth provider → authenticates
4. OAuth callback redirects back to popup: `/auth-popup/:requestId?authenticated=true`
5. Popup fetches `/api/identities` → shows identity picker
6. Frontend fetches kind:0 profiles from relays (nostr-tools) to display avatar + display name
7. User picks identity → `POST /api/select-identity { request_id, identity_id }`
8. Server creates connection with `identity_id`, sends NIP-46 ack
9. Popup closes via `window.close()`

## Bunker Changes

All NIP-46 method handlers change lookup path:

- **Before**: `client_pubkey → connection → user → encrypted_nsec/pubkey`
- **After**: `client_pubkey → connection → identity → encrypted_nsec/pubkey`

Affected methods: `get_public_key`, `sign_event`, `nip44_encrypt`, `nip44_decrypt`, `nip04_encrypt`, `nip04_decrypt`

Bunker's own keypair (for relay communication) stays the same — derived from master key via HKDF.

## API Endpoints

### New

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/identities` | none | List all identities (pubkey + label, no nsec) |
| POST | `/api/admin/identities` | none | Add identity (nsec1 bech32 + optional label) |
| DELETE | `/api/admin/identities/:id` | none | Remove identity |
| POST | `/api/select-identity` | session | Select identity for pending connection |

### Modified

- `GET /api/me` — returns OAuth info only; pubkey is per-connection not per-user

### Removed

- `POST /api/import-key` — replaced by admin identity management

## Frontend Changes

### New: `/admin` page

- Identity list with add/delete
- nsec1 input with validation

### Modified: `AuthPopup`

- After OAuth, show identity picker instead of closing
- Fetch profiles from relays using nostr-tools
- Display as cards: avatar, display name, pubkey

### Modified: `Dashboard`

- Adapt to show connection-based identity info instead of user-based pubkey

## Security

- nsecs encrypted at rest with same AES-256-GCM + HKDF scheme
- Admin endpoints have no auth (explicitly accepted for now)
- nsec values never returned via API — only pubkeys
- Zeroize pattern maintained for all key operations
