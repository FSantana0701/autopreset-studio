"""Railway API: bounded YouTube clip → HPSS → DSP → heuristic MK-300 preset."""
import base64
import json
import math
import os
from pathlib import Path
import shutil
import tempfile
import threading

for key in ('OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS','NUMBA_NUM_THREADS'):
    os.environ[key] = '1'

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
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


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=8000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=4000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=10)


class ChatResponse(BaseModel):
    response: str


class LinkRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    url: str = Field(max_length=2048)
    start_seconds: float | str = 0
    end_seconds: float | str = 45
    firmware: Literal['v75'] = 'v75'

    @model_validator(mode='after')
    def validate_clip(self):
        self.url = canonical_url(self.url)
        self.start_seconds = parse_seconds(self.start_seconds)
        self.end_seconds = parse_seconds(self.end_seconds)
        validate_interval(self.start_seconds, self.end_seconds)
        return self


def parse_seconds(value: float | str) -> float:
    try:
        if isinstance(value, str) and ':' in value:
            parts = value.strip().split(':')
            if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit() or int(parts[1]) >= 60:
                raise ValueError
            seconds = int(parts[0]) * 60 + int(parts[1])
        else:
            seconds = float(value)
        if not math.isfinite(seconds):
            raise ValueError
        return float(seconds)
    except (TypeError, ValueError) as exc:
        raise ValueError('Use segundos ou mm:ss para início/fim.') from exc


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
    return {'status':'ok','api':'autopreset-audio','analysis_enabled':True,
            'engine':'HPSS','guitar_isolated':False,'max_duration_seconds':45,
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
    original = work/'analysis.wav'
    separation = separate_harmonic(clip, harmonic, analysis_target=original)
    separation['measurement_source'] = 'original_audio'
    features = analyze(original)
    preset = suggest(features)
    raw = encode(preset)
    return {'dzh_base64':base64.b64encode(raw).decode('ascii'), 'size_bytes':len(raw),
            'filename':'HPSS-SUGGESTION.dzh','features':features,'preset':preset,'separation':separation}


@app.get('/api/v1/catalog')
def catalog():
    from services.catalog import public_catalog
    return public_catalog()


@app.post('/api/v1/chat', response_model=ChatResponse)
async def chat(body: ChatRequest):
    # Keep the audio-only process within its existing memory budget.
    from services.ai_chat import generate_reply
    reply = await generate_reply(body.message, [item.model_dump() for item in body.history])
    return {'response': reply}


def analyze_audio_for_chat(payload: bytes, suffix: str, start: float, end: float) -> dict:
    """Reuse bounded server DSP and pass measurements, not raw audio, to the chat model."""
    from services.audio_files import decode_upload
    with tempfile.TemporaryDirectory(prefix='autopreset-chat-audio-') as directory:
        work = Path(directory)
        source_path, clip_path = work / ('audio' + suffix), work / 'clip.wav'
        source_path.write_bytes(payload)
        source = decode_upload(source_path, clip_path, start, end)
        result = build_analysis(clip_path, work)
        features, preset = result['features'], result['preset']
        return {
            'duration_seconds': source['duration_seconds'],
            'sample_rate': features.get('sample_rate'),
            'classification': preset.get('classification'),
            'measurements': {key: features.get(key) for key in (
                'spectral_centroid_hz', 'spectral_rolloff_85_hz', 'spectral_flatness',
                'zero_crossing_rate', 'rms_db', 'crest_factor_db', 'delay_detected',
                'delay_time_ms', 'eq_virtual_bands_hz', 'eq_virtual_gain_db',
                'eq_device_bands_hz', 'eq_device_values', 'band_energy_ratios')
                if key in features},
            'automatic_draft': preset,
            'separation': result['separation'],
        }


@app.post('/api/v1/chat/audio', response_model=ChatResponse)
async def chat_audio(
    file: UploadFile = File(...),
    message: str = Form(''),
    history_json: str = Form('[]', max_length=40000),
    start_seconds: str = Form('0'),
    end_seconds: str = Form('45'),
):
    from services.ai_chat import generate_reply, require_api_key
    from services.audio_files import ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES

    require_api_key()  # Fail before decoding expensive audio if the service is unconfigured.
    suffix = Path(file.filename or '').suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        await file.close()
        raise ServiceError('Anexe um áudio MP3, WAV ou M4A.', status=400, code='chat_audio_type')
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise ServiceError('O áudio excede o limite de 15 MiB.', status=413, code='chat_audio_too_large')
    try:
        history = json.loads(history_json)
        request = ChatRequest(
            message=message.strip() or 'Analise este áudio e sugira um timbre inicial para a MK-300.',
            history=history,
        )
        start, end = parse_seconds(start_seconds), parse_seconds(end_seconds)
        validate_interval(start, end)
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise ServiceError('Mensagem, histórico ou intervalo de áudio inválido.', status=422,
                           code='chat_audio_invalid_input') from exc

    acquire()
    try:
        audio_context = await run_in_threadpool(analyze_audio_for_chat, payload, suffix, start, end)
    finally:
        processing.release()
    reply = await generate_reply(request.message,
                                 [item.model_dump() for item in request.history],
                                 audio_context=audio_context)
    return {'response': reply}


@app.get('/api/v1/offline-catalog')
def offline_catalog():
    from services.preset_mapper import offline_presets
    from services.dzh_encoder import encode
    result = []
    for preset in offline_presets():
        raw = encode(preset)
        result.append({'style':preset['source_style'], 'preset':preset,
                       'dzh':{'filename':f"AutoPreset_{preset['source_style']}.dzh",
                              'size_bytes':len(raw), 'base64':base64.b64encode(raw).decode('ascii')}})
    return {'firmware':'v75', 'presets':result}


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


@app.post('/api/v1/analyze-file')
async def analyze_file(file: UploadFile = File(...), start_seconds: str = Form('0'), end_seconds: str = Form('45')):
    from services.audio_files import ALLOWED_EXTENSIONS, MAX_UPLOAD_BYTES, decode_upload
    suffix = Path(file.filename or '').suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise ServiceError('Envie um arquivo MP3, WAV ou M4A.', status=400)
    payload = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if len(payload) > MAX_UPLOAD_BYTES:
        raise ServiceError('O arquivo excede o limite de 15 MiB.', status=413)
    start, end = parse_seconds(start_seconds), parse_seconds(end_seconds)
    acquire()
    try:
        with tempfile.TemporaryDirectory(prefix='autopreset-upload-') as directory:
            work = Path(directory)
            source_path, clip_path = work / ('source' + suffix), work / 'clip.wav'
            source_path.write_bytes(payload)
            source = decode_upload(source_path, clip_path, start, end)
            result = build_analysis(clip_path, work)
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
