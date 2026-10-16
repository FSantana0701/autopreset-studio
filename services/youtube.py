"""Metadata through yt-dlp; FFmpeg decodes ONLY the requested bounded clip."""
from __future__ import annotations

import math
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .errors import ServiceError, YouTubeBlocked

SAMPLE_RATE = 16000
MAX_SECONDS = 45
MAX_WAV_BYTES = SAMPLE_RATE * MAX_SECONDS * 2 * 2 + 8192


def canonical_url(value: str) -> str:
    try:
        url = urlsplit(value)
        host = url.hostname
    except ValueError as exc:
        raise ServiceError("Link do YouTube inválido.", status=400) from exc
    if url.scheme not in {"https", "http"} or url.username or url.password:
        raise ServiceError("Link do YouTube inválido.", status=400)
    if host in {"youtu.be", "www.youtu.be"}:
        video_id = url.path.strip("/")
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if url.path.rstrip("/") == "/watch":
            video_id = parse_qs(url.query).get("v", [""])[0]
        else:
            match = re.fullmatch(r"/(?:shorts|embed|live)/([\w-]{11})/?", url.path, flags=re.ASCII)
            video_id = match[1] if match else ""
    else:
        raise ServiceError("Use um link de vídeo do YouTube.", status=400)
    if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
        raise ServiceError("ID de vídeo do YouTube inválido.", status=400)
    return "https://www.youtube.com/watch?v=" + video_id


def validate_interval(start: float, end: float) -> None:
    if not all(math.isfinite(n) for n in (start, end)) or not 0 <= start < end or end - start > MAX_SECONDS:
        raise ServiceError("Escolha um trecho maior que zero e de até 45 segundos.", status=400)


def _metadata_worker(url: str, output: Path) -> dict:
    """Isolate yt-dlp imports from the DSP worker's peak RSS."""
    import json
    import yt_dlp
    from yt_dlp.utils.networking import std_headers

    headers = {**std_headers, "Accept-Language": "en-US,en;q=0.9"}
    options = {
        "format": "bestaudio/best", "noplaylist": True,
        "skip_download": True, "quiet": True, "no_warnings": True,
        "socket_timeout": 15, "retries": 1, "extractor_retries": 1,
        "http_headers": headers, "cachedir": False,
        # Metadata only here; bounded audio extraction is performed by FFmpeg below.
        "postprocessors": [{"key": "FFmpegExtractAudio"}],
    }
    try:
        with yt_dlp.YoutubeDL(options) as downloader:
            info = downloader.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as exc:
        message = str(exc).lower()
        if any(marker in message for marker in ("403", "429", "sign in", "bot", "captcha", "forbidden", "login", "private", "age")):
            raise YouTubeBlocked() from exc
        raise ServiceError("Não foi possível obter o vídeo. Tente novamente ou use upload local.", code="youtube_unavailable") from exc
    if not info or not info.get("url") or info.get("is_live"):
        raise ServiceError("Vídeo indisponível ou transmissão ao vivo não suportada.")
    media = urlsplit(info["url"])
    if media.scheme != "https" or not (media.hostname or "").endswith(".googlevideo.com"):
        raise ServiceError("O extrator não retornou um endereço de mídia YouTube HTTPS compatível.")
    result = {"title": str(info.get("title") or "YouTube")[:200], "url": info["url"],
              "duration": info.get("duration"), "headers": headers}
    output.write_text(json.dumps(result), encoding="utf-8")
    return result


def extract_clip(url: str, start: float, end: float, work: Path) -> dict:
    import json

    url = canonical_url(url)
    validate_interval(start, end)
    metadata_path = work / "source.json"
    # No model/audio is downloaded by this subprocess; only bounded metadata.
    try:
        completed = subprocess.run([sys.executable, "-m", "services.youtube", url, str(metadata_path)],
                                   capture_output=True, text=True, timeout=60, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ServiceError("O YouTube demorou a responder. Tente upload local.", status=504, code="youtube_timeout") from exc
    if completed.returncode:
        if completed.returncode == 3:
            raise YouTubeBlocked()
        raise ServiceError("Não foi possível extrair o vídeo. Tente upload local.", code="youtube_unavailable")
    info = json.loads(metadata_path.read_text())
    metadata_path.unlink()  # signed URLs are not retained or returned to the client
    duration = info.get("duration")
    if duration is not None and (not math.isfinite(float(duration)) or end > float(duration) + 0.02):
        raise ServiceError("O trecho ultrapassa a duração do vídeo.", status=400)
    clip = work / "clip.wav"
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
               "-user_agent", info["headers"]["User-Agent"], "-rw_timeout", "15000000",
               "-ss", str(start), "-i", info["url"], "-t", str(end-start),
               "-vn", "-ac", "2", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le",
               "-fs", str(MAX_WAV_BYTES), "-y", str(clip)]
    try:
        completed = subprocess.run(command, capture_output=True, timeout=60, check=False)
    except FileNotFoundError as exc:
        raise ServiceError("FFmpeg não está instalado no servidor.", status=503) from exc
    except subprocess.TimeoutExpired as exc:
        raise ServiceError("A extração do trecho expirou. Tente upload local.", status=504) from exc
    if completed.returncode:
        if any(marker in completed.stderr.lower() for marker in (b"403", b"429", b"forbidden")):
            raise YouTubeBlocked()
        raise ServiceError("Falha ao decodificar o trecho. Tente upload local.")
    if not clip.is_file() or not 44 < clip.stat().st_size <= MAX_WAV_BYTES:
        raise ServiceError("O YouTube não forneceu áudio válido para o trecho.")
    import wave
    try:
        with wave.open(str(clip)) as audio:
            valid = (audio.getframerate() == SAMPLE_RATE and audio.getnchannels() == 2
                     and audio.getsampwidth() == 2 and audio.getnframes() > 0
                     and abs(audio.getnframes()/SAMPLE_RATE - (end-start)) <= 0.25)
    except (wave.Error, EOFError) as exc:
        raise ServiceError("A extração não produziu um WAV PCM válido.") from exc
    if not valid:
        raise ServiceError("O áudio recebido está incompleto ou tem formato inválido. Tente upload local.")
    return {"title": info["title"], "url": url, "start_seconds": start, "end_seconds": end}


if __name__ == "__main__":
    try:
        _metadata_worker(sys.argv[1], Path(sys.argv[2]))
    except YouTubeBlocked:
        sys.exit(3)
    except ServiceError:
        sys.exit(2)
