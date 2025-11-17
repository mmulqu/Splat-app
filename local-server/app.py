#!/usr/bin/env python3
"""
Local Flask API server for Gaussian Splatting
Handles image uploads and triggers GPU processing locally
"""

import os
import json
import uuid
import shutil
import subprocess
import re
from datetime import datetime
from pathlib import Path
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
from PIL import Image
import pillow_heif

app = Flask(__name__, static_folder='../public', static_url_path='')
CORS(app)  # Enable CORS for local development

# Register HEIF opener with PIL
pillow_heif.register_heif_opener()

# Configuration
UPLOAD_FOLDER = Path('/workspace/uploads')
OUTPUT_FOLDER = Path('/workspace/outputs')
VIEWER_FOLDER = Path('/workspace/viewer')  # For uploaded PLY files
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB

# Create necessary directories
UPLOAD_FOLDER.mkdir(parents=True, exist_ok=True)
OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)
VIEWER_FOLDER.mkdir(parents=True, exist_ok=True)

# In-memory job storage (for local testing)
jobs = {}
projects = {}


def allowed_file(filename):
    """Check if file extension is allowed"""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/')
def index():
    """Serve the local upload interface"""
    return send_file('index.html')


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'gpu_available': check_gpu_available(),
        'timestamp': datetime.now().isoformat()
    })


def check_gpu_available():
    """Check if GPU is available"""
    try:
        result = subprocess.run(['nvidia-smi'], capture_output=True, timeout=5)
        return result.returncode == 0
    except:
        return False


@app.route('/api/projects', methods=['POST'])
def create_project():
    """Create a new project"""
    try:
        data = request.get_json() or {}
        project_id = str(uuid.uuid4())

        project = {
            'id': project_id,
            'name': data.get('name', f'Project {project_id[:8]}'),
            'status': 'created',
            'created_at': datetime.now().isoformat(),
            'photo_count': 0,
            'photos': []
        }

        projects[project_id] = project

        # Create project directory
        project_dir = UPLOAD_FOLDER / project_id
        project_dir.mkdir(parents=True, exist_ok=True)

        return jsonify(project), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>/upload', methods=['POST'])
def upload_photos(project_id):
    """Upload photos to a project"""
    try:
        if project_id not in projects:
            return jsonify({'error': 'Project not found'}), 404

        if 'files' not in request.files:
            return jsonify({'error': 'No files provided'}), 400

        files = request.files.getlist('files')
        if not files:
            return jsonify({'error': 'No files provided'}), 400

        project_dir = UPLOAD_FOLDER / project_id / 'photos'
        project_dir.mkdir(parents=True, exist_ok=True)

        uploaded_files = []
        for idx, file in enumerate(files):
            if file and allowed_file(file.filename):
                filename = secure_filename(file.filename)
                file_ext = filename.rsplit('.', 1)[1].lower() if '.' in filename else ''

                # Add index to filename to maintain order
                indexed_filename = f"{idx:03d}_{filename}"

                # Check if HEIC/HEIF file needs conversion
                if file_ext in ['heic', 'heif']:
                    # Convert HEIC to JPEG
                    print(f"Converting HEIC image: {filename}")

                    # Save temporarily
                    temp_path = project_dir / f"temp_{indexed_filename}"
                    file.save(temp_path)

                    try:
                        # Open HEIC and convert to JPEG
                        img = Image.open(temp_path)

                        # Change extension to .jpg
                        jpeg_filename = indexed_filename.rsplit('.', 1)[0] + '.jpg'
                        filepath = project_dir / jpeg_filename

                        # Save as JPEG with high quality
                        img.save(filepath, 'JPEG', quality=95)

                        # Remove temp HEIC file
                        temp_path.unlink()

                        print(f"✓ Converted {filename} to JPEG")

                    except Exception as e:
                        print(f"Error converting HEIC: {e}")
                        # If conversion fails, keep original
                        temp_path.rename(project_dir / indexed_filename)
                        filepath = project_dir / indexed_filename
                else:
                    # Save non-HEIC files directly
                    filepath = project_dir / indexed_filename
                    file.save(filepath)

                uploaded_files.append({
                    'index': idx,
                    'filename': filename,
                    'path': str(filepath),
                    'size': filepath.stat().st_size
                })

        # Update project
        projects[project_id]['photos'].extend(uploaded_files)
        projects[project_id]['photo_count'] = len(projects[project_id]['photos'])
        projects[project_id]['status'] = 'uploaded'

        return jsonify({
            'project_id': project_id,
            'uploaded_count': len(uploaded_files),
            'total_photos': projects[project_id]['photo_count'],
            'files': uploaded_files
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>', methods=['GET'])
def get_project(project_id):
    """Get project details"""
    if project_id not in projects:
        return jsonify({'error': 'Project not found'}), 404

    return jsonify(projects[project_id])


@app.route('/api/projects', methods=['GET'])
def list_projects():
    """List all projects"""
    return jsonify(list(projects.values()))


@app.route('/api/quality-presets', methods=['GET'])
def get_quality_presets():
    """Get quality presets for processing (nerfstudio splatfacto)"""
    presets = {
        'preview': {
            'name': 'Preview',
            'iterations': 7000,
            'description': 'Fast preview quality (~10 minutes)',
        },
        'standard': {
            'name': 'Standard',
            'iterations': 15000,
            'description': 'Recommended quality (~20 minutes)',
        },
        'high': {
            'name': 'High',
            'iterations': 30000,
            'description': 'High quality (default, ~30-40 minutes)',
        },
        'ultra': {
            'name': 'Ultra',
            'iterations': 50000,
            'description': 'Maximum quality (~60-90 minutes)',
        }
    }
    return jsonify(presets)


@app.route('/api/process', methods=['POST'])
def start_processing():
    """Start Gaussian Splatting processing"""
    try:
        data = request.get_json()
        project_id = data.get('project_id')
        quality_preset = data.get('quality', 'standard')
        custom_iterations = data.get('custom_iterations', None)

        if not project_id or project_id not in projects:
            return jsonify({'error': 'Invalid project_id'}), 400

        project = projects[project_id]

        if project['photo_count'] < 5:
            return jsonify({'error': 'At least 5 photos required'}), 400

        # Validate custom iterations if provided
        if custom_iterations is not None:
            if custom_iterations < 1000 or custom_iterations > 100000:
                return jsonify({'error': 'Custom iterations must be between 1,000 and 100,000'}), 400

        # Create job
        job_id = str(uuid.uuid4())
        job = {
            'id': job_id,
            'project_id': project_id,
            'status': 'queued',
            'progress': 0,
            'quality': quality_preset,
            'custom_iterations': custom_iterations,
            'created_at': datetime.now().isoformat(),
            'started_at': None,
            'completed_at': None,
            'error': None,
            'model_url': None
        }

        jobs[job_id] = job
        projects[project_id]['status'] = 'processing'
        projects[project_id]['job_id'] = job_id

        # Start processing in background
        import threading
        thread = threading.Thread(
            target=process_gaussian_splatting,
            args=(job_id, project_id, quality_preset, custom_iterations)
        )
        thread.daemon = True
        thread.start()

        return jsonify(job), 202

    except Exception as e:
        return jsonify({'error': str(e)}), 500


def process_gaussian_splatting(job_id, project_id, quality_preset, custom_iterations=None):
    """Process Gaussian Splatting (runs in background thread)"""
    try:
        job = jobs[job_id]
        job['status'] = 'processing'
        job['started_at'] = datetime.now().isoformat()
        job['progress'] = 10

        # Paths
        input_dir = UPLOAD_FOLDER / project_id / 'photos'
        output_dir = OUTPUT_FOLDER / project_id
        output_dir.mkdir(parents=True, exist_ok=True)

        # Determine iteration count
        if custom_iterations is not None:
            # Use custom iteration count
            iterations = custom_iterations
            print(f"Using custom iteration count: {iterations}")
        else:
            # Get quality parameters from presets (nerfstudio splatfacto)
            presets = {
                'preview': {'iterations': 7000},
                'standard': {'iterations': 15000},
                'high': {'iterations': 30000},
                'ultra': {'iterations': 50000}
            }
            iterations = presets.get(quality_preset, {}).get('iterations', 30000)
            print(f"Using preset '{quality_preset}': {iterations} iterations")

        job['progress'] = 20

        # Run the nerfstudio processing script
        cmd = [
            'python3', '/app/handler.py',
            '--input_dir', str(input_dir),
            '--output_dir', str(output_dir),
            '--iterations', str(iterations)
        ]

        print(f"Starting processing for job {job_id}: {' '.join(cmd)}")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            universal_newlines=True
        )

        # Monitor progress
        for line in process.stdout:
            print(f"[{job_id}] {line.rstrip()}")

            # Parse nerfstudio training output
            # Format: [job_id] 2930 (9.77%)  39.238 ms  17 m, 42 s  18.36 M
            # Pattern: iteration (percentage)  iter_time  eta  rays_per_sec
            training_pattern = r'\[[\w-]+\]\s+(\d+)\s+\(([\d.]+)%\)\s+([\d.]+ ms)\s+((?:\d+ [msh],?\s*)+)\s+([\d.]+ [MK])'
            match = re.search(training_pattern, line)

            if match:
                try:
                    iteration = match.group(1)
                    percentage = float(match.group(2))
                    iter_time = match.group(3)
                    eta = match.group(4).strip()
                    rays_per_sec = match.group(5)

                    # Update job progress (20-90% range for training)
                    job['progress'] = min(20 + int(percentage * 0.7), 90)

                    # Store detailed metrics
                    if 'metrics' not in job:
                        job['metrics'] = {}

                    job['metrics']['iteration'] = f"{iteration}/{iterations}"
                    job['metrics']['percentage'] = f"{percentage:.1f}%"
                    job['metrics']['iter_time'] = iter_time
                    job['metrics']['eta'] = eta
                    job['metrics']['rays_per_sec'] = f"{rays_per_sec} rays/s"

                except Exception as e:
                    print(f"Error parsing training metrics: {e}")

            # Fallback: simple iteration parsing
            elif 'Step' in line or 'iteration' in line.lower():
                try:
                    # Try to find any number that could be an iteration
                    numbers = re.findall(r'\b(\d+)\b', line)
                    if numbers:
                        current = int(numbers[0])
                        if current <= iterations:
                            progress = 20 + int((current / iterations) * 70)
                            job['progress'] = min(progress, 90)
                except:
                    pass

        process.wait()

        if process.returncode == 0:
            # Find output file
            output_file = output_dir / 'point_cloud.ply'
            if output_file.exists():
                job['status'] = 'completed'
                job['progress'] = 100
                job['model_url'] = f'/api/models/{project_id}/point_cloud.ply'
                job['completed_at'] = datetime.now().isoformat()
                projects[project_id]['status'] = 'completed'
                projects[project_id]['model_url'] = job['model_url']
                print(f"Job {job_id} completed successfully")
            else:
                raise Exception('Output file not found')
        else:
            stderr = process.stderr.read()
            raise Exception(f'Processing failed: {stderr}')

    except Exception as e:
        print(f"Job {job_id} failed: {str(e)}")
        job['status'] = 'failed'
        job['error'] = str(e)
        job['completed_at'] = datetime.now().isoformat()
        projects[project_id]['status'] = 'failed'


@app.route('/api/status/<job_id>', methods=['GET'])
def get_job_status(job_id):
    """Get job status"""
    if job_id not in jobs:
        return jsonify({'error': 'Job not found'}), 404

    return jsonify(jobs[job_id])


@app.route('/api/models/<project_id>/<filename>', methods=['GET'])
def download_model(project_id, filename):
    """Download or view processed model"""
    try:
        model_path = OUTPUT_FOLDER / project_id / filename
        if not model_path.exists():
            return jsonify({'error': 'Model not found'}), 404

        # Check if this is a download request or viewer request
        download = request.args.get('download', 'false').lower() == 'true'

        if download:
            # Force download
            return send_file(
                model_path,
                mimetype='application/octet-stream',
                as_attachment=True,
                download_name=filename
            )
        else:
            # Serve for viewer (allow browser to load without forcing download)
            return send_file(
                model_path,
                mimetype='application/octet-stream',
                as_attachment=False
            )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/upload-ply', methods=['POST'])
def upload_ply():
    """Upload a PLY file for immediate viewing"""
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400

        file = request.files['file']
        if not file or file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        # Check if it's a PLY file
        if not file.filename.lower().endswith('.ply'):
            return jsonify({'error': 'Only .ply files are supported'}), 400

        # Generate unique filename
        filename = secure_filename(file.filename)
        unique_id = str(uuid.uuid4())[:8]
        unique_filename = f"{unique_id}_{filename}"

        # Save to viewer folder
        filepath = VIEWER_FOLDER / unique_filename
        file.save(filepath)

        # Return URL for viewing
        return jsonify({
            'success': True,
            'filename': filename,
            'url': f'/api/viewer/{unique_filename}',
            'size': filepath.stat().st_size
        }), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/viewer/<filename>', methods=['GET'])
def serve_viewer_ply(filename):
    """Serve uploaded PLY file for viewing"""
    try:
        file_path = VIEWER_FOLDER / filename
        if not file_path.exists():
            return jsonify({'error': 'File not found'}), 404

        # Check if this is a download request
        download = request.args.get('download', 'false').lower() == 'true'

        if download:
            return send_file(
                file_path,
                mimetype='application/octet-stream',
                as_attachment=True,
                download_name=filename
            )
        else:
            return send_file(
                file_path,
                mimetype='application/octet-stream',
                as_attachment=False
            )
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id):
    """Delete a project and its files"""
    try:
        if project_id not in projects:
            return jsonify({'error': 'Project not found'}), 404

        # Delete files
        project_dir = UPLOAD_FOLDER / project_id
        if project_dir.exists():
            shutil.rmtree(project_dir)

        output_dir = OUTPUT_FOLDER / project_id
        if output_dir.exists():
            shutil.rmtree(output_dir)

        # Delete from memory
        del projects[project_id]

        # Delete associated jobs
        job_id = projects.get(project_id, {}).get('job_id')
        if job_id and job_id in jobs:
            del jobs[job_id]

        return jsonify({'message': 'Project deleted successfully'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Run on all interfaces so it's accessible from host machine
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
