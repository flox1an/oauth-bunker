# OAuth Provider Setup Guide

This guide explains how to create OAuth client credentials for each supported provider.

## Google

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Navigate to **APIs & Services > Credentials**
4. Click **Create Credentials > OAuth client ID**
5. If prompted, configure the **OAuth consent screen** first:
   - Choose "External" user type
   - Fill in app name, support email
   - Add scopes: `openid`, `email`, `profile`
   - Add your domain to authorized domains
6. Back in Credentials, create an **OAuth 2.0 Client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `https://your-domain.com/auth/google/callback`
   - For local development: `http://localhost:3000/auth/google/callback`
7. Copy the **Client ID** and **Client Secret** to your `.env`:
   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

## GitHub

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in:
   - Application name: your app name
   - Homepage URL: `https://your-domain.com`
   - Authorization callback URL: `https://your-domain.com/auth/github/callback`
   - For local development: `http://localhost:3000/auth/github/callback`
4. Click **Register application**
5. On the app page, click **Generate a new client secret**
6. Copy the **Client ID** and **Client Secret** to your `.env`:
   ```
   GITHUB_CLIENT_ID=your-client-id
   GITHUB_CLIENT_SECRET=your-client-secret
   ```

Note: GitHub client secrets are only shown once. Save it immediately.

## Microsoft (Outlook.com / Azure AD)

1. Go to [Azure Portal - App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade)
2. Click **New registration**
3. Fill in:
   - Name: your app name
   - Supported account types: **Personal Microsoft accounts only** (for Outlook.com users)
     - Choose "Accounts in any organizational directory and personal Microsoft accounts" if you also want work/school accounts
   - Redirect URI: Select **Web** platform, enter `https://your-domain.com/auth/microsoft/callback`
   - For local development: `http://localhost:3000/auth/microsoft/callback`
4. Click **Register**
5. On the app overview page, copy the **Application (client) ID**
6. Navigate to **Certificates & secrets > Client secrets**
7. Click **New client secret**, add a description, choose expiry
8. Copy the secret **Value** (not the Secret ID) immediately — it's only shown once
9. Navigate to **API permissions** and ensure these are added:
   - `openid` (delegated)
   - `email` (delegated)
   - `profile` (delegated)
   - `User.Read` (delegated)
   - These are usually added by default
10. Copy credentials to your `.env`:
    ```
    MICROSOFT_CLIENT_ID=your-application-client-id
    MICROSOFT_CLIENT_SECRET=your-client-secret-value
    ```

### Microsoft tenant configuration

The OAuth URLs use the `consumers` tenant, which only allows personal Microsoft accounts (Outlook.com, Hotmail, Live). If you need organizational accounts:

- `consumers` — personal accounts only (Outlook.com, Hotmail)
- `organizations` — work/school accounts only
- `common` — both personal and organizational

To change this, modify the auth/token URLs in `src/oauth.rs`.

## Master Encryption Key

Generate a 32-byte random key for encrypting stored Nostr private keys:

```bash
openssl rand -hex 32
```

Add it to your `.env`:
```
MASTER_KEY=your-64-character-hex-string
```

This key encrypts all user nsecs at rest. Keep it secure and back it up — losing it means losing access to all stored keys.

## Local Development

For local development, use `http://localhost:3000` as the `PUBLIC_URL` and add `http://localhost:3000/auth/{provider}/callback` as a redirect URI for each provider.

```env
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=http://localhost:3000
MASTER_KEY=<generate with openssl rand -hex 32>
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
```
