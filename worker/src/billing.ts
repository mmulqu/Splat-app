/**
 * Billing and Credits Management Module
 */

export interface User {
    id: string;
    credits: number;
    credits_used: number;
    stripe_customer_id: string | null;
    subscription_tier: 'free' | 'pro' | 'enterprise';
    subscription_status: string | null;
}

export interface CreditPackage {
    id: string;
    name: string;
    credits: number;
    price_cents: number;
    bonus_credits: number;
    popular: number;
}

export interface Transaction {
    id: string;
    user_id: string;
    type: 'purchase' | 'usage' | 'refund' | 'bonus' | 'subscription';
    amount: number;
    balance_after: number;
    description: string;
    created_at: number;
}

/**
 * Get user's current credit balance
 */
export async function getUserCredits(db: D1Database, userId: string): Promise<number> {
    const user = await db.prepare(
        'SELECT credits FROM users WHERE id = ?'
    ).bind(userId).first<{ credits: number }>();

    return user?.credits || 0;
}

/**
 * Check if user has enough credits
 */
export async function hasEnoughCredits(db: D1Database, userId: string, requiredCredits: number): Promise<boolean> {
    const balance = await getUserCredits(db, userId);
    return balance >= requiredCredits;
}

/**
 * Calculate credits cost for a processing job
 */
export function calculateJobCost(params: {
    iterations: number;
    photoCount: number;
    qualityPreset: string;
}): { credits: number; breakdown: any } {
    // Base cost calculation
    // Rough formula: credits = (iterations / 100) + (photoCount * 2)
    // This gives us costs like:
    // - Preview (3K iter, 20 photos): 30 + 40 = 70 credits (~$0.70)
    // - Standard (7K iter, 20 photos): 70 + 40 = 110 credits (~$1.10)
    // - High (15K iter, 20 photos): 150 + 40 = 190 credits (~$1.90)
    // - Ultra (30K iter, 20 photos): 300 + 40 = 340 credits (~$3.40)

    const iterationCost = Math.ceil(params.iterations / 100);
    const photoCost = params.photoCount * 2;
    const baseCost = iterationCost + photoCost;

    // Apply quality multiplier
    const qualityMultipliers: Record<string, number> = {
        'preview': 0.8,
        'standard': 1.0,
        'high': 1.3,
        'ultra': 1.5
    };

    const multiplier = qualityMultipliers[params.qualityPreset] || 1.0;
    const totalCredits = Math.ceil(baseCost * multiplier);

    return {
        credits: totalCredits,
        breakdown: {
            iterationCost,
            photoCost,
            baseCost,
            qualityMultiplier: multiplier,
            totalCredits
        }
    };
}

/**
 * Deduct credits from user balance
 */
export async function deductCredits(
    db: D1Database,
    userId: string,
    credits: number,
    description: string,
    metadata?: {
        projectId?: string;
        jobId?: string;
        costBreakdown?: any;
    }
): Promise<{ success: boolean; newBalance: number; transaction: Transaction }> {
    const user = await db.prepare(
        'SELECT credits, credits_used FROM users WHERE id = ?'
    ).bind(userId).first<{ credits: number; credits_used: number }>();

    if (!user || user.credits < credits) {
        throw new Error('Insufficient credits');
    }

    const newBalance = user.credits - credits;
    const newUsed = user.credits_used + credits;

    // Update user balance
    await db.prepare(
        'UPDATE users SET credits = ?, credits_used = ? WHERE id = ?'
    ).bind(newBalance, newUsed, userId).run();

    // Record transaction
    const transactionId = crypto.randomUUID();
    const now = Date.now();

    await db.prepare(`
        INSERT INTO transactions (
            id, user_id, type, amount, balance_after, description,
            project_id, job_id, cost_breakdown, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        transactionId,
        userId,
        'usage',
        -credits,
        newBalance,
        description,
        metadata?.projectId || null,
        metadata?.jobId || null,
        JSON.stringify(metadata?.costBreakdown || {}),
        now
    ).run();

    return {
        success: true,
        newBalance,
        transaction: {
            id: transactionId,
            user_id: userId,
            type: 'usage',
            amount: -credits,
            balance_after: newBalance,
            description,
            created_at: now
        }
    };
}

/**
 * Add credits to user balance (purchase or bonus)
 */
export async function addCredits(
    db: D1Database,
    userId: string,
    credits: number,
    type: 'purchase' | 'bonus' | 'refund' | 'subscription',
    description: string,
    paymentInfo?: {
        stripePaymentIntentId?: string;
        stripeChargeId?: string;
        amountCents?: number;
        currency?: string;
    }
): Promise<{ success: boolean; newBalance: number; transaction: Transaction }> {
    const user = await db.prepare(
        'SELECT credits FROM users WHERE id = ?'
    ).bind(userId).first<{ credits: number }>();

    const currentBalance = user?.credits || 0;
    const newBalance = currentBalance + credits;

    // Update user balance
    await db.prepare(
        'UPDATE users SET credits = ? WHERE id = ?'
    ).bind(newBalance, userId).run();

    // Record transaction
    const transactionId = crypto.randomUUID();
    const now = Date.now();

    await db.prepare(`
        INSERT INTO transactions (
            id, user_id, type, amount, balance_after, description,
            stripe_payment_intent_id, stripe_charge_id, payment_amount_cents, currency, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        transactionId,
        userId,
        type,
        credits,
        newBalance,
        description,
        paymentInfo?.stripePaymentIntentId || null,
        paymentInfo?.stripeChargeId || null,
        paymentInfo?.amountCents || null,
        paymentInfo?.currency || 'usd',
        now
    ).run();

    return {
        success: true,
        newBalance,
        transaction: {
            id: transactionId,
            user_id: userId,
            type,
            amount: credits,
            balance_after: newBalance,
            description,
            created_at: now
        }
    };
}

/**
 * Get all credit packages
 */
export async function getCreditPackages(db: D1Database): Promise<CreditPackage[]> {
    const result = await db.prepare(
        'SELECT * FROM credit_packages WHERE active = 1 ORDER BY price_cents ASC'
    ).all();

    return result.results as CreditPackage[];
}

/**
 * Get credit package by ID
 */
export async function getCreditPackage(db: D1Database, packageId: string): Promise<CreditPackage | null> {
    const result = await db.prepare(
        'SELECT * FROM credit_packages WHERE id = ? AND active = 1'
    ).bind(packageId).first<CreditPackage>();

    return result || null;
}

/**
 * Get user's transaction history
 */
export async function getTransactionHistory(
    db: D1Database,
    userId: string,
    limit: number = 50
): Promise<Transaction[]> {
    const result = await db.prepare(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(userId, limit).all();

    return result.results as Transaction[];
}

/**
 * Check and update usage limits for free tier
 */
export async function checkUsageLimits(
    db: D1Database,
    userId: string,
    user: User
): Promise<{ allowed: boolean; reason?: string }> {
    // Pro and Enterprise users have no limits
    if (user.subscription_tier !== 'free') {
        return { allowed: true };
    }

    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0];
    const monthKey = new Date(now).toISOString().slice(0, 7); // YYYY-MM

    // Get or create usage limits record
    let limits = await db.prepare(
        'SELECT * FROM usage_limits WHERE user_id = ?'
    ).bind(userId).first<any>();

    if (!limits) {
        await db.prepare(`
            INSERT INTO usage_limits (user_id, projects_today, credits_today, last_reset_date, projects_this_month, credits_this_month, month_key, created_at, updated_at)
            VALUES (?, 0, 0, ?, 0, 0, ?, ?, ?)
        `).bind(userId, today, monthKey, now, now).run();

        limits = { projects_today: 0, projects_this_month: 0, last_reset_date: today, month_key: monthKey };
    }

    // Reset daily counters if new day
    if (limits.last_reset_date !== today) {
        await db.prepare(`
            UPDATE usage_limits SET projects_today = 0, credits_today = 0, last_reset_date = ?, updated_at = ?
            WHERE user_id = ?
        `).bind(today, now, userId).run();
        limits.projects_today = 0;
        limits.credits_today = 0;
    }

    // Reset monthly counters if new month
    if (limits.month_key !== monthKey) {
        await db.prepare(`
            UPDATE usage_limits SET projects_this_month = 0, credits_this_month = 0, month_key = ?, updated_at = ?
            WHERE user_id = ?
        `).bind(monthKey, now, userId).run();
        limits.projects_this_month = 0;
        limits.credits_this_month = 0;
    }

    // Free tier limits
    const FREE_TIER_LIMITS = {
        projects_per_month: 5,
        projects_per_day: 2
    };

    // Check limits
    if (limits.projects_this_month >= FREE_TIER_LIMITS.projects_per_month) {
        return {
            allowed: false,
            reason: `Free tier limit: ${FREE_TIER_LIMITS.projects_per_month} projects per month. Upgrade to Pro for unlimited projects.`
        };
    }

    if (limits.projects_today >= FREE_TIER_LIMITS.projects_per_day) {
        return {
            allowed: false,
            reason: `Free tier limit: ${FREE_TIER_LIMITS.projects_per_day} projects per day. Try again tomorrow or upgrade to Pro.`
        };
    }

    return { allowed: true };
}

/**
 * Increment usage counters
 */
export async function incrementUsage(
    db: D1Database,
    userId: string,
    credits: number
): Promise<void> {
    const now = Date.now();
    await db.prepare(`
        UPDATE usage_limits
        SET projects_today = projects_today + 1,
            projects_this_month = projects_this_month + 1,
            credits_today = credits_today + ?,
            credits_this_month = credits_this_month + ?,
            last_project_time = ?,
            updated_at = ?
        WHERE user_id = ?
    `).bind(credits, credits, now, now, userId).run();
}

/**
 * Create Stripe customer for user
 */
export async function createStripeCustomer(
    db: D1Database,
    userId: string,
    email: string,
    stripeCustomerId: string
): Promise<void> {
    await db.prepare(
        'UPDATE users SET stripe_customer_id = ? WHERE id = ?'
    ).bind(stripeCustomerId, userId).run();
}
