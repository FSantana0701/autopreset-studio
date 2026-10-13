import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from starlette.datastructures import UploadFile

SERVICE_DIR = Path(__file__).resolve().parents[2] / "audio-service"
sys.path.insert(0, str(SERVICE_DIR))
import app as audio_app  # noqa: E402


class AudioServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        api_key = patch.object(audio_app, "API_KEY", "test-key")
        api_key.start()
        self.addCleanup(api_key.stop)

    def upload(self, filename, data=b"audio"):
        file = tempfile.SpooledTemporaryFile()
        file.write(data)
        file.seek(0)
        self.addCleanup(file.close)
        return UploadFile(filename=filename, file=file)

    async def separate(self, file, start, end, authorization="Bearer test-key"):
        return await audio_app.separate_guitar(file, start, end, authorization)

    async def test_health_reports_local_separator(self):
        self.assertEqual(audio_app.health()["separator"], "htdemucs_6s")

    async def test_separates_requested_clip_and_returns_wav(self):
        calls = []

        def fake_command(command, *, timeout):
            calls.append((command, timeout))
            if command[0] == "ffprobe":
                return json.dumps({"format": {"duration": "240"}})
            if command[0] == "ffmpeg":
                Path(command[-2]).write_bytes(b"RIFF" + b"c" * 60)
                return ""
            output_dir = Path(command[command.index("-o") + 1])
            stem = output_dir / audio_app.MODEL / "clip" / "guitar.wav"
            stem.parent.mkdir(parents=True)
            stem.write_bytes(b"RIFF" + b"g" * 96)
            return ""

        with patch.object(audio_app, "command_output", side_effect=fake_command):
            response = await self.separate(
                self.upload("song.mp3", b"mp3-content"), 208, 238
            )

        self.assertEqual(response.media_type, "audio/wav")
        self.assertEqual(response.headers["X-Audio-Separator"], "htdemucs_6s")
        self.assertEqual(response.body, b"RIFF" + b"g" * 96)
        self.assertEqual(calls[1][0][calls[1][0].index("-ss") + 1], "208")
        self.assertEqual(calls[2][1], 240)

    async def test_rejects_oversized_clip_before_running_tools(self):
        with patch.object(audio_app, "command_output") as command:
            with self.assertRaises(HTTPException) as raised:
                await self.separate(
                    self.upload("song.wav"), 0, 46
                )
        self.assertEqual(raised.exception.status_code, 413)
        command.assert_not_called()

    async def test_rejects_clip_past_file_duration(self):
        with patch.object(
            audio_app, "command_output", return_value=json.dumps({"format": {"duration": "30"}})
        ) as command:
            with self.assertRaises(HTTPException) as raised:
                await self.separate(
                    self.upload("song.wav"), 28, 32
                )
        self.assertEqual(raised.exception.status_code, 400)
        command.assert_called_once()

    async def test_rejects_unsupported_file_type(self):
        with self.assertRaises(HTTPException) as raised:
            await self.separate(
                self.upload("song.flac"), 0, 5
            )
        self.assertEqual(raised.exception.status_code, 415)

    async def test_rejects_missing_or_wrong_access_key(self):
        for authorization in (None, "Bearer wrong"):
            with self.subTest(authorization=authorization), self.assertRaises(HTTPException) as raised:
                await self.separate(self.upload("song.wav"), 0, 5, authorization)
            self.assertEqual(raised.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
