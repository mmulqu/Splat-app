FROM ghcr.io/nerfstudio-project/nerfstudio:1.1.3

# Switch to root to install packages
USER root

# Install Flask and dependencies for the web server
RUN pip install --no-cache-dir \
    Flask==3.0.0 \
    Flask-CORS==4.0.0 \
    Werkzeug==3.0.1

# Create necessary directories
RUN mkdir -p /workspace/uploads /workspace/outputs /app

# Switch back to the user that nerfstudio expects
USER user

# Set working directory
WORKDIR /app

# Expose ports
EXPOSE 5000 7007

# Default command (will be overridden by docker-compose)
CMD ["python3", "/app/app.py"]
