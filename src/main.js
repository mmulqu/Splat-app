import { openDB } from 'idb';

// Configuration
const API_ENDPOINT = import.meta.env.VITE_API_ENDPOINT || '/api';

// IndexedDB setup
let db;

// Quality presets
let qualityPresets = [];
let selectedQuality = 'standard';

async function initDB() {
    db = await openDB('SplatAppDB', 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('projects')) {
                const projectStore = db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
                projectStore.createIndex('createdAt', 'createdAt');
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

function capturePhoto() {
    const video = document.getElementById('camera-stream');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
        const photo = {
            blob,
            url: URL.createObjectURL(blob),
            timestamp: Date.now()
        };

        capturedPhotos.push(photo);
        updatePhotoCount();
        addThumbnail(photo.url);

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

    // Show quality selector when enough photos
    if (capturedPhotos.length >= 5) {
        document.getElementById('quality-selector-capture').style.display = 'block';
        updatePriceEstimate(capturedPhotos.length, 'RTX_4090', selectedQuality);
    } else {
        document.getElementById('quality-selector-capture').style.display = 'none';
    }
}

function addThumbnail(url) {
    const grid = document.getElementById('thumbnail-grid');
    const img = document.createElement('img');
    img.src = url;
    img.className = 'thumbnail';
    grid.appendChild(img);
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

        // Save project to IndexedDB
        await saveProject(result);

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

function handleFiles(files) {
    selectedFiles = files;
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';

    files.forEach(file => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span>${file.name}</span>
            <span>${(file.size / 1024 / 1024).toFixed(2)} MB</span>
        `;
        fileList.appendChild(fileItem);
    });

    // Show quality selector when enough files
    if (files.length >= 5) {
        document.getElementById('quality-selector').style.display = 'block';
        updatePriceEstimate(files.length, 'RTX_4090', selectedQuality);
    } else {
        document.getElementById('quality-selector').style.display = 'none';
    }

    document.getElementById('upload-btn').style.display = files.length > 0 ? 'inline-block' : 'none';
}

async function uploadFiles() {
    if (selectedFiles.length < 5) {
        showStatus('Please select at least 5 images', 'error');
        return;
    }

    const formData = new FormData();
    selectedFiles.forEach(file => {
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
                await saveProject(result);
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

async function saveProject(projectData) {
    const project = {
        ...projectData,
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
    const projects = await db.getAllFromIndex('projects', 'createdAt');

    projectsGrid.innerHTML = '';

    if (projects.length === 0) {
        projectsGrid.innerHTML = '<p style="color: #a8b2d1; text-align: center;">No projects yet. Start by capturing or uploading photos!</p>';
        return;
    }

    projects.reverse().forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        const quality = project.qualityPreset ? `(${project.qualityPreset})` : '';
        card.innerHTML = `
            <div class="project-thumbnail"></div>
            <h3>Project ${project.id}</h3>
            <p style="color: #a8b2d1; font-size: 0.9rem;">
                ${new Date(project.createdAt).toLocaleDateString()} ${quality}
            </p>
            <p style="color: ${project.status === 'completed' ? '#2ecc71' : '#f39c12'}; font-size: 0.9rem;">
                Status: ${project.status}
            </p>
        `;

        if (project.status === 'completed' && project.modelUrl) {
            card.addEventListener('click', () => {
                loadModelInViewer(project.modelUrl);
                document.querySelector('[data-tab="viewer"]').click();
            });
        }

        projectsGrid.appendChild(card);
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
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('Service Worker registered'))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// Initialize app
async function init() {
    await initDB();
    await loadQualityPresets();
    setupTabs();
    setupFileUpload();

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
