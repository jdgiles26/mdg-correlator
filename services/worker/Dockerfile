FROM python:3.11-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# System deps:
#   ffmpeg       — RTSP re-streaming + video inference
#   build-essential / gcc — compile spaCy + other C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        build-essential \
        gcc \
        g++ \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Pre-download the spaCy English model so the container starts without internet
RUN python -m spacy download en_core_web_sm

COPY app /app/app
CMD ["python", "-m", "app.worker"]
