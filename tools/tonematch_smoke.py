"""Offline pipeline verification on a synthetic signal, not a tone-quality benchmark."""
from pathlib import Path
import argparse
import json
import os
import sys
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.tonematch_runtime import analyze_reference
from tools.tonematch_mk300 import write_bundle

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    sr = 44100
    t = np.arange(sr * 16) / sr
    envelope = .4 + .6 * np.exp(-3 * (t % .5))
    signal = .08 * envelope * (np.sin(2*np.pi*220*t) + .3*np.sin(2*np.pi*330*t) + .2*np.sin(2*np.pi*440*t))
    audio = args.output / "synthetic-input.wav"
    sf.write(audio, np.column_stack([signal, signal * .95]), sr, subtype="PCM_16")
    result = analyze_reference(audio, args.output, isolated=True)
    result["verification_scope"] = "synthetic_pipeline_only_not_real_guitar_or_youtube_or_hardware"
    write_bundle(result, args.output)
    assert result["presets"]
    assert all(item["size_bytes"] == 448 for item in result["presets"])
    assert result["separation"]["source_separation_executed"] is False
    print(json.dumps({"pipeline": "passed", "scope": result["verification_scope"],
                     "presets": len(result["presets"])}, indent=2))

if __name__ == "__main__":
    main()
