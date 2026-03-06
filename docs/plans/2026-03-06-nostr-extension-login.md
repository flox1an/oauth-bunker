# NIP-07 Nostr Extension Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to authenticate via NIP-07 browser extensions (nos2x, Alby, etc.) as an alternative to OAuth, controlled by `NOSTR_AUTH_ENABLED` env var.

**Architecture:** Frontend detects `window.nostr`, signs a NIP-98 style kind 27235 event targeting the server URL. Backend verifies signature + timestamp (60s window), then creates/finds a User with `oauth_provider="nostr"` and `oauth_sub=<hex_pubkey>`, reusing the existing `handle_oauth_complete` flow.

**Tech Stack:** Rust/axum backend with nostr-sdk for event verification, React/TypeScript frontend with nostr-tools, existing shadcn/ui components.

---

### Task 1: Add `nostr_auth_enabled` to Config

**Files:**
- Modify: `src/config.rs:4` (add field to struct)
- Modify: `src/config.rs:56-86` (add env parsing)
- Modify: `.env.example` (document new var)

**Step 1: Add the field and env parsing**

In `src/config.rs`, add `nostr_auth_enabled: bool` to the `Config` struct after `allow_user_identity_creation`:

```rust
pub nostr_auth_enabled: bool,
```

In `Config::from_env()`, add parsing before the closing `Ok(Config {`:

```rust
nostr_auth_enabled: env::var("NOSTR_AUTH_ENABLED")
    .unwrap_or_else(|_| "false".into())
    .parse()
    .unwrap_or(false),
```

**Step 2: Add to `.env.example`**

After the Apple OAuth section, add:

```
# Nostr extension login (NIP-07) — set to true to enable
NOSTR_AUTH_ENABLED=false
```

**Step 3: Verify it compiles**

Run: `cargo check`
Expected: compiles with no errors

**Step 4: Commit**

```
feat: add NOSTR_AUTH_ENABLED config option
```

---

### Task 2: Add `POST /api/auth/nostr` endpoint

**Files:**
- Modify: `src/web.rs` (add route, request struct, handler)

**Step 1: Add the request body struct**

After the existing `CreateAssignmentBody` struct (~line 61), add:

```rust
#[derive(Deserialize)]
pub struct NostrAuthBody {
    pub signed_event: String, // JSON-serialized signed nostr event
    pub request_id: Option<String>,
}
```

**Step 2: Register the route**

In `pub fn router()`, after the `/auth/apple/callback` route (~line 172), add:

```rust
.route("/api/auth/nostr", post(api_auth_nostr))
```

**Step 3: Write the handler**

After the `handle_oauth_complete` function (~line 590), add:

```rust
async fn api_auth_nostr(
    State(state): State<AppState>,
    Json(body): Json<NostrAuthBody>,
) -> Result<Response, Response> {
    // Check feature is enabled
    if !state.config.nostr_auth_enabled {
        return Err((
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "Nostr auth is not enabled"})),
        ).into_response());
    }

    // Parse the signed event
    let event: Event = Event::from_json(&body.signed_event).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Invalid event: {e}")}))).into_response()
    })?;

    // Verify it's kind 27235 (NIP-98)
    if event.kind != Kind::from(27235) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Event must be kind 27235"})),
        ).into_response());
    }

    // Verify the signature
    event.verify().map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": format!("Invalid signature: {e}")}))).into_response()
    })?;

    // Check timestamp is within 60 seconds
    let now = Utc::now().timestamp() as u64;
    let event_time = event.created_at.as_u64();
    if now.abs_diff(event_time) > 60 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Event timestamp too old or too far in the future"})),
        ).into_response());
    }

    // Check the "u" tag matches our public URL
    let url_tag = event.tags.iter().find_map(|tag| {
        let vec = tag.as_slice();
        if vec.len() >= 2 && vec[0] == "u" {
            Some(vec[1].to_string())
        } else {
            None
        }
    });
    let expected_url = format!("{}/api/auth/nostr", state.config.public_url);
    match url_tag {
        Some(u) if u == expected_url => {}
        _ => {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({"error": "URL tag mismatch"})),
            ).into_response());
        }
    }

    // Check method tag is POST
    let method_tag = event.tags.iter().find_map(|tag| {
        let vec = tag.as_slice();
        if vec.len() >= 2 && vec[0] == "method" {
            Some(vec[1].to_string())
        } else {
            None
        }
    });
    if method_tag.as_deref() != Some("POST") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "Method tag must be POST"})),
        ).into_response());
    }

    // Build OAuthUser equivalent
    let pubkey_hex = event.author().to_hex();
    let oauth_user = crate::oauth::OAuthUser {
        provider: "nostr".to_string(),
        sub: pubkey_hex,
        email: None,
        name: None,
        avatar_url: None,
    };

    handle_oauth_complete(&state, oauth_user, body.request_id).await
}
```

**Step 4: Include "nostr" in providers list**

Modify `api_providers` to also include nostr when enabled. Change:

```rust
async fn api_providers(State(state): State<AppState>) -> impl IntoResponse {
    let mut providers: Vec<String> = state.oauth.enabled_providers().iter().map(|s| s.to_string()).collect();
    if state.config.nostr_auth_enabled {
        providers.push("nostr".to_string());
    }
    Json(serde_json::json!({ "providers": providers }))
}
```

**Step 5: Verify it compiles**

Run: `cargo check`
Expected: compiles with no errors

**Step 6: Commit**

```
feat: add POST /api/auth/nostr endpoint with NIP-98 verification
```

---

### Task 3: Add Nostr extension login to AuthPopup frontend

**Files:**
- Modify: `web-ui/src/pages/AuthPopup.tsx`

**Step 1: Add NIP-07 type declaration**

At the top of the file, after the imports, add a type declaration for `window.nostr`:

```typescript
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>
      signEvent(event: {
        kind: number
        created_at: number
        tags: string[][]
        content: string
      }): Promise<{
        id: string
        pubkey: string
        created_at: number
        kind: number
        tags: string[][]
        content: string
        sig: string
      }>
    }
  }
}
```

**Step 2: Add state for nostr login**

Inside the `AuthPopup` component, after the existing state declarations (~line 69), add:

```typescript
const [hasNostrExtension, setHasNostrExtension] = useState(false)
const [nostrLoading, setNostrLoading] = useState(false)
```

**Step 3: Detect nostr extension**

Add a useEffect to detect `window.nostr` (after the providers fetch useEffect):

```typescript
useEffect(() => {
  // Check after a short delay to allow extensions to inject
  const timer = setTimeout(() => {
    setHasNostrExtension(!!window.nostr)
  }, 100)
  return () => clearTimeout(timer)
}, [])
```

**Step 4: Add the nostr login handler**

After the `handleReject` function, add:

```typescript
const handleNostrLogin = async () => {
  if (!window.nostr) return
  setNostrLoading(true)
  setError(null)
  try {
    const event = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['u', `${window.location.origin}/api/auth/nostr`],
        ['method', 'POST'],
      ],
      content: '',
    }
    const signed = await window.nostr.signEvent(event)
    const res = await fetch('/api/auth/nostr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signed_event: JSON.stringify(signed),
        request_id: requestId,
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Nostr auth failed')
    }
    // Server sets session cookie via Set-Cookie header;
    // redirect to identity selection
    window.location.href = `/auth-popup/${requestId}?authenticated=true`
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Nostr login failed')
    setNostrLoading(false)
  }
}
```

**Step 5: Add the button to the login UI**

In the Phase 1 (not authenticated) render, inside the `<CardContent>` after the OAuth provider buttons loop and before the "no providers" message, add a nostr login button. The nostr button should appear when the `providers` list includes `"nostr"` AND the extension is detected:

```tsx
{providers.some((p) => p.name === 'Nostr Extension') && hasNostrExtension && (
  <Button
    variant="outline"
    className="w-full justify-center"
    disabled={nostrLoading}
    onClick={handleNostrLogin}
  >
    {nostrLoading ? (
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
    ) : null}
    Sign in with Nostr Extension
  </Button>
)}
```

**Step 6: Update PROVIDER_META to include nostr**

Add nostr to the `PROVIDER_META` map:

```typescript
nostr: { name: 'Nostr Extension', path: '' },
```

Note: The `path` is empty because nostr auth doesn't use redirect-based flow. The nostr button uses `handleNostrLogin` via onClick instead of an `<a>` tag. We need to handle this in the rendering: nostr entries should NOT render as `<a>` links. Modify the provider rendering:

Replace the providers map in CardContent with:

```tsx
{providers.map((provider) =>
  provider.name === 'Nostr Extension' ? null : (
    <Button
      key={provider.name}
      variant="outline"
      className="w-full justify-center"
      asChild
    >
      <a href={`${provider.path}?request_id=${requestId}`}>
        Sign in with {provider.name}
      </a>
    </Button>
  )
)}
{providers.some((p) => p.name === 'Nostr Extension') && hasNostrExtension && (
  <Button
    variant="outline"
    className="w-full justify-center"
    disabled={nostrLoading}
    onClick={handleNostrLogin}
  >
    {nostrLoading ? (
      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
    ) : null}
    Sign in with Nostr Extension
  </Button>
)}
{providers.length === 0 && (
  <p className="text-center text-sm text-muted-foreground py-4">
    No sign-in providers configured.
  </p>
)}
```

Also update the "no providers" check — if only nostr is in the list but no extension detected, show the message. Change the empty check:

```tsx
{providers.filter((p) => p.name !== 'Nostr Extension').length === 0 &&
  !(providers.some((p) => p.name === 'Nostr Extension') && hasNostrExtension) && (
  <p className="text-center text-sm text-muted-foreground py-4">
    No sign-in providers configured.
  </p>
)}
```

**Step 7: Build the frontend**

Run: `cd web-ui && npm run build`
Expected: builds with no errors

**Step 8: Commit**

```
feat: add nostr extension login button to auth popup
```

---

### Task 4: Handle nostr auth response cookie (redirect vs SPA)

**Files:**
- Modify: `src/web.rs` (adjust `handle_oauth_complete` for JSON response)

**Context:** The existing `handle_oauth_complete` returns a redirect with Set-Cookie. For the nostr flow, the frontend uses `fetch()` which means the redirect won't be followed by the browser in a useful way — but `Set-Cookie` headers from fetch responses ARE applied by the browser if `credentials: 'same-origin'` (the default for same-origin). So the frontend just needs to do `window.location.href = ...` after a successful fetch.

However, `handle_oauth_complete` returns a 303 redirect. The `fetch()` will follow it automatically, which is fine — the session cookie gets set from the 303 response, and the final response will be the HTML of the redirected page. The frontend doesn't care about the response body — it just checks `res.ok` and then manually navigates.

**Actually, there's a problem:** The 303 redirect from `handle_oauth_complete` sets the cookie, but `fetch()` follows redirects automatically. The redirect goes to `/auth-popup/{id}?authenticated=true` which serves HTML. The `res.ok` will be true (200 from the HTML page). The cookie IS set because Set-Cookie on the 303 is processed. So this actually works as-is.

**No changes needed for this task.** The existing flow works with fetch. The frontend just needs to manually navigate after the fetch succeeds (already done in Task 3).

Delete this task — it's a no-op.

---

### Task 5: Full integration test

**Step 1: Verify cargo builds**

Run: `cargo build`

**Step 2: Verify frontend builds**

Run: `cd web-ui && npm run build`

**Step 3: Manual smoke test**

1. Set `NOSTR_AUTH_ENABLED=true` in `.env`
2. Run the server
3. Open a bunker auth URL in a browser with a NIP-07 extension installed
4. Verify "Sign in with Nostr Extension" button appears
5. Click it, sign the event, verify session is created

**Step 4: Commit all if any remaining changes**

```
feat: nostr extension login via NIP-07
```
