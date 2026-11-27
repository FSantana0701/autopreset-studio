"""Translate ToneMatch DSP profiles into catalog-checked MK-300 drafts.

This is an independent adapter. It never imports BOSS device I/O, copies GT-1
knob values, or claims that spectral descriptors identify the original rig.
"""
from __future__ import annotations

import base64
import math
import struct
from typing import Any

from services.catalog import EQ_DEVICE_BANDS_HZ, load_catalog
from services.dzh_encoder import encode, model_index

UPSTREAM_REPOSITORY = "https://github.com/borabiricik/tonematch"
UPSTREAM_REVISION = "cf258995d83682154a81ee8df5dafde3bdd975fe"
AMP_BY_CLASS = {
    "clean": "Fender Super",
    "crunch": "6DS-MarsFD100",
    "high_gain": "53DS-Pey5150",
}
COMMON_WARNINGS = [
    "Sugestão heurística: não identifica de forma única os equipamentos da gravação.",
    "AMP/DS/CAB usam somente índices ancorados nas exportações V75 do proprietário.",
    "Compatibilidade sonora e de importação na V076 ainda requer teste na pedaleira.",
    "Os níveis são pontos de partida; não houve normalização de volume entre presets na MK-300.",
    "NAM e IR não são incorporados ao .dzh; confirme o conteúdo instalado nos slots.",
    "Chorus/phaser não são detectados pelo analisador; modulação só é adicionada por escolha explícita.",
]


def number(value: Any, name: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name}: esperado número.")
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name}: número fora do intervalo.")
    return value


def clipped(value: float, low: int, high: int) -> int:
    return int(round(min(high, max(low, value))))


def _block(block_id: int, block_name: str, name: str, settings: dict[str, int],
           catalog: dict) -> dict:
    index = model_index(block_name, name)
    family = next(item for item in catalog["blocks"] if item["id"] == block_id)
    model = next(item for item in family["models"] if item["index"] == index)
    unknown = set(settings) - set(model["knobs"])
    if unknown:
        raise ValueError(f"Controles inexistentes em {name}: {sorted(unknown)}")
    values = []
    defaults = model.get("defaults", [])
    for position, knob in enumerate(model["knobs"]):
        if knob in settings:
            value = settings[knob]
        elif position < len(defaults):
            value = defaults[position]
        elif knob == "Sync":
            value = 0
        else:
            raise ValueError(f"Sem valor confirmado para {name}/{knob}.")
        if type(value) is not int or not -32768 <= value <= 32767:
            raise ValueError(f"Valor bruto inválido para {name}/{knob}.")
        values.append(value)
    return {"id": block_id, "model_index": index, "model_name": name,
            "knobs": list(model["knobs"]), "values": values}


def _sample_spectrum(profile: dict, frequency: int) -> float:
    spectrum = profile.get("third_oct_db", {})
    if not isinstance(spectrum, dict):
        raise ValueError("third_oct_db deve ser um objeto.")
    points = []
    for label, value in spectrum.items():
        if not isinstance(label, str):
            raise ValueError("Frequência espectral inválida.")
        try:
            normalized = label.lower().removesuffix("hz")
            hz = float(normalized[:-1]) * 1000 if normalized.endswith("k") else float(normalized)
        except ValueError as exc:
            raise ValueError("Frequência espectral inválida.") from exc
        points.append((number(hz, "frequência", 20, 22050),
                       number(value, "nível espectral", -160, 160)))
    if not points:
        return 0.0
    points.sort()
    if frequency <= points[0][0]:
        return points[0][1]
    for (a, av), (b, bv) in zip(points, points[1:]):
        if a <= frequency <= b:
            if a == b:
                return av
            ratio = math.log(frequency / a) / math.log(b / a)
            return av + ratio * (bv - av)
    return points[-1][1]


def suggest_group(group: str, profile: dict, *, boost: bool = False,
                  compress_clean: bool = False, modulation: str = "none") -> dict:
    if not isinstance(profile, dict):
        raise ValueError("Perfil de timbre inválido.")
    if modulation not in {"none", "Chorus", "Phaser"}:
        raise ValueError("Modulação não suportada.")
    tone_class = profile.get("gain_class")
    if tone_class not in AMP_BY_CLASS:
        raise ValueError("Classe de ganho não reconhecida.")
    gain = number(profile.get("gain"), "gain", 0, 1)
    number(profile.get("seconds"), "seconds", 6, 45.1)
    descriptors = profile.get("descriptors", {})
    if not isinstance(descriptors, dict):
        raise ValueError("Descritores inválidos.")
    desc = {key: number(descriptors.get(key, 0), key, -160, 160)
            for key in ("body_db", "mid_scoop_db", "presence_db", "fizz_db", "low_depth_db")}
    catalog = load_catalog()
    drive = (22 + 35 * gain if tone_class == "clean" else
             20 + 48 * gain if tone_class == "crunch" else 35 + 35 * gain)
    amp_settings = {
        "Gain": clipped(drive, 10, 75), "Level": 55,
        "Bass": clipped(50 + .3 * desc["body_db"], 38, 60),
        "Middle": clipped(53 + .3 * desc["mid_scoop_db"], 42, 65),
        "Treble": clipped(50 + .25 * desc["presence_db"], 38, 62),
        "Pres": clipped(48 + .2 * desc["fizz_db"], 35, 60),
        "Reso": 0, "Bright": 50,
    }
    blocks = []
    if compress_clean and tone_class == "clean":
        blocks.append(_block(1, "FX", "Compress",
                             {"Sustain": 35, "Attack": 55, "Level": 50, "Blend": 65}, catalog))
    if boost:
        blocks.append(_block(3, "DS", "MW-808", {
            "Gain": 12, "Level": 55, "Bass": 45, "Middle": 55,
            "Treble": 48, "Reso": 0, "Pres": 50, "Bright": 50}, catalog))
    blocks.append(_block(4, "AMP", AMP_BY_CLASS[tone_class], amp_settings, catalog))
    cab = "1EAGLProV30s" if tone_class == "high_gain" else "44MarVal4"
    # These are existing raw controls, not an uncalibrated conversion from Hz.
    blocks.append(_block(5, "CAB", cab, {"Level": 55, "Low Cut": 20, "High Cut": 117}, catalog))
    eq = [clipped(.15 * _sample_spectrum(profile, hz), -2, 2) for hz in EQ_DEVICE_BANDS_HZ]
    eq_model = next(b for b in catalog["blocks"] if b["id"] == 6)["models"][0]
    blocks.append(_block(6, "EQ", "Guitar EQ 6", dict(zip(eq_model["knobs"], eq)), catalog))
    if modulation == "Chorus":
        blocks.append(_block(7, "MOD", "Chorus", {"Depth": 15, "Mix": 12, "Sync": 0}, catalog))
    elif modulation == "Phaser":
        blocks.append(_block(7, "MOD", "Phaser", {"MidCut": 40, "Reso": 30, "Fb": 20, "Sync": 0}, catalog))
    delay = profile.get("delay", {})
    if not isinstance(delay, dict) or type(delay.get("detected", False)) is not bool:
        raise ValueError("Estimativa de delay inválida.")
    warnings = list(COMMON_WARNINGS)
    if delay.get("detected") is True:
        milliseconds = number(delay.get("time_ms"), "delay.time_ms", 70, 1200)
        feedback = number(delay.get("feedback", 0), "delay.feedback", 0, .9)
        # The current writer has verified integer ms up to 1000; do not silently clamp a detected echo.
        if milliseconds <= 1000:
            name = "PingPong Stereo" if delay.get("pingpong") is True else "Clean"
            blocks.append(_block(8, "DLY", name, {
                "Time": int(round(milliseconds)), "Fb": clipped(feedback * 100, 10, 45),
                "Mix": 18, "Sync": 0}, catalog))
        else:
            warnings.append("Eco acima de 1000 ms: mantido no relatório, sem tradução automática do controle.")
    elif delay.get("possible"):
        warnings.append("Eco apenas possível: delay permanece desligado.")
    reverb = profile.get("reverb", {})
    if not isinstance(reverb, dict):
        raise ValueError("Estimativa de ambiência inválida.")
    amount = reverb.get("amount", "unknown")
    if amount not in {"dry", "small", "medium", "large", "unknown"}:
        raise ValueError("Classe de ambiência inválida.")
    if amount in {"small", "medium", "large"}:
        name = "Room" if amount == "small" else "Hall"
        # Decay is a raw MK-300 starting point, not a fabricated RT60 -> knob calibration.
        decay, mix = {"small": (18, 12), "medium": (28, 18), "large": (40, 22)}[amount]
        blocks.append(_block(9, "REV", name, {
            "Decay": decay, "Mix": mix, "High Pass": 80, "Low Pass": 80, "Mod Depth": 15}, catalog))
        warnings.append("Ambiência estimada por caudas; sustain, mixagem e separação podem influenciar.")
    else:
        warnings.append("Sem evidência de ambiência suficiente: reverb permanece desligado.")
    label = {"clean": "CLEAN", "crunch": "CRUNCH", "high_gain": "DRIVE"}[tone_class]
    if group == "lead":
        label = "LEAD"
    return {
        "name": "TM-" + label, "firmware": "v75", "blocks": blocks,
        "classification": {"profile": tone_class, "confidence": "low",
                           "method": "tonematch_dsp_to_mk300", "gain_is_starting_point": True},
        "diagnosis": {"source_group": group, "modulation_detection": False,
                      "model_selection": "heuristic_with_owner_confirmed_indices",
                      "v076_hardware_verified": False, "volume_matched_on_hardware": False},
        "warnings": warnings,
    }


def translate_analysis(analysis: dict, *, boost: bool = False, compress_clean: bool = False,
                       modulation: str = "none") -> dict:
    if not isinstance(analysis, dict) or not isinstance(analysis.get("groups"), dict):
        raise ValueError("Esperado relatório ToneMatch com groups.")
    number(analysis.get("duration"), "duration", 8, 45.1)
    presence = number(analysis.get("guitar_presence"), "guitar_presence", 0, 1)
    if presence < .05 or not analysis["groups"] or len(analysis["groups"]) > 8:
        raise ValueError("Guitarra insuficiente para sugerir um preset.")
    tempo = number(analysis.get("tempo"), "tempo", 0, 400)
    results = []
    for ordinal, (group, profile) in enumerate(analysis["groups"].items(), 1):
        if not isinstance(group, str) or len(group) > 80:
            raise ValueError("Nome de grupo inválido.")
        preset = suggest_group(group, profile, boost=boost,
                               compress_clean=compress_clean, modulation=modulation)
        raw = bytearray(encode(preset))
        if 40 <= tempo <= 240:
            struct.pack_into("<H", raw, 0x1a, int(round(tempo)))
        if len(raw) != 448:
            raise ValueError("Exportação .dzh inválida.")
        results.append({"group": group, "preset": preset, "filename": f"{ordinal:02d}-" + preset["name"] + ".dzh",
                        "size_bytes": len(raw), "dzh_base64": base64.b64encode(raw).decode("ascii")})
    return {"engine": "tonematch-mk300", "firmware_catalog": "v75-owner-confirmed",
            "upstream_revision": UPSTREAM_REVISION, "analysis": analysis, "presets": results,
            "hardware_verified": False, "warnings": list(COMMON_WARNINGS)}
