"""Railway API: bounded YouTube clip → HPSS → DSP → heuristic MK-300 preset."""
import base64
import os
from pathlib import Path
import shutil
import tempfile
import threading

for key in ('OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','NUMBA_NUM_THREADS'):
    os.environ[key] = '1'

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.background import BackgroundTask
from typing import Literal
from services.errors import ServiceError
from services.youtube import canonical_url, validate_interval, extract_clip

app = FastAPI(title='AutoPreset HPSS API', version='1.0.0')
# Open CORS for connection diagnostics; requests carry no browser credentials.
CORS_ORIGINS = ['*']
app.add_middleware(CORSMiddleware,
    allow_origins=CORS_ORIGINS, allow_credentials=False,
    allow_methods=['*'], allow_headers=['*'])
processing = threading.Lock()


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    url: str = Field(max_length=2048)
    start_seconds: float = Field(ge=0)
    end_seconds: float = Field(gt=0)
    firmware: Literal['v75'] = 'v75'

    @model_validator(mode='after')
    def validate_clip(self):
        self.url = canonical_url(self.url)
        validate_interval(self.start_seconds, self.end_seconds)
        return self


@app.exception_handler(ServiceError)
async def service_error(request: Request, exc: ServiceError):
    return JSONResponse(status_code=exc.status, content={'detail':str(exc),'code':exc.code})


@app.options('/api/v1/analyze-link', include_in_schema=False)
def analyze_link_options():
    # CORSMiddleware handles browser preflights and adds access-control headers.
    # Explicitly support OPTIONS probes without preflight headers as well.
    return Response(status_code=200)


@app.get('/health')
def health():
    return {'status':'ok','engine':'HPSS','guitar_isolated':False,'max_duration_seconds':45,
            'ffmpeg_available':shutil.which('ffmpeg') is not None}


def acquire():
    if not processing.acquire(blocking=False):
        raise ServiceError('Servidor ocupado. Aguarde e tente novamente.', status=503, code='busy')


def build_analysis(clip: Path, work: Path):
    from services.ai_separator import separate_harmonic
    from services.dsp_analyzer import analyze
    from services.preset_mapper import suggest
    from services.dzh_encoder import encode
    harmonic = work/'harmonic.wav'
    separation = separate_harmonic(clip, harmonic)
    features = analyze(harmonic)
    preset = suggest(features)
    raw = encode(preset)
    return {'dzh_base64':base64.b64encode(raw).decode('ascii'), 'size_bytes':len(raw),
            'filename':'HPSS-SUGGESTION.dzh','features':features,'preset':preset,'separation':separation}


@app.post('/api/v1/analyze-link')
def analyze_link(body: LinkRequest):
    acquire()
    try:
        with tempfile.TemporaryDirectory(prefix='autopreset-') as directory:
            work = Path(directory)
            source = extract_clip(body.url,body.start_seconds,body.end_seconds,work)
            result = build_analysis(work/'clip.wav',work)
            result['source'] = source
            return result
    finally:
        processing.release()


@app.post('/api/v1/extract-youtube')
def extract_youtube(body: LinkRequest):
    acquire()
    directory = tempfile.TemporaryDirectory(prefix='autopreset-')
    try:
        work = Path(directory.name)
        extract_clip(body.url,body.start_seconds,body.end_seconds,work)
        return FileResponse(work/'clip.wav', media_type='audio/wav', filename='youtube-clip.wav',
                            background=BackgroundTask(directory.cleanup))
    except Exception:
        directory.cleanup()
        raise
    finally:
        processing.release()
