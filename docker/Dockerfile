FROM nvidia/cuda:11.8.0-cudnn8-devel-ubuntu22.04

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive
ENV TORCH_CUDA_ARCH_LIST="7.0 7.5 8.0 8.6 8.9 9.0+PTX"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    wget \
    curl \
    cmake \
    build-essential \
    libboost-program-options-dev \
    libboost-filesystem-dev \
    libboost-graph-dev \
    libboost-system-dev \
    libeigen3-dev \
    libflann-dev \
    libfreeimage-dev \
    libmetis-dev \
    libgoogle-glog-dev \
    libgtest-dev \
    libsqlite3-dev \
    libglew-dev \
    qtbase5-dev \
    libqt5opengl5-dev \
    libcgal-dev \
    libceres-dev \
    python3-pip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages
RUN pip3 install --no-cache-dir \
    torch==2.0.1+cu118 \
    torchvision==0.15.2+cu118 \
    --extra-index-url https://download.pytorch.org/whl/cu118

RUN pip3 install --no-cache-dir \
    tqdm \
    plyfile \
    opencv-python \
    pillow \
    requests \
    numpy \
    scipy

# Install COLMAP
WORKDIR /tmp
RUN git clone https://github.com/colmap/colmap.git && \
    cd colmap && \
    git checkout 3.9.1 && \
    mkdir build && \
    cd build && \
    cmake .. -DCMAKE_CUDA_ARCHITECTURES="70;75;80;86;89;90" && \
    make -j$(nproc) && \
    make install && \
    cd /tmp && \
    rm -rf colmap

# Clone Gaussian Splatting repository
WORKDIR /workspace
RUN git clone https://github.com/graphdeco-inria/gaussian-splatting.git --recursive

WORKDIR /workspace/gaussian-splatting

# Install submodules
RUN pip3 install submodules/diff-gaussian-rasterization
RUN pip3 install submodules/simple-knn

# Create output directory
RUN mkdir -p /workspace/output

# Copy handler script
COPY handler.py /workspace/handler.py

# Set working directory
WORKDIR /workspace

# Default command for local testing
CMD ["python3", "handler.py"]
