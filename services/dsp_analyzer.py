"""Chunked spectral features, using float32 scratch and one reusable STFT per chunk."""
from pathlib import Path
import gc
from .spectral import BLOCK_SECONDS, FREQUENCIES, stft, mfcc


def analyze(path: Path) -> dict:
    import numpy as np
    import soundfile as sf
    from .errors import ServiceError

    mfcc_sum = np.zeros(13, dtype=np.float64)
    totals = np.zeros(3, dtype=np.float64)
    frame_count = samples = crossings = 0
    energy = peak = 0.0
    previous = None
    with sf.SoundFile(path) as audio:
        sr = audio.samplerate
        if sr != 16000 or audio.channels != 1 or not 0 < len(audio) <= sr*45:
            raise ServiceError("Trecho harmônico inválido.")
        for y in audio.blocks(blocksize=sr*BLOCK_SECONDS, dtype="float32"):
            if not np.isfinite(y).all():
                raise ServiceError("Áudio contém amostras inválidas.")
            samples += len(y)
            energy += float(np.dot(y.astype(np.float64), y))
            peak = max(peak, float(np.max(np.abs(y))))
            signs = y >= 0
            crossings += int(np.count_nonzero(signs[1:] != signs[:-1]))
            if previous is not None:
                crossings += int(previous != bool(signs[0]))
            previous = bool(signs[-1])
            spectrum = np.abs(stft(y))
            power = spectrum*spectrum
            coefficients = mfcc(power)
            frames = coefficients.shape[1]
            mfcc_sum += coefficients.sum(axis=1)
            del coefficients
            gc.collect()  # MFCC/DCT/mel scratch is no longer referenced.
            mass = np.maximum(spectrum.sum(axis=0),1e-20)
            centroid = (FREQUENCIES[:,None]*spectrum).sum(axis=0)/mass
            cumulative = np.cumsum(spectrum,axis=0)
            rolloff = FREQUENCIES[np.argmax(cumulative>=.85*mass,axis=0)]
            clamped = np.maximum(power,1e-10)
            flatness = np.exp(np.mean(np.log(clamped),axis=0))/np.mean(clamped,axis=0)
            totals += [float(centroid.sum()),float(rolloff.sum()),float(flatness.sum())]
            del spectrum, power, mass, centroid, cumulative, rolloff, clamped, flatness
            frame_count += frames
            gc.collect()
    rms = (energy/max(1,samples))**0.5
    if rms < 1e-5:
        raise ServiceError("O trecho harmônico está silencioso ou muito baixo. Escolha outro intervalo.", code="quiet_audio")
    return {"sample_rate": sr, "duration_seconds": samples/sr,
            "mfcc": (mfcc_sum/max(1,frame_count)).tolist(),
            "spectral_centroid_hz": float(totals[0]/frame_count),
            "spectral_rolloff_85_hz": float(totals[1]/frame_count),
            "spectral_flatness": float(totals[2]/frame_count),
            "zero_crossing_rate": crossings/max(1,samples-1),
            "rms": rms, "rms_db": float(20*np.log10(rms)),
            "crest_factor": peak/rms, "crest_factor_db": float(20*np.log10(max(peak/rms,1e-8))),
            "audio_source": "hpss_harmonic", "feature_version": 1}
