# Cloudflare Tunnel Setup

Run the bunker on a LAN behind a firewall while exposing only the
necessary OAuth and web UI routes to the internet. The NIP-46 bunker
itself only makes **outbound** websocket connections to Nostr relays, so
no inbound ports are needed for signing.

## Prerequisites

```bash
brew install cloudflared
```

## Create the tunnel

```bash
# Authenticate with Cloudflare
cloudflared tunnel login

# Create a named tunnel
cloudflared tunnel create bunker-demo

# Add a DNS record pointing to the tunnel
cloudflared tunnel route dns bunker-demo bunker.yourdomain.com
```

## Configure selective routing

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: <YOUR_TUNNEL_ID>
credentials-file: /home/user/.cloudflared/<YOUR_TUNNEL_ID>.json

ingress:
  # Block admin routes — keep these LAN-only
  - hostname: bunker.yourdomain.com
    path: /api/admin.*
    service: http_status:404

  # OAuth flow
  - hostname: bunker.yourdomain.com
    path: /auth.*
    service: http://localhost:3000

  # Auth popup (user picks identity after OAuth)
  - hostname: bunker.yourdomain.com
    path: /auth-popup.*
    service: http://localhost:3000

  # Web UI assets
  - hostname: bunker.yourdomain.com
    path: /assets.*
    service: http://localhost:3000

  # API endpoints needed by the web UI
  - hostname: bunker.yourdomain.com
    path: /api/me
    service: http://localhost:3000
  - hostname: bunker.yourdomain.com
    path: /api/select-identity
    service: http://localhost:3000
  - hostname: bunker.yourdomain.com
    path: /api/identities
    service: http://localhost:3000

  # NIP-89 discovery
  - hostname: bunker.yourdomain.com
    path: /.well-known/nostr.json
    service: http://localhost:3000

  # SPA index
  - hostname: bunker.yourdomain.com
    path: /
    service: http://localhost:3000

  # Block everything else
  - service: http_status:404
```

## Update environment

Set `PUBLIC_URL` to match the tunnel hostname so OAuth callback URLs are
generated correctly:

```bash
PUBLIC_URL=https://bunker.yourdomain.com
```

Update OAuth provider callback URLs in their respective dashboards:

- Google: `https://bunker.yourdomain.com/auth/google/callback`
- GitHub: `https://bunker.yourdomain.com/auth/github/callback`
- Microsoft: `https://bunker.yourdomain.com/auth/microsoft/callback`
- Apple: `https://bunker.yourdomain.com/auth/apple/callback`

## Run

```bash
# Start the bunker
cargo run

# In another terminal, start the tunnel
cloudflared tunnel run bunker-demo
```

## What's exposed vs. hidden

| Route | Exposed | Purpose |
|---|---|---|
| `/auth/*` | Yes | OAuth initiation and callbacks |
| `/auth-popup/*` | Yes | Identity selection after OAuth |
| `/api/me` | Yes | Current user info for web UI |
| `/api/select-identity` | Yes | Identity picker for auth flow |
| `/api/identities` | Yes | List available identities |
| `/.well-known/nostr.json` | Yes | NIP-89 bunker discovery |
| `/assets/*` | Yes | Static frontend assets |
| `/api/admin/*` | **No** | Identity & user management |
| `/api/connections` | **No** | Connection management |
| NIP-46 bunker | **No** | Outbound relay connections only |
