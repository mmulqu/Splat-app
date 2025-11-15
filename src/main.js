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

// Current user
let currentUser = null;

// Bulk selection state
let selectMode = false;
let selectedProjects = new Set();

async function initDB() {
    db = await openDB('SplatAppDB', 3, {
        upgrade(db, oldVersion) {
            // Create projects store if it doesn't exist
            if (!db.objectStoreNames.contains('projects')) {
                const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
                projectStore.createIndex('createdAt', 'createdAt');
                projectStore.createIndex('name', 'name');
                projectStore.createIndex('status', 'status');
                projectStore.createIndex('serverId', 'serverId');
                projectStore.createIndex('updatedAt', 'updatedAt');
            } else if (oldVersion < 3) {
                // Upgrade existing store - can't modify keyPath, but can add indexes
                const transaction = db.transaction;
                const projectStore = transaction.objectStore('projects');
                if (!projectStore.indexNames.contains('name')) {
                    projectStore.createIndex('name', 'name');
                }
                if (!projectStore.indexNames.contains('status')) {
                    projectStore.createIndex('status', 'status');
                }
                if (!projectStore.indexNames.contains('serverId')) {
                    projectStore.createIndex('serverId', 'serverId');
                }
                if (!projectStore.indexNames.contains('updatedAt')) {
                    projectStore.createIndex('updatedAt', 'updatedAt');
                }
            }

            if (!db.objectStoreNames.contains('photos')) {
                const photoStore = db.createObjectStore('photos', { keyPath: 'id', autoIncrement: true });
                photoStore.createIndex('projectId', 'projectId');
            }
        },
    });
}

// Custom Parameters Storage
let customParams = {};

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

    // Update advanced settings panels
    populateAdvancedSettings(presetId);
}

/**
 * Populate advanced settings panel with parameter controls
 */
function populateAdvancedSettings(presetId) {
    const preset = qualityPresets.find(p => p.id === presetId);
    if (!preset || !preset.params) return;

    // Reset custom params when preset changes
    customParams = {};

    const params = preset.params;

    // Define parameter groups for better organization
    const paramGroups = [
        {
            title: 'Training Parameters',
            params: [
                { key: 'iterations', label: 'Iterations', type: 'number', min: 1000, max: 100000, step: 1000 },
                { key: 'position_lr_init', label: 'Position Learning Rate (Initial)', type: 'number', min: 0.00001, max: 0.01, step: 0.00001, format: 'scientific' },
                { key: 'position_lr_final', label: 'Position Learning Rate (Final)', type: 'number', min: 0.0000001, max: 0.001, step: 0.0000001, format: 'scientific' },
                { key: 'feature_lr', label: 'Feature Learning Rate', type: 'number', min: 0.0001, max: 0.01, step: 0.0001 },
                { key: 'opacity_lr', label: 'Opacity Learning Rate', type: 'number', min: 0.001, max: 0.5, step: 0.001 },
                { key: 'scaling_lr', label: 'Scaling Learning Rate', type: 'number', min: 0.0001, max: 0.05, step: 0.0001 },
                { key: 'rotation_lr', label: 'Rotation Learning Rate', type: 'number', min: 0.0001, max: 0.01, step: 0.0001 }
            ]
        },
        {
            title: 'Densification Settings',
            params: [
                { key: 'densification_interval', label: 'Densification Interval', type: 'number', min: 10, max: 1000, step: 10 },
                { key: 'opacity_reset_interval', label: 'Opacity Reset Interval', type: 'number', min: 1000, max: 10000, step: 100 },
                { key: 'densify_from_iter', label: 'Densify From Iteration', type: 'number', min: 0, max: 5000, step: 100 },
                { key: 'densify_until_iter', label: 'Densify Until Iteration', type: 'number', min: 1000, max: 50000, step: 1000 },
                { key: 'densify_grad_threshold', label: 'Densification Gradient Threshold', type: 'number', min: 0.00001, max: 0.001, step: 0.00001, format: 'scientific' },
                { key: 'percent_dense', label: 'Percent Dense', type: 'number', min: 0.001, max: 0.1, step: 0.001 }
            ]
        },
        {
            title: 'Rendering & Quality',
            params: [
                { key: 'sh_degree', label: 'Spherical Harmonics Degree', type: 'number', min: 0, max: 4, step: 1 },
                { key: 'lambda_dssim', label: 'DSSIM Loss Weight', type: 'number', min: 0, max: 1, step: 0.05 },
                { key: 'white_background', label: 'White Background', type: 'checkbox' }
            ]
        }
    ];

    // Populate both panels (capture and upload)
    ['capture', 'upload'].forEach(mode => {
        const container = document.getElementById(`advanced-params-${mode}`);
        if (!container) return;

        container.innerHTML = '';

        paramGroups.forEach(group => {
            const groupDiv = document.createElement('div');
            groupDiv.className = 'param-group';

            groupDiv.innerHTML = `<div class="param-group-title">${group.title}</div>`;

            group.params.forEach(paramDef => {
                const value = params[paramDef.key];
                const control = createParameterControl(paramDef, value, mode);
                groupDiv.appendChild(control);
            });

            container.appendChild(groupDiv);
        });
    });
}

/**
 * Create a parameter control element
 */
function createParameterControl(paramDef, defaultValue, mode) {
    const controlDiv = document.createElement('div');
    controlDiv.className = 'param-control';

    if (paramDef.type === 'checkbox') {
        controlDiv.innerHTML = `
            <div class="param-checkbox-wrapper">
                <input type="checkbox"
                    class="param-checkbox"
                    id="param-${paramDef.key}-${mode}"
                    ${defaultValue ? 'checked' : ''}
                    data-param-key="${paramDef.key}">
                <label for="param-${paramDef.key}-${mode}" class="param-label" style="margin-bottom: 0;">
                    ${paramDef.label}
                </label>
            </div>
            <div class="param-description">${getParamDescription(paramDef.key)}</div>
        `;
    } else {
        const displayValue = paramDef.format === 'scientific'
            ? defaultValue.toExponential(6)
            : defaultValue;

        controlDiv.innerHTML = `
            <div class="param-label">
                <span>${paramDef.label}</span>
                <span class="param-value" id="param-value-${paramDef.key}-${mode}">${displayValue}</span>
            </div>
            <input type="number"
                class="param-input"
                id="param-${paramDef.key}-${mode}"
                value="${defaultValue}"
                min="${paramDef.min}"
                max="${paramDef.max}"
                step="${paramDef.step}"
                data-param-key="${paramDef.key}"
                data-format="${paramDef.format || 'number'}">
            <div class="param-description">${getParamDescription(paramDef.key)}</div>
        `;
    }

    // Add event listener
    const input = controlDiv.querySelector(`#param-${paramDef.key}-${mode}`);
    if (input) {
        input.addEventListener('input', (e) => {
            const key = e.target.dataset.paramKey;
            const value = paramDef.type === 'checkbox' ? e.target.checked : parseFloat(e.target.value);
            customParams[key] = value;

            // Update display value
            if (paramDef.type !== 'checkbox') {
                const valueDisplay = controlDiv.querySelector(`#param-value-${paramDef.key}-${mode}`);
                if (valueDisplay) {
                    valueDisplay.textContent = paramDef.format === 'scientific'
                        ? value.toExponential(6)
                        : value;
                }
            }
        });
    }

    return controlDiv;
}

/**
 * Get parameter description
 */
function getParamDescription(paramKey) {
    const descriptions = {
        iterations: 'Total number of training iterations',
        position_lr_init: 'Initial learning rate for Gaussian positions',
        position_lr_final: 'Final learning rate for Gaussian positions',
        feature_lr: 'Learning rate for Gaussian features (colors)',
        opacity_lr: 'Learning rate for Gaussian opacity',
        scaling_lr: 'Learning rate for Gaussian scales',
        rotation_lr: 'Learning rate for Gaussian rotations',
        sh_degree: 'Spherical harmonics degree (0-4) - higher = better view-dependent effects',
        densification_interval: 'Iterations between densification operations',
        opacity_reset_interval: 'Iterations between opacity resets',
        densify_from_iter: 'Iteration to start densification',
        densify_until_iter: 'Iteration to stop densification',
        densify_grad_threshold: 'Gradient threshold for densification',
        percent_dense: 'Percentage of scene extent to consider dense',
        white_background: 'Use white background instead of black',
        lambda_dssim: 'Weight for DSSIM loss (0-1, higher = more structure preservation)'
    };

    return descriptions[paramKey] || '';
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

    // Show quality selector, metadata inputs, and advanced settings when enough photos
    if (capturedPhotos.length >= 5) {
        document.getElementById('quality-selector-capture').style.display = 'block';
        document.getElementById('project-metadata-capture').style.display = 'block';
        document.getElementById('advanced-settings-capture').style.display = 'block';
        updatePriceEstimate(capturedPhotos.length, 'RTX_4090', selectedQuality);
    } else {
        document.getElementById('quality-selector-capture').style.display = 'none';
        document.getElementById('project-metadata-capture').style.display = 'none';
        document.getElementById('advanced-settings-capture').style.display = 'none';
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

    // Show quality selector, metadata inputs, and advanced settings when enough files
    if (files.length >= 5) {
        document.getElementById('quality-selector').style.display = 'block';
        document.getElementById('project-metadata-upload').style.display = 'block';
        document.getElementById('advanced-settings-upload').style.display = 'block';
        updatePriceEstimate(files.length, 'RTX_4090', selectedQuality);
    } else {
        document.getElementById('quality-selector').style.display = 'none';
        document.getElementById('project-metadata-upload').style.display = 'none';
        document.getElementById('advanced-settings-upload').style.display = 'none';
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
    const now = Date.now();
    const project = {
        ...projectData,
        id: projectData.projectId || crypto.randomUUID(),
        name: name.trim() || null,
        tags: tags.trim() || null,
        createdAt: now,
        updatedAt: now,
        status: 'processing',
        qualityPreset: selectedQuality,
        isPublic: false,
        serverId: null,
        syncedAt: null
    };

    await db.put('projects', project);

    // Sync to cloud if user is authenticated
    if (currentUser) {
        syncProjectToCloud(project).catch(err => {
            console.error('Failed to sync project to cloud:', err);
        });
    }

    return project.id;
}

async function startProcessing(projectId) {
    try {
        const requestBody = {
            projectId,
            qualityPreset: selectedQuality
        };

        // Include custom parameters if any were set
        if (Object.keys(customParams).length > 0) {
            requestBody.customParams = customParams;
        }

        const response = await fetch(`${API_ENDPOINT}/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error('Processing request failed');
        }

        const result = await response.json();

        // Store jobId in project
        const project = await db.get('projects', projectId);
        if (project) {
            project.jobId = result.jobId;
            project.updatedAt = Date.now();
            await db.put('projects', project);
        }

        // Poll for status
        pollProcessingStatus(result.jobId, projectId);

    } catch (error) {
        console.error('Processing error:', error);
        showStatus('Failed to start processing. Please try again.', 'error');
    }
}

async function pollProcessingStatus(jobId, projectId) {
    const interval = setInterval(async () => {
        try {
            const response = await fetch(`${API_ENDPOINT}/status/${jobId}`);
            const status = await response.json();

            // Update project in IndexedDB
            if (projectId) {
                const project = await db.get('projects', projectId);
                if (project) {
                    project.status = status.status;
                    project.updatedAt = Date.now();

                    if (status.modelUrl) {
                        project.modelUrl = status.modelUrl;
                        project.completedAt = Date.now();
                    }

                    if (status.error) {
                        project.error = status.error;
                    }

                    await db.put('projects', project);

                    // Reload projects list to show updated status
                    await loadProjects();
                }
            }

            if (status.status === 'completed') {
                clearInterval(interval);
                showStatus('3D reconstruction complete! View it in the Viewer tab.', 'success');

                // Send push notification if enabled
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification('Splat Processing Complete', {
                        body: 'Your 3D model is ready to view!',
                        icon: '/icon-192.png',
                        tag: `job-${jobId}`
                    });
                }

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
    }, 5000); // Poll every 5 seconds
}

function loadModelInViewer(modelUrl, metadata = {}) {
    const container = document.getElementById('viewer-container');
    const controls = document.getElementById('viewer-controls');

    // Load model in iframe
    container.innerHTML = `
        <iframe
            id="splat-viewer-frame"
            src="https://antimatter15.com/splat/?url=${encodeURIComponent(modelUrl)}"
            style="width: 100%; height: 100%; border: none; border-radius: 15px;"
            allowfullscreen>
        </iframe>
    `;

    // Store current model info
    currentModel = {
        url: modelUrl,
        projectId: metadata.projectId || null,
        quality: metadata.quality || 'Unknown',
        photoCount: metadata.photoCount || 0,
        processingTime: metadata.processingTime || 0,
        credits: metadata.credits || 0,
        fileSize: metadata.fileSize || 0,
        createdAt: metadata.createdAt || Date.now()
    };

    // Show controls
    if (controls) controls.style.display = 'flex';

    // Update info panel
    updateModelInfo();
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

        // Visibility indicator
        const isPublic = project.isPublic || false;
        const visibilityIcon = isPublic ? '🌐' : '🔒';
        const visibilityText = isPublic ? 'Public' : 'Private';
        const visibilityColor = isPublic ? '#4ade80' : '#a8b2d1';

        card.innerHTML = `
            ${selectMode ? `
                <div style="position: absolute; top: 10px; left: 10px; z-index: 10;">
                    <input type="checkbox"
                        data-project-id="${project.id}"
                        ${selectedProjects.has(project.id) ? 'checked' : ''}
                        style="width: 20px; height: 20px; cursor: pointer;"
                    />
                </div>
            ` : ''}
            <div class="project-thumbnail"></div>
            <h3>${projectName}</h3>
            <p style="color: #a8b2d1; font-size: 0.9rem;">
                ${new Date(project.createdAt).toLocaleDateString()} ${quality}
            </p>
            <p style="color: ${statusColor}; font-size: 0.9rem;">
                Status: ${project.status}
            </p>
            ${project.status === 'failed' && project.error ? `
                <div style="margin-top: 8px; padding: 8px; background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3); border-radius: 6px;">
                    <p style="color: #f87171; font-size: 0.8rem; margin: 0;">
                        ⚠️ ${project.error}
                    </p>
                </div>
            ` : ''}
            ${currentUser && !selectMode ? `
                <div class="project-visibility">
                    <span style="color: ${visibilityColor}; font-size: 0.85rem;">
                        ${visibilityIcon} ${visibilityText}
                    </span>
                    <button class="visibility-toggle-btn" data-project-id="${project.id}" data-is-public="${isPublic}">
                        ${isPublic ? 'Make Private' : 'Make Public'}
                    </button>
                </div>
                <div class="project-actions" style="margin-top: 10px; display: flex; gap: 10px;">
                    ${project.status === 'processing' || project.status === 'queued' ? `
                        <button class="cancel-job-btn" data-project-id="${project.id}" style="flex: 1; padding: 8px; background: rgba(248, 113, 113, 0.2); border: 1px solid #f87171; color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem;">
                            ⏹ Cancel Job
                        </button>
                    ` : ''}
                    <button class="delete-project-btn" data-project-id="${project.id}" style="flex: 1; padding: 8px; background: rgba(248, 113, 113, 0.2); border: 1px solid #f87171; color: #f87171; border-radius: 8px; cursor: pointer; font-size: 0.85rem;">
                        🗑 Delete
                    </button>
                </div>
            ` : ''}
            ${tags.length > 0 ? `
                <div class="project-tags">
                    ${tags.map(tag => `<span class="project-tag">${tag}</span>`).join('')}
                </div>
            ` : ''}
        `;

        // Add click handler for completed projects
        const thumbnail = card.querySelector('.project-thumbnail');
        if (project.status === 'completed' && project.modelUrl && thumbnail) {
            thumbnail.style.cursor = 'pointer';
            thumbnail.addEventListener('click', () => {
                loadModelInViewer(project.modelUrl);
                document.querySelector('[data-tab="viewer"]').click();
            });
        }

        // Add visibility toggle handler
        const toggleBtn = card.querySelector('.visibility-toggle-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await toggleProjectVisibility(project.id, !isPublic);
            });
        }

        // Add delete button handler
        const deleteBtn = card.querySelector('.delete-project-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await deleteProject(project.id, projectName);
            });
        }

        // Add cancel job button handler
        const cancelBtn = card.querySelector('.cancel-job-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await cancelJob(project.id, projectName);
            });
        }

        // Add checkbox handler for bulk selection
        const checkbox = card.querySelector('input[type="checkbox"]');
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                toggleProjectSelection(project.id);
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

    // Bulk selection mode
    const toggleSelectBtn = document.getElementById('toggle-select-mode');
    toggleSelectBtn?.addEventListener('click', toggleSelectMode);

    const cancelSelectBtn = document.getElementById('cancel-select-mode');
    cancelSelectBtn?.addEventListener('click', exitSelectMode);

    const bulkDeleteBtn = document.getElementById('bulk-delete-btn');
    bulkDeleteBtn?.addEventListener('click', bulkDeleteProjects);
}

function toggleSelectMode() {
    selectMode = !selectMode;
    selectedProjects.clear();
    updateBulkActionsBar();
    loadProjects(); // Reload to show/hide checkboxes
}

function exitSelectMode() {
    selectMode = false;
    selectedProjects.clear();
    updateBulkActionsBar();
    loadProjects();
}

function toggleProjectSelection(projectId) {
    if (selectedProjects.has(projectId)) {
        selectedProjects.delete(projectId);
    } else {
        selectedProjects.add(projectId);
    }
    updateBulkActionsBar();
    updateProjectCheckbox(projectId);
}

function updateProjectCheckbox(projectId) {
    const checkbox = document.querySelector(`input[data-project-id="${projectId}"]`);
    if (checkbox) {
        checkbox.checked = selectedProjects.has(projectId);
    }
}

function updateBulkActionsBar() {
    const bar = document.getElementById('bulk-actions-bar');
    const count = document.getElementById('selected-count');
    const toggleBtn = document.getElementById('toggle-select-mode');

    if (selectMode) {
        bar.style.display = 'block';
        count.textContent = `${selectedProjects.size} project${selectedProjects.size !== 1 ? 's' : ''} selected`;
        toggleBtn.textContent = 'Exit Select Mode';
    } else {
        bar.style.display = 'none';
        toggleBtn.textContent = 'Select Multiple';
    }
}

async function bulkDeleteProjects() {
    if (selectedProjects.size === 0) {
        showStatus('No projects selected', 'error');
        return;
    }

    const count = selectedProjects.size;
    if (!confirm(`Are you sure you want to delete ${count} project${count !== 1 ? 's' : ''}?\n\nThis will permanently delete:\n- All uploaded photos\n- All 3D models\n- All project data\n\nThis action cannot be undone!`)) {
        return;
    }

    try {
        showStatus(`Deleting ${count} projects...`, 'info');

        const projectIds = Array.from(selectedProjects);
        let successCount = 0;
        let failCount = 0;

        for (const projectId of projectIds) {
            try {
                // Delete from server
                const response = await fetch(`${API_ENDPOINT}/projects/${projectId}`, {
                    method: 'DELETE',
                    credentials: 'include',
                });

                if (!response.ok) {
                    throw new Error('Server delete failed');
                }

                // Delete from IndexedDB
                await db.delete('projects', projectId);

                // Delete associated photos
                const tx = db.transaction(['photos'], 'readwrite');
                const photoStore = tx.objectStore('photos');
                const index = photoStore.index('projectId');
                const photosToDelete = await index.getAllKeys(projectId);

                for (const key of photosToDelete) {
                    await photoStore.delete(key);
                }
                await tx.done;

                successCount++;
            } catch (error) {
                console.error(`Failed to delete project ${projectId}:`, error);
                failCount++;
            }
        }

        // Exit select mode and reload
        selectedProjects.clear();
        exitSelectMode();
        await loadProjects();

        if (failCount === 0) {
            showStatus(`Successfully deleted ${successCount} project${successCount !== 1 ? 's' : ''}`, 'success');
        } else {
            showStatus(`Deleted ${successCount} projects, ${failCount} failed`, 'error');
        }

    } catch (error) {
        console.error('Bulk delete error:', error);
        showStatus('Bulk delete failed', 'error');
    }
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

// Cloud Sync Functions

/**
 * Sync a single project to the cloud
 */
async function syncProjectToCloud(project) {
    if (!currentUser) {
        console.log('User not authenticated, skipping cloud sync');
        return;
    }

    try {
        // Prepare project data for cloud (convert camelCase to snake_case)
        const cloudProject = {
            id: project.serverId || project.id,
            name: project.name,
            status: project.status,
            photo_count: project.photoCount || 0,
            tags: project.tags,
            is_public: project.isPublic || false,
            created_at: project.createdAt,
            completed_at: project.completedAt || null,
            model_url: project.modelUrl || null,
            error: project.error || null,
            updated_at: project.updatedAt || Date.now()
        };

        const response = await fetch(`${API_ENDPOINT}/projects/sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify(cloudProject)
        });

        if (response.status === 409) {
            // Conflict - cloud version is newer
            const data = await response.json();
            console.log('Conflict detected:', data.message);
            // For now, accept cloud version
            if (data.cloudProject) {
                await updateProjectFromCloud(data.cloudProject);
            }
            return;
        }

        if (!response.ok) {
            throw new Error('Sync failed: ' + response.statusText);
        }

        const result = await response.json();

        // Update local project with sync info
        const updatedProject = {
            ...project,
            serverId: result.project.id,
            syncedAt: result.synced_at
        };

        await db.put('projects', updatedProject);
        console.log('Project synced to cloud:', result.project.id);

    } catch (error) {
        console.error('Error syncing project to cloud:', error);
        throw error;
    }
}

/**
 * Sync all local projects to the cloud
 */
async function syncAllProjectsToCloud() {
    if (!currentUser) {
        console.log('User not authenticated, skipping cloud sync');
        return;
    }

    try {
        const projects = await db.getAll('projects');

        for (const project of projects) {
            try {
                await syncProjectToCloud(project);
            } catch (error) {
                console.error('Failed to sync project:', project.id, error);
                // Continue with next project
            }
        }

        console.log('All projects synced to cloud');
    } catch (error) {
        console.error('Error syncing projects to cloud:', error);
    }
}

/**
 * Sync projects from cloud to local IndexedDB
 */
async function syncProjectsFromCloud() {
    if (!currentUser) {
        console.log('User not authenticated, skipping cloud sync');
        return;
    }

    try {
        const response = await fetch(`${API_ENDPOINT}/projects`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to fetch projects from cloud');
        }

        const data = await response.json();
        const cloudProjects = data.projects || [];

        for (const cloudProject of cloudProjects) {
            await updateProjectFromCloud(cloudProject);
        }

        console.log('Projects synced from cloud:', cloudProjects.length);
        return cloudProjects.length;

    } catch (error) {
        console.error('Error syncing projects from cloud:', error);
        throw error;
    }
}

/**
 * Update local project from cloud data
 */
async function updateProjectFromCloud(cloudProject) {
    // Convert snake_case to camelCase
    const localProject = {
        id: cloudProject.id,
        serverId: cloudProject.id,
        name: cloudProject.name,
        status: cloudProject.status,
        photoCount: cloudProject.photo_count,
        tags: cloudProject.tags,
        isPublic: cloudProject.is_public === 1,
        createdAt: cloudProject.created_at,
        completedAt: cloudProject.completed_at,
        updatedAt: cloudProject.updated_at || cloudProject.created_at,
        modelUrl: cloudProject.model_url,
        error: cloudProject.error,
        syncedAt: Date.now()
    };

    // Check if project exists locally
    const existingProject = await db.get('projects', cloudProject.id);

    if (existingProject) {
        // Merge with existing, prefer newer updatedAt
        const existingUpdated = existingProject.updatedAt || existingProject.createdAt;
        const cloudUpdated = localProject.updatedAt;

        if (cloudUpdated >= existingUpdated) {
            // Cloud version is newer or equal, update local
            await db.put('projects', { ...existingProject, ...localProject });
        }
        // If local is newer, keep local (it will sync to cloud later)
    } else {
        // New project from cloud, add to local
        await db.put('projects', localProject);
    }
}

/**
 * Full two-way sync
 */
async function performFullSync() {
    if (!currentUser) {
        console.log('User not authenticated, skipping sync');
        return { synced: 0, message: 'Not authenticated' };
    }

    try {
        showStatus('Syncing projects...', 'info');

        // First sync from cloud (to get any updates)
        const cloudCount = await syncProjectsFromCloud();

        // Then sync local changes to cloud
        await syncAllProjectsToCloud();

        showStatus(`Synced ${cloudCount} projects from cloud`, 'success');
        return { synced: cloudCount, message: 'Sync complete' };

    } catch (error) {
        console.error('Full sync error:', error);
        showStatus('Sync failed: ' + error.message, 'error');
        throw error;
    }
}

/**
 * Toggle project visibility (public/private)
 */
async function toggleProjectVisibility(projectId, makePublic) {
    if (!currentUser) {
        showStatus('Please log in to change project visibility', 'error');
        return;
    }

    try {
        // Update local project
        const project = await db.get('projects', projectId);
        if (!project) {
            showStatus('Project not found', 'error');
            return;
        }

        const updatedProject = {
            ...project,
            isPublic: makePublic,
            updatedAt: Date.now()
        };

        await db.put('projects', updatedProject);

        // Sync to cloud
        await syncProjectToCloud(updatedProject);

        // Reload projects to show updated state
        await loadProjects();

        showStatus(`Project is now ${makePublic ? 'public' : 'private'}`, 'success');

    } catch (error) {
        console.error('Error toggling visibility:', error);
        showStatus('Failed to update project visibility', 'error');
    }
}

/**
 * Delete a project
 */
async function deleteProject(projectId, projectName) {
    if (!currentUser) {
        showStatus('Please log in to delete projects', 'error');
        return;
    }

    // Confirmation dialog
    if (!confirm(`Are you sure you want to delete "${projectName}"?\n\nThis will permanently delete:\n- All uploaded photos\n- The 3D model\n- All project data\n\nThis action cannot be undone!`)) {
        return;
    }

    try {
        showStatus('Deleting project...', 'info');

        // Delete from server
        const response = await fetch(`${API_ENDPOINT}/projects/${projectId}`, {
            method: 'DELETE',
            credentials: 'include',
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete project');
        }

        // Delete from IndexedDB
        await db.delete('projects', projectId);

        // Delete associated photos
        const tx = db.transaction(['photos'], 'readwrite');
        const photoStore = tx.objectStore('photos');
        const index = photoStore.index('projectId');
        const photosToDelete = await index.getAllKeys(projectId);

        for (const key of photosToDelete) {
            await photoStore.delete(key);
        }
        await tx.done;

        // Reload projects
        await loadProjects();

        showStatus('Project deleted successfully', 'success');

    } catch (error) {
        console.error('Error deleting project:', error);
        showStatus(error.message || 'Failed to delete project', 'error');
    }
}

/**
 * Cancel a running or queued job
 */
async function cancelJob(projectId, projectName) {
    if (!currentUser) {
        showStatus('Please log in to cancel jobs', 'error');
        return;
    }

    // Confirmation dialog
    if (!confirm(`Cancel processing for "${projectName}"?\n\nAny credits used will be refunded.`)) {
        return;
    }

    try {
        showStatus('Cancelling job...', 'info');

        // Get project to find job ID
        const project = await db.get('projects', projectId);
        if (!project) {
            throw new Error('Project not found');
        }

        // Find the active job for this project
        const jobsResponse = await fetch(`${API_ENDPOINT}/projects/${projectId}`, {
            credentials: 'include',
        });

        if (!jobsResponse.ok) {
            throw new Error('Failed to get project details');
        }

        const projectData = await jobsResponse.json();

        // Find job ID - we'll need to store this in the project when we create it
        // For now, we'll use a best-effort approach
        let jobId = project.jobId; // Assuming we store this

        if (!jobId) {
            // Try to find the job through the status API - we need to enhance this
            throw new Error('Job ID not found. Please try again.');
        }

        // Cancel the job
        const response = await fetch(`${API_ENDPOINT}/jobs/${jobId}/cancel`, {
            method: 'POST',
            credentials: 'include',
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to cancel job');
        }

        const result = await response.json();

        // Update local project status
        const updatedProject = {
            ...project,
            status: 'failed',
            error: 'Cancelled by user',
            updatedAt: Date.now()
        };

        await db.put('projects', updatedProject);

        // Reload projects
        await loadProjects();

        const creditsMsg = result.creditsRefunded > 0 ? ` (${result.creditsRefunded} credits refunded)` : '';
        showStatus(`Job cancelled successfully${creditsMsg}`, 'success');

        // Reload balance if credits were refunded
        if (result.creditsRefunded > 0 && currentUser) {
            loadBalance();
        }

    } catch (error) {
        console.error('Error cancelling job:', error);
        showStatus(error.message || 'Failed to cancel job', 'error');
    }
}

// Authentication functions
async function checkAuth() {
    try {
        const response = await fetch(`${API_ENDPOINT}/auth/me`, {
            credentials: 'include',
        });

        if (response.ok) {
            const data = await response.json();
            const wasLoggedOut = !currentUser;
            currentUser = data.user;
            updateAuthUI();

            // Trigger cloud sync when user logs in
            if (wasLoggedOut && currentUser) {
                performFullSync().catch(err => {
                    console.error('Auto-sync failed:', err);
                });
            }
        } else {
            currentUser = null;
            updateAuthUI();
        }
    } catch (error) {
        console.error('Auth check error:', error);
        currentUser = null;
        updateAuthUI();
    }
}

function updateAuthUI() {
    const authButtons = document.getElementById('auth-buttons');
    const userProfile = document.getElementById('user-profile');

    if (currentUser) {
        // Show user profile
        authButtons.style.display = 'none';
        userProfile.style.display = 'flex';

        document.getElementById('user-avatar').src = currentUser.avatar_url;
        document.getElementById('user-name').textContent = currentUser.name;
        document.getElementById('user-email').textContent = currentUser.email;
    } else {
        // Show login buttons
        authButtons.style.display = 'flex';
        userProfile.style.display = 'none';
    }
}

async function handleGoogleLogin() {
    try {
        const response = await fetch(`${API_ENDPOINT}/auth/google`, {
            credentials: 'include',
        });
        const data = await response.json();

        if (data.authUrl) {
            // Store state for CSRF protection
            sessionStorage.setItem('oauth_state', data.state);
            // Redirect to Google OAuth
            window.location.href = data.authUrl;
        }
    } catch (error) {
        console.error('Google login error:', error);
        showStatus('Failed to initiate Google login', 'error');
    }
}

async function handleGitHubLogin() {
    try {
        const response = await fetch(`${API_ENDPOINT}/auth/github`, {
            credentials: 'include',
        });
        const data = await response.json();

        if (data.authUrl) {
            // Store state for CSRF protection
            sessionStorage.setItem('oauth_state', data.state);
            // Redirect to GitHub OAuth
            window.location.href = data.authUrl;
        }
    } catch (error) {
        console.error('GitHub login error:', error);
        showStatus('Failed to initiate GitHub login', 'error');
    }
}

async function handleLogout() {
    try {
        await fetch(`${API_ENDPOINT}/auth/logout`, {
            method: 'POST',
            credentials: 'include',
        });

        currentUser = null;
        updateAuthUI();
        showStatus('Logged out successfully', 'success');
    } catch (error) {
        console.error('Logout error:', error);
        showStatus('Logout failed', 'error');
    }
}

function setupAuth() {
    document.getElementById('google-login').addEventListener('click', handleGoogleLogin);
    document.getElementById('github-login').addEventListener('click', handleGitHubLogin);
    document.getElementById('logout-btn').addEventListener('click', handleLogout);

    // Check for auth success/error in URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
        showStatus('Successfully logged in!', 'success');
        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
        // Reload auth status
        checkAuth();
    } else if (params.get('error') === 'auth_failed') {
        showStatus('Authentication failed. Please try again.', 'error');
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

// ===== BILLING & PAYMENTS =====

let stripe = null;
let cardElement = null;
let currentPackage = null;
let userBalance = { credits: 0, subscriptionTier: 'free' };

/**
 * Initialize Stripe
 */
async function initStripe() {
    try {
        // Stripe will be initialized when needed with publishable key from server
        console.log('Stripe ready to initialize');
    } catch (error) {
        console.error('Stripe initialization error:', error);
    }
}

/**
 * Load user's credit balance
 */
async function loadCreditBalance() {
    try {
        const response = await fetch(`${API_ENDPOINT}/billing/balance`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            userBalance = {
                credits: data.credits || 0,
                creditsUsed: data.creditsUsed || 0,
                subscriptionTier: data.subscriptionTier || 'free',
                subscriptionStatus: data.subscriptionStatus
            };

            // Update UI
            const creditAmount = document.getElementById('credit-amount');
            const modalCreditBalance = document.getElementById('modal-credit-balance');
            const userTier = document.getElementById('user-tier');

            if (creditAmount) creditAmount.textContent = userBalance.credits.toLocaleString();
            if (modalCreditBalance) modalCreditBalance.textContent = userBalance.credits.toLocaleString();

            if (userTier) {
                userTier.textContent = userBalance.subscriptionTier.charAt(0).toUpperCase() + userBalance.subscriptionTier.slice(1) + ' Tier';
                userTier.className = `balance-tier ${userBalance.subscriptionTier}`;
            }

            return userBalance;
        }
    } catch (error) {
        console.error('Failed to load credit balance:', error);
    }

    return userBalance;
}

/**
 * Load credit packages
 */
async function loadCreditPackages() {
    try {
        const response = await fetch(`${API_ENDPOINT}/billing/packages`);
        if (!response.ok) throw new Error('Failed to load packages');

        const data = await response.json();
        const packagesGrid = document.getElementById('packages-grid');

        if (!packagesGrid) return;

        packagesGrid.innerHTML = data.packages.map(pkg => `
            <div class="package-card ${pkg.popular ? 'popular' : ''}" data-package-id="${pkg.id}">
                <div class="package-name">${pkg.name}</div>
                <div class="package-credits">${(pkg.credits + pkg.bonus_credits).toLocaleString()}</div>
                <div class="package-price">$${(pkg.price_cents / 100).toFixed(2)}</div>
                ${pkg.bonus_credits > 0 ? `
                    <div class="package-bonus">+${pkg.bonus_credits} Bonus Credits!</div>
                ` : ''}
            </div>
        `).join('');

        // Add click handlers
        packagesGrid.querySelectorAll('.package-card').forEach(card => {
            card.addEventListener('click', () => {
                const packageId = card.dataset.packageId;
                const pkg = data.packages.find(p => p.id === packageId);
                if (pkg) selectPackage(pkg);
            });
        });

    } catch (error) {
        console.error('Failed to load credit packages:', error);
        showStatus('Failed to load credit packages', 'error');
    }
}

/**
 * Select a credit package for purchase
 */
async function selectPackage(pkg) {
    currentPackage = pkg;

    // Update payment modal
    document.getElementById('payment-package-name').textContent = pkg.name;
    document.getElementById('payment-credits').textContent = `${(pkg.credits + pkg.bonus_credits).toLocaleString()} credits`;
    document.getElementById('payment-amount').textContent = `$${(pkg.price_cents / 100).toFixed(2)}`;

    // Create payment intent
    try {
        showStatus('Preparing payment...', 'info');

        const response = await fetch(`${API_ENDPOINT}/billing/purchase`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ packageId: pkg.id })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create payment intent');
        }

        const { clientSecret, publishableKey } = await response.json();

        // Initialize Stripe if not already done
        if (!stripe) {
            stripe = Stripe(publishableKey);
            const elements = stripe.elements();
            cardElement = elements.create('card', {
                style: {
                    base: {
                        color: '#fff',
                        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
                        fontSmoothing: 'antialiased',
                        fontSize: '16px',
                        '::placeholder': {
                            color: '#a8b2d1'
                        }
                    },
                    invalid: {
                        color: '#f87171',
                        iconColor: '#f87171'
                    }
                }
            });
            cardElement.mount('#card-element');

            // Handle real-time validation errors
            cardElement.on('change', (event) => {
                const displayError = document.getElementById('card-errors');
                if (event.error) {
                    displayError.textContent = event.error.message;
                } else {
                    displayError.textContent = '';
                }
            });
        }

        // Store client secret for payment
        currentPackage.clientSecret = clientSecret;

        // Show payment modal
        document.getElementById('billing-modal').classList.remove('active');
        document.getElementById('payment-modal').classList.add('active');

    } catch (error) {
        console.error('Payment preparation error:', error);
        showStatus(error.message, 'error');
    }
}

/**
 * Process payment
 */
async function processPayment(event) {
    event.preventDefault();

    if (!stripe || !cardElement || !currentPackage) {
        showStatus('Payment system not ready', 'error');
        return;
    }

    const submitButton = document.getElementById('submit-payment');
    const buttonText = document.getElementById('payment-button-text');
    const spinner = document.getElementById('payment-spinner');

    submitButton.disabled = true;
    buttonText.style.display = 'none';
    spinner.style.display = 'inline';

    try {
        const { error, paymentIntent } = await stripe.confirmCardPayment(currentPackage.clientSecret, {
            payment_method: {
                card: cardElement
            }
        });

        if (error) {
            throw new Error(error.message);
        }

        if (paymentIntent.status === 'succeeded') {
            showStatus('Payment successful! Credits will be added shortly.', 'success');

            // Close payment modal
            document.getElementById('payment-modal').classList.remove('active');

            // Reload balance after a short delay
            setTimeout(async () => {
                await loadCreditBalance();
                await loadTransactionHistory();
                showStatus(`${currentPackage.credits + currentPackage.bonus_credits} credits added to your account!`, 'success');
            }, 2000);

            currentPackage = null;
        }

    } catch (error) {
        console.error('Payment error:', error);
        showStatus(`Payment failed: ${error.message}`, 'error');
    } finally {
        submitButton.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
    }
}

/**
 * Load transaction history
 */
async function loadTransactionHistory() {
    try {
        const response = await fetch(`${API_ENDPOINT}/billing/history`, {
            credentials: 'include'
        });

        if (!response.ok) throw new Error('Failed to load transaction history');

        const data = await response.json();
        const transactionList = document.getElementById('transaction-list');

        if (!transactionList) return;

        if (!data.transactions || data.transactions.length === 0) {
            transactionList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📜</div>
                    <p>No transactions yet</p>
                </div>
            `;
            return;
        }

        transactionList.innerHTML = data.transactions.map(tx => {
            const date = new Date(tx.created_at);
            const isPositive = tx.amount > 0;

            return `
                <div class="transaction-item">
                    <div class="transaction-info">
                        <div class="transaction-description">${tx.description}</div>
                        <div class="transaction-date">${date.toLocaleDateString()} ${date.toLocaleTimeString()}</div>
                    </div>
                    <div class="transaction-amount ${isPositive ? 'positive' : 'negative'}">
                        ${isPositive ? '+' : ''}${tx.amount.toLocaleString()} credits
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Failed to load transaction history:', error);
    }
}

/**
 * Setup billing modal
 */
function setupBillingModal() {
    const creditBalance = document.getElementById('credit-balance');
    const billingModal = document.getElementById('billing-modal');
    const paymentModal = document.getElementById('payment-modal');
    const closeBillingBtn = document.getElementById('close-billing-modal');
    const closePaymentBtn = document.getElementById('close-payment-modal');
    const paymentForm = document.getElementById('payment-form');

    // Open billing modal
    if (creditBalance) {
        creditBalance.addEventListener('click', () => {
            billingModal.classList.add('active');
            loadCreditPackages();
            loadTransactionHistory();
        });
    }

    // Close modals
    if (closeBillingBtn) {
        closeBillingBtn.addEventListener('click', () => {
            billingModal.classList.remove('active');
        });
    }

    if (closePaymentBtn) {
        closePaymentBtn.addEventListener('click', () => {
            paymentModal.classList.remove('active');
            billingModal.classList.add('active');
        });
    }

    // Close on overlay click
    billingModal?.addEventListener('click', (e) => {
        if (e.target === billingModal) {
            billingModal.classList.remove('active');
        }
    });

    paymentModal?.addEventListener('click', (e) => {
        if (e.target === paymentModal) {
            paymentModal.classList.remove('active');
        }
    });

    // Billing tabs
    document.querySelectorAll('.billing-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.billing-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.billing-tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const tabName = tab.dataset.billingTab;
            document.getElementById(tabName)?.classList.add('active');

            // Load data for specific tabs
            if (tabName === 'buy-credits') {
                loadCreditPackages();
            } else if (tabName === 'history') {
                loadTransactionHistory();
            }
        });
    });

    // Payment form submit
    if (paymentForm) {
        paymentForm.addEventListener('submit', processPayment);
    }

    // Subscription buttons
    const subscribeProBtn = document.getElementById('subscribe-pro');
    const subscribeEnterpriseBtn = document.getElementById('subscribe-enterprise');
    const cancelSubscriptionBtn = document.getElementById('cancel-subscription');

    if (subscribeProBtn) {
        subscribeProBtn.addEventListener('click', () => handleSubscription('pro_monthly'));
    }

    if (subscribeEnterpriseBtn) {
        subscribeEnterpriseBtn.addEventListener('click', () => handleSubscription('enterprise_monthly'));
    }

    if (cancelSubscriptionBtn) {
        cancelSubscriptionBtn.addEventListener('click', handleCancelSubscription);
    }
}

/**
 * Handle subscription
 */
async function handleSubscription(planId) {
    try {
        showStatus('Creating subscription...', 'info');

        const response = await fetch(`${API_ENDPOINT}/billing/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ planId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create subscription');
        }

        const { clientSecret } = await response.json();

        if (clientSecret) {
            // Initialize Stripe if needed and confirm payment
            if (!stripe) {
                const packagesResponse = await fetch(`${API_ENDPOINT}/billing/packages`);
                const { publishableKey } = await packagesResponse.json();
                stripe = Stripe(publishableKey);
            }

            // Redirect to Stripe checkout or confirm payment
            showStatus('Redirecting to payment...', 'info');
            // Implementation depends on Stripe subscription flow
        } else {
            showStatus('Subscription created successfully!', 'success');
            await loadCreditBalance();
        }

    } catch (error) {
        console.error('Subscription error:', error);
        showStatus(`Subscription failed: ${error.message}`, 'error');
    }
}

/**
 * Handle subscription cancellation
 */
async function handleCancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription? Your benefits will continue until the end of the billing period.')) {
        return;
    }

    try {
        showStatus('Canceling subscription...', 'info');

        const response = await fetch(`${API_ENDPOINT}/billing/cancel-subscription`, {
            method: 'POST',
            credentials: 'include'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to cancel subscription');
        }

        showStatus('Subscription canceled successfully', 'success');
        await loadCreditBalance();

    } catch (error) {
        console.error('Cancel subscription error:', error);
        showStatus(`Failed to cancel subscription: ${error.message}`, 'error');
    }
}

/**
 * Update insufficient credits UI
 */
function showInsufficientCreditsModal(needed, balance) {
    showStatus(`Insufficient credits. You need ${needed} credits but have ${balance}. Click the balance to buy more credits.`, 'error');

    // Highlight credit balance
    const creditBalance = document.getElementById('credit-balance');
    if (creditBalance) {
        creditBalance.style.animation = 'pulse 1s ease-in-out 3';
        setTimeout(() => {
            creditBalance.style.animation = '';
        }, 3000);
    }
}

// ===== VIEWER ENHANCEMENTS =====

let currentModel = null;

/**
 * Update model information display
 */
function updateModelInfo() {
    if (!currentModel) return;

    document.getElementById('info-quality').textContent = currentModel.quality;
    document.getElementById('info-photos').textContent = currentModel.photoCount || '-';

    if (currentModel.processingTime) {
        const minutes = Math.floor(currentModel.processingTime / 60);
        const seconds = currentModel.processingTime % 60;
        document.getElementById('info-time').textContent = `${minutes}m ${seconds}s`;
    } else {
        document.getElementById('info-time').textContent = '-';
    }

    document.getElementById('info-credits').textContent = currentModel.credits || '-';

    if (currentModel.fileSize) {
        const sizeMB = (currentModel.fileSize / (1024 * 1024)).toFixed(2);
        document.getElementById('info-size').textContent = `${sizeMB} MB`;
    } else {
        document.getElementById('info-size').textContent = '-';
    }

    const date = new Date(currentModel.createdAt);
    document.getElementById('info-date').textContent = date.toLocaleDateString();
}

/**
 * Download model file
 */
async function downloadModel() {
    if (!currentModel || !currentModel.url) {
        showStatus('No model loaded', 'error');
        return;
    }

    try {
        showStatus('Preparing download...', 'info');

        // Create download link
        const a = document.createElement('a');
        a.href = currentModel.url;
        a.download = `splat-${currentModel.projectId || Date.now()}.ply`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        showStatus('Download started!', 'success');
    } catch (error) {
        console.error('Download error:', error);
        showStatus('Download failed', 'error');
    }
}

/**
 * Generate and show share modal
 */
function openShareModal() {
    if (!currentModel || !currentModel.projectId) {
        showStatus('No model loaded', 'error');
        return;
    }

    const modal = document.getElementById('share-modal');
    const shareLink = document.getElementById('share-link');
    const embedCode = document.getElementById('embed-code-display');

    // Generate share URL
    const shareUrl = `${window.location.origin}/share/${currentModel.projectId}`;
    shareLink.value = shareUrl;

    // Generate embed code
    const embedCodeText = `<iframe src="${shareUrl}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`;
    embedCode.textContent = embedCodeText;

    // Show modal
    modal.classList.add('active');
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text, successMessage = 'Copied to clipboard!') {
    try {
        await navigator.clipboard.writeText(text);
        showStatus(successMessage, 'success');
    } catch (error) {
        console.error('Copy failed:', error);
        showStatus('Failed to copy', 'error');
    }
}

/**
 * Capture screenshot from viewer
 */
async function captureScreenshot() {
    if (!currentModel) {
        showStatus('No model loaded', 'error');
        return;
    }

    try {
        showStatus('Capturing screenshot...', 'info');

        // Alternative: Open in new window for screenshot
        const newWindow = window.open(currentModel.url, '_blank', 'width=800,height=600');

        if (newWindow) {
            showStatus('Model opened in new window. Use browser screenshot tool (usually Ctrl+Shift+S or Cmd+Shift+4)', 'info');
        } else {
            showStatus('Popup blocked. Please allow popups for screenshots.', 'error');
        }

    } catch (error) {
        console.error('Screenshot error:', error);
        showStatus('Screenshot failed', 'error');
    }
}

/**
 * Toggle fullscreen mode
 */
function toggleFullscreen() {
    const container = document.getElementById('viewer-container');

    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            console.error('Fullscreen error:', err);
            showStatus('Fullscreen not supported', 'error');
        });
    } else {
        document.exitFullscreen();
    }
}

/**
 * Toggle model info panel
 */
function toggleModelInfo() {
    const infoPanel = document.getElementById('viewer-info');
    infoPanel.classList.toggle('active');
}

/**
 * Share on social media
 */
function shareOnSocial(platform) {
    if (!currentModel || !currentModel.projectId) {
        showStatus('No model loaded', 'error');
        return;
    }

    const shareUrl = encodeURIComponent(`${window.location.origin}/share/${currentModel.projectId}`);
    const text = encodeURIComponent('Check out this 3D model I created with Splat App!');

    let url;

    switch (platform) {
        case 'twitter':
            url = `https://twitter.com/intent/tweet?text=${text}&url=${shareUrl}`;
            break;
        case 'facebook':
            url = `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`;
            break;
        case 'linkedin':
            url = `https://www.linkedin.com/sharing/share-offsite/?url=${shareUrl}`;
            break;
        case 'reddit':
            url = `https://reddit.com/submit?url=${shareUrl}&title=${text}`;
            break;
        default:
            return;
    }

    window.open(url, '_blank', 'width=600,height=400');
}

/**
 * Setup viewer controls
 */
function setupViewerControls() {
    // Download button
    const downloadBtn = document.getElementById('download-model-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', downloadModel);
    }

    // Share button
    const shareBtn = document.getElementById('share-model-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', openShareModal);
    }

    // Embed code button (also opens share modal)
    const embedBtn = document.getElementById('embed-code-btn');
    if (embedBtn) {
        embedBtn.addEventListener('click', openShareModal);
    }

    // Screenshot button
    const screenshotBtn = document.getElementById('screenshot-btn');
    if (screenshotBtn) {
        screenshotBtn.addEventListener('click', captureScreenshot);
    }

    // Fullscreen button
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', toggleFullscreen);
    }

    // Model info button
    const infoBtn = document.getElementById('model-info-btn');
    if (infoBtn) {
        infoBtn.addEventListener('click', toggleModelInfo);
    }

    // Share modal close
    const closeShareModal = document.getElementById('close-share-modal');
    if (closeShareModal) {
        closeShareModal.addEventListener('click', () => {
            document.getElementById('share-modal').classList.remove('active');
        });
    }

    // Copy share link
    const copyShareLink = document.getElementById('copy-share-link');
    if (copyShareLink) {
        copyShareLink.addEventListener('click', () => {
            const link = document.getElementById('share-link').value;
            copyToClipboard(link, 'Share link copied!');
        });
    }

    // Copy embed code
    const copyEmbedCode = document.getElementById('copy-embed-code');
    if (copyEmbedCode) {
        copyEmbedCode.addEventListener('click', () => {
            const code = document.getElementById('embed-code-display').textContent;
            copyToClipboard(code, 'Embed code copied!');
        });
    }

    // Social share buttons
    document.getElementById('share-twitter')?.addEventListener('click', () => shareOnSocial('twitter'));
    document.getElementById('share-facebook')?.addEventListener('click', () => shareOnSocial('facebook'));
    document.getElementById('share-linkedin')?.addEventListener('click', () => shareOnSocial('linkedin'));
    document.getElementById('share-reddit')?.addEventListener('click', () => shareOnSocial('reddit'));

    // Close share modal on overlay click
    const shareModal = document.getElementById('share-modal');
    shareModal?.addEventListener('click', (e) => {
        if (e.target === shareModal) {
            shareModal.classList.remove('active');
        }
    });
}

// Initialize app
async function init() {
    await initDB();
    await loadQualityPresets();
    await checkAuth(); // Check authentication status
    setupTabs();
    setupFileUpload();
    setupProjectFilters();
    setupAuth();
    setupBillingModal();
    setupViewerControls();

    // Load credit balance if logged in
    if (currentUser) {
        await loadCreditBalance();
    }

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
