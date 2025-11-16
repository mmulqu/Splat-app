FROM ghcr.io/nerfstudio-project/nerfstudio:1.1.3

# Switch to root to install packages
USER root

# Install build tools (C compiler) needed for PyTorch compilation
RUN apt-get update && apt-get install -y \
    build-essential \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Flask and dependencies for the web server using python3 -m pip
RUN python3 -m pip install --no-cache-dir \
    Flask==3.0.0 \
    Flask-CORS==4.0.0 \
    Werkzeug==3.0.1

# Create necessary directories
RUN mkdir -p /workspace/uploads /workspace/outputs /app

# Set working directory
WORKDIR /app

# Expose ports
EXPOSE 5000 7007

# Default command (will be overridden by docker-compose)
CMD ["python3", "/app/app.py"]
