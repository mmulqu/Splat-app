# RunPod Serverless Worker for Gaussian Splatting
# Based on NVIDIA CUDA with Ubuntu 22.04

FROM nvidia/cuda:12.1.0-devel-ubuntu22.04

# Prevent interactive prompts during build
ENV DEBIAN_FRONTEND=noninteractive

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    git \
    wget \
    curl \
    vim \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    imagemagick \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip
RUN python3 -m pip install --upgrade pip

# Install RunPod SDK
RUN pip install runpod requests boto3 Pillow

# Install PyTorch with CUDA support
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# Clone Gaussian Splatting repository
RUN git clone https://github.com/graphdeco-inria/gaussian-splatting.git /workspace/gaussian-splatting

# Set up Gaussian Splatting
WORKDIR /workspace/gaussian-splatting

# Install submodules
RUN git submodule update --init --recursive

# Install Python dependencies for Gaussian Splatting
RUN pip install plyfile tqdm

# Install additional dependencies for COLMAP/SfM
RUN pip install \
    opencv-python \
    scipy \
    numpy \
    scikit-image

# Install diff-gaussian-rasterization
WORKDIR /workspace/gaussian-splatting/submodules/diff-gaussian-rasterization
RUN pip install .

# Install simple-knn
WORKDIR /workspace/gaussian-splatting/submodules/simple-knn
RUN pip install .

# Return to app directory
WORKDIR /app

# Copy handler and utilities
COPY rp_handler.py .
COPY utils.py .
COPY requirements.txt .
COPY test_input.json .

# Install any additional requirements
RUN pip install -r requirements.txt

# Set Python path
ENV PYTHONPATH="/workspace/gaussian-splatting:${PYTHONPATH}"

# Test imports (optional - comment out if builds are slow)
RUN python3 -c "import torch; print(f'PyTorch version: {torch.__version__}'); print(f'CUDA available: {torch.cuda.is_available()}')"

# Start the handler
CMD ["python3", "-u", "rp_handler.py"]
