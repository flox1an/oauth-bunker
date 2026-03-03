# User-Identity Assignments with Time Limits

## Problem

Currently all identities in the pool are visible to all OAuth users during the auth popup identity picker. The admin needs to control which users can use which nsecs, with time-limited access.

## Design Decisions

- **Strict allowlist model**: Users can ONLY use identities explicitly assigned to them
- **Time-limited assignments**: Duration options: 1 day, 1 week, 1 month, 6 months, 1 year
- **Auto-revoke on expiry**: Background task cleans up expired assignments and revokes related connections
- **Admin manages assignments**: Via the existing `/admin` page (extended with new sections)

## Database

New table `user_identity_assignments`:

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | UUID |
| `user_id` | TEXT FK->users | The OAuth user |
| `identity_id` | TEXT FK->identities | The nsec identity |
| `expires_at` | INTEGER | Unix timestamp when access expires |
| `created_at` | INTEGER | Unix timestamp |

Unique constraint on `(user_id, identity_id)` -- one assignment per user-identity pair.

## API Endpoints

All unauthenticated (matching existing admin pattern):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List all users |
| `GET` | `/api/admin/assignments` | List all assignments with user+identity info |
| `POST` | `/api/admin/assignments` | Create assignment `{user_id, identity_id, duration}` |
| `DELETE` | `/api/admin/assignments/{id}` | Delete assignment + auto-revoke connections |

Duration values: `1d`, `1w`, `1m`, `6m`, `1y`.

## Identity Picker Filtering

`GET /api/identities` when called by an authenticated user returns only identities with valid (unexpired) assignments for that user.

## Signing Enforcement

Before signing a NIP-46 request, verify the connection's user has a valid assignment for the connection's identity. If expired or missing, reject and delete the connection.

## Background Cleanup Task

Tokio task running every 5 minutes:
1. Find expired assignments
2. Delete connections where `(user_id, identity_id)` matches expired assignments
3. Delete expired assignments

## Admin UI

Extended `/admin` page with:

**Users section**: Read-only table of all registered users (email, provider, created date).

**Assignments section**: Table of all assignments (user, identity, expiry, status). Add form with user dropdown, identity dropdown, duration selector. Delete button per assignment.
