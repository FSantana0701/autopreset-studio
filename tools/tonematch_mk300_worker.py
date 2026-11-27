"""Isolated Python 3.11 DSP worker; never imports GT-1 transport or browser cookies."""
from __future__ import annotations
import argparse
from importlib.metadata import version
import json
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--isolated", action="store_true")
    args = parser.parse_args()
    work = args.output.resolve().parent
    os.environ["TONEMATCH_DATA"] = str(work / "tonematch-data")
    for key in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "NUMBA_NUM_THREADS"):
        os.environ.setdefault(key, "1")
    import numpy as np
    import soundfile as sf
    import librosa
    from tonematch.analysis import analyze
    audio, sr = sf.read(args.audio, dtype="float32", always_2d=True)
    if not np.isfinite(audio).all() or not 8 <= len(audio) / sr <= 45.1:
        raise ValueError("Áudio precisa conter 8–45 segundos finitos.")
    if audio.shape[1] > 2:
        audio = audio[:, :2]
    if np.max(np.abs(audio)) < 1e-5:
        raise ValueError("Áudio silencioso.")
    if sr != 44100:
        audio = librosa.resample(audio.T, orig_sr=sr, target_sr=44100).T
    if audio.shape[1] == 1:
        audio = np.repeat(audio, 2, axis=1)
    mix = work / "tonematch-mix.wav"
    sf.write(mix, audio, 44100, subtype="PCM_24")
    if args.isolated:
        guitar = mix
        separation = {"method": "user_declared_isolated", "guitar_isolated": False,
                      "source_separation_executed": False}
    else:
        import torch
        from demucs.api import Separator, save_audio
        torch.set_num_threads(1)
        torch.manual_seed(0)
        separator = Separator(model="htdemucs_6s", device="cpu", shifts=0, split=True, segment=4)
        _, stems = separator.separate_audio_file(str(mix))
        if "guitar" not in stems or not bool(stems["guitar"].isfinite().all()):
            raise ValueError("O separador não produziu guitarra válida.")
        guitar = work / "tonematch-guitar.wav"
        save_audio(stems["guitar"], str(guitar), samplerate=separator.samplerate)
        separation = {"method": "demucs_htdemucs_6s", "guitar_isolated": True,
                      "source_separation_executed": True,
                      "quality": "estimated_stem_with_possible_bleed_and_artifacts"}
    result = analyze(guitar, mix).to_dict()
    # Window diagnostics are not needed for preset translation or API payloads.
    result.pop("windows", None)
    payload = {"analysis": result, "separation": separation,
               "versions": {"tonematch": version("tonematch")}}
    encoded = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    if len(encoded.encode("utf-8")) > 256 * 1024:
        raise ValueError("Relatório de análise excedeu o limite.")
    args.output.write_text(encoded, encoding="utf-8")

if __name__ == "__main__":
    main()
