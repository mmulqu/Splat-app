-- Seed data for Splat App

-- Subscription Plans
INSERT OR REPLACE INTO subscription_plans (id, name, tier, monthly_credits, price_cents, currency, features, stripe_price_id, active, created_at, updated_at) VALUES
    (
        'plan_free',
        'Free Tier',
        'free',
        100,
        0,
        'usd',
        '["10 credits per month", "Basic quality presets", "Up to 20 photos per project", "Public project sharing", "Standard processing speed"]',
        NULL,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    ),
    (
        'plan_pro_monthly',
        'Pro Plan',
        'pro',
        1000,
        1999,
        'usd',
        '["1000 credits per month", "All quality presets including Ultra", "Up to 100 photos per project", "Priority processing", "Private projects", "Download in multiple formats", "Remove watermarks", "Email support"]',
        NULL,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    ),
    (
        'plan_enterprise_monthly',
        'Enterprise Plan',
        'enterprise',
        5000,
        9999,
        'usd',
        '["5000 credits per month", "Custom quality presets", "Unlimited photos per project", "Highest priority processing", "API access", "Batch processing", "Custom branding", "Dedicated support", "Team collaboration", "Advanced analytics"]',
        NULL,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    );

-- Credit Packages (one-time purchases)
INSERT OR REPLACE INTO credit_packages (id, name, credits, price_cents, currency, bonus_credits, popular, active, created_at, updated_at) VALUES
    (
        'pkg_starter',
        'Starter Pack',
        100,
        999,
        'usd',
        0,
        0,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    ),
    (
        'pkg_popular',
        'Popular Pack',
        500,
        3999,
        'usd',
        50,
        1,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    ),
    (
        'pkg_pro',
        'Pro Pack',
        1000,
        6999,
        'usd',
        150,
        0,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    ),
    (
        'pkg_ultimate',
        'Ultimate Pack',
        2500,
        14999,
        'usd',
        500,
        0,
        1,
        strftime('%s', 'now') * 1000,
        strftime('%s', 'now') * 1000
    );
