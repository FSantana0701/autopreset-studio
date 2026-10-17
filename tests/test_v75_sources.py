from __future__ import annotations

import base64
import io
import tempfile
import shutil
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

import main
from services.catalog import public_catalog
from services.dzh_encoder import encode
from services.preset_mapper import offline_presets, suggest


def test_real_catalog_dsp_thresholds_and_448_byte_encoder():
    catalog = public_catalog()
    assert len(catalog['blocks']['AMP']) >= 100
    assert len(catalog['blocks']['DS']) == 40
    assert len(catalog['blocks']['DLY']) == 27
    assert len(catalog['blocks']['REV']) == 18
    assert catalog['eq_analysis_bands_hz'] == [100, 300, 1000, 3000, 8000]
    features = {'crest_factor_db': 7.5, 'spectral_centroid_hz': 2000,
                'eq_device_values': [-2, -1, 0, 1, 2, 0], 'delay_detected': False}
    preset = suggest(features)
    assert next(block for block in preset['blocks'] if block['id'] == 4)['model_index'] == 64
    assert next(block for block in preset['blocks'] if block['id'] == 3)['model_index'] == 21
    assert len(encode(preset)) == 448


def test_numpy_dsp_detects_repeat_delay_and_clamps_eq_gain():
    from services.dsp_analyzer import analyze
    rate = 16000
    samples = np.zeros(rate * 4, dtype=np.float32)
    pulse = 0.8 * np.sin(2 * np.pi * 440 * np.arange(400) / rate)
    for start in np.arange(0, 4, .35):
        index = int(start * rate)
        samples[index:index + len(pulse)] = pulse
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / 'repeat.wav'
        sf.write(path, samples, rate, subtype='PCM_16')
        features = analyze(path)
    assert features['delay_detected'] is True
    assert 200 <= features['delay_time_ms'] <= 600
    assert len(features['eq_virtual_gain_db']) == 5
    assert all(-12 <= value <= 12 for value in features['eq_device_values'])


def test_mm_ss_parser_supports_link_form_values():
    assert main.parse_seconds('1:05') == 65
    assert main.parse_seconds('0:09') == 9


def test_offline_catalog_has_five_encodable_style_presets():
    presets = offline_presets()
    assert {item['source_style'] for item in presets} == {'Rock', 'Metal', 'MPB', 'Blues', 'Clean'}
    assert all(len(encode(item)) == 448 for item in presets)


def test_offline_catalog_api_returns_downloadable_dzh():
    with TestClient(main.app) as client:
        response = client.get('/api/v1/offline-catalog')
    assert response.status_code == 200
    body = response.json()
    assert len(body['presets']) == 5
    for item in body['presets']:
        assert len(base64.b64decode(item['dzh']['base64'], validate=True)) == 448


def test_file_upload_is_decoded_and_capped_to_15_mib():
    if shutil.which('ffmpeg') is None:
        import pytest
        pytest.skip('ffmpeg is not installed in this test environment')
    rate = 16000
    samples = (0.2 * np.sin(2 * np.pi * 330 * np.arange(rate * 3) / rate)).astype('<i2')
    wav_bytes = io.BytesIO()
    with wave.open(wav_bytes, 'wb') as writer:
        writer.setnchannels(1); writer.setsampwidth(2); writer.setframerate(rate)
        writer.writeframes(samples.tobytes())
    fake = {'dzh_base64': base64.b64encode(bytes(448)).decode(), 'size_bytes': 448,
            'preset': {'blocks': []}, 'features': {}, 'separation': {'guitar_isolated': False}}
    with TestClient(main.app) as client, patch.object(main, 'build_analysis', return_value=fake):
        response = client.post('/api/v1/analyze-file',
            files={'file': ('sample.wav', wav_bytes.getvalue(), 'audio/wav')},
            data={'start_seconds': '0', 'end_seconds': '2'})
    assert response.status_code == 200, response.text
    assert response.json()['source']['duration_seconds'] == 2.0
    with TestClient(main.app) as client:
        rejected = client.post('/api/v1/analyze-file', files={'file': ('bad.exe', b'bad', 'application/octet-stream')})
    assert rejected.status_code == 400
    with TestClient(main.app) as client:
        too_large = client.post('/api/v1/analyze-file', files={'file': ('large.wav', b'0' * (15 * 1024 * 1024 + 1), 'audio/wav')})
    assert too_large.status_code == 413
