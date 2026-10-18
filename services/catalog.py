"""V75 labels verified against owner exports; legacy data stays available."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EQ_ANALYSIS_BANDS_HZ = (100, 300, 1000, 3000, 8000)
EQ_DEVICE_BANDS_HZ = (100, 200, 400, 800, 1600, 3200)
V75 = json.loads((ROOT / "src/data/mk300-v75-confirmed.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_catalog() -> dict[str, Any]:
    catalog = json.loads((ROOT / "src/data/mk300-v73-parameters.json").read_text(encoding="utf-8"))
    for item in V75["confirmed_models"]:
        block = next(block for block in catalog["blocks"] if block["id"] == item["block"])
        model = next((model for model in block["models"] if model["index"] == item["index"]), None)
        if model is None:
            model = {"index": item["index"], "knobs": list(block["models"][0]["knobs"])}
            block["models"].append(model)
        model.update(name=item["name"], verification="owner_export", evidence=item["evidence"])
    amp = next(block for block in catalog["blocks"] if block["name"] == "AMP")
    for index in V75["nam"]["observed_indices"]:
        model = next(model for model in amp["models"] if model["index"] == index)
        model.update(legacy_name=model["name"], name=f"Slot personalizado {index + 1} · nome a confirmar",
                     verification="custom_slot")
    catalog["firmware"] = "v75"
    return catalog


def models(block_name: str) -> list[dict[str, Any]]:
    block = next(block for block in load_catalog()["blocks"] if block["name"] == block_name)
    return block["models"]


WAH_MODELS = V75["models"]["WAH"]
FX_MODELS = V75["models"]["FX"]
GATE_MODELS = V75["models"]["GATE"]
AMP_MODELS = V75["models"]["AMP"]
DS_MODELS = V75["models"]["DS"]
CAB_MODELS = V75["models"]["CAB"]
EQ_MODELS = V75["models"]["EQ"]
MOD_MODELS = V75["models"]["MOD"]
DLY_MODELS = V75["models"]["DLY"]
REV_MODELS = V75["models"]["REV"]
NAM_MODELS = V75["models"]["NAM"]
CAB_SLOTS = models("CAB")
EQ_BANDS = [{"frequency_hz": f} for f in EQ_ANALYSIS_BANDS_HZ]
DLY_TYPES = models("DLY")
REV_TYPES = models("REV")


def public_catalog() -> dict[str, Any]:
    return {"firmware": "v75", "source": V75["source"],
            "blocks": {name: models(name) for name in ("WAH", "FX", "GATE", "DS", "AMP", "CAB", "EQ", "MOD", "DLY", "REV", "VOL")},
            "v75_names": V75["models"], "ui_models": V75.get("ui_models", V75["models"]),
            "model_indices_by_name": model_indices_by_name(),
            "confirmed_models": V75["confirmed_models"],
            "nam": V75["nam"],
            "unverified_names_selectable": False,
            "eq_analysis_bands_hz": list(EQ_ANALYSIS_BANDS_HZ),
            "eq_device_bands_hz": list(EQ_DEVICE_BANDS_HZ)}


def model_indices_by_name() -> dict[str, dict[str, int]]:
    """Map only exact V75 labels with a defensible physical binary index."""
    display = V75.get("ui_models", V75["models"])
    ids = {block["name"]: block["id"] for block in load_catalog()["blocks"]}
    confirmed_only = {"AMP", "DS", "CAB"}
    result: dict[str, dict[str, int]] = {}
    for name, labels in display.items():
        if name not in ids or not isinstance(labels, list):
            continue
        block_id = ids[name]
        mapping: dict[str, int] = {}
        if name in confirmed_only:
            for item in V75["confirmed_models"]:
                if item["block"] == block_id and item["name"] in labels:
                    mapping[item["name"]] = item["index"]
        else:
            available = models(name)
            for label in labels:
                matches = [item for item in available
                           if item["name"].casefold() == label.casefold()]
                if len(matches) == 1:
                    mapping[label] = matches[0]["index"]
        result[name] = mapping
    return result
