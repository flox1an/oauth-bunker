# Documentation Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a static HTML documentation site in `docs-site/` that self-hosters can browse to learn everything about setting up the Nostr OAuth Signer.

**Architecture:** Hand-crafted static HTML/CSS/JS. Shared CSS for styling (sidebar, dark mode, responsive, code highlighting). Shared JS injects consistent nav into all pages and handles dark mode + copy buttons. highlight.js loaded from CDN for syntax highlighting. No build step.

**Tech Stack:** HTML5, CSS3, vanilla JS, highlight.js (CDN)

---

### Task 1: Scaffold docs-site folder and shared CSS

**Files:**
- Create: `docs-site/css/style.css`

**Step 1: Create the CSS file**

Create `docs-site/css/style.css` with:
- CSS custom properties for light/dark theme colors
- `@media (prefers-color-scheme: dark)` default, plus `.light-mode` override class
- Layout: sidebar (260px fixed left) + main content area
- Sidebar styles: nav links, active state, section headers, logo area
- Responsive: `@media (max-width: 768px)` collapses sidebar, shows hamburger
- Typography: system font stack, `monospace` for code
- Code blocks: background, padding, border-radius, overflow-x scroll, position relative for copy button
- Copy button: absolute top-right of code block, small, subtle
- Heading anchor links: `::before` with `#` on hover
- Table styles for reference tables
- Smooth transitions for dark/light toggle

**Step 2: Verify file exists**

Run: `ls docs-site/css/style.css`
Expected: file listed

**Step 3: Commit**

```bash
git add docs-site/css/style.css
git commit -m "docs: scaffold docs-site with shared CSS"
```

---

### Task 2: Create shared JavaScript (nav + dark mode + code features)

**Files:**
- Create: `docs-site/js/main.js`
- Create: `docs-site/js/nav.js`

**Step 1: Create nav.js**

Create `docs-site/js/nav.js` that:
- Defines the full navigation structure as a JS object (sections + pages)
- Exports a function `renderNav()` that:
  - Builds sidebar HTML from the nav structure
  - Highlights the current page based on `window.location.pathname`
  - Injects into `#sidebar` element
- Navigation structure:
  - Getting Started: Overview (index.html), Quick Start (getting-started.html)
  - Setup: OAuth Providers (oauth-setup.html), Configuration (configuration.html)
  - Deployment: Production Deployment (deployment.html), Architecture (architecture.html)
  - Usage: Admin Guide (admin-guide.html), Troubleshooting (troubleshooting.html)

**Step 2: Create main.js**

Create `docs-site/js/main.js` that:
- Calls `renderNav()` on DOMContentLoaded
- Dark/light toggle: reads localStorage, applies class, toggles on button click
- Copy buttons: finds all `<pre><code>` blocks, adds a "Copy" button, copies text on click with brief "Copied!" feedback
- Hamburger menu: toggles sidebar visibility on mobile
- Heading anchors: adds `id` to headings and `#` links on hover
- Initializes highlight.js if loaded

**Step 3: Verify files exist**

Run: `ls docs-site/js/`
Expected: `main.js  nav.js`

**Step 4: Commit**

```bash
git add docs-site/js/
git commit -m "docs: add shared JS for nav, dark mode, and code features"
```

---

### Task 3: Create index.html (Overview / Landing)

**Files:**
- Create: `docs-site/index.html`

**Step 1: Create the page**

Create `docs-site/index.html` with:
- Standard HTML5 boilerplate
- `<link>` to `css/style.css`
- `<link>` to highlight.js CSS (CDN, both light and dark themes)
- `<script>` for highlight.js (CDN), `nav.js`, `main.js`
- `<div id="sidebar">` (populated by nav.js)
- `<main>` content:
  - Hero section: "Nostr OAuth Signer" title, one-line description
  - What it does: bridge OAuth login (Google, GitHub, Microsoft, Apple) with Nostr key management
  - Key features list: OAuth authentication, encrypted key storage (AES-256-GCM), NIP-46 bunker protocol, multi-identity support, time-limited identity assignments, admin dashboard
  - How it works (brief): OAuth login -> identity selection -> NIP-46 signing
  - Quick links to other doc pages
- Dark mode toggle button in top bar

**Step 2: Open in browser to verify**

Run: `open docs-site/index.html` (or just verify file structure)

**Step 3: Commit**

```bash
git add docs-site/index.html
git commit -m "docs: add index page with overview"
```

---

### Task 4: Create getting-started.html (Quick Start)

**Files:**
- Create: `docs-site/getting-started.html`

**Step 1: Create the page**

Content covers:
- **Prerequisites**: Rust (1.70+), Node.js (18+) for web-ui build, Git, OpenSSL (for key generation)
- **Clone and build**:
  ```bash
  git clone <repo-url>
  cd oauth-signer
  # Build the web UI
  cd web-ui && npm install && npm run build && cd ..
  # Build the Rust server
  cargo build --release
  ```
- **Generate master key**:
  ```bash
  openssl rand -hex 32
  ```
- **Create `.env`** — minimal example with all required vars, sensible defaults noted
- **Configure at least one OAuth provider** — link to oauth-setup.html for details
- **Run**:
  ```bash
  cargo run
  ```
- **Verify**: Visit `http://localhost:3000`, see landing page with OAuth buttons
- **Next steps**: links to configuration.html, oauth-setup.html, deployment.html

**Step 2: Commit**

```bash
git add docs-site/getting-started.html
git commit -m "docs: add getting started guide"
```

---

### Task 5: Create oauth-setup.html (OAuth Provider Configuration)

**Files:**
- Create: `docs-site/oauth-setup.html`

**Step 1: Create the page**

Content based on existing `docs/oauth-setup.md`. Each provider gets its own section with:
- **Google**: Cloud Console setup, consent screen, create OAuth client, redirect URI pattern, env vars
- **GitHub**: Developer Settings, new OAuth app, redirect URI, env vars. Note: secret shown once
- **Microsoft**: Azure Portal app registration, account type choice (consumers/organizations/common), permissions, env vars. Note: secret shown once
- **Apple**: Developer Portal, App ID, Services ID, Key creation, `.p8` download, JWT generation script, env vars. Note: requires HTTPS even in dev
- **Redirect URI reference table**: all four providers with pattern `{PUBLIC_URL}/auth/{provider}/callback`
- **Master Key** section: generation and importance

**Step 2: Commit**

```bash
git add docs-site/oauth-setup.html
git commit -m "docs: add OAuth provider setup guide"
```

---

### Task 6: Create configuration.html (Configuration Reference)

**Files:**
- Create: `docs-site/configuration.html`

**Step 1: Create the page**

Reference table for every environment variable from `src/config.rs`:

| Variable | Required | Default | Description |
|---|---|---|---|
| `HOST` | No | `127.0.0.1` | Server bind address |
| `PORT` | No | `3000` | Server port |
| `PUBLIC_URL` | No | `http://localhost:3000` | Full public URL (used for OAuth callbacks) |
| `MASTER_KEY` | **Yes** | — | 32-byte hex key for encrypting stored nsecs |
| `GOOGLE_CLIENT_ID` | **Yes** | — | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | **Yes** | — | Google OAuth client secret |
| `GITHUB_CLIENT_ID` | **Yes** | — | GitHub OAuth client ID |
| `GITHUB_CLIENT_SECRET` | **Yes** | — | GitHub OAuth client secret |
| `MICROSOFT_CLIENT_ID` | **Yes** | — | Microsoft OAuth client ID |
| `MICROSOFT_CLIENT_SECRET` | **Yes** | — | Microsoft OAuth client secret |
| `APPLE_CLIENT_ID` | **Yes** | — | Apple Services ID |
| `APPLE_CLIENT_SECRET` | **Yes** | — | Apple JWT client secret |
| `NOSTR_RELAYS` | No | `wss://relay.nsec.app,wss://relay.damus.io,wss://nos.lol` | Comma-separated relay URLs |
| `DATABASE_URL` | No | `oauth-signer.db` | SQLite database file path |
| `RUST_LOG` | No | — | Logging filter (e.g., `info`, `oauth_signer=debug`) |

Sections:
- Complete `.env` example file
- Notes on each category (server, encryption, OAuth, Nostr, database, logging)

**Step 2: Commit**

```bash
git add docs-site/configuration.html
git commit -m "docs: add configuration reference"
```

---

### Task 7: Create deployment.html (Production Deployment)

**Files:**
- Create: `docs-site/deployment.html`

**Step 1: Create the page**

Content based on `TUNNEL-SETUP.md` and `SPLIT-ARCHITECTURE.md`:

- **Deployment models**: Monolithic (single server) vs Split (bunker + web service)
- **Monolithic deployment**:
  - Suitable for personal use behind a reverse proxy
  - Use Cloudflare Tunnel to expose only needed routes
  - Admin routes stay LAN-only
- **Cloudflare Tunnel setup**:
  - Install cloudflared
  - Create tunnel, add DNS route
  - `config.yml` with selective routing (include full example)
  - Routes table: what's exposed vs hidden
  - Update `PUBLIC_URL` and OAuth callback URLs
- **Split architecture** (production recommended):
  - Components: Bunker (LAN), Web Service (internet), Shared DB
  - What each service needs (data ownership table)
  - Security properties: NSECs never leave LAN
- **Security checklist**:
  - MASTER_KEY backed up securely
  - Admin routes not exposed to internet
  - HTTPS on public-facing service
  - OAuth callback URLs match PUBLIC_URL
  - Firewall rules for LAN-only bunker

**Step 2: Commit**

```bash
git add docs-site/deployment.html
git commit -m "docs: add deployment guide"
```

---

### Task 8: Create admin-guide.html (Admin Guide)

**Files:**
- Create: `docs-site/admin-guide.html`

**Step 1: Create the page**

Content covering the admin dashboard at `/admin` (LAN-only):

- **Accessing the admin panel**: Navigate to `http://localhost:3000` (or LAN IP), admin routes are at `/api/admin/*`
- **Managing identities**:
  - Adding: paste an nsec (bech32), optionally add a label
  - The nsec is encrypted with AES-256-GCM using a key derived from MASTER_KEY + identity ID
  - Listing: shows pubkey (npub), label, created date, active connection count
  - Deleting: removes identity and all associated connections
- **Managing users**:
  - Users are created automatically on first OAuth login
  - View all users with their OAuth provider and email
- **Identity assignments**:
  - Assign identities to specific users with time limits
  - Duration options: 1 day, 1 week, 1 month, 6 months, 1 year
  - Expired assignments are auto-cleaned every 5 minutes
  - Users can only connect to identities they're assigned to
  - Revoking: delete the assignment to immediately revoke access
- **Monitoring connections**:
  - View active NIP-46 connections per identity
  - See which client pubkey connected via which relay

**Step 2: Commit**

```bash
git add docs-site/admin-guide.html
git commit -m "docs: add admin guide"
```

---

### Task 9: Create architecture.html (Architecture)

**Files:**
- Create: `docs-site/architecture.html`

**Step 1: Create the page**

Content covering how the system works:

- **Overview**: OAuth bridge + NIP-46 bunker + encrypted key vault
- **NIP-46 Bunker Protocol**:
  - What NIP-46 is (Nostr Connect / remote signing)
  - Supported methods: connect, sign_event, get_public_key, get_relays, nip44_encrypt, nip04_encrypt
  - How clients connect (bunker URI format)
- **Connection flow** (from SPLIT-ARCHITECTURE.md):
  - Step-by-step: client requests → auth URL → OAuth → identity picker → approval → signing
  - Include the ASCII sequence diagram from SPLIT-ARCHITECTURE.md (adapted)
- **Key encryption model**:
  - MASTER_KEY stored in environment (never in DB)
  - Per-identity key derivation: `HKDF-SHA256(salt=user_id, key=MASTER_KEY)`
  - Encryption: AES-256-GCM with random nonce
  - Decryption only happens in bunker memory during signing, then zeroized
- **Database schema** (overview, not full DDL):
  - Users, Identities, Assignments, Connections, Sessions, PendingAuth
  - Relationships between tables
- **Security properties**:
  - NSECs encrypted at rest, decrypted only for signing
  - Split architecture keeps keys on LAN
  - Assignment expiration enforced at signing time
  - OAuth sessions are separate from NIP-46 connections

**Step 2: Commit**

```bash
git add docs-site/architecture.html
git commit -m "docs: add architecture overview"
```

---

### Task 10: Create troubleshooting.html

**Files:**
- Create: `docs-site/troubleshooting.html`

**Step 1: Create the page**

Common issues and solutions:

- **OAuth callback errors**:
  - "Redirect URI mismatch": PUBLIC_URL doesn't match provider config
  - "Invalid client": wrong client ID/secret
  - Apple requires HTTPS even for development
- **Startup errors**:
  - "MASTER_KEY must be set": missing from .env
  - "MASTER_KEY must be 32 bytes": wrong length (need 64 hex chars)
  - "Failed to bind": port already in use or wrong HOST
- **Relay connection issues**:
  - Bunker can't connect to relays: check NOSTR_RELAYS, firewall rules
  - Clients can't find bunker: verify bunker pubkey, check relay connectivity
- **Database issues**:
  - Permission errors: check DATABASE_URL path is writable
  - Corrupted DB: WAL mode details, how to recover
- **Assignment issues**:
  - User can't see identities: check assignments exist and aren't expired
  - Signing fails with expired assignment: renew in admin
- **Debugging tips**:
  - Enable verbose logging: `RUST_LOG=oauth_signer=debug cargo run`
  - Check structured JSON logs for specific errors
  - Test OAuth flow in browser directly

**Step 2: Commit**

```bash
git add docs-site/troubleshooting.html
git commit -m "docs: add troubleshooting guide"
```

---

### Task 11: Final review and polish

**Step 1: Open each page in browser and verify**

- Navigation works across all pages
- Dark/light toggle works and persists
- Code blocks have syntax highlighting
- Copy buttons work
- Mobile responsive (resize browser to narrow width)
- All internal links resolve correctly

**Step 2: Fix any broken links or styling issues**

**Step 3: Final commit**

```bash
git add docs-site/
git commit -m "docs: polish docs site, fix any issues"
```
