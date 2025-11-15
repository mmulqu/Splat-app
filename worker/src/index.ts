/**
 * Cloudflare Worker for Splat App
 * Handles photo uploads, R2 storage, and GPU processing orchestration
 */

interface Env {
    SPLAT_BUCKET: R2Bucket;
    SPLAT_DB: D1Database;
    PROCESSING_QUEUE: Queue;
    // GPU Processing API keys (configure in Cloudflare dashboard)
    REPLICATE_API_KEY?: string;
    MODAL_API_KEY?: string;
    RUNPOD_API_KEY?: string;
}

interface UploadResponse {
    success: boolean;
    projectId: string;
    uploadUrls?: string[];
    error?: string;
}

interface ProcessRequest {
    projectId: string;
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

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
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
                return await handleListProjects(env, corsHeaders);
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
        const { projectId } = body;

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

        // Create processing job
        const jobId = crypto.randomUUID();

        await env.SPLAT_DB.prepare(
            'INSERT INTO jobs (id, project_id, status, created_at) VALUES (?, ?, ?, ?)'
        ).bind(jobId, projectId, 'queued', Date.now()).run();

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

        // Trigger GPU processing (example using Replicate)
        // In production, this would be handled by a queue consumer
        // triggerGPUProcessing(jobId, projectId, env);

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
 * List all projects
 */
async function handleListProjects(env: Env, corsHeaders: Record<string, string>): Promise<Response> {
    try {
        const projects = await env.SPLAT_DB.prepare(
            'SELECT * FROM projects ORDER BY created_at DESC LIMIT 50'
        ).all();

        return jsonResponse({ projects: projects.results }, 200, corsHeaders);

    } catch (error) {
        console.error('List projects error:', error);
        return jsonResponse({ error: 'Failed to list projects' }, 500, corsHeaders);
    }
}

/**
 * Trigger GPU processing (example implementation)
 */
async function triggerGPUProcessing(jobId: string, projectId: string, env: Env) {
    // Example: Using Replicate API
    if (env.REPLICATE_API_KEY) {
        try {
            // This would call Replicate's API to start the gaussian splatting process
            // The actual implementation would depend on which model you're using

            const response = await fetch('https://api.replicate.com/v1/predictions', {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${env.REPLICATE_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    version: 'gaussian-splatting-model-version-here',
                    input: {
                        // Pass R2 URLs or pre-signed URLs for photos
                        images: [], // Array of image URLs
                    },
                    webhook: `https://your-worker.workers.dev/api/webhook/${jobId}`,
                }),
            });

            const data = await response.json();

            // Update job with prediction ID
            await env.SPLAT_DB.prepare(
                'UPDATE jobs SET external_id = ?, status = ? WHERE id = ?'
            ).bind(data.id, 'processing', jobId).run();

        } catch (error) {
            console.error('GPU processing trigger error:', error);
            await env.SPLAT_DB.prepare(
                'UPDATE jobs SET status = ?, error = ? WHERE id = ?'
            ).bind('failed', String(error), jobId).run();
        }
    }

    // Similar implementations for Modal, RunPod, etc.
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
