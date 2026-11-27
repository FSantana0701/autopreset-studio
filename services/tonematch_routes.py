"""Optional ToneMatch API. Runtime is opt-in; imports keep the default API light."""
from __future__ import annotations
from pathlib import Path
import tempfile
from typing import Literal

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel, ConfigDict, model_validator
from starlette.concurrency import run_in_threadpool

from services.errors import ServiceError
from services.youtube import canonical_url
from services.audio_files import ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES
from services.tonematch_runtime import (
    analyze_reference, decode_reference, extract_youtube_reference, runtime_python,
    status, validate_reference_interval,
)

class ToneMatchLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    url: str
    start_seconds: float = 0
    end_seconds: float = 30
    boost: bool = False
    compress_clean: bool = False
    modulation: Literal["none", "Chorus", "Phaser"] = "none"

    @model_validator(mode="after")
    def validate_source(self):
        if len(self.url) > 2048:
            raise ValueError("Link muito longo.")
        try:
            self.url = canonical_url(self.url)
            validate_reference_interval(self.start_seconds, self.end_seconds)
        except ServiceError as exc:
            raise ValueError(str(exc)) from exc
        return self

def create_router(acquire, release, parse_seconds):
    router = APIRouter(prefix="/api/v1/tonematch", tags=["ToneMatch MK-300"])

    @router.get("/status")
    def get_status():
        return status()

    @router.post("/analyze-link")
    def analyze_link(body: ToneMatchLinkRequest):
        runtime_python()  # Do not download media when the worker is not configured.
        acquire()
        try:
            with tempfile.TemporaryDirectory(prefix="mk300-tonematch-") as directory:
                work = Path(directory)
                audio, source = extract_youtube_reference(
                    body.url, body.start_seconds, body.end_seconds, work)
                result = analyze_reference(audio, work, boost=body.boost,
                                           compress_clean=body.compress_clean, modulation=body.modulation)
                result["source"] = source
                return result
        finally:
            release()

    def run_upload(payload, suffix, start, end, isolated, boost, compress_clean, modulation):
        with tempfile.TemporaryDirectory(prefix="mk300-tonematch-upload-") as directory:
            work = Path(directory)
            source, audio = work / ("source" + suffix), work / "reference.wav"
            source.write_bytes(payload)
            provenance = decode_reference(source, audio, start, end)
            result = analyze_reference(audio, work, isolated=isolated, boost=boost,
                                       compress_clean=compress_clean, modulation=modulation)
            result["source"] = provenance
            return result

    @router.post("/analyze-file")
    async def analyze_file(
        file: UploadFile = File(...), start_seconds: str = Form("0"),
        end_seconds: str = Form("30"), isolated: bool = Form(False),
        boost: bool = Form(False), compress_clean: bool = Form(False),
        modulation: Literal["none", "Chorus", "Phaser"] = Form("none"),
    ):
        try:
            suffix = Path(file.filename or "").suffix.lower()
            if suffix not in ALLOWED_EXTENSIONS:
                raise ServiceError("Envie MP3, WAV ou M4A.", status=400)
            payload = await file.read(MAX_UPLOAD_BYTES + 1)
        finally:
            await file.close()
        if len(payload) > MAX_UPLOAD_BYTES:
            raise ServiceError("Áudio excede 15 MiB.", status=413)
        try:
            start, end = parse_seconds(start_seconds), parse_seconds(end_seconds)
        except (ValueError, TypeError) as exc:
            raise ServiceError("Intervalo inválido.", status=400) from exc
        validate_reference_interval(start, end)
        runtime_python()
        acquire()
        try:
            return await run_in_threadpool(run_upload, payload, suffix, start, end,
                                           isolated, boost, compress_clean, modulation)
        finally:
            release()

    return router
