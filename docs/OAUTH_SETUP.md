# OAuth Authentication Setup Guide

This guide walks you through setting up Google and GitHub OAuth authentication for the Splat App.

## Overview

The Splat App uses OAuth 2.0 authentication with two providers:
- **Google OAuth** - For users with Google accounts
- **GitHub OAuth** - For users with GitHub accounts

Both use the authorization code flow with secure session management via HTTP-only cookies.

## Prerequisites

- Cloudflare Workers account with D1 database configured
- Domain or localhost setup for testing
- Access to Google Cloud Console and GitHub Developer Settings

## Part 1: Database Setup

First, ensure your D1 database has the authentication tables:

```bash
# For production
wrangler d1 execute splat-app-db --file=./worker/schema.sql

# For local development
wrangler d1 execute splat-app-db --local --file=./worker/schema.sql
```

This creates the `users` and `sessions` tables needed for authentication.

## Part 2: Google OAuth Setup

### Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Navigate to **APIs & Services** → **Credentials**

### Step 2: Configure OAuth Consent Screen

1. Click **OAuth consent screen** in the left sidebar
2. Select **External** user type (or Internal if using Google Workspace)
3. Fill in the required fields:
   - **App name**: Splat App
   - **User support email**: Your email
   - **Developer contact email**: Your email
4. Add scopes:
   - `openid`
   - `email`
   - `profile`
5. Add test users if in testing mode
6. Save and continue

### Step 3: Create OAuth 2.0 Client ID

1. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
2. Select **Application type**: Web application
3. **Name**: Splat App Web Client
4. **Authorized JavaScript origins**:
   - For local dev: `http://localhost:5173`
   - For production: `https://your-domain.com`
5. **Authorized redirect URIs**:
   - For local dev: `http://localhost:5173/api/auth/google/callback`
   - For production: `https://your-domain.com/api/auth/google/callback`
6. Click **Create**
7. **Important**: Copy the **Client ID** and **Client Secret** - you'll need these!

### Step 4: Configure Cloudflare Secrets

Add your Google OAuth credentials to Cloudflare Workers:

```bash
# Set Google Client ID
wrangler secret put GOOGLE_CLIENT_ID
# Paste your Client ID when prompted

# Set Google Client Secret
wrangler secret put GOOGLE_CLIENT_SECRET
# Paste your Client Secret when prompted
```

## Part 3: GitHub OAuth Setup

### Step 1: Register OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **OAuth Apps** → **New OAuth App**
3. Fill in the application details:
   - **Application name**: Splat App
   - **Homepage URL**:
     - For local dev: `http://localhost:5173`
     - For production: `https://your-domain.com`
   - **Authorization callback URL**:
     - For local dev: `http://localhost:5173/api/auth/github/callback`
     - For production: `https://your-domain.com/api/auth/github/callback`
4. Click **Register application**

### Step 2: Generate Client Secret

1. After registration, you'll see your **Client ID**
2. Click **Generate a new client secret**
3. **Important**: Copy both the **Client ID** and **Client Secret** immediately - the secret won't be shown again!

### Step 3: Configure Cloudflare Secrets

Add your GitHub OAuth credentials to Cloudflare Workers:

```bash
# Set GitHub Client ID
wrangler secret put GITHUB_CLIENT_ID
# Paste your Client ID when prompted

# Set GitHub Client Secret
wrangler secret put GITHUB_CLIENT_SECRET
# Paste your Client Secret when prompted
```

## Part 4: Configure Base URL

Set your application's base URL for OAuth redirects:

```bash
# For local development
wrangler secret put BASE_URL
# Enter: http://localhost:5173

# For production
wrangler secret put BASE_URL
# Enter: https://your-domain.com
```

## Part 5: Update wrangler.toml

Ensure your `wrangler.toml` includes all required bindings:

```toml
name = "splat-app-worker"
main = "worker/src/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "SPLAT_DB"
database_name = "splat-app-db"
database_id = "your-database-id"

[[r2_buckets]]
binding = "SPLAT_BUCKET"
bucket_name = "splat-app-bucket"

# Secrets are configured via wrangler secret put
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - GITHUB_CLIENT_ID
# - GITHUB_CLIENT_SECRET
# - BASE_URL
```

## Part 6: Testing

### Local Development

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Start the worker locally:
   ```bash
   npm run worker:dev
   ```

3. Open `http://localhost:5173` in your browser

4. Test authentication:
   - Click "Sign in with Google" - should redirect to Google login
   - Complete Google authentication - should redirect back with profile
   - Click "Logout" - should clear session
   - Click "Sign in with GitHub" - should redirect to GitHub login
   - Complete GitHub authentication - should redirect back with profile

### Verify Session

Check the browser developer tools:
- **Application** → **Cookies** → Look for `session` cookie
- Should have flags: `HttpOnly`, `Secure`, `SameSite=Lax`

### Check Database

Verify users and sessions are being created:

```bash
# Check users table
wrangler d1 execute splat-app-db --local --command "SELECT * FROM users"

# Check sessions table
wrangler d1 execute splat-app-db --local --command "SELECT * FROM sessions"
```

## Security Considerations

### Session Security
- Sessions use HTTP-only cookies to prevent XSS attacks
- Secure flag ensures cookies are only sent over HTTPS
- SameSite=Lax prevents CSRF attacks
- Sessions expire after 30 days
- Session IDs are cryptographically random (32 bytes)

### State Parameter
- OAuth flows use a random state parameter for CSRF protection
- State is validated on callback to prevent authorization code injection

### Environment Variables
- Never commit OAuth secrets to version control
- Use Cloudflare Workers secrets management
- Rotate secrets periodically

### CORS Configuration
- Credentials mode is enabled for authentication
- Origin validation is performed
- Only necessary headers are exposed

## Troubleshooting

### "redirect_uri_mismatch" Error

**Problem**: OAuth provider rejects the redirect URI

**Solution**:
1. Ensure the redirect URI in your OAuth app settings exactly matches the one in your code
2. Check for trailing slashes - they must match exactly
3. Verify protocol (http vs https)
4. For Google: Add both JavaScript origins and redirect URIs

### Session Not Persisting

**Problem**: User is logged out on page refresh

**Solution**:
1. Ensure cookies are being set correctly (check HttpOnly, Secure, SameSite flags)
2. Verify `credentials: 'include'` is set in all fetch requests
3. Check CORS headers include `Access-Control-Allow-Credentials: true`
4. For local development: Ensure BASE_URL uses http:// (not https://)

### "Failed to exchange code for token"

**Problem**: Token exchange fails during OAuth callback

**Solution**:
1. Verify Client ID and Client Secret are correct
2. Check that secrets are properly set in Cloudflare Workers
3. Ensure authorization code hasn't expired (use it immediately)
4. Verify redirect URI matches exactly

### GitHub Email Not Available

**Problem**: GitHub user has private email

**Solution**: The implementation automatically falls back to fetching primary email from GitHub API using the `/user/emails` endpoint. Ensure the OAuth scope includes `user:email`.

## API Endpoints

### Authentication Endpoints

```
GET  /api/auth/google          - Initiate Google OAuth flow
GET  /api/auth/google/callback - Google OAuth callback
GET  /api/auth/github          - Initiate GitHub OAuth flow
GET  /api/auth/github/callback - GitHub OAuth callback
GET  /api/auth/me              - Get current user (requires session)
POST /api/auth/logout          - Logout (clear session)
```

### Example Usage

```javascript
// Check authentication status
const response = await fetch('/api/auth/me', {
    credentials: 'include'
});
if (response.ok) {
    const { user } = await response.json();
    console.log('Logged in as:', user.name);
}

// Logout
await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include'
});
```

## Production Deployment

### Pre-Deployment Checklist

- [ ] OAuth apps configured for production domain
- [ ] All secrets set in production Cloudflare Workers
- [ ] BASE_URL set to production domain (https://)
- [ ] Database migrations run on production D1
- [ ] CORS origins updated for production domain
- [ ] OAuth consent screens configured (not in testing mode)
- [ ] SSL certificate configured for production domain

### Deploy to Production

```bash
# Deploy worker
npm run worker:deploy

# Verify deployment
curl https://your-domain.com/api/auth/me
```

### Post-Deployment Testing

1. Clear browser cookies
2. Navigate to production URL
3. Test Google OAuth flow end-to-end
4. Test GitHub OAuth flow end-to-end
5. Verify session persists across page refreshes
6. Test logout functionality

## Monitoring

### Session Cleanup

The database includes expired session cleanup functionality. Consider running this periodically:

```typescript
// In your worker, add a scheduled event handler
export default {
    async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
        await Auth.cleanExpiredSessions(env.SPLAT_DB);
    }
};
```

Add to `wrangler.toml`:
```toml
[triggers]
crons = ["0 0 * * *"]  # Run daily at midnight
```

### Analytics

Consider tracking:
- New user registrations
- Login success/failure rates
- Provider preference (Google vs GitHub)
- Session duration
- Active users

## Next Steps

After OAuth authentication is working:

1. **Cloud Project Sync** - Sync local IndexedDB projects to D1 when user authenticates
2. **Public/Private Projects** - Allow users to make projects public or keep them private
3. **Project Sharing** - Share project links with other users
4. **Social Features** - Follow users, like projects, comments

## Support

For issues or questions:
- Check Cloudflare Workers logs: `wrangler tail`
- Review browser console for client-side errors
- Verify OAuth app configuration in provider dashboards
- Consult [Google OAuth documentation](https://developers.google.com/identity/protocols/oauth2)
- Consult [GitHub OAuth documentation](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
