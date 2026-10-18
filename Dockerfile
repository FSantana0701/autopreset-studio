# syntax=docker/dockerfile:1
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=7860 \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 NUMBA_NUM_THREADS=1 MALLOC_ARENA_MAX=2
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY services/ ./services/
COPY src/data/ ./src/data/
RUN chmod -R a+rX /app && useradd --create-home app
USER app
EXPOSE 7860
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860} --workers 1"]
