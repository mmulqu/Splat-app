-- Seed data for credit packages and subscription plans

-- Credit Packages
-- Pricing: ~$1 = 100 credits, with bulk bonuses
INSERT OR REPLACE INTO credit_packages (id, name, credits, price_cents, bonus_credits, popular, active, created_at, updated_at) VALUES
('starter', 'Starter Pack', 500, 500, 0, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('basic', 'Basic Pack', 1000, 1000, 100, 1, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('pro', 'Pro Pack', 2500, 2000, 500, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('mega', 'Mega Pack', 5000, 3500, 1500, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('ultra', 'Ultra Pack', 10000, 6000, 4000, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Subscription Plans
INSERT OR REPLACE INTO subscription_plans (id, name, tier, monthly_credits, price_cents, features, active, created_at, updated_at) VALUES
('free', 'Free Tier', 'free', 500, 0, '["5 projects per month","Preview quality only","Community support","Public projects only"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('pro_monthly', 'Pro Monthly', 'pro', 2500, 1999, '["Unlimited projects","All quality levels","Priority processing","Email support","Private projects","Advanced parameters","API access"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000),
('enterprise_monthly', 'Enterprise Monthly', 'enterprise', 10000, 4999, '["Everything in Pro","Dedicated GPU","Custom training parameters","White-label option","SLA guarantee","Phone support","Bulk processing","Team collaboration"]', 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);

-- Example cost calculations for reference:
-- Preview (3K iterations): ~50 credits ($0.50)
-- Standard (7K iterations): ~100 credits ($1.00)
-- High (15K iterations): ~200 credits ($2.00)
-- Ultra (30K iterations): ~400 credits ($4.00)

-- These costs are estimates based on:
-- - GPU rental: $0.35/hr for RTX 4090
-- - Average processing time
-- - Overhead (storage, bandwidth, etc.)
