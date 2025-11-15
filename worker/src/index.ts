/**
 * Cloudflare Worker for Splat App
 * Handles photo uploads, R2 storage, and GPU processing orchestration
 */

import { getQualityPreset, calculatePresetCost, getAllQualityPresets } from './quality-presets';
import * as Auth from './auth';

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
        const { projectId, qualityPreset = 'standard' } = body;

        if (!projectId) {
            return jsonResponse({ success: false, error: 'Project ID required' }, 400, corsHeaders);
        }

        // Get project photos from database
        const photos = await env.SPLAT_DB.prepare(
            'SELECT * FROM photos WHERE project_id = ?'
        ).bind(projectId).all();

        if (!photos.results || photos.results.length < 5) {
            return jsonResponse({ success: false, error: 'Insufficient photos (minimum 5)' }, 400, corsHeaders);
        }

        // Get quality preset
        const preset = getQualityPreset(qualityPreset);

        // Create processing job
        const jobId = crypto.randomUUID();

        await env.SPLAT_DB.prepare(
            'INSERT INTO jobs (id, project_id, status, created_at) VALUES (?, ?, ?, ?)'
        ).bind(jobId, projectId, 'queued', Date.now()).run();

        // Store quality preset in job metadata
        await env.SPLAT_DB.prepare(
            'UPDATE jobs SET external_id = ? WHERE id = ?'
        ).bind(JSON.stringify({ qualityPreset, iterations: preset.iterations }), jobId).run();

        // Update project status
        await env.SPLAT_DB.prepare(
            'UPDATE projects SET status = ? WHERE id = ?'
        ).bind('processing', projectId).run();

        // Queue processing job
        await env.PROCESSING_QUEUE.send({
            jobId,
            projectId,
            photoKeys: photos.results.map((p: any) => p.r2_key),
        });

        // Trigger GPU processing with RunPod
        if (env.RUNPOD_API_KEY && env.RUNPOD_ENDPOINT_ID) {
            await triggerRunPodProcessing(jobId, projectId, photos.results, env, preset.iterations);
        }

        const response: ProcessResponse = {
            success: true,
            jobId,
        };

        return jsonResponse(response, 200, corsHeaders);

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
 * Trigger RunPod GPU processing
 */
async function triggerRunPodProcessing(jobId: string, projectId: string, photos: any[], env: Env, iterations: number = 7000) {
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

        // Call RunPod API
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
                        iterations: iterations,
                        upload_url: uploadUrl,
                        webhook_url: webhookUrl,
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

        console.log(`RunPod job started: ${data.id}`);

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
