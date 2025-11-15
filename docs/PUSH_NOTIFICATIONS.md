# Push Notifications Setup Guide

This guide explains how to set up Web Push notifications for the Splat App to notify users when their 3D reconstruction is complete.

## Overview

The app uses the Web Push API with VAPID (Voluntary Application Server Identification) keys to send notifications to users when their Gaussian Splatting processing jobs complete.

## Features

- 🔔 Real-time notifications when processing completes
- 📱 Works on mobile and desktop (Chrome, Firefox, Edge, Safari 16+)
- 🔒 Secure push using VAPID authentication
- 📊 Subscription management in D1 database
- 🎯 Project-specific subscriptions

## Setup Steps

### 1. Generate VAPID Keys

VAPID keys are required for authenticating push notifications. Generate them using the `web-push` library:

```bash
# Install web-push globally
npm install -g web-push

# Generate VAPID keys
web-push generate-vapid-keys
```

This will output:
```
Public Key: BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U
Private Key: [your-private-key-here]
```

### 2. Configure Backend

Add the VAPID keys to your Cloudflare Worker secrets:

```bash
# Add VAPID public key
wrangler secret put VAPID_PUBLIC_KEY
# Paste the public key when prompted

# Add VAPID private key
wrangler secret put VAPID_PRIVATE_KEY
# Paste the private key when prompted

# Add contact email for VAPID
wrangler secret put VAPID_SUBJECT
# Enter: mailto:your-email@example.com
```

Update `worker/wrangler.toml` to document these variables:

```toml
# Environment variables (set via `wrangler secret put`)
# VAPID_PUBLIC_KEY - Your VAPID public key for Web Push
# VAPID_PRIVATE_KEY - Your VAPID private key for Web Push
# VAPID_SUBJECT - Contact email (mailto:your@email.com)
```

### 3. Configure Frontend

Update the `vapidPublicKey` in `src/main.js` with your actual public key:

```javascript
// Replace the placeholder key with your actual VAPID public key
const vapidPublicKey = 'YOUR_ACTUAL_VAPID_PUBLIC_KEY_HERE';
```

Alternatively, you can create an API endpoint to fetch the public key:

```typescript
// In worker/src/index.ts
if (path === '/api/vapid-public-key' && request.method === 'GET') {
    return jsonResponse({ publicKey: env.VAPID_PUBLIC_KEY }, 200, corsHeaders);
}
```

### 4. Database Setup

The database schema already includes the `push_subscriptions` table. Run the migration:

```bash
# For production
wrangler d1 execute splat-app-db --file=./worker/schema.sql

# For local development
wrangler d1 execute splat-app-db --local --file=./worker/schema.sql
```

### 5. Implement Web Push in Worker (Production)

For production use, install the `web-push` library and update `worker/src/index.ts`:

```typescript
import webpush from 'web-push';

// Configure web-push
webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
);

// In sendPushNotification function, replace the TODO with:
await webpush.sendNotification(
    {
        endpoint: sub.endpoint,
        keys: {
            p256dh: sub.p256dh_key,
            auth: sub.auth_key
        }
    },
    JSON.stringify({ title, body, url })
);
```

## How It Works

### 1. User Flow

1. User visits the PWA
2. Service Worker registers
3. App requests notification permission
4. If granted, subscribes to push notifications
5. Subscription is sent to backend and stored in D1

### 2. Notification Flow

1. User uploads photos and starts processing
2. RunPod processes the Gaussian Splatting
3. RunPod calls webhook when complete
4. Worker sends push notification to all subscribed devices
5. User receives notification with click action to view result

### 3. Database Schema

```sql
CREATE TABLE push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    project_id TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);
```

## API Endpoints

### Subscribe to Notifications

```http
POST /api/push/subscribe
Content-Type: application/json

{
    "subscription": {
        "endpoint": "https://fcm.googleapis.com/fcm/send/...",
        "keys": {
            "p256dh": "BNcRd...",
            "auth": "tBHI..."
        }
    },
    "projectId": "optional-project-id"
}
```

### Unsubscribe

```http
POST /api/push/unsubscribe
Content-Type: application/json

{
    "endpoint": "https://fcm.googleapis.com/fcm/send/..."
}
```

## Testing Notifications

### Manual Test

You can test notifications using the browser's DevTools:

```javascript
// In browser console
navigator.serviceWorker.ready.then(registration => {
    registration.showNotification('Test Notification', {
        body: 'This is a test',
        icon: '/icon-192.png',
        badge: '/icon-192.png'
    });
});
```

### Backend Test

Create a test endpoint in your worker:

```typescript
if (path === '/api/test-push' && request.method === 'POST') {
    const body = await request.json();
    await sendPushNotification(
        env,
        body.projectId,
        'Test Notification',
        'This is a test notification',
        '/'
    );
    return jsonResponse({ success: true }, 200, corsHeaders);
}
```

## Browser Support

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 50+ | ✅ Full | Best support |
| Firefox 44+ | ✅ Full | Excellent support |
| Edge 17+ | ✅ Full | Chromium-based |
| Safari 16+ | ✅ Limited | macOS 13+, iOS 16.4+ |
| Opera 39+ | ✅ Full | Chromium-based |

## Security Considerations

1. **VAPID Keys**: Keep private key secret, never expose in client code
2. **Permissions**: Respect user's notification preferences
3. **Subscription Management**: Clean up old/invalid subscriptions
4. **Rate Limiting**: Implement rate limits to prevent spam
5. **Data Privacy**: Don't send sensitive data in notifications

## Troubleshooting

### Notifications not showing

1. Check browser permissions: `Notification.permission`
2. Verify Service Worker is active
3. Check browser console for errors
4. Ensure VAPID keys are configured correctly

### Subscription fails

1. Verify VAPID public key matches backend
2. Check Service Worker registration status
3. Ensure HTTPS (required for push notifications)
4. Test with different browser

### Backend errors

1. Verify all environment variables are set
2. Check D1 database schema is up to date
3. Review worker logs: `wrangler tail`
4. Test subscription endpoint directly

## Cost Considerations

- Push notifications via Web Push API are **free**
- No third-party services required (unlike Firebase Cloud Messaging)
- D1 database storage for subscriptions is minimal (~100 bytes per subscription)
- Cloudflare Workers requests for push endpoints count toward your quota

## Future Enhancements

- [ ] Add notification preferences (email + push)
- [ ] Support notification customization per project
- [ ] Add notification history/inbox
- [ ] Implement notification actions (View, Dismiss, Share)
- [ ] Support rich notifications with images
- [ ] Add notification scheduling for reminders
- [ ] Implement notification grouping for batch jobs

## Resources

- [Web Push API MDN](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [VAPID Spec](https://datatracker.ietf.org/doc/html/rfc8292)
- [web-push library](https://github.com/web-push-libs/web-push)
- [Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
