"""CLI: reference audio or YouTube -> ToneMatch -> MK-300 .dzh drafts."""
from __future__ import annotations
import argparse
import base64
import json
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from services.tonematch_mk300 import translate_analysis
from services.tonematch_runtime import analyze_reference, decode_reference, extract_youtube_reference, runtime_python
from services.errors import ServiceError

def write_bundle(result, destination):
    destination.mkdir(parents=True, exist_ok=True)
    # Filenames are generated from ordinal positions, never supplied by a source report.
    for index, item in enumerate(result["presets"], 1):
        filename = f"{index:02d}-" + item["preset"]["name"] + ".dzh"
        raw = base64.b64decode(item["dzh_base64"], validate=True)
        if len(raw) != 448:
            raise ValueError("Preset .dzh inválido.")
        (destination / filename).write_bytes(raw)
        item["filename"] = filename
    (destination / "report.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Arquivo MP3/WAV/M4A ou link público YouTube")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--start", type=float, default=0)
    parser.add_argument("--end", type=float, default=30)
    parser.add_argument("--from-analysis", action="store_true", help="Traduz um JSON ToneMatch já calculado")
    parser.add_argument("--isolated", action="store_true", help="Declara arquivo de guitarra isolada; não executa separação")
    parser.add_argument("--boost", action="store_true")
    parser.add_argument("--compress-clean", action="store_true")
    parser.add_argument("--modulation", choices=("none", "Chorus", "Phaser"), default="none")
    args = parser.parse_args()
    settings = {"boost": args.boost, "compress_clean": args.compress_clean, "modulation": args.modulation}
    if args.from_analysis:
        path = Path(args.source)
        if path.stat().st_size > 256 * 1024:
            raise ValueError("Relatório excede 256 KiB.")
        data = json.loads(path.read_text(encoding="utf-8"))
        result = translate_analysis(data.get("analysis", data), **settings)
    else:
        runtime_python()
        with tempfile.TemporaryDirectory(prefix="mk300-tonematch-cli-") as directory:
            work = Path(directory)
            if args.source.startswith(("https://", "http://")):
                if args.isolated:
                    raise ValueError("--isolated só pode ser declarado para arquivo local.")
                audio, provenance = extract_youtube_reference(args.source, args.start, args.end, work)
                result = analyze_reference(audio, work, **settings)
            else:
                source = Path(args.source).resolve(strict=True)
                if source.suffix.lower() not in {".wav", ".mp3", ".m4a"}:
                    raise ValueError("Envie MP3, WAV ou M4A.")
                if source.stat().st_size > 15 * 1024 * 1024:
                    raise ValueError("Áudio excede 15 MiB.")
                audio = work / "reference.wav"
                provenance = decode_reference(source, audio, args.start, args.end)
                result = analyze_reference(audio, work, isolated=args.isolated, **settings)
            result["source"] = provenance
    write_bundle(result, args.output)
    print(json.dumps({"status": "drafts_created", "engine": result["engine"],
                      "presets": [item["filename"] for item in result["presets"]],
                      "hardware_verified": False}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except (ServiceError, ValueError, OSError) as exc:
        print(json.dumps({"status": "failed", "code": getattr(exc, "code", "invalid_input"),
                          "detail": str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(2)
