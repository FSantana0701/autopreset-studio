"""Chunked spectral features, using float32 scratch and one reusable STFT per chunk."""
from pathlib import Path
import gc
from .spectral import BLOCK_SECONDS, FREQUENCIES, stft, mfcc
from .catalog import EQ_ANALYSIS_BANDS_HZ, EQ_DEVICE_BANDS_HZ


def analyze(path: Path) -> dict:
    import numpy as np
    import soundfile as sf
    from .errors import ServiceError

    mfcc_sum = np.zeros(13, dtype=np.float64)
    totals = np.zeros(3, dtype=np.float64)
    frame_count = samples = crossings = 0
    energy = peak = 0.0
    previous = None
    band_power = np.zeros(len(EQ_ANALYSIS_BANDS_HZ), dtype=np.float64)
    envelope_parts = []
    band_edges = [0.0] + [float((a*b) ** 0.5) for a, b in zip(EQ_ANALYSIS_BANDS_HZ, EQ_ANALYSIS_BANDS_HZ[1:])] + [8000.0]
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
            for band in range(len(EQ_ANALYSIS_BANDS_HZ)):
                mask = (FREQUENCIES >= band_edges[band]) & (FREQUENCIES < band_edges[band+1])
                if mask.any():
                    band_power[band] += float(power[mask].mean(axis=0).sum())
            for offset in range(0, len(y), max(1, sr//100)):
                frame = y[offset:offset+max(1, sr//100)]
                if frame.size:
                    envelope_parts.append(float(np.sqrt(np.mean(frame.astype(np.float64)**2))))
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
    nonzero = band_power[band_power > 1e-20]
    reference = float(np.exp(np.log(nonzero).mean())) if nonzero.size else 1e-20
    virtual_db = np.clip(10*np.log10(np.maximum(band_power, 1e-20)/reference), -12, 12)
    device_db = np.rint(np.interp(np.log(EQ_DEVICE_BANDS_HZ), np.log(EQ_ANALYSIS_BANDS_HZ), virtual_db)).astype(int)
    envelope = np.asarray(envelope_parts, dtype=np.float64)
    delay_ms = None
    if envelope.size >= 120 and np.std(envelope) > 1e-7:
        envelope -= envelope.mean()
        fft_size = 1 << (2*envelope.size-1).bit_length()
        transformed = np.fft.rfft(envelope, n=fft_size)
        corr = np.fft.irfft(transformed * transformed.conjugate(), n=fft_size)[:envelope.size]
        if corr[0] > 1e-12:
            corr /= corr[0]
            window = corr[20:61]
            peaks = np.asarray([index for index in range(1, len(window)-1)
                               if window[index] > window[index-1] and window[index] >= window[index+1]
                               and window[index]-max(window[index-1],window[index+1]) >= 0.035])
            if peaks.size:
                lags = peaks + 20
                best = int(lags[np.argmax(corr[lags])])
                if corr[best] >= 0.12:
                    delay_ms = int(round(best*10))
    result = {"sample_rate": sr, "duration_seconds": samples/sr,
            "mfcc": (mfcc_sum/max(1,frame_count)).tolist(),
            "spectral_centroid_hz": float(totals[0]/frame_count),
            "spectral_rolloff_85_hz": float(totals[1]/frame_count),
            "spectral_flatness": float(totals[2]/frame_count),
            "zero_crossing_rate": crossings/max(1,samples-1),
            "rms": rms, "rms_db": float(20*np.log10(rms)),
            "crest_factor": peak/rms, "crest_factor_db": float(20*np.log10(max(peak/rms,1e-8))),
            "eq_virtual_bands_hz": list(EQ_ANALYSIS_BANDS_HZ),
            "eq_virtual_gain_db": np.round(virtual_db, 2).tolist(),
            "eq_device_bands_hz": list(EQ_DEVICE_BANDS_HZ), "eq_device_values": device_db.tolist(),
            "delay_detected": delay_ms is not None, "delay_time_ms": delay_ms,
            "audio_source": "hpss_harmonic", "feature_version": 1}
    # The decision uses the same relative-power FFT descriptors as the browser.
    # MFCC/virtual EQ diagnostics above remain available for existing clients.
    from .tone_features import extract
    result.update(extract(path))
    return result
