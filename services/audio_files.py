"""Small bounded upload decoder using the system FFmpeg binary."""
from __future__ import annotations

import math
import shutil
import subprocess
from pathlib import Path

from .errors import ServiceError
from .youtube import MAX_SECONDS, SAMPLE_RATE, validate_interval

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
ALLOWED_EXTENSIONS = {'.mp3', '.wav', '.m4a'}


def decode_upload(source: Path, output: Path, start: float, end: float) -> dict:
    validate_interval(start, end)
    if shutil.which('ffmpeg') is None:
        raise ServiceError('FFmpeg indisponível no servidor.', status=503)
    try:
        result = subprocess.run([
            'ffmpeg', '-nostdin', '-v', 'error', '-ss', str(start), '-i', str(source),
            '-t', str(end-start), '-vn', '-ac', '1', '-ar', str(SAMPLE_RATE),
            '-c:a', 'pcm_s16le', '-y', str(output),
        ], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ServiceError('A conversão do áudio demorou demais.', status=504) from exc
    if result.returncode or not output.is_file() or output.stat().st_size < 8192:
        raise ServiceError('Não foi possível decodificar o arquivo. Confira se MP3, WAV ou M4A está íntegro.', status=400)
    # Validate actual decoded duration and impose the same bounded clip contract as YouTube.
    import soundfile as sf
    with sf.SoundFile(output) as audio:
        duration = len(audio) / audio.samplerate
    if not math.isfinite(duration) or not 0 < duration <= MAX_SECONDS + .05:
        raise ServiceError('O trecho convertido precisa ter até 45 segundos.', status=400)
    return {'title': source.name[:200], 'duration_seconds': round(duration, 3), 'start_seconds': start, 'end_seconds': end}
