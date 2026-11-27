import io
import json
import wave

import pytest

from services.errors import ServiceError
from services import spotify_preview as spotify

TRACK = "https://open.spotify.com/track/7ftj7rBwPyNa6P5g6sCGKT"
MEDIA = "https://p.scdn.co/mp3-preview/" + "a" * 40


def embed(preview=MEDIA, uri="spotify:track:7ftj7rBwPyNa6P5g6sCGKT"):
    entity = {"uri": uri, "name": "Rude Cruz", "audioPreview": {"url": preview} if preview else None}
    data = {"props": {"pageProps": {"state": {"data": {"entity": entity}}}}}
    return '<script type="application/json" id="__NEXT_DATA__">' + json.dumps(data) + '</script>'


@pytest.mark.parametrize("url", ["http://open.spotify.com/track/7ftj7rBwPyNa6P5g6sCGKT",
    "https://evil.test/track/7ftj7rBwPyNa6P5g6sCGKT", "https://open.spotify.com/playlist/7ftj7rBwPyNa6P5g6sCGKT",
    "https://open.spotify.com:444/track/7ftj7rBwPyNa6P5g6sCGKT",
    "https://user@open.spotify.com/track/7ftj7rBwPyNa6P5g6sCGKT"])
def test_rejects_non_track_and_untrusted_destinations(url):
    with pytest.raises(ServiceError):
        spotify.canonical_spotify_track(url)


@pytest.mark.parametrize("url", ["https://p.scdn.co.evil.test/mp3-preview/" + "a" * 40,
    "http://p.scdn.co/mp3-preview/" + "a" * 40, "https://p.scdn.co/anything",
    "https://user@p.scdn.co/mp3-preview/" + "a" * 40, "https://127.0.0.1/audio.mp3"])
def test_embed_cannot_redirect_download_to_an_arbitrary_url(url):
    with pytest.raises(ServiceError):
        spotify.preview_metadata(embed(url), TRACK)


def test_metadata_requires_the_requested_recording_and_a_preview():
    for html in (embed(None), embed(uri="spotify:track:another"), "<html>Sign in</html>"):
        with pytest.raises(ServiceError) as error:
            spotify.preview_metadata(html, TRACK)
        assert error.value.code == "spotify_preview_unavailable"
    assert spotify.preview_metadata(embed(), TRACK + "?si=tracking")["url"] == TRACK


def test_network_redirect_is_not_followed():
    assert spotify._NoRedirect().redirect_request(None, None, 302, "Found", {}, "http://127.0.0.1/") is None


def test_real_audio_validation_and_provenance_without_substitution(monkeypatch, tmp_path):
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x00\x00" * 8000 * 10)
    payload = buffer.getvalue()
    monkeypatch.setattr(spotify, "_read_public_url", lambda url, limit: embed().encode() if "embed/" in url else payload)
    path, source = spotify.fetch_spotify_preview(TRACK, tmp_path)
    assert path.read_bytes() == payload
    assert source["content_source"] == "spotify_public_preview"
    assert source["full_track"] is False and source["source_substituted"] is False
    assert source["track_offset_seconds"] is None
    assert source["preview_duration_seconds"] == 10


def test_invalid_media_is_removed_and_never_claimed_as_audio(monkeypatch, tmp_path):
    monkeypatch.setattr(spotify, "_read_public_url", lambda url, limit: embed().encode() if "embed/" in url else b"<html>Denied</html>")
    with pytest.raises(ServiceError) as error:
        spotify.fetch_spotify_preview(TRACK, tmp_path)
    assert error.value.code == "spotify_invalid_preview"
    assert not list(tmp_path.glob("*.mp3"))
