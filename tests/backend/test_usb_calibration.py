"""USB regression features contain no audio. Synthetic probes validate extraction."""
import json
import subprocess

import numpy as np
import pytest
import soundfile as sf

from services.catalog import ROOT
from services.dzh_encoder import encode
from services.dsp_analyzer import analyze
from services.preset_mapper import suggest
from services.tone_classifier import classify
from services.tone_features import extract

FIXTURE = ROOT / 'src/tests/fixtures/usb-calibration.json'


@pytest.mark.parametrize('shape,expected', [('sine', 'Clean'), ('clipped_chord', 'Hi-Gain')])
def test_uniform_recording_level_does_not_select_drive(tmp_path, shape, expected):
    t = np.arange(32000) / 16000
    y = np.sin(2*np.pi*220*t)
    if shape == 'clipped_chord':
        y = np.tanh(10*(y + np.sin(2*np.pi*330*t) + np.sin(2*np.pi*554*t)))
    decisions = []
    for level in (.003, .03, .3):
        source = tmp_path / f'{level}.wav'
        sf.write(source, y*level, 16000, subtype='FLOAT')
        features = analyze(source)
        plan = suggest(features)
        decisions.append(plan['classification']['distortion'])
        assert plan['classification']['tone_type'] == expected
        assert any(b['id'] == 3 for b in plan['blocks']) == (expected != 'Clean')
        assert not any(b['id'] == 9 for b in plan['blocks'])
        assert len(encode(plan)) == 448
    np.testing.assert_allclose(decisions, decisions[0], atol=1e-6)


def test_numpy_fft_matches_browser_fft_on_the_same_pcm(tmp_path):
    t = np.arange(32000) / 16000
    y = (.2*np.sin(2*np.pi*220*t)*np.exp(-t) + .04*np.sin(2*np.pi*880*t)).astype('float32')
    source = tmp_path / 'same-pcm.wav'
    pcm = tmp_path / 'same-pcm.f32'
    sf.write(source, y, 16000, subtype='FLOAT')
    y.tofile(pcm)
    script = """const fs=require('node:fs');
require('./src/data/v73.js');require('./src/data/v73-parameters.js');require('./src/data/v75.js');
require('./src/integrations/audio-heuristic-analyzer.js');
const b=fs.readFileSync(process.argv[1]),samples=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
AutoPresetAudioHeuristics.extractFeatures({sampleRate:16000,numberOfChannels:1,length:samples.length,duration:samples.length/16000,getChannelData:()=>samples})
.then(features=>process.stdout.write(JSON.stringify({features,decision:AutoPresetAudioHeuristics.toneHints(features)})));"""
    browser = json.loads(subprocess.check_output(['node', '-e', script, str(pcm)], cwd=ROOT, text=True))
    features = extract(source)
    for key in ('rms', 'crest_factor_db', 'zero_crossing_rate', 'spectral_centroid_hz',
                'spectral_rolloff_85_hz', 'spectral_flatness', 'harmonic_energy_ratio',
                'spectral_flux', 'spectral_flux_peak', 'band_energy_ratios'):
        np.testing.assert_allclose(features[key], browser['features'][key], rtol=1e-7, atol=1e-9, err_msg=key)
    decision = classify(features)
    assert decision['classification'] == browser['decision']['classification']
    assert decision['distortion'] == pytest.approx(browser['decision']['distortion'], abs=1e-9)


@pytest.mark.parametrize('case', json.loads(FIXTURE.read_text())['cases'], ids=lambda case: case['id'])
def test_three_usb_clean_references_remain_clean_without_auto_reverb(case):
    plan = suggest(case['features'])
    assert plan['classification']['tone_type'] == case['expected']['classification']
    assert next(b for b in plan['blocks'] if b['id'] == 4)['model_index'] == 0
    assert not any(b['id'] in (3, 9) for b in plan['blocks'])
    assert plan['classification']['gain_is_starting_point'] is True
    assert len(encode(plan)) == 448


def test_main_measures_original_not_hpss_preview(tmp_path):
    import main
    from services.tone_features import extract
    t = np.arange(32000) / 16000
    y = (.2*np.sin(2*np.pi*220*t)+.03*np.random.default_rng(9).normal(size=len(t))).astype('float32')
    source = tmp_path/'clip.wav'
    sf.write(source, y, 16000, subtype='FLOAT')
    result = main.build_analysis(source, tmp_path)
    assert result['separation']['measurement_source'] == 'original_audio'
    assert result['separation']['guitar_isolated'] is False
    expected = extract(source)
    assert result['features']['spectral_flatness'] == pytest.approx(expected['spectral_flatness'], abs=1e-9)
    assert result['features']['audio_source'] == 'full_mix'
