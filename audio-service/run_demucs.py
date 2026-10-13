"""Run Demucs with a standard-library WAV writer for torchaudio compatibility."""

from __future__ import annotations

import sys
import wave
from pathlib import Path

import numpy as np
import torchaudio


def save_pcm16(path: str, source, sample_rate: int, **_kwargs) -> None:
    audio = source.detach().cpu().float().clamp(-1, 1).numpy()
    if audio.ndim == 1:
        audio = audio[None, :]
    interleaved = np.rint(audio.T * 32767).astype("<i2", copy=False)
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(target), "wb") as output:
        output.setnchannels(audio.shape[0])
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(interleaved.tobytes())


torchaudio.save = save_pcm16
from demucs.separate import main


if __name__ == "__main__":
    main()
