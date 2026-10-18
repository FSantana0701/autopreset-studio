"""Shared, level-invariant decision rules; config also ships to the browser."""
import json
import math
from pathlib import Path

CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'src/data/audio-analysis.json').read_text())


def clamp(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def classify(features):
    required = ('sample_rate', 'crest_factor_db', 'spectral_flatness',
                'harmonic_energy_ratio', 'zero_crossing_rate',
                'spectral_centroid_hz', 'spectral_rolloff_85_hz')
    if any(not isinstance(features.get(key), (float, int)) or not math.isfinite(features[key])
           for key in required):
        return {'classification': 'Clean', 'distortion': 0.0, 'brightness': 0.0,
                'measurement_complete': False, 'method': CONFIG['version']}
    c = CONFIG['classification']
    compression = clamp((c['crest_reference_db'] - features['crest_factor_db']) / c['crest_span_db'])
    noise = clamp(math.sqrt(max(0, features['spectral_flatness'])))
    harmonics = clamp(features['harmonic_energy_ratio'] * c['harmonic_scale'])
    crossings = clamp(features['zero_crossing_rate'] * features['sample_rate'] / c['crossing_scale_hz'])
    w = c['weights']
    distortion = clamp(w['compression'] * compression + w['noise'] * noise +
                       w['harmonics'] * harmonics + w['crossings'] * crossings)
    fuzz = (noise > c['fuzz_noise_threshold'] and compression > c['fuzz_compression_threshold']
            and crossings > c['fuzz_crossings_threshold'])
    kind = ('Fuzz' if fuzz else 'Hi-Gain' if distortion > c['high_gain_threshold']
            else 'Crunch' if distortion > c['crunch_threshold'] else 'Clean')
    brightness = clamp((features['spectral_centroid_hz'] / 5000 + features['spectral_rolloff_85_hz'] / 9000) / 2)
    return {'classification': kind, 'distortion': distortion, 'brightness': brightness,
            'measurement_complete': True, 'method': CONFIG['version']}
