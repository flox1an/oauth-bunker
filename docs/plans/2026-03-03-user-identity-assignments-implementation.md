# User-Identity Assignments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add time-limited user-identity assignments so admins control which OAuth users can use which nsec identities, with auto-revocation of expired assignments.

**Architecture:** New `user_identity_assignments` table with `(user_id, identity_id, expires_at)`. Backend enforces assignments at identity selection time and signing time. Background tokio task cleans up expired assignments every 5 minutes. Admin UI extended with Users and Assignments sections.

**Tech Stack:** Rust/Axum backend, SQLite (rusqlite), React/TypeScript frontend with shadcn/ui

---

### Task 1: Add `user_identity_assignments` table and DB methods

**Files:**
- Modify: `src/db.rs`

**Step 1: Add the Assignment struct**

After the `Identity` struct (line 55), add:

```rust
#[derive(Debug, Clone)]
pub struct Assignment {
    pub id: String,
    pub user_id: String,
    pub identity_id: String,
    pub expires_at: i64,
    pub created_at: i64,
}
```

**Step 2: Add the table creation migration**

In `run_alter_migrations` (after the identity_id migration at line 184), add:

```rust
// Create user_identity_assignments table if it doesn't exist
conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS user_identity_assignments (
        id           TEXT    PRIMARY KEY,
        user_id      TEXT    NOT NULL REFERENCES users(id),
        identity_id  TEXT    NOT NULL REFERENCES identities(id),
        expires_at   INTEGER NOT NULL,
        created_at   INTEGER NOT NULL,
        UNIQUE(user_id, identity_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assignments_user_id ON user_identity_assignments(user_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_identity_id ON user_identity_assignments(identity_id);
    CREATE INDEX IF NOT EXISTS idx_assignments_expires_at ON user_identity_assignments(expires_at);"
)?;
```

**Step 3: Add DB methods for assignments**

Add a new section `// Assignments` in `impl Database` after the Identities section (after line 555):

```rust
// -----------------------------------------------------------------------
// Assignments
// -----------------------------------------------------------------------

pub fn list_all_users(&self) -> rusqlite::Result<Vec<User>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT id, oauth_provider, oauth_sub, email, avatar_url, created_at
         FROM users ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(User {
            id: row.get(0)?,
            oauth_provider: row.get(1)?,
            oauth_sub: row.get(2)?,
            email: row.get(3)?,
            avatar_url: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

pub fn create_assignment(&self, assignment: &Assignment) -> rusqlite::Result<()> {
    let conn = self.conn.lock().unwrap();
    conn.execute(
        "INSERT INTO user_identity_assignments (id, user_id, identity_id, expires_at, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            assignment.id,
            assignment.user_id,
            assignment.identity_id,
            assignment.expires_at,
            assignment.created_at,
        ],
    )?;
    Ok(())
}

pub fn list_assignments(&self) -> rusqlite::Result<Vec<(Assignment, Option<String>, Option<String>, Option<String>)>> {
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT a.id, a.user_id, a.identity_id, a.expires_at, a.created_at,
                u.email, i.pubkey, i.label
         FROM user_identity_assignments a
         JOIN users u ON a.user_id = u.id
         JOIN identities i ON a.identity_id = i.id
         ORDER BY a.created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            Assignment {
                id: row.get(0)?,
                user_id: row.get(1)?,
                identity_id: row.get(2)?,
                expires_at: row.get(3)?,
                created_at: row.get(4)?,
            },
            row.get::<_, Option<String>>(5)?, // user email
            row.get::<_, Option<String>>(6)?, // identity pubkey
            row.get::<_, Option<String>>(7)?, // identity label
        ))
    })?;
    rows.collect()
}

pub fn delete_assignment(&self, id: &str) -> rusqlite::Result<bool> {
    let conn = self.conn.lock().unwrap();
    let affected = conn.execute(
        "DELETE FROM user_identity_assignments WHERE id = ?1",
        params![id],
    )?;
    Ok(affected > 0)
}

pub fn has_valid_assignment(&self, user_id: &str, identity_id: &str) -> rusqlite::Result<bool> {
    let now = Utc::now().timestamp();
    let conn = self.conn.lock().unwrap();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM user_identity_assignments
         WHERE user_id = ?1 AND identity_id = ?2 AND expires_at > ?3",
        params![user_id, identity_id, now],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

pub fn list_identities_for_user(&self, user_id: &str) -> rusqlite::Result<Vec<Identity>> {
    let now = Utc::now().timestamp();
    let conn = self.conn.lock().unwrap();
    let mut stmt = conn.prepare(
        "SELECT i.id, i.encrypted_nsec, i.nonce, i.pubkey, i.label, i.created_at
         FROM identities i
         JOIN user_identity_assignments a ON a.identity_id = i.id
         WHERE a.user_id = ?1 AND a.expires_at > ?2
         ORDER BY i.created_at DESC",
    )?;
    let rows = stmt.query_map(params![user_id, now], |row| {
        Ok(Identity {
            id: row.get(0)?,
            encrypted_nsec: row.get(1)?,
            nonce: row.get(2)?,
            pubkey: row.get(3)?,
            label: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    rows.collect()
}

/// Find expired assignments and revoke their connections. Returns number of connections deleted.
pub fn cleanup_expired_assignments(&self) -> rusqlite::Result<usize> {
    let now = Utc::now().timestamp();
    let conn = self.conn.lock().unwrap();

    // Delete connections whose user+identity pair has an expired assignment
    let connections_deleted = conn.execute(
        "DELETE FROM connections WHERE id IN (
            SELECT c.id FROM connections c
            JOIN user_identity_assignments a ON c.user_id = a.user_id AND c.identity_id = a.identity_id
            WHERE a.expires_at <= ?1
        )",
        params![now],
    )?;

    // Delete the expired assignments
    conn.execute(
        "DELETE FROM user_identity_assignments WHERE expires_at <= ?1",
        params![now],
    )?;

    Ok(connections_deleted)
}

/// Delete connections for a specific user+identity pair (used when manually deleting an assignment).
pub fn delete_connections_for_assignment(&self, user_id: &str, identity_id: &str) -> rusqlite::Result<usize> {
    let conn = self.conn.lock().unwrap();
    let affected = conn.execute(
        "DELETE FROM connections WHERE user_id = ?1 AND identity_id = ?2",
        params![user_id, identity_id],
    )?;
    Ok(affected)
}
```

**Step 4: Verify it compiles**

Run: `cargo check`
Expected: No errors

**Step 5: Commit**

```bash
git add src/db.rs
git commit -m "feat: add user_identity_assignments table and DB methods"
```

---

### Task 2: Add assignment API endpoints

**Files:**
- Modify: `src/web.rs`

**Step 1: Add request/response structs**

After `SelectIdentityBody` (line 42), add:

```rust
#[derive(Deserialize)]
pub struct CreateAssignmentBody {
    pub user_id: String,
    pub identity_id: String,
    pub duration: String, // "1d", "1w", "1m", "6m", "1y"
}

#[derive(Serialize)]
struct UserResponse {
    id: String,
    email: Option<String>,
    avatar_url: Option<String>,
    oauth_provider: String,
    created_at: i64,
}

#[derive(Serialize)]
struct AssignmentResponse {
    id: String,
    user_id: String,
    identity_id: String,
    user_email: Option<String>,
    identity_pubkey: Option<String>,
    identity_label: Option<String>,
    expires_at: i64,
    created_at: i64,
}
```

**Step 2: Add routes to the router**

In `pub fn router()` (around line 124), add before the closing:

```rust
.route("/api/admin/users", get(api_list_users))
.route("/api/admin/assignments", get(api_list_assignments).post(api_create_assignment))
.route("/api/admin/assignments/{id}", delete(api_delete_assignment))
```

**Step 3: Add duration parser helper**

```rust
fn parse_duration(duration: &str) -> Result<i64, String> {
    match duration {
        "1d" => Ok(86400),
        "1w" => Ok(7 * 86400),
        "1m" => Ok(30 * 86400),
        "6m" => Ok(180 * 86400),
        "1y" => Ok(365 * 86400),
        _ => Err(format!("Invalid duration: {duration}. Use 1d, 1w, 1m, 6m, or 1y")),
    }
}
```

**Step 4: Implement the handler functions**

```rust
// ---------------------------------------------------------------------------
// API: GET /api/admin/users
// ---------------------------------------------------------------------------

async fn api_list_users(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Response> {
    let users = state.db.list_all_users().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    let response: Vec<UserResponse> = users
        .into_iter()
        .map(|u| UserResponse {
            id: u.id,
            email: u.email,
            avatar_url: u.avatar_url,
            oauth_provider: u.oauth_provider,
            created_at: u.created_at,
        })
        .collect();

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// API: GET /api/admin/assignments
// ---------------------------------------------------------------------------

async fn api_list_assignments(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, Response> {
    let assignments = state.db.list_assignments().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    let response: Vec<AssignmentResponse> = assignments
        .into_iter()
        .map(|(a, user_email, identity_pubkey, identity_label)| AssignmentResponse {
            id: a.id,
            user_id: a.user_id,
            identity_id: a.identity_id,
            user_email,
            identity_pubkey,
            identity_label,
            expires_at: a.expires_at,
            created_at: a.created_at,
        })
        .collect();

    Ok(Json(response))
}

// ---------------------------------------------------------------------------
// API: POST /api/admin/assignments
// ---------------------------------------------------------------------------

async fn api_create_assignment(
    State(state): State<AppState>,
    Json(body): Json<CreateAssignmentBody>,
) -> Result<impl IntoResponse, Response> {
    let duration_secs = parse_duration(&body.duration).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e}))).into_response()
    })?;

    // Validate user exists
    state.db.find_user_by_id(&body.user_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "User not found"}))).into_response()
    })?;

    // Validate identity exists
    state.db.find_identity_by_id(&body.identity_id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?.ok_or_else(|| {
        (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Identity not found"}))).into_response()
    })?;

    let now = Utc::now().timestamp();
    let assignment = crate::db::Assignment {
        id: Uuid::new_v4().to_string(),
        user_id: body.user_id,
        identity_id: body.identity_id,
        expires_at: now + duration_secs,
        created_at: now,
    };

    state.db.create_assignment(&assignment).map_err(|e| {
        let error_str = format!("{e}");
        if error_str.contains("UNIQUE") {
            (StatusCode::CONFLICT, Json(serde_json::json!({"error": "Assignment already exists for this user-identity pair"}))).into_response()
        } else {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
        }
    })?;

    Ok((StatusCode::CREATED, Json(serde_json::json!({
        "id": assignment.id,
        "expires_at": assignment.expires_at,
    }))))
}

// ---------------------------------------------------------------------------
// API: DELETE /api/admin/assignments/{id}
// ---------------------------------------------------------------------------

async fn api_delete_assignment(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, Response> {
    // First, find the assignment to get user_id and identity_id for connection cleanup
    let assignments = state.db.list_assignments().map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    let assignment = assignments.iter().find(|(a, _, _, _)| a.id == id);

    if let Some((a, _, _, _)) = assignment {
        // Delete related connections
        let _ = state.db.delete_connections_for_assignment(&a.user_id, &a.identity_id);
    }

    let deleted = state.db.delete_assignment(&id).map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
    })?;

    if deleted {
        Ok(Json(serde_json::json!({"deleted": true})))
    } else {
        Err((StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Assignment not found"}))).into_response())
    }
}
```

**Step 5: Verify it compiles**

Run: `cargo check`
Expected: No errors

**Step 6: Commit**

```bash
git add src/web.rs
git commit -m "feat: add admin API endpoints for users and assignments"
```

---

### Task 3: Filter identity picker by assignments

**Files:**
- Modify: `src/web.rs`

**Step 1: Modify `api_list_identities` to filter by user assignments when authenticated**

Replace the current `api_list_identities` function (lines 539-561) with:

```rust
async fn api_list_identities(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, Response> {
    // If user is authenticated, return only assigned identities
    let identities = if let Ok(user) = get_authenticated_user(&state, &headers) {
        state.db.list_identities_for_user(&user.id).map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
        })?
    } else {
        // Unauthenticated: return all (for admin page)
        state.db.list_identities().map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
        })?
    };

    let response: Vec<IdentityResponse> = identities
        .into_iter()
        .map(|i| {
            let active_connections = state.db.count_connections_for_identity(&i.id).unwrap_or(0);
            IdentityResponse {
                id: i.id,
                pubkey: i.pubkey,
                label: i.label,
                created_at: i.created_at,
                active_connections,
            }
        })
        .collect();

    Ok(Json(response))
}
```

**Step 2: Add assignment validation to `api_select_identity`**

In `api_select_identity` (around line 647), after validating that the identity exists, add:

```rust
// Validate user has a valid assignment for this identity
if !state.db.has_valid_assignment(&user.id, &body.identity_id).map_err(|e| {
    (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": format!("Database error: {e}")}))).into_response()
})? {
    return Err((StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "No valid assignment for this identity"}))).into_response());
}
```

**Step 3: Verify it compiles**

Run: `cargo check`
Expected: No errors

**Step 4: Commit**

```bash
git add src/web.rs
git commit -m "feat: filter identity picker by user assignments"
```

---

### Task 4: Add signing enforcement in bunker

**Files:**
- Modify: `src/bunker.rs`

**Step 1: Modify `find_identity_by_client` to also check assignment validity**

Replace the `find_identity_by_client` method (lines 482-489) with:

```rust
async fn find_identity_by_client(&self, client_pubkey: &PublicKey) -> Result<Identity, String> {
    let client_pk_hex = client_pubkey.to_hex();

    let identity = self.db
        .find_identity_by_client_pubkey(&client_pk_hex)
        .map_err(|e| format!("DB error: {e}"))?
        .ok_or_else(|| "No identity found for this client".to_string())?;

    // Find the user_id for this connection to check assignment
    let connections = self.db
        .list_connections_by_client_pubkey(&client_pk_hex)
        .map_err(|e| format!("DB error: {e}"))?;

    if let Some(conn) = connections.first() {
        if !self.db.has_valid_assignment(&conn.user_id, &identity.id)
            .map_err(|e| format!("DB error: {e}"))? {
            // Assignment expired — revoke the connection
            let _ = self.db.delete_connection(&conn.id, &conn.user_id);
            return Err("Assignment expired for this identity".to_string());
        }
    }

    Ok(identity)
}
```

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/bunker.rs
git commit -m "feat: enforce assignment validity at signing time"
```

---

### Task 5: Add background cleanup task

**Files:**
- Modify: `src/main.rs`

**Step 1: Add a background task before the `tokio::select!` block**

After line 77 (`let state = AppState { ... };`) and before the router setup, add:

```rust
// Spawn background task to cleanup expired assignments
let cleanup_db = state.db.clone();
tokio::spawn(async move {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300)); // 5 minutes
    loop {
        interval.tick().await;
        match cleanup_db.cleanup_expired_assignments() {
            Ok(deleted) => {
                if deleted > 0 {
                    tracing::info!(connections_revoked = deleted, "Cleaned up expired assignments");
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "Failed to cleanup expired assignments");
            }
        }
    }
});
```

**Step 2: Verify it compiles**

Run: `cargo check`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main.rs
git commit -m "feat: add background task for expired assignment cleanup"
```

---

### Task 6: Add Select UI component

The admin assignments form needs a dropdown/select component. shadcn/ui `Select` component is needed.

**Files:**
- Create: `web-ui/src/components/ui/select.tsx`

**Step 1: Install the select component**

Run: `cd /Users/flox/dev/nostr/oauth-signer/web-ui && npx shadcn@latest add select --yes`

If the CLI doesn't work, create manually from shadcn/ui docs.

**Step 2: Commit**

```bash
git add web-ui/src/components/ui/select.tsx
git commit -m "chore: add shadcn select component"
```

---

### Task 7: Update Admin UI with Users and Assignments sections

**Files:**
- Modify: `web-ui/src/pages/Admin.tsx`

**Step 1: Add imports and interfaces**

At the top of Admin.tsx, update imports to include Select and additional icons:

```typescript
import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Loader2, Trash2 } from 'lucide-react'
```

Add new interfaces after the `Identity` interface:

```typescript
interface User {
  id: string
  email: string | null
  avatar_url: string | null
  oauth_provider: string
  created_at: number
}

interface Assignment {
  id: string
  user_id: string
  identity_id: string
  user_email: string | null
  identity_pubkey: string | null
  identity_label: string | null
  expires_at: number
  created_at: number
}
```

**Step 2: Add state and fetch functions inside the component**

After the existing state variables (nsecInput, labelInput, etc.), add:

```typescript
const [users, setUsers] = useState<User[]>([])
const [assignments, setAssignments] = useState<Assignment[]>([])

// Assignment form state
const [selectedUserId, setSelectedUserId] = useState('')
const [selectedIdentityId, setSelectedIdentityId] = useState('')
const [selectedDuration, setSelectedDuration] = useState('')
const [assignLoading, setAssignLoading] = useState(false)
const [assignError, setAssignError] = useState<string | null>(null)

const fetchUsers = useCallback(async () => {
  try {
    const res = await fetch('/api/admin/users')
    if (!res.ok) throw new Error('Failed to fetch users')
    setUsers(await res.json())
  } catch {
    // Users fetch is best-effort
  }
}, [])

const fetchAssignments = useCallback(async () => {
  try {
    const res = await fetch('/api/admin/assignments')
    if (!res.ok) throw new Error('Failed to fetch assignments')
    setAssignments(await res.json())
  } catch {
    // Assignments fetch is best-effort
  }
}, [])
```

Update the existing `useEffect` to also fetch users and assignments:

```typescript
useEffect(() => {
  fetchIdentities()
  fetchUsers()
  fetchAssignments()
}, [fetchIdentities, fetchUsers, fetchAssignments])
```

**Step 3: Add handler functions**

```typescript
const handleCreateAssignment = async () => {
  setAssignLoading(true)
  setAssignError(null)
  try {
    const res = await fetch('/api/admin/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: selectedUserId,
        identity_id: selectedIdentityId,
        duration: selectedDuration,
      }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Failed to create assignment')
    }
    setSelectedUserId('')
    setSelectedIdentityId('')
    setSelectedDuration('')
    await fetchAssignments()
  } catch (e) {
    setAssignError(e instanceof Error ? e.message : 'Failed')
  } finally {
    setAssignLoading(false)
  }
}

const handleDeleteAssignment = async (id: string) => {
  try {
    const res = await fetch(`/api/admin/assignments/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setAssignments((prev) => prev.filter((a) => a.id !== id))
    }
  } catch {
    // Silently fail; user can retry
  }
}
```

**Step 4: Add the UI sections in the return JSX**

After the existing Identities card (closing `</Card>` around line 225), add two new cards:

```tsx
{/* Users */}
<Card>
  <CardHeader>
    <CardTitle>Users</CardTitle>
    <CardDescription>
      {users.length === 0
        ? 'No users registered yet.'
        : `${users.length} registered user${users.length === 1 ? '' : 's'}.`}
    </CardDescription>
  </CardHeader>
  {users.length > 0 && (
    <CardContent className="space-y-3">
      {users.map((user, i) => (
        <div key={user.id}>
          {i > 0 && <Separator className="mb-3" />}
          <div className="flex items-center gap-3">
            {user.avatar_url ? (
              <img src={user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm">{user.email || 'No email'}</p>
              <p className="text-xs text-muted-foreground">
                {user.oauth_provider} &middot; {new Date(user.created_at * 1000).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      ))}
    </CardContent>
  )}
</Card>

{/* Assignments */}
<Card>
  <CardHeader>
    <CardTitle>Assignments</CardTitle>
    <CardDescription>
      Control which users can use which identities.
    </CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* Add Assignment Form */}
    <div className="space-y-3 rounded-lg border p-4">
      <p className="text-sm font-medium">New Assignment</p>
      <div className="space-y-2">
        <Label>User</Label>
        <Select value={selectedUserId} onValueChange={setSelectedUserId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a user" />
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.email || u.oauth_provider + ' user'} ({u.oauth_provider})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Identity</Label>
        <Select value={selectedIdentityId} onValueChange={setSelectedIdentityId}>
          <SelectTrigger>
            <SelectValue placeholder="Select an identity" />
          </SelectTrigger>
          <SelectContent>
            {identities.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.label ? `${i.label} — ` : ''}{truncate(i.pubkey, 24)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Duration</Label>
        <Select value={selectedDuration} onValueChange={setSelectedDuration}>
          <SelectTrigger>
            <SelectValue placeholder="Select duration" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1d">1 Day</SelectItem>
            <SelectItem value="1w">1 Week</SelectItem>
            <SelectItem value="1m">1 Month</SelectItem>
            <SelectItem value="6m">6 Months</SelectItem>
            <SelectItem value="1y">1 Year</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {assignError && <p className="text-sm text-destructive">{assignError}</p>}
      <Button
        onClick={handleCreateAssignment}
        disabled={!selectedUserId || !selectedIdentityId || !selectedDuration || assignLoading}
      >
        {assignLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Assign
      </Button>
    </div>

    {/* Assignments list */}
    {assignments.length > 0 && (
      <div className="space-y-3">
        <Separator />
        {assignments.map((a, i) => {
          const isExpired = a.expires_at * 1000 < Date.now()
          return (
            <div key={a.id}>
              {i > 0 && <Separator className="mb-3" />}
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm">
                    <span className="font-medium">{a.user_email || 'Unknown user'}</span>
                    {' → '}
                    <span className="font-mono text-xs">
                      {a.identity_label ? `${a.identity_label} ` : ''}
                      {a.identity_pubkey ? truncate(a.identity_pubkey, 16) : 'Unknown'}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                      Expires: {new Date(a.expires_at * 1000).toLocaleDateString()}
                    </p>
                    {isExpired ? (
                      <Badge variant="destructive" className="text-xs">Expired</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Active</Badge>
                    )}
                  </div>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="icon" className="h-8 w-8 shrink-0">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete assignment?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will revoke the user's access to this identity and disconnect any active connections.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDeleteAssignment(a.id)}>
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          )
        })}
      </div>
    )}
    {assignments.length === 0 && (
      <p className="text-sm text-muted-foreground text-center py-2">No assignments yet.</p>
    )}
  </CardContent>
</Card>
```

**Step 5: Build the frontend to check for errors**

Run: `cd /Users/flox/dev/nostr/oauth-signer/web-ui && npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add web-ui/src/pages/Admin.tsx
git commit -m "feat: add users list and assignments management to admin page"
```

---

### Task 8: Full build verification

**Step 1: Build Rust backend**

Run: `cargo build`
Expected: Build succeeds

**Step 2: Build React frontend**

Run: `cd /Users/flox/dev/nostr/oauth-signer/web-ui && npm run build`
Expected: Build succeeds

**Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: build artifacts for user-identity assignments feature"
```
