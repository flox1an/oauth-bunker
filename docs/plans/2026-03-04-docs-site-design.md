# Documentation Site Design

## Goal
Create a static HTML documentation site for self-hosters to learn everything about setting up and running the Nostr OAuth Signer.

## Audience
Self-hosters with sysadmin-level technical capability.

## Approach
Hand-crafted static HTML/CSS/JS in a `docs-site/` folder. No build step, no dependencies. Deployable to any static host (GitHub Pages, Netlify, etc.).

## Structure

```
docs-site/
  index.html            # Landing/overview
  getting-started.html  # Quick start guide
  oauth-setup.html      # OAuth provider config (Google, GitHub, Microsoft, Apple)
  configuration.html    # Environment variables and .env
  deployment.html       # Production deployment (Cloudflare Tunnel, split arch)
  admin-guide.html      # Admin dashboard usage
  architecture.html     # How it works, security model, data flow
  troubleshooting.html  # Common issues
  css/
    style.css           # All styling
  js/
    main.js             # Dark mode, code highlighting, copy buttons
    nav.js              # Shared sidebar nav injected into all pages
```

## UI Features
- Sidebar navigation with active page highlight
- Dark/light mode toggle (respects system preference, persists in localStorage)
- Code blocks with syntax highlighting (highlight.js via CDN)
- Responsive layout (sidebar collapses to hamburger on mobile)
- Copy buttons on code blocks
- Anchor links on headings for deep linking

## Page Content

### index.html - Overview
- What the app does, why it exists
- Key features list
- Links to other pages

### getting-started.html - Quick Start
- Prerequisites (Rust, Node.js for web-ui build)
- Clone, build, configure minimal .env, run
- Verify it's working

### oauth-setup.html - OAuth Provider Setup
- Step-by-step for Google, GitHub, Microsoft, Apple
- Each in its own section with redirect URI patterns
- Based on existing docs/oauth-setup.md content

### configuration.html - Configuration Reference
- Every environment variable with description, type, default, example
- Grouped by category (server, encryption, OAuth providers, Nostr, database)

### deployment.html - Production Deployment
- Cloudflare Tunnel setup (from TUNNEL-SETUP.md)
- Split architecture overview (from SPLIT-ARCHITECTURE.md)
- Which routes to expose vs keep LAN-only
- Security checklist

### admin-guide.html - Admin Guide
- Adding identities (paste nsec)
- Managing users and assignments
- Monitoring connections
- Assignment expiration and cleanup

### architecture.html - Architecture
- Monolithic vs split deployment models
- NIP-46 bunker protocol flow
- Key encryption model (MASTER_KEY, HKDF, AES-256-GCM)
- Data flow diagrams (OAuth -> session -> identity selection -> signing)
- Database schema overview

### troubleshooting.html - Troubleshooting
- Common errors and fixes
- OAuth callback issues
- Relay connection problems
- Database issues
- Debugging tips

## Visual Style
- Modern docs site aesthetic (clean typography, generous whitespace)
- Dark mode with muted colors, light mode with high contrast
- Monospace code blocks with language-appropriate highlighting
- Consistent color palette across both modes
