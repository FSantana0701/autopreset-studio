"""Provision an isolated CPU runtime. Requires uv, git and system FFmpeg."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = "cf258995d83682154a81ee8df5dafde3bdd975fe"

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, default=ROOT / ".tonematch-runtime")
    args = parser.parse_args()
    for executable in ("uv", "git", "ffmpeg"):
        if not shutil.which(executable):
            raise SystemExit(f"Instale {executable} antes de configurar o runtime.")
    runtime = args.runtime.resolve()
    uv = shutil.which("uv")
    subprocess.run([uv, "venv", "--python", "3.11", str(runtime)], check=True)
    python = runtime / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    subprocess.run([uv, "pip", "install", "--python", str(python), "--index-url",
                    "https://download.pytorch.org/whl/cpu", "torch==2.5.1+cpu", "torchaudio==2.5.1+cpu"], check=True)
    constraint = runtime / "cpu-constraint.txt"
    constraint.write_text("torch==2.5.1+cpu\ntorchaudio==2.5.1+cpu\n", encoding="utf-8")
    subprocess.run([uv, "pip", "install", "--python", str(python), "--constraint", str(constraint),
                    "-r", str(ROOT / "requirements-tonematch-worker.txt")], check=True)
    subprocess.run([uv, "pip", "install", "--python", str(python), "--no-deps",
                    "git+https://github.com/borabiricik/tonematch.git@" + UPSTREAM], check=True)
    subprocess.run([str(python), "-c", "from tonematch.analysis import analyze; from demucs.api import Separator; print('DSP imports OK')"],
                   env={**os.environ, "TONEMATCH_DATA": str(runtime / "data")}, check=True)
    print("Runtime configurado. Defina TONEMATCH_PYTHON=" + str(python))

if __name__ == "__main__":
    main()
