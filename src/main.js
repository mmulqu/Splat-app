import { openDB } from 'idb';
import { optimizeImage, batchOptimizeImages, calculateSavings, formatBytes, detectBlur, getBlurStatistics, detectDuplicates, removeDuplicates } from './image-utils.js';

// Configuration
const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || '/api';

// IndexedDB setup
let db;

// Quality presets
let qualityPresets = [];
let selectedQuality = 'standard';

// Project filters
let currentSearchTerm = '';
let currentStatusFilter = 'all';
let currentSortOrder = 'newest';
let currentTagFilter = null;
let allProjects = [];

async function initDB() {
    db = await openDB('SplatAppDB', 2, {
        upgrade(db, oldVersion) {
            // Create projects store if it doesn't exist
            if (!db.objectStoreNames.contains('projects')) {
                const projectStore = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
                projectStore.createIndex('createdAt', 'createdAt');
                projectStore.createIndex('name', 'name');
                projectStore.createIndex('status', 'status');
            } else if (oldVersion < 2) {
                // Upgrade existing store
                const transaction = db.transaction;
                const projectStore = transaction.objectStore('projects');
                if (!projectStore.indexNames.contains('name')) {
                    projectStore.createIndex('name', 'name');
                }
                if (!projectStore.indexNames.contains('status')) {
                    projectStore.createIndex('status', 'status');
                }
            }

            if (!db.objectStoreNames.contains('photos')) {
                const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                photoStore.createIndex('projectId', 'projectId');
            }
        },
    });
}

// Quality Presets Management
async function loadQualityPresets() {
    try {
        const response = await fetch(`${API_ENDPOINT}/quality-presets`);
        if (!response.ok) {
            throw new Error('Failed to load quality presets');
        }

        const data = await response.json();
        qualityPresets = data.presets;

        // Render quality presets in both capture and upload tabs
        renderQualityPresets('quality-grid-capture');
        renderQualityPresets('quality-grid');

    } catch (error) {
        console.error('Error loading quality presets:', error);
        // Use fallback presets
        qualityPresets = [
            {
                id: 'preview',
                name: 'Preview',
                description: 'Fast preview (5 min)',
                iterations: 3000,
                icon: '🟢',
                color: '#4ade80'
            },
            {
                id: 'standard',
                name: 'Standard',
                description: 'Balanced quality (15 min)',
                iterations: 7000,
                icon: '🟡',
                color: '#facc15'
            },
            {
                id: 'high',
                name: 'High',
                description: 'High quality (30 min)',
                iterations: 15000,
                icon: '🟠',
                color: '#fb923c'
            },
            {
                id: 'ultra',
                name: 'Ultra',
                description: 'Maximum quality (60 min)',
                iterations: 30000,
                icon: '🔴',
                color: '#f87171'
            }
        ];
        renderQualityPresets('quality-grid-capture');
        renderQualityPresets('quality-grid');
    }
}

function renderQualityPresets(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    qualityPresets.forEach((preset, index) => {
        const card = document.createElement('div');
        card.className = `quality-card ${preset.id === selectedQuality ? 'selected' : ''}`;
        card.dataset.presetId = preset.id;
        card.style.setProperty('--preset-color', preset.color);

        const isRecommended = preset.id === 'standard';

        card.innerHTML = `
            ${isRecommended ? '<div class="quality-recommended">RECOMMENDED</div>' : ''}
            <span class="quality-icon">${preset.icon}</span>
            <div class="quality-name">${preset.name}</div>
            <div class="quality-description">${preset.description}</div>
            <div class="quality-stats">
                <div class="quality-stat">
                    <span>Iterations:</span>
                    <span class="quality-stat-value">${preset.iterations.toLocaleString()}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => selectQualityPreset(preset.id));
        container.appendChild(card);
    });
}

function selectQualityPreset(presetId) {
    selectedQuality = presetId;

    // Update all quality cards
    document.querySelectorAll('.quality-card').forEach(card => {
        if (card.dataset.presetId === presetId) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

    // Update price estimate
    const photoCount = capturedPhotos.length || selectedFiles.length;
    if (photoCount >= 5) {
        updatePriceEstimate(photoCount, 'RTX_4090', presetId);
    }
}

// Tab navigation
function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(tc => tc.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tabName).classList.add('active');

            if (tabName === 'projects') {
                loadProjects();
            }
        });
    });
}

// Camera capture functionality
let cameraStream = null;
let capturedPhotos = [];

async function startCamera() {
    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });

        const videoElement = document.getElementById('camera-stream');
        const cameraPreview = document.getElementById('camera-preview');

        videoElement.srcObject = cameraStream;
        cameraPreview.style.display = 'block';

        document.getElementById('start-camera').style.display = 'none';
        document.getElementById('capture-photo').style.display = 'inline-block';
        document.getElementById('stop-camera').style.display = 'inline-block';
    } catch (error) {
        console.error('Error accessing camera:', error);
        showStatus('Error accessing camera. Please check permissions.', 'error');
    }
}

async function capturePhoto() {
    const video = document.getElementById('camera-stream');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(async blob => {
        // Create file from blob for optimization
        const file = new File([blob], `capture_${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Optimize the captured photo
        const optimized = await optimizeImage(file);

        // Detect blur
        const blurResult = await detectBlur(optimized.file);

        const photo = {
            blob: optimized.file,
            url: URL.createObjectURL(optimized.file),
            timestamp: Date.now(),
            metadata: optimized.metadata,
            blur: blurResult
        };

        capturedPhotos.push(photo);
        updatePhotoCount();
        addThumbnail(photo.url, blurResult);

        // Show warning if blurry
        if (blurResult.isBlurry) {
            showStatus(`⚠️ Last photo appears blurry. ${blurResult.recommendation}`, 'warning');
        }

        if (capturedPhotos.length >= 5) {
            document.getElementById('process-captures').style.display = 'inline-block';
        }
    }, 'image/jpeg', 0.92);
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;

        document.getElementById('camera-preview').style.display = 'none';
        document.getElementById('start-camera').style.display = 'inline-block';
        document.getElementById('capture-photo').style.display = 'none';
        document.getElementById('stop-camera').style.display = 'none';
    }
}

function updatePhotoCount() {
    document.getElementById('photo-count').textContent = capturedPhotos.length;

    // Show quality selector and metadata inputs when enough photos
    if (capturedPhotos.length >= 5) {
        document.getElementById('quality-selector-capture').style.display = 'block';
        document.getElementById('project-metadata-capture').style.display = 'block';
        updatePriceEstimate(capturedPhotos.length, 'RTX_4090', selectedQuality);
    } else {
        document.getElementById('quality-selector-capture').style.display = 'none';
        document.getElementById('project-metadata-capture').style.display = 'none';
    }
}

function addThumbnail(url, blurResult) {
    const grid = document.getElementById('thumbnail-grid');
    const container = document.createElement('div');
    container.className = 'thumbnail-container';

    const img = document.createElement('img');
    img.src = url;
    img.className = 'thumbnail';

    container.appendChild(img);

    // Add blur indicator if provided
    if (blurResult) {
        const indicator = document.createElement('div');
        indicator.className = 'blur-indicator';

        const icon = blurResult.quality === 'sharp' ? '✅' :
                    blurResult.quality === 'acceptable' ? '🟡' : '⚠️';
        const bgColor = blurResult.quality === 'sharp' ? 'rgba(74, 222, 128, 0.9)' :
                       blurResult.quality === 'acceptable' ? 'rgba(250, 204, 21, 0.9)' : 'rgba(248, 113, 113, 0.9)';

        indicator.style.cssText = `
            position: absolute;
            top: 5px;
            right: 5px;
            background: ${bgColor};
            border-radius: 50%;
            width: 24px;
            height: 24px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        `;
        indicator.textContent = icon;
        indicator.title = blurResult.recommendation;

        container.appendChild(indicator);
    }

    grid.appendChild(container);
}

async function processCapturedPhotos() {
    if (capturedPhotos.length < 5) {
        showStatus('Please capture at least 5 photos', 'error');
        return;
    }

    showStatus('Uploading photos...', 'info');

    try {
        // Create FormData with all photos
        const formData = new FormData();
        capturedPhotos.forEach((photo, index) => {
            formData.append('photos', photo.blob, `photo_${index}.jpg`);
        });

        // Upload photos
        const response = await fetch(`${API_ENDPOINT}/upload`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Upload failed');
        }

        const result = await response.json();

        // Get project metadata from capture inputs
        const projectName = document.getElementById('project-name-capture').value;
        const projectTags = document.getElementById('project-tags-capture').value;

        // Save project to IndexedDB
        await saveProject(result, projectName, projectTags);

        showStatus('Photos uploaded! Processing started...', 'success');

        // Start processing
        await startProcessing(result.projectId);

    } catch (error) {
        console.error('Error processing photos:', error);
        showStatus('Error processing photos. Please try again.', 'error');
    }
}

// File upload functionality
function setupFileUpload() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const uploadBtn = document.getElementById('upload-btn');

    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        handleFiles(files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(Array.from(e.target.files));
    });

    uploadBtn.addEventListener('click', uploadFiles);
}

let selectedFiles = [];
let optimizedFiles = [];
let blurResults = [];

async function handleFiles(files) {
    selectedFiles = files;
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    // Show optimization progress
    const optimizationStatus = document.createElement('div');
    optimizationStatus.className = 'optimization-status';
    optimizationStatus.innerHTML = `
        <div class="optimization-progress">
            <div class="optimization-text">Optimizing images for faster upload...</div>
            <div class="optimization-bar">
                <div class="optimization-fill" id="optimization-fill"></div>
            </div>
        </div>
    `;
    fileList.appendChild(optimizationStatus);

    // Optimize images with progress
    const optimizationCallback = (current, total) => {
        const fillElement = document.getElementById('optimization-fill');
        const textElement = fileList.querySelector('.optimization-text');
        if (fillElement) {
            const percent = (current / total) * 100;
            fillElement.style.width = percent + '%';
        }
        if (textElement) {
            textElement.textContent = `Optimizing images... ${current}/${total}`;
        }
    };

    const optimizationResults = await batchOptimizeImages(Array.from(files), optimizationCallback);
    optimizedFiles = optimizationResults.map(r => r.file);

    // Update status for blur detection
    optimizationStatus.innerHTML = `
        <div class="optimization-progress">
            <div class="optimization-text">Analyzing image quality...</div>
            <div class="optimization-bar">
                <div class="optimization-fill" id="blur-detection-fill"></div>
            </div>
        </div>
    `;

    // Detect blur with progress
    const blurCallback = (current, total) => {
        const fillElement = document.getElementById('blur-detection-fill');
        const textElement = fileList.querySelector('.optimization-text');
        if (fillElement) {
            const percent = (current / total) * 100;
            fillElement.style.width = percent + '%';
        }
        if (textElement) {
            textElement.textContent = `Analyzing image quality... ${current}/${total}`;
        }
    };

    blurResults = await Promise.all(
        optimizedFiles.map(async (file, index) => ({
            file,
            optimization: optimizationResults[index],
            blur: await detectBlur(file)
        }))
    );

    // Detect duplicates
    optimizationStatus.innerHTML = `
        <div class="optimization-progress">
            <div class="optimization-text">Checking for duplicates...</div>
            <div class="optimization-bar">
                <div class="optimization-fill" style="width: 100%;"></div>
            </div>
        </div>
    `;

    const duplicateResults = await detectDuplicates(optimizedFiles);

    // Calculate statistics
    const savings = calculateSavings(optimizationResults);
    const blurStats = getBlurStatistics(blurResults);

    // Clear and show file list
    fileList.innerHTML = '';

    // Show combined stats
    const statsInfo = document.createElement('div');
    statsInfo.className = 'optimization-info';

    const blurWarningClass = blurStats.blurry > 0 ? 'blur-warning' : 'blur-success';
    const blurIcon = blurStats.blurry > 0 ? '⚠️' : '✅';

    const duplicateWarningClass = duplicateResults.hasDuplicates ? 'blur-warning' : 'blur-success';
    const duplicateIcon = duplicateResults.hasDuplicates ? '⚠️' : '✅';

    statsInfo.innerHTML = `
        <div class="optimization-success">
            ${savings.totalSavings > 0 ? `✅ Optimized: Saved ${formatBytes(savings.totalSavings)} (${savings.savingsPercent}% reduction)` : '✅ Images ready'}
        </div>
        <div class="${blurWarningClass}" style="margin-top: 8px;">
            ${blurIcon} Quality: ${blurStats.sharp} sharp, ${blurStats.acceptable} acceptable${blurStats.blurry > 0 ? `, ${blurStats.blurry} blurry` : ''}
        </div>
        ${blurStats.blurry > 0 ? `<div class="blur-recommendation">${blurStats.recommendation}</div>` : ''}
        <div class="${duplicateWarningClass}" style="margin-top: 8px;">
            ${duplicateIcon} ${duplicateResults.recommendation}
        </div>
    `;
    fileList.appendChild(statsInfo);

    // Show file list with blur and duplicate indicators
    blurResults.forEach((result, index) => {
        const fileItem = document.createElement('div');
        const isBlurry = result.blur.isBlurry;
        const isDuplicate = duplicateResults.duplicateIndices.includes(index);

        let itemClass = 'file-item';
        if (isBlurry) itemClass += ' file-item-blurry';
        if (isDuplicate) itemClass += ' file-item-duplicate';

        fileItem.className = itemClass;

        const original = result.optimization.metadata.original;
        const optimized = result.optimization.metadata.optimized;

        const qualityIcon = result.blur.quality === 'sharp' ? '✅' :
                           result.blur.quality === 'acceptable' ? '🟡' : '⚠️';
        const qualityColor = result.blur.quality === 'sharp' ? '#4ade80' :
                            result.blur.quality === 'acceptable' ? '#facc15' : '#f87171';

        // Find if this file is part of a duplicate pair
        const duplicatePair = duplicateResults.duplicatePairs.find(
            pair => pair.index1 === index || pair.index2 === index
        );

        fileItem.innerHTML = `
            <span>${result.file.name} ${isDuplicate ? '⚠️ Similar' : ''}</span>
            <div class="file-info">
                <span class="original-size" style="text-decoration: line-through; color: #888;">${formatBytes(original.size)}</span>
                <span class="optimized-size" style="color: #4ade80; margin-left: 8px;">${formatBytes(optimized.size)}</span>
                ${result.optimization.metadata.wasResized ? `<span style="color: #667eea; margin-left: 8px;">📐 Resized</span>` : ''}
                <span style="color: ${qualityColor}; margin-left: 8px;" title="${result.blur.recommendation}">${qualityIcon} ${result.blur.quality}</span>
                ${duplicatePair ? `<span style="color: #f87171; margin-left: 8px;" title="Similarity: ${duplicatePair.similarity}%">🔁 ${duplicatePair.similarity}% similar</span>` : ''}
            </div>
        `;
        fileList.appendChild(fileItem);
    });

    // Show quality selector and metadata inputs when enough files
    if (files.length >= 5) {
        document.getElementById('quality-selector').style.display = 'block';
        document.getElementById('project-metadata-upload').style.display = 'block';
        updatePriceEstimate(files.length, 'RTX_4090', selectedQuality);
    } else {
        document.getElementById('quality-selector').style.display = 'none';
        document.getElementById('project-metadata-upload').style.display = 'none';
    }

    document.getElementById('upload-btn').style.display = files.length > 0 ? 'inline-block' : 'none';
}

async function uploadFiles() {
    if (selectedFiles.length < 5) {
        showStatus('Please select at least 5 images', 'error');
        return;
    }

    const formData = new FormData();
    // Use optimized files if available, otherwise use original files
    const filesToUpload = optimizedFiles.length > 0 ? optimizedFiles : selectedFiles;
    filesToUpload.forEach(file => {
        formData.append('photos', file);
    });

    const progressContainer = document.getElementById('upload-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');

    progressContainer.style.display = 'block';

    try {
        const xhr = new XMLHttpRequest();

        xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
                const percent = (e.loaded / e.total) * 100;
                progressFill.style.width = percent + '%';
                progressText.textContent = Math.round(percent) + '%';
            }
        });

        xhr.addEventListener('load', async () => {
            if (xhr.status === 200) {
                const result = JSON.parse(xhr.responseText);

                // Get project metadata from upload inputs
                const projectName = document.getElementById('project-name-upload').value;
                const projectTags = document.getElementById('project-tags-upload').value;

                await saveProject(result, projectName, projectTags);
                showStatus('Upload successful! Processing started...', 'success');
                await startProcessing(result.projectId);
            } else {
                showStatus('Upload failed. Please try again.', 'error');
            }
        });

        xhr.addEventListener('error', () => {
            showStatus('Upload failed. Please check your connection.', 'error');
        });

        xhr.open('POST', `${API_ENDPOINT}/upload`);
        xhr.send(formData);

    } catch (error) {
        console.error('Upload error:', error);
        showStatus('Upload failed. Please try again.', 'error');
    }
}

async function saveProject(projectData, name = '', tags = '') {
    const project = {
        ...projectData,
        name: name.trim() || null,
        tags: tags.trim() || null,
        createdAt: Date.now(),
        status: 'processing',
        qualityPreset: selectedQuality
    };

    const id = await db.add('projects', project);
    return id;
}

async function startProcessing(projectId) {
    try {
        const response = await fetch(`${API_ENDPOINT}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                qualityPreset: selectedQuality
            })
        });

        if (!response.ok) {
            throw new Error('Processing request failed');
        }

        const result = await response.json();

        // Poll for status
        pollProcessingStatus(result.jobId);

    } catch (error) {
        console.error('Processing error:', error);
        showStatus('Failed to start processing. Please try again.', 'error');
    }
}

async function pollProcessingStatus(jobId) {
    const interval = setInterval(async () => {
        try {
            const response = await fetch(`${API_ENDPOINT}/status/${jobId}`);
            const status = await response.json();

            if (status.status === 'completed') {
                clearInterval(interval);
                showStatus('3D reconstruction complete! View it in the Viewer tab.', 'success');
                // Load the model in viewer
                loadModelInViewer(status.modelUrl);
            } else if (status.status === 'failed') {
                clearInterval(interval);
                showStatus('Processing failed. Please try again.', 'error');
            } else {
                showStatus(`Processing: ${status.progress || 0}%`, 'info');
            }
        } catch (error) {
            console.error('Status check error:', error);
        }
    }, 5000);
}

function loadModelInViewer(modelUrl) {
    const container = document.getElementById('viewer-container');
    container.innerHTML = `
        <iframe
            src="https://antimatter15.com/splat/?url=${encodeURIComponent(modelUrl)}"
            style="width: 100%; height: 100%; border: none; border-radius: 15px;"
            allowfullscreen>
        </iframe>
    `;
}

async function loadProjects() {
    const projectsGrid = document.getElementById('projects-grid');
    allProjects = await db.getAllFromIndex('projects', 'createdAt');

    // Update available tags
    updateTagsFilter();

    // Apply filters
    const filteredProjects = filterAndSortProjects(allProjects);

    projectsGrid.innerHTML = '';

    if (filteredProjects.length === 0) {
        const message = allProjects.length === 0
            ? 'No projects yet. Start by capturing or uploading photos!'
            : 'No projects match your current filters.';
        projectsGrid.innerHTML = `<p style="color: #a8b2d1; text-align: center;">${message}</p>`;
        return;
    }

    filteredProjects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const quality = project.qualityPreset ? `(${project.qualityPreset})` : '';
        const projectName = project.name || `Project ${project.id}`;
        const tags = project.tags ? project.tags.split(',').filter(t => t.trim()) : [];

        // Status color
        const statusColors = {
            'completed': '#4ade80',
            'processing': '#facc15',
            'failed': '#f87171',
            'uploading': '#667eea',
            'uploaded': '#667eea'
        };
        const statusColor = statusColors[project.status] || '#a8b2d1';

        card.innerHTML = `
            <div class="project-thumbnail"></div>
            <h3>${projectName}</h3>
            <p style="color: #a8b2d1; font-size: 0.9rem;">
                ${new Date(project.createdAt).toLocaleDateString()} ${quality}
            </p>
            <p style="color: ${statusColor}; font-size: 0.9rem;">
                Status: ${project.status}
            </p>
            ${tags.length > 0 ? `
                <div class="project-tags">
                    ${tags.map(tag => `<span class="project-tag">${tag}</span>`).join('')}
                </div>
            ` : ''}
        `;

        if (project.status === 'completed' && project.modelUrl) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', () => {
                loadModelInViewer(project.modelUrl);
                document.querySelector('[data-tab="viewer"]').click();
            });
        }

        projectsGrid.appendChild(card);
    });
}

function filterAndSortProjects(projects) {
    let filtered = [...projects];

    // Apply search filter
    if (currentSearchTerm) {
        const searchLower = currentSearchTerm.toLowerCase();
        filtered = filtered.filter(p => {
            const name = (p.name || `Project ${p.id}`).toLowerCase();
            const tags = (p.tags || '').toLowerCase();
            return name.includes(searchLower) || tags.includes(searchLower);
        });
    }

    // Apply status filter
    if (currentStatusFilter !== 'all') {
        filtered = filtered.filter(p => p.status === currentStatusFilter);
    }

    // Apply tag filter
    if (currentTagFilter) {
        filtered = filtered.filter(p => {
            const tags = p.tags ? p.tags.split(',').map(t => t.trim()) : [];
            return tags.includes(currentTagFilter);
        });
    }

    // Apply sorting
    filtered.sort((a, b) => {
        switch (currentSortOrder) {
            case 'newest':
                return b.createdAt - a.createdAt;
            case 'oldest':
                return a.createdAt - b.createdAt;
            case 'name':
                const nameA = (a.name || `Project ${a.id}`).toLowerCase();
                const nameB = (b.name || `Project ${b.id}`).toLowerCase();
                return nameA.localeCompare(nameB);
            default:
                return 0;
        }
    });

    return filtered;
}

function updateTagsFilter() {
    const tagsListContainer = document.getElementById('filter-tags-list');

    // Collect all unique tags
    const allTags = new Set();
    allProjects.forEach(project => {
        if (project.tags) {
            project.tags.split(',').forEach(tag => {
                const trimmed = tag.trim();
                if (trimmed) allTags.add(trimmed);
            });
        }
    });

    tagsListContainer.innerHTML = '';

    if (allTags.size === 0) {
        tagsListContainer.innerHTML = '<span style="color: #666; font-size: 0.85rem;">No tags yet</span>';
        return;
    }

    // Create tag filter chips
    Array.from(allTags).sort().forEach(tag => {
        const tagChip = document.createElement('span');
        tagChip.className = 'tag' + (currentTagFilter === tag ? ' active' : '');
        tagChip.textContent = tag;
        tagChip.addEventListener('click', () => {
            if (currentTagFilter === tag) {
                currentTagFilter = null;
            } else {
                currentTagFilter = tag;
            }
            loadProjects();
        });
        tagsListContainer.appendChild(tagChip);
    });
}

function setupProjectFilters() {
    // Search input
    const searchInput = document.getElementById('project-search');
    searchInput.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value;
        loadProjects();
    });

    // Status filter
    const statusFilter = document.getElementById('status-filter');
    statusFilter.addEventListener('change', (e) => {
        currentStatusFilter = e.target.value;
        loadProjects();
    });

    // Sort order
    const sortOrder = document.getElementById('sort-order');
    sortOrder.addEventListener('change', (e) => {
        currentSortOrder = e.target.value;
        loadProjects();
    });
}

function showStatus(message, type = 'info') {
    const statusDiv = document.getElementById('status-message');
    statusDiv.className = `status-message ${type}`;
    statusDiv.textContent = message;
    statusDiv.style.display = 'block';

    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

// Price estimation
async function updatePriceEstimate(photoCount, gpuType = 'RTX_4090', qualityPresetId = 'standard') {
    if (photoCount < 5) {
        hidePriceEstimate();
        return;
    }

    const preset = qualityPresets.find(p => p.id === qualityPresetId) || qualityPresets.find(p => p.id === 'standard');
    const iterations = preset ? preset.iterations : 7000;

    try {
        const response = await fetch(`${API_ENDPOINT}/estimate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                photoCount,
                iterations,
                gpuType
            })
        });

        if (!response.ok) {
            throw new Error('Failed to get estimate');
        }

        const estimate = await response.json();
        displayPriceEstimate(estimate, preset);

    } catch (error) {
        console.error('Price estimate error:', error);
        // Fallback to local calculation
        const estimate = calculateLocalEstimate(photoCount, gpuType, iterations);
        displayPriceEstimate(estimate, preset);
    }
}

function calculateLocalEstimate(photoCount, gpuType = 'RTX_4090', iterations = 7000) {
    const gpuPrices = {
        'RTX_4090': 0.35,
        'RTX_3090': 0.20,
        'A100_80GB': 2.17,
        'A100_40GB': 1.89,
        'T4': 0.40,
    };

    const hourlyRate = gpuPrices[gpuType] || 0.35;
    const colmapTime = (photoCount / 10) * 90;
    const trainingTime = iterations * 0.5;
    const overhead = 60;
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
            hourlyRate
        }
    };
}

function displayPriceEstimate(estimate, preset) {
    // Create or update price estimate display
    let estimateDiv = document.getElementById('price-estimate');

    if (!estimateDiv) {
        estimateDiv = document.createElement('div');
        estimateDiv.id = 'price-estimate';
        estimateDiv.className = 'price-estimate-box';

        // Insert into both capture and upload sections
        const captureSections = document.querySelectorAll('.upload-section');
        captureSections.forEach(section => {
            const clone = estimateDiv.cloneNode(true);
            section.appendChild(clone);
        });

        // Use the first one for updates
        estimateDiv = document.getElementById('price-estimate');
    }

    const minutes = Math.floor(estimate.estimatedTime / 60);
    const seconds = estimate.estimatedTime % 60;
    const qualityName = preset ? `${preset.icon} ${preset.name}` : 'Standard';

    estimateDiv.innerHTML = `
        <div class="estimate-header">
            <h3>💰 Estimated Cost</h3>
            <div class="cost-amount">$${estimate.estimatedCost.toFixed(2)}</div>
        </div>
        <div class="estimate-details">
            <div class="detail-row">
                <span>⏱️ Processing Time:</span>
                <span>${minutes}m ${seconds}s</span>
            </div>
            <div class="detail-row">
                <span>✨ Quality:</span>
                <span>${qualityName}</span>
            </div>
            <div class="detail-row">
                <span>🎮 GPU:</span>
                <span>${estimate.gpuType.replace('_', ' ')}</span>
            </div>
            <div class="detail-row">
                <span>💵 Rate:</span>
                <span>$${estimate.breakdown.hourlyRate.toFixed(2)}/hr</span>
            </div>
        </div>
        <div class="estimate-breakdown">
            <details>
                <summary>View breakdown</summary>
                <div class="breakdown-content">
                    <div class="breakdown-row">
                        <span>COLMAP (Structure from Motion):</span>
                        <span>${Math.floor(estimate.breakdown.colmapTime / 60)}m</span>
                    </div>
                    <div class="breakdown-row">
                        <span>Gaussian Splatting Training:</span>
                        <span>${Math.floor(estimate.breakdown.trainingTime / 60)}m</span>
                    </div>
                    <div class="breakdown-row">
                        <span>Overhead (upload/download):</span>
                        <span>${Math.floor(estimate.breakdown.overhead / 60)}m</span>
                    </div>
                </div>
            </details>
        </div>
        <div class="estimate-note">
            <small>💡 Estimate based on ${qualityName} quality with ${estimate.gpuType.replace('_', ' ')} GPU. Actual cost may vary.</small>
        </div>
    `;

    estimateDiv.style.display = 'block';
}

function hidePriceEstimate() {
    const estimates = document.querySelectorAll('#price-estimate');
    estimates.forEach(est => est.style.display = 'none');
}

// Service Worker registration
let swRegistration = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            swRegistration = await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered');

            // Request notification permission after SW is registered
            await requestNotificationPermission();
        } catch (err) {
            console.error('Service Worker registration failed:', err);
        }
    });
}

// Push Notification Support
async function requestNotificationPermission() {
    if (!('Notification' in window)) {
        console.log('This browser does not support notifications');
        return false;
    }

    if (Notification.permission === 'granted') {
        await subscribeToPushNotifications();
        return true;
    }

    if (Notification.permission !== 'denied') {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            await subscribeToPushNotifications();
            return true;
        }
    }

    return false;
}

async function subscribeToPushNotifications() {
    try {
        if (!swRegistration) {
            console.log('Service Worker not registered yet');
            return;
        }

        // Check if already subscribed
        let subscription = await swRegistration.pushManager.getSubscription();

        if (!subscription) {
            // VAPID public key - in production, this should come from your backend
            // For now, we'll use a placeholder
            const vapidPublicKey = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

            const convertedVapidKey = urlBase64ToUint8Array(vapidPublicKey);

            subscription = await swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: convertedVapidKey
            });
        }

        // Send subscription to backend
        await fetch(`${API_ENDPOINT}/push/subscribe`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                subscription: subscription.toJSON()
            })
        });

        console.log('Push notification subscription successful');

    } catch (error) {
        console.error('Error subscribing to push notifications:', error);
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Initialize app
async function init() {
    await initDB();
    await loadQualityPresets();
    setupTabs();
    setupFileUpload();
    setupProjectFilters();

    // Camera controls
    document.getElementById('start-camera').addEventListener('click', startCamera);
    document.getElementById('capture-photo').addEventListener('click', capturePhoto);
    document.getElementById('stop-camera').addEventListener('click', stopCamera);
    document.getElementById('process-captures').addEventListener('click', processCapturedPhotos);

    // Handle URL parameters
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (action) {
        const tab = document.querySelector(`[data-tab="${action}"]`);
        if (tab) tab.click();
    }
}

init();
