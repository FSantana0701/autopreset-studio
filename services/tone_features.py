"""Streaming FFT decisions compatible with the browser's spectralFrames.

The 16 kHz input is bounded to 45 s. Only one FFT frame is processed at a time;
relative power and energy weights prevent file loudness from acting as drive.
"""
from pathlib import Path

import numpy as np
import soundfile as sf

FFT_SIZE = 2048


def extract(path: Path):
    y, rate = sf.read(path, dtype='float32', always_2d=False)
    if y.ndim != 1 or rate != 16000 or not 0 < len(y) <= 45 * rate or not np.isfinite(y).all():
        raise ValueError('Esperado áudio mono finito de até 45 s a 16 kHz.')
    frequencies = np.arange(FFT_SIZE // 2 + 1) * rate / FFT_SIZE
    first, last = max(1, int(np.ceil(40 * FFT_SIZE / rate))), FFT_SIZE // 2
    selected = slice(first, last + 1)
    centers = np.array([100, 200, 400, 800, 1600, 3200])
    masks = [(frequencies >= center / np.sqrt(2)) & (frequencies < center * np.sqrt(2)) for center in centers]
    band_energy = np.zeros(6)
    previous = np.zeros(last + 1)
    window = np.hanning(FFT_SIZE)
    scratch = np.zeros(FFT_SIZE)
    totals = np.zeros(4)  # centroid, rolloff, flatness, upper-harmonic power
    weight = flux_sum = flux_peak = 0.0
    frames = active = flux_count = 0
    was_active = False
    for offset in range(0, len(y), max(FFT_SIZE // 2, round(rate / 50))):
        if len(y) >= FFT_SIZE and offset + FFT_SIZE > len(y):
            break
        segment = y[offset:offset + FFT_SIZE]
        scratch.fill(0)
        scratch[:len(segment)] = (segment.astype('float64') - float(np.mean(segment, dtype='float64'))) * window[:len(segment)]
        transform = np.fft.rfft(scratch)
        power = transform.real ** 2 + transform.imag ** 2
        power[:first] = 0
        mass = float(power[selected].sum())
        if mass > 1e-10:
            bins = last - first + 1
            peak_bin = first + int(np.argmax(power[selected]))
            centroid = float(np.dot(power[selected], frequencies[selected]))
            index = min(last, first + int(np.searchsorted(np.cumsum(power[selected]), .85 * mass)))
            floor = mass / bins * 1e-12
            flatness = float(np.exp(np.log(np.maximum(floor, power[selected])).mean()) / (mass / bins))
            upper = float(power[np.arange(len(power)) > peak_bin * 1.5].sum())
            magnitude = np.sqrt(power / mass)
            if was_active or frames > 0:
                flux = float(np.sqrt(np.square(np.maximum(0, magnitude - previous)).sum()))
                flux_sum += flux
                flux_peak = max(flux_peak, flux)
                flux_count += 1
            previous[:] = magnitude
            was_active = True
            totals += [centroid, mass * frequencies[index], mass * min(1, max(0, flatness)), upper]
            for band, mask in enumerate(masks):
                band_energy[band] += power[mask].sum()
            weight += mass
            active += 1
        else:
            previous.fill(0)
            was_active = False
        frames += 1
    signs = y >= 0
    rms = float(np.sqrt(np.mean(np.square(y.astype('float64')))))
    peak = float(np.max(np.abs(y)))
    crest = peak / rms if rms else 0.0
    return {'sample_rate': rate, 'duration_seconds': len(y) / rate,
            'rms': rms, 'rms_db': float(20 * np.log10(max(rms, 1e-8))), 'peak': peak,
            'crest_factor': crest, 'crest_factor_db': float(20 * np.log10(crest)) if crest else 0.0,
            'zero_crossing_rate': float(np.count_nonzero(signs[1:] != signs[:-1]) / max(1, len(y) - 1)),
            'spectral_centroid_hz': float(totals[0] / weight) if weight else 0,
            'spectral_rolloff_85_hz': float(totals[1] / weight) if weight else 0,
            'spectral_flatness': float(totals[2] / weight) if weight else 0,
            'harmonic_energy_ratio': float(totals[3] / weight) if weight else 0,
            'spectral_flux': flux_sum / flux_count if flux_count else 0, 'spectral_flux_peak': flux_peak,
            'band_energy_ratios': (band_energy / band_energy.sum()).tolist() if band_energy.sum() else [0.] * 6,
            'spectral_frames': frames, 'active_spectral_frames': active, 'fft_size': FFT_SIZE,
            'audio_source': 'full_mix', 'feature_version': 3}
