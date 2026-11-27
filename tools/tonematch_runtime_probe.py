"""Check the provisioned separator and one public YouTube reference without hiding failures."""
from pathlib import Path
import json
import os
import subprocess
import sys
import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.tonematch_runtime import WORKER, extract_youtube_reference, analyze_reference
from tools.tonematch_mk300 import write_bundle
from services.errors import ServiceError

def main():
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)
    t = np.arange(44100 * 12) / 44100
    signal = .1 * np.sin(2*np.pi*220*t) * np.exp(-4*(t % .5))
    source = output / "synthetic.wav"
    sf.write(source, np.column_stack([signal, signal]), 44100)
    report = output / "worker.json"
    subprocess.run([os.environ["TONEMATCH_PYTHON"], str(WORKER),
                    "--audio", str(source), "--output", str(report)], check=True, timeout=240)
    worker = json.loads(report.read_text())
    assert worker["separation"]["source_separation_executed"] is True
    assert worker["separation"]["method"] == "demucs_htdemucs_6s"
    probe = {"separator_execution": "passed_on_synthetic_audio",
             "musical_fidelity_verified": False, "youtube": {"audio_downloaded": False}}
    # A public reference previously supplied by the owner; never use browser cookies.
    try:
        audio, _ = extract_youtube_reference("https://www.youtube.com/watch?v=Uz31UqPTr0E",
                                          30, 42, output)
    except ServiceError as exc:
        probe["youtube"] = {"audio_downloaded": False, "error": type(exc).__name__,
                            "code": getattr(exc, "code", None)}
    else:
        probe["youtube"] = {"audio_downloaded": audio.is_file(),
                            "preset_generation_passed": False,
                            "tone_fidelity_verified": False}
        try:
            result = analyze_reference(audio, output)
            write_bundle(result, output / "youtube")
            probe["youtube"]["preset_generation_passed"] = True
            probe["youtube"]["presets"] = len(result["presets"])
        except ServiceError as exc:
            probe["youtube"]["analysis_error"] = getattr(exc, "code", type(exc).__name__)
    (output / "probe.json").write_text(json.dumps(probe, indent=2), encoding="utf-8")
    print(json.dumps(probe, indent=2))

if __name__ == "__main__":
    main()
