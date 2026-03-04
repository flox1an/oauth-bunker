# Admin NIP-98 Authentication Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Protect all admin endpoints with NIP-98 HTTP Auth, gated by NIP-07 browser extension signing on the frontend.

**Architecture:** Stateless per-request NIP-98 auth. Each admin API call carries an `Authorization: Nostr <base64>` header containing a signed kind 27235 event. Backend verifies signature, timestamp, URL, method, and pubkey against an env var allowlist. Frontend uses `window.nostr` (NIP-07) to sign events.

**Tech Stack:** Rust/Axum (backend), `nostr-sdk` for event verification, React + `nostr-tools` (frontend), NIP-07 browser extension

---

### Task 1: Add ADMIN_PUBKEYS to Config

**Files:**
- Modify: `src/config.rs:4` (add field to Config struct)
- Modify: `src/config.rs:22-68` (parse from env in `from_env()`)

**Step 1: Add field to Config struct**

In `src/config.rs`, add to the `Config` struct:

```rust
pub admin_pubkeys: Vec<String>,
```

**Step 2: Parse ADMIN_PUBKEYS in from_env()**

In `Config::from_env()`, add after the `relays` parsing block:

```rust
let admin_pubkeys: Vec<String> = env::var("ADMIN_PUBKEYS")
    .unwrap_or_default()
    .split(',')
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .collect();
```

And add `admin_pubkeys` to the `Ok(Config { ... })` return.

**Step 3: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully

**Step 4: Commit**

```bash
git add src/config.rs
git commit -m "feat: add ADMIN_PUBKEYS config for admin auth allowlist"
```

---

### Task 2: Add NIP-98 verification function to web.rs

**Files:**
- Modify: `src/web.rs` (add `verify_admin_auth` function after `get_authenticated_user`)

**Step 1: Add the NIP-98 verification function**

Add after the `get_authenticated_user` function (~line 201):

```rust
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
```

Add to the top imports, and add the function:

```rust
fn verify_admin_auth(
    state: &AppState,
    headers: &HeaderMap,
    method: &str,
    url: &str,
) -> Result<String, Response> {
    // Extract Authorization header
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Missing Authorization header"}))).into_response()
        })?;

    // Must start with "Nostr "
    let encoded = auth_header.strip_prefix("Nostr ").ok_or_else(|| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid Authorization scheme"}))).into_response()
    })?;

    // Base64 decode
    let decoded = BASE64.decode(encoded).map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid base64 in Authorization"}))).into_response()
    })?;

    // Parse as JSON event
    let event: Event = serde_json::from_slice(&decoded).map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid Nostr event"}))).into_response()
    })?;

    // Verify signature
    event.verify().map_err(|_| {
        (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Invalid event signature"}))).into_response()
    })?;

    // Must be kind 27235
    if event.kind() != Kind::HttpAuth {
        return Err(
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Wrong event kind"}))).into_response()
        );
    }

    // Check timestamp (within 60 seconds)
    let now = Utc::now().timestamp() as u64;
    let event_time = event.created_at().as_u64();
    if now.abs_diff(event_time) > 60 {
        return Err(
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Event timestamp too old"}))).into_response()
        );
    }

    // Check "u" tag matches URL
    let u_tag = event.tags().iter().find_map(|t| {
        let vec = t.as_slice();
        if vec.len() >= 2 && vec[0] == "u" {
            Some(vec[1].to_string())
        } else {
            None
        }
    });
    if u_tag.as_deref() != Some(url) {
        return Err(
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "URL mismatch"}))).into_response()
        );
    }

    // Check "method" tag
    let method_tag = event.tags().iter().find_map(|t| {
        let vec = t.as_slice();
        if vec.len() >= 2 && vec[0] == "method" {
            Some(vec[1].to_string())
        } else {
            None
        }
    });
    if method_tag.as_deref() != Some(method) {
        return Err(
            (StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error": "Method mismatch"}))).into_response()
        );
    }

    // Check pubkey is in allowlist
    let pubkey_hex = event.author().to_hex();
    if !state.config.admin_pubkeys.contains(&pubkey_hex) {
        return Err(
            (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Not an admin"}))).into_response()
        );
    }

    Ok(pubkey_hex)
}
```

**Step 2: Add `base64` crate dependency**

Run: `cargo add base64`

**Step 3: Verify it compiles**

Run: `cargo check`
Expected: Compiles successfully (function is unused for now, may warn)

**Step 4: Commit**

```bash
git add src/web.rs Cargo.toml Cargo.lock
git commit -m "feat: add NIP-98 verification function for admin auth"
```

---

### Task 3: Apply NIP-98 auth to all admin handlers

**Files:**
- Modify: `src/web.rs` (update all 7 admin handler functions)

**Step 1: Update each admin handler to take headers and verify auth**

Each admin handler needs:
1. Add `headers: HeaderMap` parameter
2. Construct the full URL using `state.config.public_url`
3. Call `verify_admin_auth()` at the top

For example, `api_list_all_identities` changes from:

```rust
async fn api_list_all_identities(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Response> {
```

To:

```rust
async fn api_list_all_identities(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    let url = format!("{}/api/admin/identities", state.config.public_url);
    verify_admin_auth(&state, &headers, "GET", &url)?;
```

Apply the same pattern to all admin handlers:

- `api_list_all_identities` — method: `"GET"`, path: `/api/admin/identities`
- `api_add_identity` — method: `"POST"`, path: `/api/admin/identities`
- `api_delete_identity` — method: `"DELETE"`, path: `/api/admin/identities/{id}` (use actual `id` from Path)
- `api_list_users` — method: `"GET"`, path: `/api/admin/users`
- `api_list_assignments` — method: `"GET"`, path: `/api/admin/assignments`
- `api_create_assignment` — method: `"POST"`, path: `/api/admin/assignments`
- `api_delete_assignment` — method: `"DELETE"`, path: `/api/admin/assignments/{id}` (use actual `id` from Path)

**Important:** For DELETE routes with path params, the URL in the NIP-98 event must include the actual ID. The handler has `Path(id): Path<String>`, so construct: `format!("{}/api/admin/identities/{}", state.config.public_url, id)`.

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: Compiles with no errors

**Step 3: Commit**

```bash
git add src/web.rs
git commit -m "feat: require NIP-98 auth on all admin endpoints"
```

---

### Task 4: Add NIP-98 fetch wrapper to frontend

**Files:**
- Create: `web-ui/src/lib/nostr-auth.ts`

**Step 1: Create the adminFetch helper**

```typescript
import { finalizeEvent, type EventTemplate } from 'nostr-tools'

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: EventTemplate): Promise<{ sig: string; id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string }>
    }
  }
}

export async function getNostrPublicKey(): Promise<string | null> {
  if (!window.nostr) return null
  try {
    return await window.nostr.getPublicKey()
  } catch {
    return null
  }
}

export async function adminFetch(
  path: string,
  method: string = 'GET',
  body?: unknown,
): Promise<Response> {
  if (!window.nostr) {
    throw new Error('No Nostr signer extension found')
  }

  const url = `${window.location.origin}${path}`

  const event: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
    ],
    content: '',
  }

  const signedEvent = await window.nostr.signEvent(event)
  const token = btoa(JSON.stringify(signedEvent))

  const headers: Record<string, string> = {
    Authorization: `Nostr ${token}`,
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd web-ui && npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add web-ui/src/lib/nostr-auth.ts
git commit -m "feat: add NIP-98 adminFetch helper for Nostr auth"
```

---

### Task 5: Gate the Admin page with NIP-07 auth

**Files:**
- Modify: `web-ui/src/pages/Admin.tsx`

**Step 1: Add auth state and gate logic**

Add these states at the top of the `Admin` component:

```typescript
const [authState, setAuthState] = useState<'loading' | 'no-extension' | 'connect' | 'unauthorized' | 'authenticated'>('loading')
const [adminPubkey, setAdminPubkey] = useState<string | null>(null)
```

Add an auth check effect (before the existing `useEffect`):

```typescript
useEffect(() => {
  const checkAuth = async () => {
    if (!window.nostr) {
      setAuthState('no-extension')
      return
    }
    setAuthState('connect')
  }
  checkAuth()
}, [])
```

Add a `handleConnect` function:

```typescript
const handleConnect = async () => {
  try {
    const pubkey = await getNostrPublicKey()
    if (!pubkey) {
      setAuthState('no-extension')
      return
    }
    setAdminPubkey(pubkey)

    // Test auth with a real API call
    const res = await adminFetch('/api/admin/identities')
    if (res.status === 401 || res.status === 403) {
      setAuthState('unauthorized')
      return
    }
    if (!res.ok) {
      setError('Failed to authenticate')
      return
    }

    // Auth successful — load data
    const data = await res.json()
    setIdentities(data)
    setAuthState('authenticated')
    setLoading(false)
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Authentication failed')
    setAuthState('connect')
  }
}
```

**Step 2: Add gate UI before the main return**

Before the existing loading/error/main renders, add:

```typescript
if (authState === 'loading') {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

if (authState === 'no-extension') {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader>
          <CardTitle>Nostr Signer Required</CardTitle>
          <CardDescription>
            Install a NIP-07 browser extension (like nos2x or Alby) to access the admin panel.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}

if (authState === 'connect') {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader>
          <CardTitle>Admin Access</CardTitle>
          <CardDescription>
            Connect your Nostr identity to access the admin panel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive mb-4">{error}</p>}
          <Button onClick={handleConnect} className="w-full">
            Connect with Nostr
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

if (authState === 'unauthorized') {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-[400px]">
        <CardHeader>
          <CardTitle>Not Authorized</CardTitle>
          <CardDescription>
            Your pubkey ({adminPubkey ? truncate(adminPubkey) : 'unknown'}) is not in the admin allowlist.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
```

**Step 3: Replace all fetch() calls with adminFetch()**

Change the existing data-loading `useEffect` to only run when `authState === 'authenticated'`:

```typescript
useEffect(() => {
  if (authState !== 'authenticated') return
  // identities already loaded during auth check
  fetchUsers()
  fetchAssignments()
}, [authState, fetchUsers, fetchAssignments])
```

Update `fetchIdentities`, `fetchUsers`, `fetchAssignments`, `handleAdd`, `handleDelete`, `handleCreateAssignment`, `handleDeleteAssignment` — replace every `fetch('/api/admin/...')` with `adminFetch('/api/admin/...')`.

Examples:
- `fetch('/api/admin/identities')` → `adminFetch('/api/admin/identities')`
- `fetch('/api/admin/identities', { method: 'POST', headers: ..., body: ... })` → `adminFetch('/api/admin/identities', 'POST', body)`
- `fetch(\`/api/admin/identities/${id}\`, { method: 'DELETE' })` → `adminFetch(\`/api/admin/identities/${id}\`, 'DELETE')`
- Same pattern for users, assignments

Add import at top: `import { adminFetch, getNostrPublicKey } from '@/lib/nostr-auth'`

**Step 4: Verify frontend compiles**

Run: `cd web-ui && npx tsc --noEmit`
Expected: No type errors

**Step 5: Build frontend and verify Rust compilation**

Run: `cd web-ui && npm run build && cd .. && cargo check`
Expected: Both succeed

**Step 6: Commit**

```bash
git add web-ui/src/pages/Admin.tsx
git commit -m "feat: gate admin page with NIP-07 auth and use NIP-98 for API calls"
```

---

### Task 6: Manual integration test

**Step 1: Set up test environment**

Add to `.env`:
```
ADMIN_PUBKEYS=<your-hex-pubkey>
```

(Get your hex pubkey from your NIP-07 extension)

**Step 2: Build and run**

```bash
cd web-ui && npm run build && cd .. && cargo run
```

**Step 3: Test scenarios**

1. Visit `/admin` — should see "Connect with Nostr" button
2. Click connect — extension prompts for pubkey — approve
3. Extension prompts to sign event — approve
4. If your pubkey is in ADMIN_PUBKEYS: admin panel loads
5. If not: "Not Authorized" message
6. Try all admin operations (add identity, list users, create assignment, delete)
7. Each operation should trigger an extension signing prompt
8. Test without extension (incognito): "Nostr Signer Required" message
9. Test curl without auth header: `curl localhost:3000/api/admin/identities` → 401

**Step 4: Final commit if any fixes needed**

---

### Task 7: Update .env.example (if exists) or add docs

**Files:**
- Modify or create: `.env.example` (if exists)

**Step 1: Add ADMIN_PUBKEYS to example env**

Add line:
```
ADMIN_PUBKEYS=hex_pubkey_1,hex_pubkey_2
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add ADMIN_PUBKEYS to env example"
```
