"""Behavioral checks for the adapter; no live YouTube, model downloads or device writes."""
import base64
from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys
import wave

import pytest
from fastapi.testclient import TestClient

import main
from services.catalog import V75
from services.dzh_encoder import reference_presets
from services.errors import ServiceError, YouTubeBlocked
from services.tonematch_mk300 import suggest_group, translate_analysis
from services import tonematch_runtime as runtime
from services import tonematch_routes as routes


def profile(**overrides):
    result = {
        "name": "clean", "seconds": 12, "segments": [[0, 12]], "gain": .3,
        "gain_class": "clean", "flatness": .02, "width": .1,
        "crest_db": 14, "sustain": .5, "descriptors": {"body_db": -3, "presence_db": -5},
        "third_oct_db": {"100Hz": 4, "400Hz": 0, "1.6kHz": -2, "3.2kHz": -8},
        "delay": {"detected": False, "possible": False}, "reverb": {"amount": "unknown"},
    }
    result.update(overrides)
    return result


def analysis(**overrides):
    result = {"tempo": 120, "duration": 12, "guitar_presence": .8, "groups": {"clean": profile()}}
    result.update(overrides)
    return result


def blocks(preset):
    return {b["id"]: b for b in preset["blocks"]}


@pytest.mark.parametrize("tone_class,index", [("clean", 0), ("crunch", 5), ("high_gain", 52)])
def test_catalog_checked_native_choices_and_binary_preservation(tone_class, index):
    source = analysis(groups={"rhythm": profile(gain_class=tone_class, gain=.7)})
    result = translate_analysis(source)
    record = result["presets"][0]
    raw = base64.b64decode(record["dzh_base64"], validate=True)
    base = base64.b64decode(reference_presets()[0]["base64"])
    assert len(raw) == 448 and raw[58] == index
    assert raw[330:] == base[330:]
    assert int.from_bytes(raw[26:28], "little") == 120
    assert blocks(record["preset"])[4]["model_name"] in {"Fender Super", "6DS-MarsFD100", "53DS-Pey5150"}
    for block in record["preset"]["blocks"]:
        if block["id"] in {3, 4, 5}:
            assert any(a["block"] == block["id"] and a["index"] == block["model_index"]
                       and a["name"] == block["model_name"] for a in V75["confirmed_models"])
    assert blocks(record["preset"])[5]["model_name"] in V75["ui_models"]["CAB"]
    assert result["hardware_verified"] is False


def test_ambiguous_echo_and_unknown_reverb_do_not_enable_effects():
    draft = suggest_group("clean", profile(delay={"detected": False, "possible": True, "time_ms": 400}))
    assert 8 not in blocks(draft) and 9 not in blocks(draft)
    assert any("apenas possível" in message for message in draft["warnings"])


def test_detected_echo_uses_ms_and_does_not_invent_rt60_knob_conversion():
    draft = suggest_group("lead", profile(
        delay={"detected": True, "time_ms": 375, "feedback": .32},
        reverb={"amount": "medium", "decay_s": 2.5}))
    delay = blocks(draft)[8]
    assert dict(zip(delay["knobs"], delay["values"]))["Time"] == 375
    assert dict(zip(delay["knobs"], delay["values"]))["Fb"] == 32
    assert blocks(draft)[9]["model_name"] == "Hall"
    assert draft["diagnosis"]["volume_matched_on_hardware"] is False


def test_echo_outside_mapped_range_is_reported_without_silent_clamping():
    draft = suggest_group("lead", profile(delay={"detected": True, "time_ms": 1150, "feedback": .3}))
    assert 8 not in blocks(draft)
    assert any("1000" in warning for warning in draft["warnings"])


def test_explicit_choices_use_real_controls_and_remain_optional():
    auto = suggest_group("clean", profile())
    assert not {1, 3, 7}.intersection(blocks(auto))
    requested = suggest_group("clean", profile(), boost=True, compress_clean=True, modulation="Chorus")
    selected = blocks(requested)
    assert selected[1]["model_name"] == "Compress"
    assert selected[3]["model_name"] == "MW-808"
    assert selected[7]["model_name"] == "Chorus"
    assert "Sync" in selected[7]["knobs"]
    assert suggest_group("clean", profile(), modulation="Phaser")
    with pytest.raises(ValueError):
        suggest_group("clean", profile(), modulation="imaginary")


@pytest.mark.parametrize("change", [
    {"gain": float("nan")}, {"gain": float("inf")}, {"gain": True},
    {"gain_class": "guessed_unknown"}, {"seconds": 0},
    {"descriptors": {"presence_db": float("nan")}},
    {"third_oct_db": {"not-a-frequency": 1}}, {"delay": {"detected": "yes"}},
    {"reverb": {"amount": "guess"}},
])
def test_invalid_profiles_never_export_a_preset(change):
    with pytest.raises(ValueError):
        translate_analysis(analysis(groups={"clean": profile(**change)}))


@pytest.mark.parametrize("change", [
    {"guitar_presence": 0}, {"guitar_presence": float("nan")},
    {"duration": 200}, {"groups": {}}, {"tempo": True},
])
def test_missing_evidence_is_rejected(change):
    with pytest.raises(ValueError):
        translate_analysis(analysis(**change))


def test_two_similar_groups_have_distinct_download_names():
    result = translate_analysis(analysis(groups={
        "rhythm": profile(gain_class="high_gain"), "rhythm2": profile(gain_class="high_gain")}))
    assert len({r["filename"] for r in result["presets"]}) == 2


def test_gate_and_modulation_are_not_inferred_from_flatness():
    result = translate_analysis(analysis())
    raw = base64.b64decode(result["presets"][0]["dzh_base64"])
    assert raw[43 + 2] == 0 and raw[43 + 7] == 0


def test_runtime_requires_explicit_configuration(monkeypatch, tmp_path):
    monkeypatch.setenv("TONEMATCH_PYTHON", str(tmp_path / "missing"))
    with pytest.raises(ServiceError) as error:
        runtime.runtime_python()
    assert error.value.status == 503


def test_worker_failure_returns_no_fake_analysis(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "runtime_python", lambda: sys.executable)
    monkeypatch.setattr(runtime.subprocess, "run", lambda *a, **k: subprocess.CompletedProcess([], 1, b"", b""))
    with pytest.raises(ServiceError) as error:
        runtime.analyze_reference(tmp_path / "input.wav", tmp_path)
    assert error.value.code == "tonematch_analysis_failed"


def test_worker_timeout_removes_any_partial_output(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "runtime_python", lambda: sys.executable)
    partial = tmp_path / "tonematch-analysis.json"
    partial.write_text("{}")
    def timeout(*a, **k):
        raise subprocess.TimeoutExpired("worker", 240)
    monkeypatch.setattr(runtime.subprocess, "run", timeout)
    with pytest.raises(ServiceError) as error:
        runtime.analyze_reference(tmp_path / "input.wav", tmp_path)
    assert error.value.status == 504 and not partial.exists()


def test_worker_json_translates_to_real_binary(monkeypatch, tmp_path):
    monkeypatch.setattr(runtime, "runtime_python", lambda: sys.executable)
    def run(*a, **k):
        (tmp_path / "tonematch-analysis.json").write_text(json.dumps({
            "analysis": analysis(), "separation": {"method": "user_declared_isolated",
                                                   "source_separation_executed": False}}))
        return subprocess.CompletedProcess([], 0, b"", b"")
    monkeypatch.setattr(runtime.subprocess, "run", run)
    result = runtime.analyze_reference(tmp_path / "input.wav", tmp_path, isolated=True)
    assert result["presets"][0]["size_bytes"] == 448
    assert result["separation"]["source_separation_executed"] is False


def test_youtube_block_is_propagated_without_cookie_or_client_retry(monkeypatch, tmp_path):
    calls = []
    def run(command, **kwargs):
        calls.append(command)
        return subprocess.CompletedProcess(command, 3, "", "")
    monkeypatch.setattr(runtime.subprocess, "run", run)
    with pytest.raises(YouTubeBlocked):
        runtime.extract_youtube_reference("https://youtu.be/Uz31UqPTr0E", 0, 12, tmp_path)
    assert len(calls) == 1
    assert calls[0][:3] == [sys.executable, "-m", "services.youtube"]


def test_youtube_403_during_audio_transfer_returns_no_partial_clip(monkeypatch, tmp_path):
    def run(command, **kwargs):
        if command[0] == sys.executable:
            Path(command[-1]).write_text(json.dumps({
                "url": "https://example.googlevideo.com/audio",
                "headers": {"User-Agent": "test"}, "title": "fixture", "duration": 60}))
            return subprocess.CompletedProcess(command, 0, "", "")
        (tmp_path / "tonematch-reference.wav").write_bytes(b"partial")
        return subprocess.CompletedProcess(command, 1, b"", b"HTTP 403 Forbidden")
    monkeypatch.setattr(runtime.subprocess, "run", run)
    with pytest.raises(YouTubeBlocked):
        runtime.extract_youtube_reference("https://youtu.be/Uz31UqPTr0E", 0, 12, tmp_path)
    assert not (tmp_path / "tonematch-source.json").exists()
    assert not (tmp_path / "tonematch-reference.wav").exists()


def test_routes_fail_before_downloading_when_runtime_missing(monkeypatch):
    def unavailable():
        raise ServiceError("Runtime ausente.", status=503, code="tonematch_not_configured")
    monkeypatch.setattr(routes, "runtime_python", unavailable)
    monkeypatch.setattr(routes, "extract_youtube_reference",
                        lambda *a, **k: pytest.fail("Should not download"))
    client = TestClient(main.app)
    response = client.post("/api/v1/tonematch/analyze-link", json={
        "url": "https://youtu.be/Uz31UqPTr0E", "end_seconds": 12})
    assert response.status_code == 503 and response.json()["code"] == "tonematch_not_configured"


def test_routes_reject_untrusted_urls_and_short_clips():
    client = TestClient(main.app)
    for body in ({"url": "https://example.com/video", "end_seconds": 12},
                 {"url": "https://youtu.be/Uz31UqPTr0E", "end_seconds": 3}):
        assert client.post("/api/v1/tonematch/analyze-link", json=body).status_code == 422


def test_routes_release_shared_slot_after_worker_failure(monkeypatch):
    monkeypatch.setattr(routes, "runtime_python", lambda: sys.executable)
    monkeypatch.setattr(routes, "extract_youtube_reference",
                        lambda *a: (Path("fixture.wav"), {"title": "fixture"}))
    def failed(*a, **k):
        raise ServiceError("Falha.", code="tonematch_analysis_failed")
    monkeypatch.setattr(routes, "analyze_reference", failed)
    with TestClient(main.app) as client:
        response = client.post("/api/v1/tonematch/analyze-link", json={
            "url": "https://youtu.be/Uz31UqPTr0E", "end_seconds": 12})
    assert response.status_code == 422
    assert main.processing.acquire(blocking=False)
    main.processing.release()


def test_optional_routes_keep_default_hpss_endpoint_contract():
    client = TestClient(main.app)
    assert client.get("/health").json()["engine"] == "HPSS"
    status = client.get("/api/v1/tonematch/status").json()
    assert status["engine"] == "tonematch-mk300" and status["live_youtube_verified"] is False
