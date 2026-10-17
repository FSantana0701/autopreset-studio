"""MK-300 model metadata derived from the IDs shipped with the PWA."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EQ_ANALYSIS_BANDS_HZ = (100, 300, 1000, 3000, 8000)
EQ_DEVICE_BANDS_HZ = (100, 200, 400, 800, 1600, 3200)


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    return json.loads((ROOT / "src/data/mk300-v73-parameters.json").read_text(encoding="utf-8"))


def models(block_name: str) -> list[dict[str, Any]]:
    block = next(block for block in load_catalog()["blocks"] if block["name"] == block_name)
    return block["models"]


AMP_MODELS = models("AMP")
DS_MODELS = models("DS")
CAB_SLOTS = models("CAB")
EQ_BANDS = [{"frequency_hz": f} for f in EQ_ANALYSIS_BANDS_HZ]
DLY_TYPES = models("DLY")
REV_TYPES = models("REV")


def public_catalog() -> dict[str, Any]:
    return {"firmware": "v75-compatible", "source": "catalog shipped with MK-300 editor; V75 retains these model indexes",
            "blocks": {name: models(name) for name in ("GATE", "DS", "AMP", "CAB", "EQ", "DLY", "REV")},
            "eq_analysis_bands_hz": list(EQ_ANALYSIS_BANDS_HZ),
            "eq_device_bands_hz": list(EQ_DEVICE_BANDS_HZ)}
