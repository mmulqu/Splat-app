/**
 * Authentication utilities for OAuth (Google & GitHub)
 */

export interface User {
    id: string;
    email: string;
    name: string;
    avatar_url: string;
    provider: 'google' | 'github';
    provider_id: string;
    created_at: number;
    last_login: number;
}

export interface Session {
    id: string;
    user_id: string;
    expires_at: number;
    created_at: number;
}

export interface OAuthConfig {
    google: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };
    github: {
        clientId: string;
        clientSecret: string;
        redirectUri: string;
    };
}

/**
 * Generate a random session ID
 */
export function generateSessionId(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random user ID
 */
export function generateUserId(): string {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return 'usr_' + Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Create OAuth authorization URL for Google
 */
export function getGoogleAuthUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'offline',
        state: state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Create OAuth authorization URL for GitHub
 */
export function getGitHubAuthUrl(clientId: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state: state,
    });

    return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange Google authorization code for tokens
 */
export async function exchangeGoogleCode(code: string, clientId: string, clientSecret: string, redirectUri: string) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to exchange Google code for token');
    }

    return await response.json();
}

/**
 * Get Google user info from access token
 */
export async function getGoogleUserInfo(accessToken: string) {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!response.ok) {
        throw new Error('Failed to get Google user info');
    }

    return await response.json();
}

/**
 * Exchange GitHub authorization code for token
 */
export async function exchangeGitHubCode(code: string, clientId: string, clientSecret: string) {
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            code,
        }),
    });

    if (!response.ok) {
        throw new Error('Failed to exchange GitHub code for token');
    }

    return await response.json();
}

/**
 * Get GitHub user info from access token
 */
export async function getGitHubUserInfo(accessToken: string) {
    const response = await fetch('https://api.github.com/user', {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
        },
    });

    if (!response.ok) {
        throw new Error('Failed to get GitHub user info');
    }

    const user = await response.json();

    // Get primary email if not public
    if (!user.email) {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: 'application/vnd.github.v3+json',
            },
        });

        if (emailResponse.ok) {
            const emails = await emailResponse.json();
            const primaryEmail = emails.find((e: any) => e.primary);
            user.email = primaryEmail ? primaryEmail.email : emails[0]?.email;
        }
    }

    return user;
}

/**
 * Create or update user in database
 */
export async function upsertUser(db: D1Database, userData: {
    provider: 'google' | 'github';
    provider_id: string;
    email: string;
    name: string;
    avatar_url: string;
}): Promise<User> {
    const now = Date.now();

    // Check if user exists
    const existing = await db.prepare(
        'SELECT * FROM users WHERE provider = ? AND provider_id = ?'
    ).bind(userData.provider, userData.provider_id).first<User>();

    if (existing) {
        // Update last login
        await db.prepare(
            'UPDATE users SET last_login = ?, name = ?, avatar_url = ?, email = ? WHERE id = ?'
        ).bind(now, userData.name, userData.avatar_url, userData.email, existing.id).run();

        return {
            ...existing,
            name: userData.name,
            avatar_url: userData.avatar_url,
            email: userData.email,
            last_login: now,
        };
    } else {
        // Create new user
        const userId = generateUserId();
        await db.prepare(
            'INSERT INTO users (id, email, name, avatar_url, provider, provider_id, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(
            userId,
            userData.email,
            userData.name,
            userData.avatar_url,
            userData.provider,
            userData.provider_id,
            now,
            now
        ).run();

        return {
            id: userId,
            email: userData.email,
            name: userData.name,
            avatar_url: userData.avatar_url,
            provider: userData.provider,
            provider_id: userData.provider_id,
            created_at: now,
            last_login: now,
        };
    }
}

/**
 * Create a new session for a user
 */
export async function createSession(db: D1Database, userId: string): Promise<Session> {
    const sessionId = generateSessionId();
    const now = Date.now();
    const expiresAt = now + (30 * 24 * 60 * 60 * 1000); // 30 days

    await db.prepare(
        'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
    ).bind(sessionId, userId, expiresAt, now).run();

    return {
        id: sessionId,
        user_id: userId,
        expires_at: expiresAt,
        created_at: now,
    };
}

/**
 * Get session by ID
 */
export async function getSession(db: D1Database, sessionId: string): Promise<Session | null> {
    const session = await db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND expires_at > ?'
    ).bind(sessionId, Date.now()).first<Session>();

    return session || null;
}

/**
 * Get user by session ID
 */
export async function getUserBySession(db: D1Database, sessionId: string): Promise<User | null> {
    const session = await getSession(db, sessionId);
    if (!session) return null;

    const user = await db.prepare(
        'SELECT * FROM users WHERE id = ?'
    ).bind(session.user_id).first<User>();

    return user || null;
}

/**
 * Delete session (logout)
 */
export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}

/**
 * Clean up expired sessions
 */
export async function cleanExpiredSessions(db: D1Database): Promise<void> {
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
}
