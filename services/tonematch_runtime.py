"""Bounded media input and process boundary for the optional ToneMatch runtime."""
from __future__ import annotations
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import wave

from services.errors import ServiceError, YouTubeBlocked
from services.youtube import canonical_url, extract_clip, validate_interval
from services.tonematch_mk300 import translate_analysis

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "tools" / "tonematch_mk300_worker.py"
RATE = 44100
MAX_BYTES = RATE * 45 * 2 * 2 + 8192

def validate_reference_interval(start, end):
    validate_interval(start, end)
    if end - start < 8:
        raise ServiceError("ToneMatch precisa de um trecho de 8–45 segundos.", status=400,
                           code="tonematch_interval")

def runtime_python():
    configured = os.environ.get("TONEMATCH_PYTHON")
    candidate = Path(configured) if configured else ROOT / ".tonematch-runtime" / "bin" / "python"
    if not candidate.is_absolute() or not candidate.is_file() or not os.access(candidate, os.X_OK):
        raise ServiceError("Runtime ToneMatch não configurado. Execute tools/setup_tonematch.py.",
                           status=503, code="tonematch_not_configured")
    return str(candidate)

def status():
    try:
        runtime_python()
        configured = True
    except ServiceError:
        configured = False
    return {"engine": "tonematch-mk300", "configured": configured,
            "runtime_dependencies_verified": False, "live_youtube_verified": False,
            "catalog": "v75-owner-confirmed", "v076_hardware_verified": False,
            "min_seconds": 8, "max_seconds": 45}

def decode_reference(source, output, start, end):
    validate_reference_interval(start, end)
    if not shutil.which("ffmpeg"):
        raise ServiceError("FFmpeg indisponível.", status=503)
    command = ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start), "-i", str(source),
               "-t", str(end - start), "-vn", "-ac", "2", "-ar", str(RATE), "-c:a",
               "pcm_s16le", "-fs", str(MAX_BYTES), "-y", str(output)]
    try:
        result = subprocess.run(command, capture_output=True, timeout=60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ServiceError("Conversão excedeu o tempo.", status=504, code="tonematch_decode_timeout") from exc
    except FileNotFoundError as exc:
        raise ServiceError("FFmpeg indisponível.", status=503) from exc
    if result.returncode or not output.is_file() or not 44 < output.stat().st_size <= MAX_BYTES:
        raise ServiceError("Áudio inválido ou incompleto.", status=422, code="tonematch_invalid_audio")
    try:
        with wave.open(str(output)) as audio:
            duration = audio.getnframes() / audio.getframerate()
            valid = audio.getframerate() == RATE and audio.getnchannels() == 2 and audio.getsampwidth() == 2
        if not valid or abs(duration - (end - start)) > .25:
            raise ValueError("Duração incompleta.")
    except (wave.Error, EOFError, ValueError) as exc:
        raise ServiceError("Áudio inválido ou incompleto.", code="tonematch_invalid_audio") from exc
    return {"title": source.name[:200], "start_seconds": start, "end_seconds": end,
            "duration_seconds": duration}

def extract_youtube_reference(url, start, end, work):
    # Reuse the existing canonical URL and source-host validation, with a high-resolution path.
    # The metadata worker is intentionally separate from ToneMatch's browser-cookie fallback.
    validate_reference_interval(start, end)
    url = canonical_url(url)
    metadata = work / "tonematch-source.json"
    try:
        run = subprocess.run([sys.executable, "-m", "services.youtube", url, str(metadata)],
                             capture_output=True, text=True, timeout=60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ServiceError("YouTube demorou a responder.", status=504, code="youtube_timeout") from exc
    if run.returncode:
        metadata.unlink(missing_ok=True)
        if run.returncode == 3:
            raise YouTubeBlocked()
        raise ServiceError("Não foi possível obter o vídeo.", code="youtube_unavailable")
    try:
        info = json.loads(metadata.read_text())
    finally:
        metadata.unlink(missing_ok=True)
    duration = info.get("duration")
    if duration is not None and (not math.isfinite(float(duration)) or end > float(duration) + .02):
        raise ServiceError("Trecho ultrapassa a duração do vídeo.", status=400)
    from urllib.parse import urlsplit
    media = urlsplit(info.get("url", ""))
    if media.scheme != "https" or not (media.hostname or "").endswith(".googlevideo.com"):
        raise ServiceError("Endereço de mídia YouTube inválido.", code="youtube_unavailable")
    headers = info.get("headers", {})
    audio = work / "tonematch-reference.wav"
    command = ["ffmpeg", "-nostdin", "-v", "error", "-user_agent", str(headers.get("User-Agent", "")),
               "-rw_timeout", "15000000", "-ss", str(start), "-i", info["url"],
               "-t", str(end - start), "-vn", "-ac", "2", "-ar", str(RATE),
               "-c:a", "pcm_s16le", "-fs", str(MAX_BYTES), "-y", str(audio)]
    try:
        result = subprocess.run(command, capture_output=True, timeout=60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ServiceError("Extração YouTube excedeu o tempo.", status=504, code="youtube_timeout") from exc
    except FileNotFoundError as exc:
        raise ServiceError("FFmpeg indisponível.", status=503) from exc
    if result.returncode:
        audio.unlink(missing_ok=True)
        if any(marker in result.stderr.lower() for marker in (b"403", b"429", b"forbidden")):
            raise YouTubeBlocked()
        raise ServiceError("Falha na extração YouTube.", code="youtube_unavailable")
    # Validate and bound actual frames without an unnecessary second lossy conversion.
    try:
        if not 44 < audio.stat().st_size <= MAX_BYTES:
            raise ValueError("Tamanho inválido.")
        with wave.open(str(audio)) as wav:
            seconds = wav.getnframes() / wav.getframerate()
            if wav.getframerate() != RATE or wav.getnchannels() != 2 or wav.getsampwidth() != 2 or abs(seconds - (end-start)) > .25:
                raise ValueError("WAV incompleto.")
    except (OSError, wave.Error, EOFError, ValueError) as exc:
        raise ServiceError("Áudio YouTube incompleto.", code="youtube_unavailable") from exc
    return audio, {"title": str(info.get("title", "YouTube"))[:200], "url": url,
                   "start_seconds": start, "end_seconds": end}

def analyze_reference(audio, work, *, isolated=False, boost=False, compress_clean=False,
                      modulation="none"):
    python = runtime_python()
    output = work / "tonematch-analysis.json"
    command = [python, str(WORKER), "--audio", str(audio), "--output", str(output)]
    if isolated:
        command.append("--isolated")
    environment = dict(os.environ)
    for key in ("OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
        environment[key] = "1"
    try:
        result = subprocess.run(command, cwd=ROOT, env=environment, capture_output=True,
                                timeout=240, check=False)
    except subprocess.TimeoutExpired as exc:
        output.unlink(missing_ok=True)
        raise ServiceError("Análise ToneMatch excedeu 240 segundos.", status=504,
                           code="tonematch_timeout") from exc
    if result.returncode or not output.is_file():
        output.unlink(missing_ok=True)
        raise ServiceError("ToneMatch não concluiu a análise; confira runtime e evidência de guitarra.",
                           code="tonematch_analysis_failed")
    if output.stat().st_size > 256 * 1024:
        raise ServiceError("Relatório ToneMatch inválido.", code="tonematch_invalid_report")
    try:
        data = json.loads(output.read_text(encoding="utf-8"))
        result = translate_analysis(data["analysis"], boost=boost, compress_clean=compress_clean,
                                    modulation=modulation)
        separation = data["separation"]
        if not isinstance(separation, dict):
            raise ValueError("Separação inválida.")
    except (KeyError, TypeError, ValueError) as exc:
        raise ServiceError("Dados de guitarra insuficientes ou inválidos; nenhum preset foi gerado.",
                           code="tonematch_invalid_report") from exc
    result["separation"] = separation
    return result
