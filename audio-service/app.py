from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response


ROOT = Path(__file__).resolve().parent
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_CLIP_SECONDS = 45.0
MODEL = os.getenv("DEMUCS_MODEL", "htdemucs_6s")
DEVICE = os.getenv("DEMUCS_DEVICE", "cpu")
API_KEY = os.getenv("AUTOPRESET_API_KEY", "")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "AUTOPRESET_ALLOWED_ORIGINS",
        "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5500,http://127.0.0.1:5500",
    ).split(",")
    if origin.strip()
]

app = FastAPI(title="AutoPreset Guitar Separation", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


def command_output(command: list[str], *, timeout: int) -> str:
    try:
        result = subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="A separação excedeu o tempo limite.") from exc
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or "Falha no processamento do áudio.")[-1200:]
        raise HTTPException(status_code=422, detail=detail) from exc
    return result.stdout


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "separator": MODEL, "device": DEVICE}


@app.post("/v1/separate")
async def separate_guitar(
    file: UploadFile = File(...),
    start_seconds: float = Form(...),
    end_seconds: float = Form(...),
    authorization: str | None = Header(default=None),
) -> Response:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="O serviço ainda não foi configurado pelo administrador.")
    bearer = f"Bearer {API_KEY}"
    if not authorization or not secrets.compare_digest(authorization, bearer):
        raise HTTPException(status_code=401, detail="Chave de acesso do serviço inválida.")

    suffix = Path(file.filename or "audio").suffix.lower()
    if suffix not in {".mp3", ".wav"}:
        raise HTTPException(status_code=415, detail="Envie um arquivo MP3 ou WAV.")
    if not (start_seconds >= 0 and end_seconds > start_seconds):
        raise HTTPException(status_code=400, detail="Intervalo de áudio inválido.")
    if end_seconds - start_seconds > MAX_CLIP_SECONDS:
        raise HTTPException(
            status_code=413,
            detail=f"Cada trecho pode ter no máximo {int(MAX_CLIP_SECONDS)} segundos.",
        )

    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if not data:
        raise HTTPException(status_code=400, detail="O arquivo está vazio.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="O arquivo excede 25 MiB.")

    with tempfile.TemporaryDirectory(prefix="autopreset-separation-") as temp_dir:
        work = Path(temp_dir)
        original = work / f"input{suffix}"
        clip = work / "clip.wav"
        original.write_bytes(data)

        probe = command_output(
            [
                "ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "json", str(original),
            ],
            timeout=20,
        )
        try:
            duration = float(json.loads(probe)["format"]["duration"])
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise HTTPException(status_code=422, detail="Não foi possível ler a duração do áudio.") from exc
        if end_seconds > duration + 0.02:
            raise HTTPException(status_code=400, detail="O trecho ultrapassa a duração do arquivo.")

        command_output(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(start_seconds),
                "-i", str(original), "-t", str(end_seconds - start_seconds), "-vn",
                "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(clip), "-y",
            ],
            timeout=30,
        )

        output_dir = work / "stems"
        command_output(
            [
                sys.executable, str(ROOT / "run_demucs.py"), "-n", MODEL, "-d", DEVICE,
                "-o", str(output_dir), str(clip),
            ],
            timeout=240,
        )
        stem = output_dir / MODEL / "clip" / "guitar.wav"
        if not stem.is_file() or stem.stat().st_size <= 44:
            raise HTTPException(status_code=502, detail="O separador não gerou a faixa de guitarra.")
        audio = stem.read_bytes()

    return Response(
        content=audio,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="guitar-stem.wav"',
            "X-Audio-Separator": MODEL,
            "Cache-Control": "no-store",
        },
    )
