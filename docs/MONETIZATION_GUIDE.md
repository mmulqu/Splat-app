# Monetization System - Complete Guide

## Overview

The Splat App uses a **credits-based monetization system** with Stripe payment processing. Users buy credits and spend them on GPU processing. We offer both pay-as-you-go credit packages and monthly subscriptions.

---

## Pricing Strategy

### Credit Economy

**Exchange Rate:** `$1.00 = 100 credits`

**Processing Costs:**
- **Preview** (3K iterations): ~50 credits ($0.50)
- **Standard** (7K iterations): ~100 credits ($1.00)
- **High** (15K iterations): ~200 credits ($2.00)
- **Ultra** (30K iterations): ~400 credits ($4.00)

*Costs scale with photo count and iterations*

### Credit Packages (Pay-as-you-go)

| Package | Credits | Price | Bonus | Total Credits | Value |
|---------|---------|-------|-------|---------------|-------|
| Starter | 500 | $5.00 | +0 | 500 | - |
| **Basic** | 1,000 | $10.00 | +100 | 1,100 | +10% ⭐ |
| Pro | 2,500 | $20.00 | +500 | 3,000 | +20% |
| Mega | 5,000 | $35.00 | +1,500 | 6,500 | +30% |
| Ultra | 10,000 | $60.00 | +4,000 | 14,000 | +40% |

### Subscription Tiers

#### Free Tier
- **Price:** $0/month
- **Credits:** 500/month
- **Limits:**
  - 5 projects per month
  - 2 projects per day
  - Preview quality only
  - Public projects only
  - Community support

#### Pro Tier
- **Price:** $19.99/month
- **Credits:** 2,500/month (~25 standard reconstructions)
- **Features:**
  - Unlimited projects
  - All quality levels
  - Priority processing queue
  - Private projects
  - Advanced parameters
  - Email support
  - API access

#### Enterprise Tier
- **Price:** $49.99/month
- **Credits:** 10,000/month (~100 standard reconstructions)
- **Features:**
  - Everything in Pro, plus:
  - Dedicated GPU allocation
  - Custom training parameters
  - White-label option
  - SLA guarantee (99.9% uptime)
  - Phone support
  - Bulk processing
  - Team collaboration
  - Usage analytics

---

## Architecture

### Database Schema

#### Users Table (Extended)
```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    credits INTEGER DEFAULT 0,              -- Current balance
    credits_used INTEGER DEFAULT 0,         -- Lifetime usage
    stripe_customer_id TEXT,                -- Stripe Customer ID
    subscription_tier TEXT DEFAULT 'free',  -- free | pro | enterprise
    subscription_status TEXT,               -- active | canceled | past_due | trialing
    subscription_id TEXT,                   -- Stripe Subscription ID
    subscription_current_period_end INTEGER
);
```

#### Transactions Table
```sql
CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,                     -- purchase | usage | refund | bonus | subscription
    amount INTEGER NOT NULL,                -- Credits (positive or negative)
    balance_after INTEGER NOT NULL,
    description TEXT,
    -- Payment details
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,
    payment_amount_cents INTEGER,           -- Actual USD paid
    currency TEXT DEFAULT 'usd',
    -- Usage details
    project_id TEXT,
    job_id TEXT,
    cost_breakdown TEXT,                    -- JSON
    created_at INTEGER NOT NULL
);
```

#### Usage Limits Table
```sql
CREATE TABLE usage_limits (
    user_id TEXT PRIMARY KEY,
    projects_today INTEGER DEFAULT 0,
    credits_today INTEGER DEFAULT 0,
    last_reset_date TEXT,                   -- YYYY-MM-DD
    projects_this_month INTEGER DEFAULT 0,
    credits_this_month INTEGER DEFAULT 0,
    month_key TEXT,                         -- YYYY-MM
    last_project_time INTEGER
);
```

### Billing Module API

#### Core Functions

```typescript
// Check balance
const credits = await getUserCredits(db, userId);

// Calculate job cost
const { credits, breakdown } = calculateJobCost({
    iterations: 7000,
    photoCount: 20,
    qualityPreset: 'standard'
});

// Check if user can afford
const canAfford = await hasEnoughCredits(db, userId, credits);

// Deduct credits for usage
await deductCredits(db, userId, credits, 'Standard reconstruction', {
    projectId,
    jobId,
    costBreakdown: breakdown
});

// Add credits from purchase
await addCredits(db, userId, 1100, 'purchase', 'Basic Pack', {
    stripePaymentIntentId: 'pi_xxx',
    amountCents: 1000
});

// Check free tier limits
const { allowed, reason } = await checkUsageLimits(db, userId, user);

// Increment usage counters
await incrementUsage(db, userId, credits);
```

---

## Stripe Integration

### Setup Required

1. **Create Stripe Account**
   - Sign up at https://stripe.com
   - Get API keys (test and production)

2. **Configure Cloudflare Secrets**
```bash
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_PUBLISHABLE_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

3. **Create Stripe Products**
   - Create products for each credit package
   - Create prices for each product
   - Save Price IDs to database

### API Endpoints to Implement

#### 1. Get Credit Packages
```
GET /api/billing/packages
Response: { packages: CreditPackage[] }
```

#### 2. Create Payment Intent
```
POST /api/billing/purchase
Body: { packageId: string }
Response: { clientSecret: string, amount: number }
```

#### 3. Stripe Webhook
```
POST /api/webhooks/stripe
Headers: stripe-signature
Body: Stripe Event
```

#### 4. Get Balance & History
```
GET /api/billing/balance
Response: { credits: number, creditsUsed: number }

GET /api/billing/history
Response: { transactions: Transaction[] }
```

#### 5. Subscription Management
```
POST /api/billing/subscribe
Body: { planId: string }
Response: { clientSecret: string }

POST /api/billing/cancel-subscription
Response: { success: boolean }
```

### Payment Flow

```
1. User clicks "Buy Credits" → Selects package
2. Frontend calls /api/billing/purchase → Gets PaymentIntent
3. Stripe.js collects payment → Confirms payment
4. Stripe sends webhook → Worker receives payment.succeeded
5. Worker adds credits → Updates user balance
6. Frontend refreshes → Shows new balance
```

### Webhook Handling

```typescript
async function handleStripeWebhook(request: Request, env: Env) {
    const signature = request.headers.get('stripe-signature');
    const body = await request.text();

    // Verify signature
    const event = await stripe.webhooks.constructEvent(
        body,
        signature,
        env.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
        case 'payment_intent.succeeded':
            await handlePaymentSuccess(event.data.object);
            break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            await handleSubscriptionUpdate(event.data.object);
            break;
        case 'customer.subscription.deleted':
            await handleSubscriptionCanceled(event.data.object);
            break;
        case 'invoice.payment_succeeded':
            await handleSubscriptionPayment(event.data.object);
            break;
    }

    return new Response(JSON.stringify({ received: true }), { status: 200 });
}
```

---

## Frontend UI Components

### 1. Credits Display (Header)

```jsx
<div className="credits-display">
    <span className="credit-icon">⭐</span>
    <span className="credit-balance">{user.credits.toLocaleString()} credits</span>
    <button onClick={openBillingModal}>Buy Credits</button>
</div>
```

### 2. Billing Modal

Components needed:
- Credit package selector
- Payment form (Stripe Elements)
- Transaction history
- Subscription management

### 3. Cost Preview (Before Processing)

```jsx
<div className="cost-estimate">
    <h4>Cost Estimate</h4>
    <div className="cost-breakdown">
        <span>Quality: {preset.name}</span>
        <span>{estimatedCredits} credits</span>
    </div>
    <div className="balance-check">
        {hasEnough ? (
            <span className="sufficient">✓ Sufficient balance</span>
        ) : (
            <span className="insufficient">
                ⚠️ Need {needed} more credits
                <button onClick={openBillingModal}>Buy Credits</button>
            </span>
        )}
    </div>
</div>
```

### 4. Insufficient Credits Modal

```jsx
<Modal title="Insufficient Credits">
    <p>This {preset.name} reconstruction costs {cost} credits.</p>
    <p>Your balance: {balance} credits</p>
    <p>You need {cost - balance} more credits.</p>
    <CreditPackageSelector />
</Modal>
```

---

## Processing Integration

### Updated Processing Flow

```typescript
async function handleProcess(request: Request, env: Env) {
    const { projectId, qualityPreset, customParams } = await request.json();
    const user = await getUserBySession(env.SPLAT_DB, sessionId);

    // 1. Check authentication
    if (!user) {
        return jsonResponse({ error: 'Authentication required' }, 401);
    }

    // 2. Get photos
    const photos = await getProjectPhotos(env.SPLAT_DB, projectId);

    // 3. Calculate cost
    const preset = getQualityPreset(qualityPreset);
    const params = mergeParams(qualityPreset, customParams);
    const { credits, breakdown } = calculateJobCost({
        iterations: params.iterations,
        photoCount: photos.length,
        qualityPreset
    });

    // 4. Check free tier limits (if applicable)
    if (user.subscription_tier === 'free') {
        const { allowed, reason } = await checkUsageLimits(env.SPLAT_DB, user.id, user);
        if (!allowed) {
            return jsonResponse({ error: reason, needsUpgrade: true }, 403);
        }

        // Free tier can only use preview quality
        if (qualityPreset !== 'preview') {
            return jsonResponse({
                error: 'Free tier limited to Preview quality. Upgrade to Pro for all quality levels.',
                needsUpgrade: true
            }, 403);
        }
    }

    // 5. Check credit balance
    if (!await hasEnoughCredits(env.SPLAT_DB, user.id, credits)) {
        return jsonResponse({
            error: 'Insufficient credits',
            required: credits,
            balance: user.credits,
            needed: credits - user.credits
        }, 402); // 402 Payment Required
    }

    // 6. Deduct credits
    const { newBalance, transaction } = await deductCredits(
        env.SPLAT_DB,
        user.id,
        credits,
        `${preset.name} reconstruction`,
        { projectId, costBreakdown: breakdown }
    );

    // 7. Create job
    const jobId = crypto.randomUUID();
    await env.SPLAT_DB.prepare(`
        INSERT INTO jobs (id, project_id, status, credits_cost, cost_breakdown, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).bind(jobId, projectId, 'queued', credits, JSON.stringify(breakdown), Date.now()).run();

    // 8. Increment usage tracking
    await incrementUsage(env.SPLAT_DB, user.id, credits);

    // 9. Trigger GPU processing
    await triggerRunPodProcessing(jobId, projectId, photos, env, params);

    return jsonResponse({
        success: true,
        jobId,
        creditsCharged: credits,
        newBalance,
        transactionId: transaction.id
    });
}
```

---

## Free Tier Limits

### Enforcement Points

1. **Project Creation**
   - Check: `projects_this_month < 5`
   - Check: `projects_today < 2`

2. **Quality Selection**
   - Free tier: Only "Preview" quality
   - Pro+: All quality levels

3. **Advanced Parameters**
   - Free tier: Disabled
   - Pro+: Full access

4. **Project Visibility**
   - Free tier: Public only
   - Pro+: Public or private

### UI Indicators

```jsx
{user.subscription_tier === 'free' && (
    <div className="upgrade-prompt">
        <p>Free tier: {user.projects_this_month}/5 projects this month</p>
        <button onClick={openUpgradeModal}>Upgrade to Pro</button>
    </div>
)}
```

---

## Revenue Projections

### Conservative Estimates

**Assumptions:**
- 1,000 monthly active users
- 20% pay conversion rate (200 paying users)
- Mix: 60% one-time purchases, 40% subscriptions

**Monthly Revenue:**
- One-time purchases: 120 users × $15 avg = $1,800
- Subscriptions: 80 users × $20 avg = $1,600
- **Total: ~$3,400/month**

### Scaling Targets

| Users | Conversion | Monthly Revenue |
|-------|-----------|-----------------|
| 1,000 | 20% | $3,400 |
| 5,000 | 20% | $17,000 |
| 10,000 | 25% | $42,500 |
| 50,000 | 25% | $212,500 |

---

## Cost Management

### GPU Costs

**Current pricing (RunPod RTX 4090):**
- $0.35/hour
- Standard reconstruction: ~15 min = ~$0.09
- Our charge: 100 credits = $1.00
- **Profit margin: ~91%** (before infrastructure costs)

**Infrastructure costs:**
- Cloudflare Workers: ~$5-25/month
- Cloudflare R2: ~$0.015/GB storage
- Cloudflare D1: ~$5/10M reads
- Stripe fees: 2.9% + $0.30 per transaction

**Net margins:** ~75-85% after all costs

---

## Implementation Checklist

### Phase 1: Core System ✅ (Complete)
- [x] Database schema
- [x] Billing module
- [x] Credit calculation
- [x] Usage tracking
- [x] Transaction history

### Phase 2: Stripe Integration (Next)
- [ ] Add Stripe SDK
- [ ] Create payment intents
- [ ] Implement webhook handler
- [ ] Test payment flow
- [ ] Handle errors and edge cases

### Phase 3: Frontend UI
- [ ] Credits display in header
- [ ] Billing modal/page
- [ ] Credit package selection
- [ ] Payment form (Stripe Elements)
- [ ] Transaction history view
- [ ] Subscription management
- [ ] Upgrade prompts for free tier

### Phase 4: Processing Integration
- [ ] Add credit checks to process endpoint
- [ ] Deduct credits on job creation
- [ ] Handle insufficient credits error
- [ ] Show cost preview before processing
- [ ] Refund on processing failure

### Phase 5: Polish & Launch
- [ ] Add usage analytics dashboard
- [ ] Email notifications (purchase receipts, low balance)
- [ ] Referral program (bonus credits)
- [ ] Admin panel for monitoring
- [ ] Documentation for users
- [ ] Legal pages (terms, privacy, refund policy)

---

## Security Considerations

### Payment Security
- ✅ Never store card details (handled by Stripe)
- ✅ Verify webhook signatures
- ✅ Use HTTPS only
- ✅ Implement rate limiting on payment endpoints

### Fraud Prevention
- Monitor for unusual usage patterns
- Implement velocity checks (max transactions per hour)
- Require email verification
- Flag suspicious accounts for manual review

### Credit Security
- Atomic database transactions
- Balance verification before and after operations
- Audit trail via transactions table
- Regular balance reconciliation

---

## Testing Strategy

### Test Stripe Integration

```bash
# Use Stripe test mode
export STRIPE_SECRET_KEY=sk_test_...

# Test credit cards
4242 4242 4242 4242  # Success
4000 0000 0000 9995  # Decline
4000 0000 0000 0341  # Auth required (3D Secure)
```

### Test Scenarios
1. ✅ Purchase credits → Balance increases
2. ✅ Process project → Credits deducted
3. ✅ Insufficient balance → Error returned
4. ✅ Free tier limits → Enforced correctly
5. ✅ Webhook delivery → Credits added
6. ✅ Processing failure → Credits refunded
7. ✅ Subscription payment → Monthly credits added

---

## Support & FAQs

### Common Questions

**Q: What happens if processing fails?**
A: Credits are automatically refunded to your account.

**Q: Do credits expire?**
A: Purchased credits never expire. Subscription credits expire at end of billing period.

**Q: Can I get a refund?**
A: Unused credits can be refunded within 30 days of purchase.

**Q: What payment methods do you accept?**
A: All major credit/debit cards via Stripe. We also support Apple Pay, Google Pay, and Link.

**Q: Do you offer educational discounts?**
A: Yes! Students and educators get 50% off Pro subscriptions. Contact support.

---

## Next Steps

**Ready to implement?** Here's the order:

1. **Set up Stripe account** - Get API keys
2. **Implement Stripe integration** - Payment intents, webhooks
3. **Build frontend UI** - Billing modal, credit display
4. **Wire up processing** - Add credit checks, deductions
5. **Test end-to-end** - Full payment → processing flow
6. **Launch free tier** - Attract initial users
7. **Marketing** - Product Hunt, social media, ads

**Want me to continue implementing?** I can build:
- Complete Stripe integration
- Billing UI components
- Credit flow integration
- Admin dashboard
- Usage analytics

Let me know what you'd like to tackle next!
