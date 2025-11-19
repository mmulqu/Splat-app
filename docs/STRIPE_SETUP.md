# Stripe Integration Setup Guide

This guide walks you through setting up Stripe payment processing for the Splat App monetization system.

---

## Prerequisites

- A Stripe account (sign up at https://stripe.com)
- Cloudflare Workers deployed
- D1 database set up with monetization schema

---

## Step 1: Create Stripe Account

1. **Sign up for Stripe** at https://stripe.com
2. **Verify your email** and complete account setup
3. **Activate your account** (for production payments)

---

## Step 2: Get Stripe API Keys

### Test Mode Keys (for development)

1. Go to https://dashboard.stripe.com/test/apikeys
2. Copy your **Publishable key** (starts with `pk_test_`)
3. Copy your **Secret key** (starts with `sk_test_`)

### Production Keys (for live payments)

1. Switch to Live mode in Stripe Dashboard
2. Go to https://dashboard.stripe.com/apikeys
3. Copy your **Publishable key** (starts with `pk_live_`)
4. Copy your **Secret key** (starts with `sk_live_`)

⚠️ **Never commit secret keys to git!** Use environment variables.

---

## Step 3: Configure Cloudflare Secrets

Set your Stripe keys as Cloudflare Worker secrets:

```bash
# Test mode (for development)
wrangler secret put STRIPE_SECRET_KEY
# Paste: sk_test_...

wrangler secret put STRIPE_PUBLISHABLE_KEY
# Paste: pk_test_...

# Production (when ready to go live)
wrangler secret put STRIPE_SECRET_KEY --env production
# Paste: sk_live_...

wrangler secret put STRIPE_PUBLISHABLE_KEY --env production
# Paste: pk_live_...
```

---

## Step 4: Create Stripe Products and Prices

You need to create products in Stripe for each credit package and subscription plan.

### Option A: Stripe Dashboard (Manual)

#### Credit Packages

1. Go to https://dashboard.stripe.com/test/products
2. Click **+ Add product**
3. For each package:

   **Starter Pack:**
   - Name: `Starter Pack`
   - Description: `500 credits for Splat App`
   - Pricing: One-time, $5.00 USD
   - Copy the **Price ID** (starts with `price_`)

   **Basic Pack:**
   - Name: `Basic Pack`
   - Description: `1,100 credits (1000 + 100 bonus)`
   - Pricing: One-time, $10.00 USD
   - Copy the **Price ID**

   **Pro Pack:**
   - Name: `Pro Pack`
   - Description: `3,000 credits (2500 + 500 bonus)`
   - Pricing: One-time, $20.00 USD
   - Copy the **Price ID**

   **Mega Pack:**
   - Name: `Mega Pack`
   - Description: `6,500 credits (5000 + 1500 bonus)`
   - Pricing: One-time, $35.00 USD
   - Copy the **Price ID**

   **Ultra Pack:**
   - Name: `Ultra Pack`
   - Description: `14,000 credits (10000 + 4000 bonus)`
   - Pricing: One-time, $60.00 USD
   - Copy the **Price ID**

#### Subscription Plans

1. Go to https://dashboard.stripe.com/test/products
2. Click **+ Add product**
3. For each subscription:

   **Pro Monthly:**
   - Name: `Pro Monthly Subscription`
   - Description: `2,500 credits per month + Pro features`
   - Pricing: Recurring monthly, $19.99 USD
   - Copy the **Price ID**

   **Enterprise Monthly:**
   - Name: `Enterprise Monthly Subscription`
   - Description: `10,000 credits per month + Enterprise features`
   - Pricing: Recurring monthly, $49.99 USD
   - Copy the **Price ID**

### Option B: Stripe API (Automated)

Use this script to create all products and prices:

```bash
# Run this from your terminal (requires curl and jq)
./scripts/create-stripe-products.sh
```

Or manually via Stripe API:

```bash
# Example: Create Starter Pack
curl https://api.stripe.com/v1/products \
  -u sk_test_YOUR_SECRET_KEY: \
  -d name="Starter Pack" \
  -d description="500 credits for Splat App"

# Then create price for that product
curl https://api.stripe.com/v1/prices \
  -u sk_test_YOUR_SECRET_KEY: \
  -d product=prod_PRODUCT_ID \
  -d unit_amount=500 \
  -d currency=usd
```

---

## Step 5: Update Database with Stripe Price IDs

After creating products in Stripe, update your D1 database with the Price IDs:

```sql
-- Update credit packages with Stripe Price IDs
UPDATE credit_packages SET stripe_price_id = 'price_ABC123' WHERE id = 'starter';
UPDATE credit_packages SET stripe_price_id = 'price_DEF456' WHERE id = 'basic';
UPDATE credit_packages SET stripe_price_id = 'price_GHI789' WHERE id = 'pro';
UPDATE credit_packages SET stripe_price_id = 'price_JKL012' WHERE id = 'mega';
UPDATE credit_packages SET stripe_price_id = 'price_MNO345' WHERE id = 'ultra';

-- Update subscription plans with Stripe Price IDs
UPDATE subscription_plans SET stripe_price_id = 'price_PQR678' WHERE id = 'pro_monthly';
UPDATE subscription_plans SET stripe_price_id = 'price_STU901' WHERE id = 'enterprise_monthly';
```

Run via wrangler:

```bash
wrangler d1 execute splat-app-db --file=./update-stripe-price-ids.sql
```

---

## Step 6: Set Up Stripe Webhooks

Webhooks allow Stripe to notify your app when payments succeed.

### 6.1 Get Your Webhook Endpoint URL

Your webhook endpoint is:
```
https://your-worker.workers.dev/api/webhooks/stripe
```

Replace `your-worker.workers.dev` with your actual worker URL.

### 6.2 Create Webhook in Stripe Dashboard

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click **+ Add endpoint**
3. Enter your endpoint URL: `https://your-worker.workers.dev/api/webhooks/stripe`
4. Select events to listen to:
   - ✅ `payment_intent.succeeded`
   - ✅ `customer.subscription.created`
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`
   - ✅ `invoice.payment_succeeded`
5. Click **Add endpoint**
6. Copy the **Signing secret** (starts with `whsec_`)

### 6.3 Add Webhook Secret to Cloudflare

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste: whsec_...
```

---

## Step 7: Test the Integration

### 7.1 Test Credit Purchase

1. Start your app in development mode
2. Sign in with OAuth
3. Click "Buy Credits"
4. Select a credit package
5. Use Stripe test card: `4242 4242 4242 4242`
6. Expiry: Any future date (e.g., 12/34)
7. CVC: Any 3 digits (e.g., 123)
8. Complete payment
9. **Expected:** Credits added to your account within seconds

### 7.2 Monitor Webhook Events

1. Go to https://dashboard.stripe.com/test/webhooks
2. Click on your webhook endpoint
3. View event delivery logs
4. Check for successful `payment_intent.succeeded` events

### 7.3 Test Subscription

1. Click "Upgrade to Pro"
2. Enter test card details
3. Complete subscription
4. **Expected:** Subscription status updates, monthly credits added

### 7.4 Test Failed Payment

Use test cards that simulate failures:

- **Card declined:** `4000 0000 0000 0002`
- **Insufficient funds:** `4000 0000 0000 9995`
- **3D Secure required:** `4000 0000 0000 3220`

**Expected:** Error handling, no credits added

---

## Step 8: Stripe Test Cards Reference

Use these cards in test mode:

| Card Number         | Scenario                        |
|--------------------|---------------------------------|
| 4242 4242 4242 4242 | Successful payment             |
| 4000 0000 0000 0002 | Card declined                  |
| 4000 0000 0000 9995 | Insufficient funds             |
| 4000 0000 0000 0341 | Attaching fails                |
| 4000 0000 0000 3220 | 3D Secure required (succeeds)  |
| 4000 0027 6000 3184 | 3D Secure required (fails)     |

Full list: https://stripe.com/docs/testing

---

## Step 9: Go Live Checklist

Before accepting real payments:

### Business Setup

- [ ] Activate your Stripe account (provide business details)
- [ ] Set up bank account for payouts
- [ ] Configure tax settings (if applicable)
- [ ] Review and accept Stripe's terms of service

### Technical Setup

- [ ] Switch to production Stripe keys (`sk_live_...`, `pk_live_...`)
- [ ] Create production webhook endpoint
- [ ] Update webhook secret
- [ ] Create production products and prices
- [ ] Update database with production price IDs
- [ ] Test full payment flow in production mode

### Legal & Compliance

- [ ] Add Terms of Service page
- [ ] Add Privacy Policy page
- [ ] Add Refund Policy page
- [ ] Ensure GDPR compliance (if serving EU customers)
- [ ] Add required legal disclaimers

### Security

- [ ] Enable Stripe Radar for fraud detection
- [ ] Set up email notifications for disputes
- [ ] Implement rate limiting on payment endpoints
- [ ] Monitor for unusual activity

---

## Troubleshooting

### Problem: "Stripe not configured" error

**Solution:** Check that secrets are set correctly:
```bash
wrangler secret list
```

### Problem: Webhook not receiving events

**Possible causes:**
1. Webhook URL is incorrect (check deployed worker URL)
2. Webhook secret doesn't match
3. Events not selected in Stripe Dashboard

**Debug:**
- Check Stripe Dashboard → Webhooks → Endpoint → Recent events
- Look for failed deliveries
- Check worker logs: `wrangler tail`

### Problem: Credits not added after payment

**Possible causes:**
1. Webhook signature verification failed
2. Metadata missing from payment intent
3. Database update failed

**Debug:**
- Check worker logs for errors
- Verify webhook event in Stripe Dashboard
- Check `transactions` table in D1 database

### Problem: "Invalid signature" on webhook

**Solution:**
- Ensure `STRIPE_WEBHOOK_SECRET` matches the signing secret from Stripe Dashboard
- Check that webhook endpoint is correct
- Verify request body is not modified before verification

---

## API Endpoints Reference

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/billing/packages` | GET | No | Get available credit packages |
| `/api/billing/balance` | GET | Yes | Get user's credit balance |
| `/api/billing/history` | GET | Yes | Get transaction history |
| `/api/billing/purchase` | POST | Yes | Create payment intent for credits |
| `/api/billing/subscribe` | POST | Yes | Create subscription |
| `/api/billing/cancel-subscription` | POST | Yes | Cancel subscription |
| `/api/webhooks/stripe` | POST | No* | Stripe webhook handler |

*Webhooks use signature verification instead of session auth

---

## Monitoring & Analytics

### Track Key Metrics

1. **Conversion Rate:** Users who buy credits / Total users
2. **Average Purchase Value:** Total revenue / Number of purchases
3. **Churn Rate:** Canceled subscriptions / Active subscriptions
4. **Credit Burn Rate:** Credits used / Credits purchased

### Stripe Dashboard

Monitor in real-time:
- https://dashboard.stripe.com/test/payments (transactions)
- https://dashboard.stripe.com/test/subscriptions (subscriptions)
- https://dashboard.stripe.com/test/customers (customers)

### D1 Database Queries

```sql
-- Total revenue (last 30 days)
SELECT SUM(payment_amount_cents) / 100.0 AS total_revenue_usd
FROM transactions
WHERE type = 'purchase'
  AND created_at > strftime('%s', 'now', '-30 days') * 1000;

-- Active subscriptions by tier
SELECT subscription_tier, COUNT(*) as count
FROM users
WHERE subscription_status = 'active'
GROUP BY subscription_tier;

-- Top spenders
SELECT user_id, SUM(payment_amount_cents) / 100.0 AS total_spent_usd
FROM transactions
WHERE type = 'purchase'
GROUP BY user_id
ORDER BY total_spent_usd DESC
LIMIT 10;
```

---

## Next Steps

1. **Implement frontend UI** - Build billing modal and credit display
2. **Add email notifications** - Send receipts and low balance alerts
3. **Implement refund handling** - Process refund requests
4. **Add referral program** - Give bonus credits for referrals
5. **Create admin dashboard** - Monitor revenue and usage

---

## Resources

- **Stripe Documentation:** https://stripe.com/docs
- **Stripe API Reference:** https://stripe.com/docs/api
- **Cloudflare Workers:** https://developers.cloudflare.com/workers/
- **Stripe Testing Guide:** https://stripe.com/docs/testing
- **Stripe Webhooks:** https://stripe.com/docs/webhooks

---

## Support

If you encounter issues:

1. Check worker logs: `wrangler tail`
2. Check Stripe webhook logs in Dashboard
3. Review error messages in browser console
4. Consult Stripe documentation
5. Contact Stripe support for payment-specific issues

---

**Ready to accept payments!** 🎉

Once you complete these steps, your Splat App will have a fully functional payment system with Stripe.
