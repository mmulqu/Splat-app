/**
 * Cloudflare Worker for Splat App
 * Handles photo uploads, R2 storage, and GPU processing orchestration
 */

import { getQualityPreset, calculatePresetCost, getAllQualityPresets, mergeParams, validateParams, type GaussianSplattingParams } from './quality-presets';
import * as Auth from './auth';
import * as Billing from './billing';

interface Env {
    SPLAT_BUCKET: R2Bucket;
    SPLAT_DB: D1Database;
    PROCESSING_QUEUE: Queue;
    // GPU Processing API keys (configure in Cloudflare dashboard)
    REPLICATE_API_KEY?: string;
    MODAL_API_KEY?: string;
    RUNPOD_API_KEY?: string;
    RUNPOD_ENDPOINT_ID?: string;
    // OAuth credentials
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GITHUB_CLIENT_ID?: string;
    GITHUB_CLIENT_SECRET?: string;
    // Base URL for redirects
    BASE_URL?: string;
    // Stripe credentials
    STRIPE_SECRET_KEY?: string;
    STRIPE_PUBLISHABLE_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
}

interface UploadResponse {
    success: boolean;
    projectId: string;
    uploadUrls?: string[];
    error?: string;
}

interface ProcessRequest {
    projectId: string;
    qualityPreset?: string; // preview, standard, high, ultra
    customParams?: Partial<GaussianSplattingParams>; // Override specific parameters
}

interface ProcessResponse {
    success: boolean;
    jobId: string;
    error?: string;
}

interface StatusResponse {
    status: 'queued' | 'processing' | 'completed' | 'failed';
    progress?: number;
    modelUrl?: string;
    error?: string;
}

interface PriceEstimate {
    estimatedCost: number;
    estimatedTime: number;
    gpuType: string;
    breakdown: {
        colmapTime: number;
        trainingTime: number;
        overhead: number;
        hourlyRate: number;
    };
}

interface WebhookPayload {
    job_id: string;
    status: string;
    model_url?: string;
    model_size_mb?: number;
    project_id?: string;
    error?: string;
}

interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

interface PushSubscribeRequest {
    subscription: PushSubscription;
    projectId?: string;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Credentials': 'true',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // Upload endpoint
            if (path === '/api/upload' && request.method === 'POST') {
                return await handleUpload(request, env, corsHeaders);
            }

            // Process endpoint
            if (path === '/api/process' && request.method === 'POST') {
                return await handleProcess(request, env, corsHeaders);
            }

            // Status endpoint
            if (path.startsWith('/api/status/') && request.method === 'GET') {
                const jobId = path.split('/').pop();
                return await handleStatus(jobId!, env, corsHeaders);
            }

            // Cancel job endpoint
            if (path.match(/^\/api\/jobs\/[^\/]+\/cancel$/) && request.method === 'POST') {
                const jobId = path.split('/')[3];
                return await handleCancelJob(jobId!, request, env, corsHeaders);
            }

            // Model download endpoint
            if (path.startsWith('/api/model/') && request.method === 'GET') {
                const modelId = path.split('/').pop();
                return await handleModelDownload(modelId!, env, corsHeaders);
            }

            // List projects endpoint
            if (path === '/api/projects' && request.method === 'GET') {
                return await handleListProjects(request, env, corsHeaders);
            }

            // Sync project to cloud
            if (path === '/api/projects/sync' && request.method === 'POST') {
                return await handleSyncProject(request, env, corsHeaders);
            }

            // Update project
            if (path.match(/^\/api\/projects\/[^\/]+$/) && request.method === 'PUT') {
                const projectId = path.split('/').pop();
                return await handleUpdateProject(projectId!, request, env, corsHeaders);
            }

            // Delete project
            if (path.match(/^\/api\/projects\/[^\/]+$/) && request.method === 'DELETE') {
                const projectId = path.split('/').pop();
                return await handleDeleteProject(projectId!, request, env, corsHeaders);
            }

            // Get single project
            if (path.match(/^\/api\/projects\/[^\/]+$/) && request.method === 'GET') {
                const projectId = path.split('/').pop();
                return await handleGetProject(projectId!, request, env, corsHeaders);
            }

            // Price estimate endpoint
            if (path === '/api/estimate' && request.method === 'POST') {
                return await handlePriceEstimate(request, env, corsHeaders);
            }

            // Quality presets endpoint
            if (path === '/api/quality-presets' && request.method === 'GET') {
                return await handleQualityPresets(corsHeaders);
            }

            // Webhook endpoint for RunPod callbacks
            if (path.startsWith('/api/webhook/') && request.method === 'POST') {
                const jobId = path.split('/').pop();
                return await handleWebhook(jobId!, request, env, corsHeaders);
            }

            // Push subscription endpoints
            if (path === '/api/push/subscribe' && request.method === 'POST') {
                return await handlePushSubscribe(request, env, corsHeaders);
            }

            if (path === '/api/push/unsubscribe' && request.method === 'POST') {
                return await handlePushUnsubscribe(request, env, corsHeaders);
            }

            // Authentication endpoints
            if (path === '/api/auth/google' && request.method === 'GET') {
                return await handleGoogleAuth(env, corsHeaders);
            }

            if (path === '/api/auth/google/callback' && request.method === 'GET') {
                return await handleGoogleCallback(request, env);
            }

            if (path === '/api/auth/github' && request.method === 'GET') {
                return await handleGitHubAuth(env, corsHeaders);
            }

            if (path === '/api/auth/github/callback' && request.method === 'GET') {
                return await handleGitHubCallback(request, env);
            }

            if (path === '/api/auth/me' && request.method === 'GET') {
                return await handleGetCurrentUser(request, env, corsHeaders);
            }

            if (path === '/api/auth/logout' && request.method === 'POST') {
                return await handleLogout(request, env, corsHeaders);
            }

            // Billing endpoints
            if (path === '/api/billing/packages' && request.method === 'GET') {
                return await handleGetCreditPackages(env, corsHeaders);
            }

            if (path === '/api/billing/balance' && request.method === 'GET') {
                return await handleGetBalance(request, env, corsHeaders);
            }

            if (path === '/api/billing/history' && request.method === 'GET') {
                return await handleGetHistory(request, env, corsHeaders);
            }

            if (path === '/api/billing/purchase' && request.method === 'POST') {
                return await handleCreatePaymentIntent(request, env, corsHeaders);
            }

            if (path === '/api/billing/subscribe' && request.method === 'POST') {
                return await handleCreateSubscription(request, env, corsHeaders);
            }

            if (path === '/api/billing/cancel-subscription' && request.method === 'POST') {
                return await handleCancelSubscription(request, env, corsHeaders);
            }

            // Stripe webhook
            if (path === '/api/webhooks/stripe' && request.method === 'POST') {
                return await handleStripeWebhook(request, env);
            }

            // Public share pages
            if (path.startsWith('/share/') && request.method === 'GET') {
                const projectId = path.split('/')[2];
                return await handleSharePage(projectId, env, request);
            }

            if (path.startsWith('/embed/') && request.method === 'GET') {
                const projectId = path.split('/')[2];
                return await handleEmbedPage(projectId, env, request);
            }

            return new Response('Not Found', { status: 404, headers: corsHeaders });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
                status: 500,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            });
        }
    },
};

/**
 * Handle photo uploads to R2
 */
async function handleUpload(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const formData = await request.formData();
        const photos = formData.getAll('photos') as File[];

        if (photos.length === 0) {
            return jsonResponse({ success: false, error: 'No photos provided' }, 400, corsHeaders);
        }

        // Create project in D1
        const projectId = crypto.randomUUID();
        const timestamp = Date.now();

        await env.SPLAT_DB.prepare(
            'INSERT INTO projects (id, status, photo_count, created_at) VALUES (?, ?, ?, ?)'
        ).bind(projectId, 'uploading', photos.length, timestamp).run();

        // Upload photos to R2
        const uploadPromises = photos.map(async (photo, index) => {
            const key = `projects/${projectId}/photos/${index}_${photo.name}`;
            const arrayBuffer = await photo.arrayBuffer();

            await env.SPLAT_BUCKET.put(key, arrayBuffer, {
                httpMetadata: {
                    contentType: photo.type,
                },
                customMetadata: {
                    projectId,
                    uploadedAt: timestamp.toString(),
                }
            });

            // Record photo in database
            await env.SPLAT_DB.prepare(
                'INSERT INTO photos (project_id, r2_key, filename, size, uploaded_at) VALUES (?, ?, ?, ?, ?)'
            ).bind(projectId, key, photo.name, photo.size, timestamp).run();

            return key;
        });

        await Promise.all(uploadPromises);

        // Update project status
        await env.SPLAT_DB.prepare(
            'UPDATE projects SET status = ? WHERE id = ?'
        ).bind('uploaded', projectId).run();

        const response: UploadResponse = {
            success: true,
            projectId,
        };

        return jsonResponse(response, 200, corsHeaders);

    } catch (error) {
        console.error('Upload error:', error);
        return jsonResponse({ success: false, error: 'Upload failed' }, 500, corsHeaders);
    }
}

/**
 * Handle processing request - trigger GPU processing
 */
async function handleProcess(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const body = await request.json() as ProcessRequest;
        const { projectId, qualityPreset = 'standard', customParams = {} } = body;

        if (!projectId) {
            return jsonResponse({ success: false, error: 'Project ID required' }, 400, corsHeaders);
        }

        // Check authentication
        const sessionId = getSessionFromRequest(request);
        if (!sessionId) {
            return jsonResponse({ success: false, error: 'Authentication required' }, 401, corsHeaders);
        }

        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);
        if (!user) {
            return jsonResponse({ success: false, error: 'Invalid session' }, 401, corsHeaders);
        }

        // Validate custom parameters
        if (Object.keys(customParams).length > 0) {
            const validationErrors = validateParams(customParams);
            if (validationErrors.length > 0) {
                return jsonResponse({
                    success: false,
                    error: 'Invalid parameters',
                    validationErrors
                }, 400, corsHeaders);
            }
        }

        // Get project photos from database
        const photos = await env.SPLAT_DB.prepare(
            'SELECT * FROM photos WHERE project_id = ?'
        ).bind(projectId).all();

        if (!photos.results || photos.results.length < 5) {
            return jsonResponse({ success: false, error: 'Insufficient photos (minimum 5)' }, 400, corsHeaders);
        }

        // Get quality preset and merge with custom parameters
        const preset = getQualityPreset(qualityPreset);
        const finalParams = mergeParams(qualityPreset, customParams);

        // Calculate cost
        const { credits, breakdown } = Billing.calculateJobCost({
            iterations: finalParams.iterations,
            photoCount: photos.results.length,
            qualityPreset
        });

        // Check free tier limits
        if (user.subscription_tier === 'free') {
            const { allowed, reason } = await Billing.checkUsageLimits(env.SPLAT_DB, user.id, user);
            if (!allowed) {
                return jsonResponse({
                    success: false,
                    error: reason,
                    needsUpgrade: true
                }, 403, corsHeaders);
            }

            // Free tier can only use preview quality
            if (qualityPreset !== 'preview') {
                return jsonResponse({
                    success: false,
                    error: 'Free tier limited to Preview quality. Upgrade to Pro for all quality levels.',
                    needsUpgrade: true
                }, 403, corsHeaders);
            }
        }

        // Check credit balance
        if (!await Billing.hasEnoughCredits(env.SPLAT_DB, user.id, credits)) {
            return jsonResponse({
                success: false,
                error: 'Insufficient credits',
                required: credits,
                balance: user.credits,
                needed: credits - user.credits,
                needsCredits: true
            }, 402, corsHeaders); // 402 Payment Required
        }

        // Deduct credits
        const { newBalance, transaction } = await Billing.deductCredits(
            env.SPLAT_DB,
            user.id,
            credits,
            `${preset.name} reconstruction`,
            {
                projectId,
                costBreakdown: breakdown
            }
        );

        // Create processing job
        const jobId = crypto.randomUUID();

        await env.SPLAT_DB.prepare(
            'INSERT INTO jobs (id, project_id, status, credits_cost, cost_breakdown, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(jobId, projectId, 'queued', credits, JSON.stringify(breakdown), Date.now()).run();

        // Store parameters in job metadata
        await env.SPLAT_DB.prepare(
            'UPDATE jobs SET external_id = ? WHERE id = ?'
        ).bind(JSON.stringify({
            qualityPreset,
            params: finalParams,
            customParams
        }), jobId).run();

        // Update project status
        await env.SPLAT_DB.prepare(
            'UPDATE projects SET status = ? WHERE id = ?'
        ).bind('processing', projectId).run();

        // Increment usage tracking
        await Billing.incrementUsage(env.SPLAT_DB, user.id, credits);

        // Queue processing job
        await env.PROCESSING_QUEUE.send({
            jobId,
            projectId,
            photoKeys: photos.results.map((p: any) => p.r2_key),
            params: finalParams
        });

        // Trigger GPU processing with RunPod
        if (env.RUNPOD_API_KEY && env.RUNPOD_ENDPOINT_ID) {
            await triggerRunPodProcessing(jobId, projectId, photos.results, env, finalParams);
        }

        const response: ProcessResponse = {
            success: true,
            jobId,
        };

        return jsonResponse({
            ...response,
            creditsCharged: credits,
            newBalance,
            transactionId: transaction.id
        }, 200, corsHeaders);

    } catch (error) {
        console.error('Process error:', error);
        return jsonResponse({ success: false, error: 'Processing request failed' }, 500, corsHeaders);
    }
}

/**
 * Check processing status
 */
async function handleStatus(jobId: string, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const job = await env.SPLAT_DB.prepare(
            'SELECT * FROM jobs WHERE id = ?'
        ).bind(jobId).first();

        if (!job) {
            return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
        }

        const response: StatusResponse = {
            status: job.status as any,
            progress: job.progress || 0,
            modelUrl: job.model_url || undefined,
        };

        return jsonResponse(response, 200, corsHeaders);

    } catch (error) {
        console.error('Status error:', error);
        return jsonResponse({ error: 'Status check failed' }, 500, corsHeaders);
    }
}

/**
 * Cancel a running or queued job
 */
async function handleCancelJob(jobId: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const sessionId = getSessionFromRequest(request);

        if (!sessionId) {
            return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
        }

        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        // Get job and verify ownership
        const job = await env.SPLAT_DB.prepare(
            'SELECT j.*, p.user_id FROM jobs j JOIN projects p ON j.project_id = p.id WHERE j.id = ?'
        ).bind(jobId).first<any>();

        if (!job) {
            return jsonResponse({ error: 'Job not found' }, 404, corsHeaders);
        }

        if (job.user_id !== user.id) {
            return jsonResponse({ error: 'Access denied' }, 403, corsHeaders);
        }

        // Can only cancel queued or processing jobs
        if (job.status !== 'queued' && job.status !== 'processing') {
            return jsonResponse({
                error: `Cannot cancel job with status: ${job.status}`,
                status: job.status
            }, 400, corsHeaders);
        }

        // If job has external_id (RunPod job), try to cancel it
        if (job.external_id) {
            try {
                await fetch(`https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/cancel/${job.external_id}`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
                        'Content-Type': 'application/json',
                    },
                });
            } catch (error) {
                console.error('Failed to cancel RunPod job:', error);
                // Continue anyway to mark as failed locally
            }
        }

        // Refund credits if they were charged
        if (job.credits_cost > 0) {
            await env.SPLAT_DB.prepare(
                'UPDATE users SET credits = credits + ? WHERE id = ?'
            ).bind(job.credits_cost, user.id).run();

            // Record refund transaction
            await env.SPLAT_DB.prepare(
                `INSERT INTO transactions (
                    id, user_id, type, amount, credits, description, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                crypto.randomUUID(),
                user.id,
                'refund',
                0,
                job.credits_cost,
                `Job ${jobId} cancelled - credits refunded`,
                Date.now()
            ).run();
        }

        // Mark job as failed
        await env.SPLAT_DB.prepare(
            'UPDATE jobs SET status = ?, error = ?, completed_at = ? WHERE id = ?'
        ).bind('failed', 'Cancelled by user', Date.now(), jobId).run();

        // Update project status
        await env.SPLAT_DB.prepare(
            'UPDATE projects SET status = ?, error = ?, updated_at = ? WHERE id = ?'
        ).bind('failed', 'Cancelled by user', Date.now(), job.project_id).run();

        return jsonResponse({
            success: true,
            message: 'Job cancelled successfully',
            creditsRefunded: job.credits_cost || 0
        }, 200, corsHeaders);

    } catch (error) {
        console.error('Cancel job error:', error);
        return jsonResponse({ error: 'Failed to cancel job' }, 500, corsHeaders);
    }
}

/**
 * Download model file
 */
async function handleModelDownload(modelId: string, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const key = `models/${modelId}.ply`;
        const object = await env.SPLAT_BUCKET.get(key);

        if (!object) {
            return new Response('Model not found', { status: 404, headers: corsHeaders });
        }

        const headers = {
            ...corsHeaders,
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${modelId}.ply"`,
        };

        return new Response(object.body, { headers });

    } catch (error) {
        console.error('Download error:', error);
        return new Response('Download failed', { status: 500, headers: corsHeaders });
    }
}

/**
 * List all projects (filtered by user if authenticated)
 */
async function handleListProjects(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const sessionId = getSessionFromRequest(request);
        let user = null;

        if (sessionId) {
            user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);
        }

        let projects;
        if (user) {
            // Return user's projects (including public projects)
            projects = await env.SPLAT_DB.prepare(
                'SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC LIMIT 100'
            ).bind(user.id).all();
        } else {
            // Return only public projects
            projects = await env.SPLAT_DB.prepare(
                'SELECT * FROM projects WHERE is_public = 1 ORDER BY created_at DESC LIMIT 50'
            ).all();
        }

        return jsonResponse({ projects: projects.results }, 200, corsHeaders);

    } catch (error) {
        console.error('List projects error:', error);
        return jsonResponse({ error: 'Failed to list projects' }, 500, corsHeaders);
    }
}

/**
 * Get a single project
 */
async function handleGetProject(projectId: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const sessionId = getSessionFromRequest(request);
        let user = null;

        if (sessionId) {
            user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);
        }

        const project = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(projectId).first();

        if (!project) {
            return jsonResponse({ error: 'Project not found' }, 404, corsHeaders);
        }

        // Check access - user can access their own projects or public projects
        if (!project.is_public && (!user || project.user_id !== user.id)) {
            return jsonResponse({ error: 'Access denied' }, 403, corsHeaders);
        }

        return jsonResponse({ project }, 200, corsHeaders);

    } catch (error) {
        console.error('Get project error:', error);
        return jsonResponse({ error: 'Failed to get project' }, 500, corsHeaders);
    }
}

/**
 * Sync project to cloud (create or update)
 */
async function handleSyncProject(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const sessionId = getSessionFromRequest(request);

        if (!sessionId) {
            return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
        }

        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        const body = await request.json() as any;
        const {
            id,
            name,
            status,
            photo_count,
            tags,
            is_public,
            created_at,
            completed_at,
            model_url,
            error,
            updated_at
        } = body;

        if (!id) {
            return jsonResponse({ error: 'Project ID required' }, 400, corsHeaders);
        }

        const now = Date.now();
        const updatedAt = updated_at || now;

        // Check if project exists
        const existingProject = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(id).first();

        if (existingProject) {
            // Update existing project (only if owned by user)
            if (existingProject.user_id && existingProject.user_id !== user.id) {
                return jsonResponse({ error: 'Cannot update another user\'s project' }, 403, corsHeaders);
            }

            // Conflict detection - check if cloud version is newer
            const cloudUpdatedAt = (existingProject as any).updated_at || (existingProject as any).created_at;
            if (cloudUpdatedAt > updatedAt) {
                // Cloud version is newer, return conflict
                return jsonResponse({
                    conflict: true,
                    cloudProject: existingProject,
                    message: 'Cloud version is newer'
                }, 409, corsHeaders);
            }

            await env.SPLAT_DB.prepare(`
                UPDATE projects
                SET name = ?, status = ?, photo_count = ?, tags = ?,
                    is_public = ?, completed_at = ?, model_url = ?,
                    error = ?, user_id = ?, updated_at = ?
                WHERE id = ?
            `).bind(
                name || null,
                status,
                photo_count || 0,
                tags || null,
                is_public ? 1 : 0,
                completed_at || null,
                model_url || null,
                error || null,
                user.id,
                updatedAt,
                id
            ).run();

        } else {
            // Create new project
            await env.SPLAT_DB.prepare(`
                INSERT INTO projects
                (id, user_id, name, status, photo_count, tags, is_public,
                 created_at, completed_at, model_url, error, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
                id,
                user.id,
                name || null,
                status,
                photo_count || 0,
                tags || null,
                is_public ? 1 : 0,
                created_at || now,
                completed_at || null,
                model_url || null,
                error || null,
                updatedAt
            ).run();
        }

        // Return the synced project
        const syncedProject = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(id).first();

        return jsonResponse({
            success: true,
            project: syncedProject,
            synced_at: now
        }, 200, corsHeaders);

    } catch (error) {
        console.error('Sync project error:', error);
        return jsonResponse({ error: 'Failed to sync project' }, 500, corsHeaders);
    }
}

/**
 * Update an existing project
 */
async function handleUpdateProject(projectId: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const sessionId = getSessionFromRequest(request);

        if (!sessionId) {
            return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
        }

        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        const project = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(projectId).first();

        if (!project) {
            return jsonResponse({ error: 'Project not found' }, 404, corsHeaders);
        }

        // Only owner can update
        if (project.user_id !== user.id) {
            return jsonResponse({ error: 'Access denied' }, 403, corsHeaders);
        }

        const body = await request.json() as any;
        const { name, tags, is_public, status, model_url, completed_at, error } = body;

        const now = Date.now();

        // Build update query dynamically
        const updates: string[] = [];
        const values: any[] = [];

        if (name !== undefined) {
            updates.push('name = ?');
            values.push(name);
        }
        if (tags !== undefined) {
            updates.push('tags = ?');
            values.push(tags);
        }
        if (is_public !== undefined) {
            updates.push('is_public = ?');
            values.push(is_public ? 1 : 0);
        }
        if (status !== undefined) {
            updates.push('status = ?');
            values.push(status);
        }
        if (model_url !== undefined) {
            updates.push('model_url = ?');
            values.push(model_url);
        }
        if (completed_at !== undefined) {
            updates.push('completed_at = ?');
            values.push(completed_at);
        }
        if (error !== undefined) {
            updates.push('error = ?');
            values.push(error);
        }

        if (updates.length === 0) {
            return jsonResponse({ error: 'No fields to update' }, 400, corsHeaders);
        }

        // Always update updated_at
        updates.push('updated_at = ?');
        values.push(now);
        values.push(projectId);

        await env.SPLAT_DB.prepare(
            `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();

        const updatedProject = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(projectId).first();

        return jsonResponse({
            success: true,
            project: updatedProject
        }, 200, corsHeaders);

    } catch (error) {
        console.error('Update project error:', error);
        return jsonResponse({ error: 'Failed to update project' }, 500, corsHeaders);
    }
}

/**
 * Handle delete project request
 */
async function handleDeleteProject(projectId: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const sessionId = getSessionFromRequest(request);

        if (!sessionId) {
            return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
        }

        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        const project = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(projectId).first<any>();

        if (!project) {
            return jsonResponse({ error: 'Project not found' }, 404, corsHeaders);
        }

        // Only owner can delete
        if (project.user_id !== user.id) {
            return jsonResponse({ error: 'Access denied' }, 403, corsHeaders);
        }

        // Get all photos for this project to delete from R2
        const photos = await env.SPLAT_DB.prepare(
            'SELECT r2_key FROM photos WHERE project_id = ?'
        ).bind(projectId).all();

        // Delete all photos from R2
        if (photos.results && photos.results.length > 0) {
            await Promise.all(
                photos.results.map(async (photo: any) => {
                    try {
                        await env.SPLAT_BUCKET.delete(photo.r2_key);
                    } catch (error) {
                        console.error(`Failed to delete photo ${photo.r2_key}:`, error);
                    }
                })
            );
        }

        // Delete model file from R2 if it exists
        if (project.model_url) {
            const modelKey = `models/${projectId}.ply`;
            try {
                await env.SPLAT_BUCKET.delete(modelKey);
            } catch (error) {
                console.error(`Failed to delete model ${modelKey}:`, error);
            }
        }

        // Delete project from database (cascade will delete photos and jobs)
        await env.SPLAT_DB.prepare(
            'DELETE FROM projects WHERE id = ?'
        ).bind(projectId).run();

        return jsonResponse({
            success: true,
            message: 'Project deleted successfully'
        }, 200, corsHeaders);

    } catch (error) {
        console.error('Delete project error:', error);
        return jsonResponse({ error: 'Failed to delete project' }, 500, corsHeaders);
    }
}

/**
 * Trigger RunPod GPU processing
 */
async function triggerRunPodProcessing(jobId: string, projectId: string, photos: any[], env: Env, params: GaussianSplattingParams) {
    try {
        // Generate pre-signed URLs for photos
        const imageUrls = await Promise.all(
            photos.map(async (photo: any) => {
                const url = await env.SPLAT_BUCKET.createSignedUrl(photo.r2_key, {
                    expiresIn: 3600, // 1 hour
                });
                return url;
            })
        );

        // Generate pre-signed upload URL for result
        const modelKey = `models/${projectId}.ply`;
        const uploadUrl = await env.SPLAT_BUCKET.createSignedUrl(modelKey, {
            method: 'PUT',
            expiresIn: 7200, // 2 hours
        });

        // Get the worker base URL for webhook
        const webhookUrl = `${new URL(env.WORKER_URL || 'https://your-worker.workers.dev').origin}/api/webhook/${jobId}`;

        // Call RunPod API with full Gaussian Splatting parameters
        const response = await fetch(
            `https://api.runpod.ai/v2/${env.RUNPOD_ENDPOINT_ID}/run`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${env.RUNPOD_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    input: {
                        project_id: projectId,
                        image_urls: imageUrls,
                        upload_url: uploadUrl,
                        webhook_url: webhookUrl,
                        // Gaussian Splatting parameters
                        params: {
                            iterations: params.iterations,
                            position_lr_init: params.position_lr_init,
                            position_lr_final: params.position_lr_final,
                            position_lr_delay_mult: params.position_lr_delay_mult,
                            position_lr_max_steps: params.position_lr_max_steps,
                            feature_lr: params.feature_lr,
                            opacity_lr: params.opacity_lr,
                            scaling_lr: params.scaling_lr,
                            rotation_lr: params.rotation_lr,
                            sh_degree: params.sh_degree,
                            percent_dense: params.percent_dense,
                            densification_interval: params.densification_interval,
                            opacity_reset_interval: params.opacity_reset_interval,
                            densify_from_iter: params.densify_from_iter,
                            densify_until_iter: params.densify_until_iter,
                            densify_grad_threshold: params.densify_grad_threshold,
                            white_background: params.white_background,
                            resolution_scales: params.resolution_scales,
                            lambda_dssim: params.lambda_dssim,
                            save_iterations: params.save_iterations,
                            test_iterations: params.test_iterations
                        }
                    },
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`RunPod API error: ${response.statusText}`);
        }

        const data: any = await response.json();

        // Update job with RunPod job ID
        await env.SPLAT_DB.prepare(
            'UPDATE jobs SET external_id = ?, status = ? WHERE id = ?'
        ).bind(data.id, 'processing', jobId).run();

        console.log(`RunPod job started: ${data.id} with params:`, params);

    } catch (error) {
        console.error('RunPod trigger error:', error);
        await env.SPLAT_DB.prepare(
            'UPDATE jobs SET status = ?, error = ? WHERE id = ?'
        ).bind('failed', String(error), jobId).run();
    }
}

/**
 * Calculate price estimate
 */
function calculatePriceEstimate(photoCount: number, iterations: number = 7000, gpuType: string = 'RTX_4090'): PriceEstimate {
    // GPU pricing per hour
    const gpuPrices: Record<string, number> = {
        'RTX_4090': 0.35,
        'RTX_3090': 0.20,
        'A100_80GB': 2.17,
        'A100_40GB': 1.89,
        'T4': 0.40,
    };

    const hourlyRate = gpuPrices[gpuType] || 0.35;

    // Time estimates (in seconds)
    const colmapTime = (photoCount / 10) * 90; // ~90 sec per 10 images
    const trainingTime = iterations * 0.5; // ~0.5 sec per iteration on RTX 4090
    const overhead = 60; // 1 minute overhead

    const totalSeconds = colmapTime + trainingTime + overhead;
    const totalHours = totalSeconds / 3600;

    const estimatedCost = totalHours * hourlyRate;

    return {
        estimatedCost: parseFloat(estimatedCost.toFixed(3)),
        estimatedTime: Math.ceil(totalSeconds),
        gpuType,
        breakdown: {
            colmapTime: Math.ceil(colmapTime),
            trainingTime: Math.ceil(trainingTime),
            overhead,
            hourlyRate,
        },
    };
}

/**
 * Handle price estimate request
 */
async function handlePriceEstimate(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const body = await request.json() as any;
        const photoCount = body.photoCount || 20;
        const iterations = body.iterations || 7000;
        const gpuType = body.gpuType || 'RTX_4090';

        const estimate = calculatePriceEstimate(photoCount, iterations, gpuType);

        return jsonResponse(estimate, 200, corsHeaders);

    } catch (error) {
        console.error('Price estimate error:', error);
        return jsonResponse({ error: 'Failed to calculate estimate' }, 500, corsHeaders);
    }
}

/**
 * Handle quality presets request
 */
async function handleQualityPresets(corsHeaders: Record<string, string>): Promise<Response> {
    const presets = getAllQualityPresets();
    return jsonResponse({ presets }, 200, corsHeaders);
}

/**
 * Handle webhook from RunPod
 */
async function handleWebhook(jobId: string, request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const payload = await request.json() as WebhookPayload;

        console.log(`Webhook received for job ${jobId}:`, payload);

        // Update job status in database
        if (payload.status === 'completed') {
            await env.SPLAT_DB.prepare(
                'UPDATE jobs SET status = ?, model_url = ?, completed_at = ?, progress = ? WHERE id = ?'
            ).bind('completed', payload.model_url, Date.now(), 100, jobId).run();

            // Update project status
            if (payload.project_id) {
                await env.SPLAT_DB.prepare(
                    'UPDATE projects SET status = ?, model_url = ?, completed_at = ? WHERE id = ?'
                ).bind('completed', payload.model_url, Date.now(), payload.project_id).run();

                // Send push notification
                await sendPushNotification(
                    env,
                    payload.project_id,
                    'Splat App - Processing Complete! 🎉',
                    'Your 3D reconstruction is ready to view',
                    `/?project=${payload.project_id}`
                );
            }

        } else if (payload.status === 'failed') {
            await env.SPLAT_DB.prepare(
                'UPDATE jobs SET status = ?, error = ? WHERE id = ?'
            ).bind('failed', payload.error || 'Unknown error', jobId).run();

            if (payload.project_id) {
                await env.SPLAT_DB.prepare(
                    'UPDATE projects SET status = ? WHERE id = ?'
                ).bind('failed', payload.project_id).run();
            }
        }

        return jsonResponse({ success: true }, 200, corsHeaders);

    } catch (error) {
        console.error('Webhook error:', error);
        return jsonResponse({ error: 'Webhook processing failed' }, 500, corsHeaders);
    }
}

/**
 * Handle push subscription registration
 */
async function handlePushSubscribe(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const body = await request.json() as PushSubscribeRequest;
        const { subscription, projectId } = body;

        if (!subscription || !subscription.endpoint || !subscription.keys) {
            return jsonResponse({ success: false, error: 'Invalid subscription data' }, 400, corsHeaders);
        }

        // Store subscription in database
        await env.SPLAT_DB.prepare(
            'INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh_key, auth_key, project_id, created_at) VALUES (?, ?, ?, ?, ?)'
        ).bind(
            subscription.endpoint,
            subscription.keys.p256dh,
            subscription.keys.auth,
            projectId || null,
            Date.now()
        ).run();

        console.log('Push subscription registered:', subscription.endpoint);

        return jsonResponse({ success: true }, 200, corsHeaders);

    } catch (error) {
        console.error('Push subscribe error:', error);
        return jsonResponse({ success: false, error: 'Subscription failed' }, 500, corsHeaders);
    }
}

/**
 * Handle push subscription removal
 */
async function handlePushUnsubscribe(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const body = await request.json() as { endpoint: string };

        if (!body.endpoint) {
            return jsonResponse({ success: false, error: 'Endpoint required' }, 400, corsHeaders);
        }

        await env.SPLAT_DB.prepare(
            'DELETE FROM push_subscriptions WHERE endpoint = ?'
        ).bind(body.endpoint).run();

        console.log('Push subscription removed:', body.endpoint);

        return jsonResponse({ success: true }, 200, corsHeaders);

    } catch (error) {
        console.error('Push unsubscribe error:', error);
        return jsonResponse({ success: false, error: 'Unsubscribe failed' }, 500, corsHeaders);
    }
}

/**
 * Send push notification to subscribers
 */
async function sendPushNotification(env: Env, projectId: string, title: string, body: string, url: string = '/') {
    try {
        // Get all subscriptions for this project (or all if no specific project)
        const subscriptions = await env.SPLAT_DB.prepare(
            'SELECT * FROM push_subscriptions WHERE project_id = ? OR project_id IS NULL'
        ).bind(projectId).all();

        if (!subscriptions.results || subscriptions.results.length === 0) {
            console.log('No push subscriptions found for project:', projectId);
            return;
        }

        // Web Push requires VAPID keys - these should be set in env
        // For now, we'll log that notifications would be sent
        // In production, you'd use web-push library with VAPID keys

        for (const sub of subscriptions.results) {
            console.log(`Would send push notification to: ${sub.endpoint}`);
            console.log(`Title: ${title}, Body: ${body}, URL: ${url}`);

            // TODO: In production, use web-push library:
            // await webpush.sendNotification(
            //     {
            //         endpoint: sub.endpoint,
            //         keys: {
            //             p256dh: sub.p256dh_key,
            //             auth: sub.auth_key
            //         }
            //     },
            //     JSON.stringify({ title, body, url })
            // );

            // Update last_used_at
            await env.SPLAT_DB.prepare(
                'UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?'
            ).bind(Date.now(), sub.id).run();
        }

    } catch (error) {
        console.error('Send push notification error:', error);
    }
}

/**
 * Helper function to return JSON responses
 */
function jsonResponse(data: any, status: number, corsHeaders: Record<string, string>): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
        },
    });
}

/**
 * Handle Google OAuth initiation
 */
async function handleGoogleAuth(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    if (!env.GOOGLE_CLIENT_ID) {
        return jsonResponse({ error: 'Google OAuth not configured' }, 500, corsHeaders);
    }

    const baseUrl = env.BASE_URL || 'http://localhost:5173';
    const redirectUri = `${baseUrl}/api/auth/google/callback`;
    const state = Auth.generateSessionId(); // Use as CSRF token

    const authUrl = Auth.getGoogleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri, state);

    return jsonResponse({ authUrl, state }, 200, corsHeaders);
}

/**
 * Handle Google OAuth callback
 */
async function handleGoogleCallback(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    const baseUrl = env.BASE_URL || 'http://localhost:5173';

    if (error || !code) {
        return Response.redirect(`${baseUrl}/?error=auth_failed`, 302);
    }

    try {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
            throw new Error('Google OAuth not configured');
        }

        const redirectUri = `${baseUrl}/api/auth/google/callback`;

        // Exchange code for tokens
        const tokenData = await Auth.exchangeGoogleCode(
            code,
            env.GOOGLE_CLIENT_ID,
            env.GOOGLE_CLIENT_SECRET,
            redirectUri
        );

        // Get user info
        const userInfo = await Auth.getGoogleUserInfo(tokenData.access_token);

        // Upsert user in database
        const user = await Auth.upsertUser(env.SPLAT_DB, {
            provider: 'google',
            provider_id: userInfo.id,
            email: userInfo.email,
            name: userInfo.name,
            avatar_url: userInfo.picture,
        });

        // Create session
        const session = await Auth.createSession(env.SPLAT_DB, user.id);

        // Redirect to app with session cookie
        const response = Response.redirect(`${baseUrl}/?auth=success`, 302);
        response.headers.set(
            'Set-Cookie',
            `session=${session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
        );

        return response;
    } catch (error) {
        console.error('Google OAuth error:', error);
        return Response.redirect(`${baseUrl}/?error=auth_failed`, 302);
    }
}

/**
 * Handle GitHub OAuth initiation
 */
async function handleGitHubAuth(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    if (!env.GITHUB_CLIENT_ID) {
        return jsonResponse({ error: 'GitHub OAuth not configured' }, 500, corsHeaders);
    }

    const baseUrl = env.BASE_URL || 'http://localhost:5173';
    const redirectUri = `${baseUrl}/api/auth/github/callback`;
    const state = Auth.generateSessionId(); // Use as CSRF token

    const authUrl = Auth.getGitHubAuthUrl(env.GITHUB_CLIENT_ID, redirectUri, state);

    return jsonResponse({ authUrl, state }, 200, corsHeaders);
}

/**
 * Handle GitHub OAuth callback
 */
async function handleGitHubCallback(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    const baseUrl = env.BASE_URL || 'http://localhost:5173';

    if (error || !code) {
        return Response.redirect(`${baseUrl}/?error=auth_failed`, 302);
    }

    try {
        if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
            throw new Error('GitHub OAuth not configured');
        }

        // Exchange code for token
        const tokenData = await Auth.exchangeGitHubCode(
            code,
            env.GITHUB_CLIENT_ID,
            env.GITHUB_CLIENT_SECRET
        );

        // Get user info
        const userInfo = await Auth.getGitHubUserInfo(tokenData.access_token);

        // Upsert user in database
        const user = await Auth.upsertUser(env.SPLAT_DB, {
            provider: 'github',
            provider_id: userInfo.id.toString(),
            email: userInfo.email,
            name: userInfo.name || userInfo.login,
            avatar_url: userInfo.avatar_url,
        });

        // Create session
        const session = await Auth.createSession(env.SPLAT_DB, user.id);

        // Redirect to app with session cookie
        const response = Response.redirect(`${baseUrl}/?auth=success`, 302);
        response.headers.set(
            'Set-Cookie',
            `session=${session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
        );

        return response;
    } catch (error) {
        console.error('GitHub OAuth error:', error);
        return Response.redirect(`${baseUrl}/?error=auth_failed`, 302);
    }
}

/**
 * Get current user from session
 */
async function handleGetCurrentUser(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    const sessionId = getSessionFromRequest(request);

    if (!sessionId) {
        return jsonResponse({ user: null }, 200, corsHeaders);
    }

    try {
        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ user: null }, 200, corsHeaders);
        }

        // Don't send sensitive data
        const { provider_id, ...safeUser } = user;

        return jsonResponse({ user: safeUser }, 200, corsHeaders);
    } catch (error) {
        console.error('Get current user error:', error);
        return jsonResponse({ error: 'Failed to get user' }, 500, corsHeaders);
    }
}

/**
 * Logout user
 */
async function handleLogout(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    const sessionId = getSessionFromRequest(request);

    if (sessionId) {
        try {
            await Auth.deleteSession(env.SPLAT_DB, sessionId);
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    const response = jsonResponse({ success: true }, 200, corsHeaders);
    response.headers.set('Set-Cookie', 'session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

    return response;
}

/**
 * Extract session ID from request cookies
 */
function getSessionFromRequest(request: Request): string | null {
    const cookieHeader = request.headers.get('Cookie');
    if (!cookieHeader) return null;

    const cookies = cookieHeader.split(';').map(c => c.trim());
    const sessionCookie = cookies.find(c => c.startsWith('session='));

    if (!sessionCookie) return null;

    return sessionCookie.split('=')[1];
}

/**
 * Get credit packages
 */
async function handleGetCreditPackages(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const packages = await Billing.getCreditPackages(env.SPLAT_DB);
        return jsonResponse({ packages }, 200, corsHeaders);
    } catch (error) {
        console.error('Get credit packages error:', error);
        return jsonResponse({ error: 'Failed to get credit packages' }, 500, corsHeaders);
    }
}

/**
 * Get user's credit balance
 */
async function handleGetBalance(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    const sessionId = getSessionFromRequest(request);

    if (!sessionId) {
        return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
    }

    try {
        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        return jsonResponse({
            credits: user.credits,
            creditsUsed: user.credits_used,
            subscriptionTier: user.subscription_tier,
            subscriptionStatus: user.subscription_status
        }, 200, corsHeaders);
    } catch (error) {
        console.error('Get balance error:', error);
        return jsonResponse({ error: 'Failed to get balance' }, 500, corsHeaders);
    }
}

/**
 * Get user's transaction history
 */
async function handleGetHistory(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    const sessionId = getSessionFromRequest(request);

    if (!sessionId) {
        return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
    }

    try {
        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        const transactions = await Billing.getTransactionHistory(env.SPLAT_DB, user.id);

        return jsonResponse({ transactions }, 200, corsHeaders);
    } catch (error) {
        console.error('Get history error:', error);
        return jsonResponse({ error: 'Failed to get transaction history' }, 500, corsHeaders);
    }
}

/**
 * Create Stripe payment intent for credit purchase
 */
async function handleCreatePaymentIntent(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    if (!env.STRIPE_SECRET_KEY) {
        return jsonResponse({ error: 'Stripe not configured' }, 500, corsHeaders);
    }

    const sessionId = getSessionFromRequest(request);

    if (!sessionId) {
        return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
    }

    try {
        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        const body = await request.json() as any;
        const { packageId } = body;

        if (!packageId) {
            return jsonResponse({ error: 'Package ID required' }, 400, corsHeaders);
        }

        const pkg = await Billing.getCreditPackage(env.SPLAT_DB, packageId);

        if (!pkg) {
            return jsonResponse({ error: 'Invalid package' }, 404, corsHeaders);
        }

        // Create or get Stripe customer
        let stripeCustomerId = user.stripe_customer_id;
        if (!stripeCustomerId) {
            const customer = await createStripeCustomer(env.STRIPE_SECRET_KEY, user.email, user.name);
            stripeCustomerId = customer.id;
            await Billing.createStripeCustomer(env.SPLAT_DB, user.id, user.email, stripeCustomerId);
        }

        // Create payment intent
        const paymentIntent = await createStripePaymentIntent(
            env.STRIPE_SECRET_KEY,
            pkg.price_cents,
            stripeCustomerId,
            {
                userId: user.id,
                packageId: pkg.id,
                credits: pkg.credits + pkg.bonus_credits
            }
        );

        return jsonResponse({
            clientSecret: paymentIntent.client_secret,
            amount: pkg.price_cents,
            credits: pkg.credits + pkg.bonus_credits,
            publishableKey: env.STRIPE_PUBLISHABLE_KEY
        }, 200, corsHeaders);
    } catch (error) {
        console.error('Create payment intent error:', error);
        return jsonResponse({ error: 'Failed to create payment intent' }, 500, corsHeaders);
    }
}

/**
 * Create Stripe subscription
 */
async function handleCreateSubscription(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    if (!env.STRIPE_SECRET_KEY) {
        return jsonResponse({ error: 'Stripe not configured' }, 500, corsHeaders);
    }

    const sessionId = getSessionFromRequest(request);

    if (!sessionId) {
        return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
    }

    try {
        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        const body = await request.json() as any;
        const { planId } = body;

        if (!planId) {
            return jsonResponse({ error: 'Plan ID required' }, 400, corsHeaders);
        }

        // Get subscription plan
        const plan = await env.SPLAT_DB.prepare(
            'SELECT * FROM subscription_plans WHERE id = ? AND active = 1'
        ).bind(planId).first<any>();

        if (!plan) {
            return jsonResponse({ error: 'Invalid plan' }, 404, corsHeaders);
        }

        // Create or get Stripe customer
        let stripeCustomerId = user.stripe_customer_id;
        if (!stripeCustomerId) {
            const customer = await createStripeCustomer(env.STRIPE_SECRET_KEY, user.email, user.name);
            stripeCustomerId = customer.id;
            await Billing.createStripeCustomer(env.SPLAT_DB, user.id, user.email, stripeCustomerId);
        }

        // Create subscription
        const subscription = await createStripeSubscription(
            env.STRIPE_SECRET_KEY,
            stripeCustomerId,
            plan.stripe_price_id,
            {
                userId: user.id,
                planId: plan.id,
                tier: plan.tier
            }
        );

        // Update user subscription info
        await env.SPLAT_DB.prepare(`
            UPDATE users
            SET subscription_tier = ?,
                subscription_status = ?,
                subscription_id = ?,
                subscription_current_period_end = ?
            WHERE id = ?
        `).bind(
            plan.tier,
            subscription.status,
            subscription.id,
            subscription.current_period_end * 1000,
            user.id
        ).run();

        return jsonResponse({
            success: true,
            subscriptionId: subscription.id,
            clientSecret: subscription.latest_invoice?.payment_intent?.client_secret
        }, 200, corsHeaders);
    } catch (error) {
        console.error('Create subscription error:', error);
        return jsonResponse({ error: 'Failed to create subscription' }, 500, corsHeaders);
    }
}

/**
 * Cancel subscription
 */
async function handleCancelSubscription(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    if (!env.STRIPE_SECRET_KEY) {
        return jsonResponse({ error: 'Stripe not configured' }, 500, corsHeaders);
    }

    const sessionId = getSessionFromRequest(request);

    if (!sessionId) {
        return jsonResponse({ error: 'Authentication required' }, 401, corsHeaders);
    }

    try {
        const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);

        if (!user) {
            return jsonResponse({ error: 'Invalid session' }, 401, corsHeaders);
        }

        if (!user.subscription_id) {
            return jsonResponse({ error: 'No active subscription' }, 400, corsHeaders);
        }

        // Cancel subscription at period end
        await cancelStripeSubscription(env.STRIPE_SECRET_KEY, user.subscription_id);

        // Update user status
        await env.SPLAT_DB.prepare(`
            UPDATE users SET subscription_status = 'canceled' WHERE id = ?
        `).bind(user.id).run();

        return jsonResponse({ success: true }, 200, corsHeaders);
    } catch (error) {
        console.error('Cancel subscription error:', error);
        return jsonResponse({ error: 'Failed to cancel subscription' }, 500, corsHeaders);
    }
}

/**
 * Handle Stripe webhooks
 */
async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
        return new Response('Stripe not configured', { status: 500 });
    }

    try {
        const signature = request.headers.get('stripe-signature');
        if (!signature) {
            return new Response('Missing signature', { status: 400 });
        }

        const body = await request.text();

        // Verify webhook signature
        const event = await verifyStripeWebhook(body, signature, env.STRIPE_WEBHOOK_SECRET);

        // Handle different event types
        switch (event.type) {
            case 'payment_intent.succeeded':
                await handlePaymentSuccess(event.data.object, env);
                break;

            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await handleSubscriptionUpdate(event.data.object, env);
                break;

            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object, env);
                break;

            case 'invoice.payment_succeeded':
                await handleSubscriptionPayment(event.data.object, env);
                break;

            default:
                console.log(`Unhandled event type: ${event.type}`);
        }

        return new Response(JSON.stringify({ received: true }), { status: 200 });
    } catch (error) {
        console.error('Stripe webhook error:', error);
        return new Response(`Webhook error: ${error}`, { status: 400 });
    }
}

/**
 * Handle successful payment intent
 */
async function handlePaymentSuccess(paymentIntent: any, env: Env) {
    const { userId, packageId, credits } = paymentIntent.metadata;

    if (!userId || !credits) {
        console.error('Missing metadata in payment intent');
        return;
    }

    try {
        // Add credits to user account
        await Billing.addCredits(
            env.SPLAT_DB,
            userId,
            parseInt(credits),
            'purchase',
            `Credit purchase: ${packageId}`,
            {
                stripePaymentIntentId: paymentIntent.id,
                stripeChargeId: paymentIntent.charges?.data?.[0]?.id,
                amountCents: paymentIntent.amount,
                currency: paymentIntent.currency
            }
        );

        console.log(`Added ${credits} credits to user ${userId}`);
    } catch (error) {
        console.error('Error handling payment success:', error);
    }
}

/**
 * Handle subscription update
 */
async function handleSubscriptionUpdate(subscription: any, env: Env) {
    const { userId, tier } = subscription.metadata;

    if (!userId) {
        console.error('Missing userId in subscription metadata');
        return;
    }

    try {
        await env.SPLAT_DB.prepare(`
            UPDATE users
            SET subscription_tier = ?,
                subscription_status = ?,
                subscription_id = ?,
                subscription_current_period_end = ?
            WHERE id = ?
        `).bind(
            tier || 'pro',
            subscription.status,
            subscription.id,
            subscription.current_period_end * 1000,
            userId
        ).run();

        console.log(`Updated subscription for user ${userId}: ${tier} (${subscription.status})`);
    } catch (error) {
        console.error('Error handling subscription update:', error);
    }
}

/**
 * Handle subscription deletion
 */
async function handleSubscriptionDeleted(subscription: any, env: Env) {
    const { userId } = subscription.metadata;

    if (!userId) {
        console.error('Missing userId in subscription metadata');
        return;
    }

    try {
        await env.SPLAT_DB.prepare(`
            UPDATE users
            SET subscription_tier = 'free',
                subscription_status = NULL,
                subscription_id = NULL,
                subscription_current_period_end = NULL
            WHERE id = ?
        `).bind(userId).run();

        console.log(`Subscription deleted for user ${userId}`);
    } catch (error) {
        console.error('Error handling subscription deletion:', error);
    }
}

/**
 * Handle subscription payment (monthly recurring)
 */
async function handleSubscriptionPayment(invoice: any, env: Env) {
    const subscription = invoice.subscription_details || invoice.subscription;
    if (!subscription) return;

    const { userId, planId } = invoice.metadata || subscription.metadata || {};

    if (!userId) {
        console.error('Missing userId in invoice metadata');
        return;
    }

    try {
        // Get plan details
        const plan = await env.SPLAT_DB.prepare(
            'SELECT * FROM subscription_plans WHERE id = ?'
        ).bind(planId).first<any>();

        if (!plan) {
            console.error('Plan not found:', planId);
            return;
        }

        // Add monthly credits
        await Billing.addCredits(
            env.SPLAT_DB,
            userId,
            plan.monthly_credits,
            'subscription',
            `${plan.name} monthly credits`,
            {
                stripeChargeId: invoice.charge,
                amountCents: invoice.amount_paid,
                currency: invoice.currency
            }
        );

        console.log(`Added ${plan.monthly_credits} subscription credits to user ${userId}`);
    } catch (error) {
        console.error('Error handling subscription payment:', error);
    }
}

/**
 * Stripe API helper: Create customer
 */
async function createStripeCustomer(apiKey: string, email: string, name?: string | null): Promise<any> {
    const response = await fetch('https://api.stripe.com/v1/customers', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            email,
            ...(name && { name })
        })
    });

    if (!response.ok) {
        throw new Error(`Stripe API error: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Stripe API helper: Create payment intent
 */
async function createStripePaymentIntent(
    apiKey: string,
    amount: number,
    customerId: string,
    metadata: Record<string, string>
): Promise<any> {
    const params = new URLSearchParams({
        amount: amount.toString(),
        currency: 'usd',
        customer: customerId,
        'automatic_payment_methods[enabled]': 'true'
    });

    // Add metadata
    Object.entries(metadata).forEach(([key, value]) => {
        params.append(`metadata[${key}]`, value);
    });

    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    if (!response.ok) {
        throw new Error(`Stripe API error: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Stripe API helper: Create subscription
 */
async function createStripeSubscription(
    apiKey: string,
    customerId: string,
    priceId: string,
    metadata: Record<string, string>
): Promise<any> {
    const params = new URLSearchParams({
        customer: customerId,
        'items[0][price]': priceId,
        'payment_behavior': 'default_incomplete',
        'payment_settings[save_default_payment_method]': 'on_subscription',
        'expand[0]': 'latest_invoice.payment_intent'
    });

    // Add metadata
    Object.entries(metadata).forEach(([key, value]) => {
        params.append(`metadata[${key}]`, value);
    });

    const response = await fetch('https://api.stripe.com/v1/subscriptions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
    });

    if (!response.ok) {
        throw new Error(`Stripe API error: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Stripe API helper: Cancel subscription
 */
async function cancelStripeSubscription(apiKey: string, subscriptionId: string): Promise<any> {
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });

    if (!response.ok) {
        throw new Error(`Stripe API error: ${response.statusText}`);
    }

    return await response.json();
}

/**
 * Stripe API helper: Verify webhook signature
 */
async function verifyStripeWebhook(body: string, signature: string, secret: string): Promise<any> {
    // Extract timestamp and signatures from header
    const elements = signature.split(',');
    const timestamp = elements.find(e => e.startsWith('t='))?.split('=')[1];
    const signatures = elements.filter(e => e.startsWith('v1='));

    if (!timestamp || signatures.length === 0) {
        throw new Error('Invalid signature header');
    }

    // Construct signed payload
    const signedPayload = `${timestamp}.${body}`;

    // Compute expected signature using HMAC SHA-256
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signatureBytes = await crypto.subtle.sign(
        'HMAC',
        key,
        encoder.encode(signedPayload)
    );

    const expectedSignature = Array.from(new Uint8Array(signatureBytes))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Compare signatures
    const signatureMatches = signatures.some(sig => {
        const providedSignature = sig.split('=')[1];
        return providedSignature === expectedSignature;
    });

    if (!signatureMatches) {
        throw new Error('Invalid signature');
    }

    // Parse and return event
    return JSON.parse(body);
}

/**
 * Handle public share page
 */
async function handleSharePage(projectId: string, env: Env, request: Request): Promise<Response> {
    try {
        // Get project info
        const project = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(projectId).first<any>();

        if (!project) {
            return new Response('Project not found', { status: 404 });
        }

        // Check if project is public
        if (!project.is_public) {
            // Check if user owns the project
            const sessionId = getSessionFromRequest(request);
            if (sessionId) {
                const user = await Auth.getUserBySession(env.SPLAT_DB, sessionId);
                if (!user || user.id !== project.user_id) {
                    return new Response('This project is private', { status: 403 });
                }
            } else {
                return new Response('This project is private', { status: 403 });
            }
        }

        if (!project.model_url) {
            return new Response('Model not yet available', { status: 404 });
        }

        // Generate share page HTML
        const html = generateSharePageHTML(project);

        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (error) {
        console.error('Share page error:', error);
        return new Response('Error loading share page', { status: 500 });
    }
}

/**
 * Handle embed page
 */
async function handleEmbedPage(projectId: string, env: Env, request: Request): Promise<Response> {
    try {
        // Get project info
        const project = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects WHERE id = ?'
        ).bind(projectId).first<any>();

        if (!project) {
            return new Response('Project not found', { status: 404 });
        }

        // Check if project is public
        if (!project.is_public) {
            return new Response('This project is private', { status: 403 });
        }

        if (!project.model_url) {
            return new Response('Model not yet available', { status: 404 });
        }

        // Generate embed page HTML (minimal, just the viewer)
        const html = generateEmbedPageHTML(project);

        return new Response(html, {
            headers: {
                'Content-Type': 'text/html',
                'Cache-Control': 'public, max-age=3600',
                'X-Frame-Options': 'ALLOWALL',
            },
        });
    } catch (error) {
        console.error('Embed page error:', error);
        return new Response('Error loading embed page', { status: 500 });
    }
}

/**
 * Generate share page HTML
 */
function generateSharePageHTML(project: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${project.name || 'Splat Model'} - Splat App</title>
    <meta property="og:title" content="${project.name || 'Splat Model'}" />
    <meta property="og:description" content="3D Gaussian Splatting Model created with Splat App" />
    <meta property="og:type" content="website" />
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            color: #fff;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            padding: 20px;
            text-align: center;
            background: rgba(255, 255, 255, 0.05);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }
        h1 {
            font-size: 1.5rem;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }
        .viewer-container {
            flex: 1;
            padding: 20px;
            display: flex;
            flex-direction: column;
        }
        iframe {
            flex: 1;
            border: none;
            border-radius: 15px;
            background: rgba(0, 0, 0, 0.3);
        }
        .info {
            margin-top: 20px;
            text-align: center;
            color: #a8b2d1;
        }
        .btn {
            display: inline-block;
            margin: 10px;
            padding: 12px 24px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            border-radius: 8px;
            transition: all 0.3s ease;
        }
        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(102, 126, 234, 0.3);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>${project.name || 'Splat Model'}</h1>
        <p>Created with Splat App</p>
    </div>
    <div class="viewer-container">
        <iframe src="https://antimatter15.com/splat/?url=${encodeURIComponent(project.model_url)}" allowfullscreen></iframe>
        <div class="info">
            <p>Use mouse to rotate, scroll to zoom</p>
            <a href="/" class="btn">Create Your Own 3D Model</a>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate embed page HTML
 */
function generateEmbedPageHTML(project: any): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${project.name || 'Splat Model'}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        iframe {
            width: 100%;
            height: 100%;
            border: none;
        }
    </style>
</head>
<body>
    <iframe src="https://antimatter15.com/splat/?url=${encodeURIComponent(project.model_url)}" allowfullscreen></iframe>
</body>
</html>`;
}

/**
 * Queue consumer for processing jobs
 * This would be a separate worker that processes items from the queue
 */
export async function queueConsumer(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const message of batch.messages) {
        const { jobId, projectId, photoKeys } = message.body;

        try {
            // Download photos from R2
            // Process with GPU service
            // Upload result back to R2
            // Update job status in D1

            console.log(`Processing job ${jobId} for project ${projectId}`);

            // Acknowledge message
            message.ack();
        } catch (error) {
            console.error(`Queue processing error for job ${jobId}:`, error);
            message.retry();
        }
    }
}
