"""Bounded public Spotify previews; never fetch full or encrypted tracks."""
from __future__ import annotations

import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from services.errors import ServiceError

MAX_HTML_BYTES = 2 * 1024 * 1024
MAX_PREVIEW_BYTES = 5 * 1024 * 1024


def canonical_spotify_track(value: str) -> str:
    try:
        parsed = urlsplit(value)
        match = re.fullmatch(r"/(?:intl-[a-z]{2}/)?track/([A-Za-z0-9]{22})/?", parsed.path)
        valid = (parsed.scheme == "https" and parsed.hostname == "open.spotify.com"
                 and parsed.port in (None, 443) and not parsed.username and not parsed.password)
    except ValueError as exc:
        raise ServiceError("Link de faixa Spotify inválido.", status=400) from exc
    if not valid or not match:
        raise ServiceError("Use o link HTTPS completo de uma faixa do Spotify.", status=400)
    return "https://open.spotify.com/track/" + match[1]


def validate_preview_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        valid = (parsed.scheme == "https" and parsed.hostname == "p.scdn.co"
                 and parsed.port in (None, 443) and not parsed.username and not parsed.password
                 and not parsed.fragment and re.fullmatch(r"/mp3-preview/[a-fA-F0-9]{40}(?:\.mp3)?", parsed.path))
    except (TypeError, ValueError) as exc:
        raise ServiceError("Endereço de prévia inválido.", code="spotify_invalid_preview") from exc
    if not valid:
        raise ServiceError("O Spotify não retornou uma prévia pública compatível.", code="spotify_invalid_preview")
    return value


class _NextData(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            self.active = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def preview_metadata(html: str, track_url: str) -> dict:
    canonical = canonical_spotify_track(track_url)
    parser = _NextData()
    parser.feed(html)
    try:
        entity = json.loads("".join(parser.parts))["props"]["pageProps"]["state"]["data"]["entity"]
        if not isinstance(entity, dict) or entity.get("uri") != "spotify:track:" + canonical.rsplit("/", 1)[1]:
            raise ValueError("Track identity differs.")
        preview = entity.get("audioPreview") or {}
        if not isinstance(preview, dict):
            raise ValueError("Invalid preview metadata.")
        if not preview.get("url"):
            raise ServiceError("Esta faixa não oferece prévia pública disponível.", status=422,
                               code="spotify_preview_unavailable")
        media = validate_preview_url(preview["url"])
    except ServiceError:
        raise
    except (KeyError, TypeError, ValueError) as exc:
        raise ServiceError("Não foi possível ler a prévia pública desta faixa.", status=422,
                           code="spotify_preview_unavailable") from exc
    return {"url": canonical, "title": str(entity.get("name") or entity.get("title") or "Spotify")[:200],
            "preview_url": media}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read_public_url(url: str, maximum: int) -> bytes:
    # Only called with our canonical Spotify URL or the validated public CDN path.
    try:
        with build_opener(_NoRedirect()).open(Request(url, headers={"User-Agent": "AutoPreset-Reference/1.0"}),
                                              timeout=20) as response:
            payload = response.read(maximum + 1)
    except (HTTPError, URLError, TimeoutError) as exc:
        raise ServiceError("O Spotify não disponibilizou a prévia nesta consulta.", status=502,
                           code="spotify_preview_unavailable") from exc
    if not payload or len(payload) > maximum:
        raise ServiceError("Prévia ou metadados excedem o limite.", status=422,
                           code="spotify_invalid_preview")
    return payload


def fetch_spotify_preview(url: str, work: Path) -> tuple[Path, dict]:
    canonical = canonical_spotify_track(url)
    track_id = canonical.rsplit("/", 1)[1]
    html = _read_public_url("https://open.spotify.com/embed/track/" + track_id, MAX_HTML_BYTES)
    metadata = preview_metadata(html.decode("utf-8"), canonical)
    payload = _read_public_url(metadata.pop("preview_url"), MAX_PREVIEW_BYTES)
    preview = work / "spotify-preview.mp3"
    preview.write_bytes(payload)
    try:
        import soundfile as sf
        info = sf.info(preview)
        if not 8 <= info.duration <= 31 or info.channels not in (1, 2):
            raise ValueError("Expected a short public preview.")
    except (RuntimeError, ValueError) as exc:
        preview.unlink(missing_ok=True)
        raise ServiceError("A resposta não contém uma prévia de áudio válida.", status=422,
                           code="spotify_invalid_preview") from exc
    metadata.update({"content_source": "spotify_public_preview", "full_track": False,
                     "preview_duration_seconds": info.duration, "track_offset_seconds": None,
                     "timestamps_relative_to": "preview", "sha256": hashlib.sha256(payload).hexdigest(),
                     "source_substituted": False})
    return preview, metadata
