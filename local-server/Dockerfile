FROM ghcr.io/nerfstudio-project/nerfstudio:1.1.3

# Switch to root to install packages
USER root

# Install build tools, git, wget, unzip, and Python dev headers
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    git \
    wget \
    unzip \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Flask, dependencies for web server, and Splat/Tiling tools
RUN python3 -m pip install --no-cache-dir \
    Flask==3.0.0 \
    Flask-CORS==4.0.0 \
    Werkzeug==3.0.1 \
    numpy \
    plyfile \
    pygltflib \
    pyproj

# Download and install gsbox binary (Linux AMD64)
# Using the GitHub user-attachments URL from the v4.4.1 release
RUN wget https://github.com/user-attachments/files/23587886/gsbox-amd64-linux-v4.4.1.zip -O /tmp/gsbox.zip && \
    cd /tmp && \
    unzip gsbox.zip && \
    chmod +x gsbox && \
    mv gsbox /usr/local/bin/gsbox && \
    rm gsbox.zip && \
    gsbox -v

# Create necessary directories
RUN mkdir -p /workspace/uploads /workspace/outputs /app

# Clone the splat-3dtiles tool into /app/scripts
RUN git clone https://github.com/gaohualan/splat-3dtiles.git /app/splat-3dtiles

# Set working directory
WORKDIR /app

# Expose ports
EXPOSE 5000 7007

# Default command (will be overridden by docker-compose)
CMD ["python3", "/app/app.py"]
