# Admin Authentication Design — NIP-98 + NIP-07

**Date:** 2026-03-04
**Status:** Approved

## Problem

All `/api/admin/*` endpoints are currently unauthenticated. Anyone can add/delete identities, manage users, and create assignments.

## Solution

Stateless NIP-98 HTTP Auth (kind 27235) with NIP-07 browser extension signing. Admin pubkeys configured via environment variable.

## Approach: Stateless NIP-98 Per-Request

Every admin API call includes an `Authorization: Nostr <base64>` header with a freshly signed kind 27235 event. The server verifies signature + pubkey on every request. No sessions, no tokens.

## Backend

### Config

- New env var: `ADMIN_PUBKEYS` (comma-separated hex pubkeys)
- Stored as `Vec<String>` on `AppState`

### Axum Extractor: `AdminAuth`

Extracts and validates the `Authorization: Nostr <base64>` header:

1. Base64-decode → parse as Nostr event
2. Verify valid signature
3. Verify kind is 27235
4. Verify `created_at` within ±60 seconds (replay protection)
5. Verify `u` tag matches request URL
6. Verify `method` tag matches HTTP method
7. Verify pubkey is in `ADMIN_PUBKEYS` allowlist
8. Return 401 on any failure

Applied to all `/api/admin/*` routes as an extractor parameter.

## Frontend

### Admin Page Gate

UI states in order:

1. No `window.nostr` → "Install a Nostr signer extension to access admin"
2. Extension found, not authenticated → "Connect with Nostr" button
3. Authenticated but not in allowlist → "Not authorized as admin"
4. Authenticated and authorized → Full admin panel

### NIP-98 Fetch Wrapper

`adminFetch(url, method, body?)`:

1. Create kind 27235 event with `u` tag (full URL) and `method` tag
2. Call `window.nostr.signEvent(event)`
3. Base64-encode the signed event JSON
4. Set `Authorization: Nostr <base64>` header
5. Make the fetch call

All existing admin API calls switch from `fetch()` to `adminFetch()`.

## Decisions

- **Stateless per-request** over session-based: simpler, no state to manage, Nostr-native
- **NIP-07 only** (no nsec paste fallback): cleanest security, no secrets in the app
- **Env var allowlist** over DB roles: simple, fits existing config pattern
- **Gated UI** over API-only protection: prevents information leakage
