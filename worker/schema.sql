-- D1 Database Schema for Splat App

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar_url TEXT,
    provider TEXT NOT NULL CHECK(provider IN ('google', 'github')),
    provider_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_login INTEGER NOT NULL,
    -- Monetization fields
    credits INTEGER NOT NULL DEFAULT 0,
    credits_used INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    subscription_tier TEXT CHECK(subscription_tier IN ('free', 'pro', 'enterprise')) DEFAULT 'free',
    subscription_status TEXT CHECK(subscription_status IN ('active', 'canceled', 'past_due', 'trialing')) DEFAULT NULL,
    subscription_id TEXT,
    subscription_current_period_end INTEGER,
    UNIQUE(provider, provider_id)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_provider ON users(provider, provider_id);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    name TEXT,
    status TEXT NOT NULL CHECK(status IN ('uploading', 'uploaded', 'processing', 'completed', 'failed')),
    photo_count INTEGER NOT NULL DEFAULT 0,
    tags TEXT,
    is_public INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    updated_at INTEGER,
    model_url TEXT,
    error TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_created_at ON projects(created_at DESC);
CREATE INDEX idx_projects_name ON projects(name);
CREATE INDEX idx_projects_user_id ON projects(user_id);
CREATE INDEX idx_projects_public ON projects(is_public);

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    uploaded_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_photos_project_id ON photos(project_id);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'processing', 'completed', 'failed')),
    progress INTEGER DEFAULT 0,
    external_id TEXT,
    model_url TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    error TEXT,
    -- Cost tracking
    credits_cost INTEGER DEFAULT 0, -- Credits charged for this job
    cost_breakdown TEXT, -- JSON with detailed cost calculation
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_jobs_project_id ON jobs(project_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);

-- Push subscriptions table
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    project_id TEXT,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
);

CREATE INDEX idx_push_subscriptions_project_id ON push_subscriptions(project_id);
CREATE INDEX idx_push_subscriptions_endpoint ON push_subscriptions(endpoint);

-- Transactions table (credit purchases and usage)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('purchase', 'usage', 'refund', 'bonus', 'subscription')),
    amount INTEGER NOT NULL, -- Credits (positive for purchase, negative for usage)
    balance_after INTEGER NOT NULL,
    description TEXT,
    -- Payment details
    stripe_payment_intent_id TEXT,
    stripe_charge_id TEXT,
    payment_amount_cents INTEGER, -- Actual USD paid (in cents)
    currency TEXT DEFAULT 'usd',
    -- Usage details
    project_id TEXT,
    job_id TEXT,
    cost_breakdown TEXT, -- JSON with detailed cost info
    -- Metadata
    created_at INTEGER NOT NULL,
    metadata TEXT, -- JSON for additional info
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL
);

CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX idx_transactions_project_id ON transactions(project_id);

-- Credit packages table (pricing tiers)
CREATE TABLE IF NOT EXISTS credit_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    credits INTEGER NOT NULL,
    price_cents INTEGER NOT NULL, -- Price in cents
    currency TEXT NOT NULL DEFAULT 'usd',
    bonus_credits INTEGER DEFAULT 0, -- Extra credits for bulk purchases
    popular INTEGER DEFAULT 0, -- Flag for UI
    stripe_price_id TEXT, -- Stripe Price ID
    active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Subscription plans table
CREATE TABLE IF NOT EXISTS subscription_plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN ('free', 'pro', 'enterprise')),
    monthly_credits INTEGER NOT NULL, -- Credits per month
    price_cents INTEGER NOT NULL, -- Monthly price in cents
    currency TEXT NOT NULL DEFAULT 'usd',
    features TEXT, -- JSON array of features
    stripe_price_id TEXT, -- Stripe Price ID
    active INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Usage limits table (for free tier and rate limiting)
CREATE TABLE IF NOT EXISTS usage_limits (
    user_id TEXT PRIMARY KEY,
    -- Daily limits
    projects_today INTEGER DEFAULT 0,
    credits_today INTEGER DEFAULT 0,
    last_reset_date TEXT, -- YYYY-MM-DD format
    -- Monthly limits (for free tier)
    projects_this_month INTEGER DEFAULT 0,
    credits_this_month INTEGER DEFAULT 0,
    month_key TEXT, -- YYYY-MM format
    -- Rate limiting
    last_project_time INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_limits_last_reset_date ON usage_limits(last_reset_date);
CREATE INDEX idx_usage_limits_month_key ON usage_limits(month_key);

-- Setup instructions:
-- 1. Create D1 database: wrangler d1 create splat-app-db
-- 2. Update wrangler.toml with the database_id
-- 3. Run migrations: wrangler d1 execute splat-app-db --file=./schema.sql
-- 4. For local development: wrangler d1 execute splat-app-db --local --file=./schema.sql
