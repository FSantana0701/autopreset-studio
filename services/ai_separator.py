"""HPSS is not guitar isolation: voices/bass/keys remain in the harmonic component."""
from pathlib import Path
import gc
from .spectral import BLOCK_SECONDS, SAMPLE_RATE, hpss
BLOCK_FRAMES = SAMPLE_RATE * BLOCK_SECONDS
HALO = 4096


def separate_harmonic(source: Path, target: Path) -> dict:
    import numpy as np
    import soundfile as sf
    from .errors import ServiceError

    with sf.SoundFile(source) as audio:
        if audio.samplerate != SAMPLE_RATE or not 0 < len(audio) <= SAMPLE_RATE * 45 or not 1 <= audio.channels <= 2:
            raise ServiceError("Esperado um trecho PCM de até 45 s, 16 kHz e até dois canais.")
        with sf.SoundFile(target, "w", samplerate=SAMPLE_RATE, channels=1, subtype="PCM_16") as output:
            for start in range(0, len(audio), BLOCK_FRAMES):
                left = max(0, start-HALO)
                count = min(BLOCK_FRAMES, len(audio)-start)
                audio.seek(left)
                data = audio.read(min(len(audio)-left, count + HALO*2), dtype="float32", always_2d=True)
                if not np.isfinite(data).all():
                    raise ServiceError("Áudio contém amostras não finitas.")
                # A dominant channel avoids cancellation of opposite-phase stereo.
                channel = int(np.argmax(np.mean(data*data, axis=0)))
                signal = np.ascontiguousarray(data[:, channel])
                if np.max(np.abs(signal)) < 1e-7:
                    harmonic = signal
                else:
                    harmonic = hpss(signal)
                    gc.collect()  # HPSS scratch arrays are now out of scope.
                output.write(harmonic[start-left:start-left+count])
                del data, signal, harmonic
                gc.collect()
    return {"method": "HPSS", "guitar_isolated": False,
            "warning": "Componente harmônica aproximada: pode conter guitarra, voz, baixo e teclados."}
