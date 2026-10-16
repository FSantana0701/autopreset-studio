"""Real synthetic DSP; YouTube transport explicitly simulated in HTTP tests."""
import base64
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import urllib.request
import urllib.error
import wave

import main
from services.dzh_encoder import Encoder, reference_presets, encode, ROOT
from services.errors import ServiceError, YouTubeBlocked
from services.youtube import canonical_url, validate_interval


def fixture(path, seconds=2, silent=False):
    import numpy as np
    import soundfile as sf
    t = np.arange(int(16000*seconds), dtype=np.float32)/16000
    y = np.zeros_like(t) if silent else .3*np.sin(2*np.pi*220*t)
    if not silent:
        y[::4000] += .5
    sf.write(path, y, 16000, subtype='PCM_16')


class BackendTests(unittest.TestCase):
    def test_reference_roundtrip_and_js_compatibility(self):
        for entry in reference_presets():
            raw = base64.b64decode(entry['base64'])
            self.assertEqual(Encoder(raw).compile(),raw)
            self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['sha256'])
            encoder = Encoder(raw)
            encoder.name('HPSS TEST')
            encoder.model(4,84)
            encoder.state(4,True)
            encoder.knob(4,0,63)
            script = """require('./src/core/mk300-preset-handler.js');
const h=new MK300Core.MK300PresetHandler(new Uint8Array(Buffer.from(process.argv[1],'base64')));
h.setName('HPSS TEST');h.setBlockModel(4,84);h.setBlockState(4,true);h.setKnobValue(4,0,63);
process.stdout.write(Buffer.from(h.compile()).toString('base64'));"""
            js = subprocess.check_output(['node','-e',script,entry['base64']],cwd=ROOT,text=True)
            self.assertEqual(encoder.compile(),base64.b64decode(js))
            self.assertEqual(encoder.compile()[330:],raw[330:])

    def test_encoder_validation(self):
        with self.assertRaises(ValueError): Encoder(b'wrong')
        encoder = Encoder(base64.b64decode(reference_presets()[0]['base64']))
        for value in ('', 'é'*10):
            with self.assertRaises(ValueError): encoder.name(value)
        with self.assertRaises(ValueError): encoder.knob(11,0,10)
        with self.assertRaises(ValueError): encoder.knob(4,0,32768)
        encoder.data[330] ^= 1
        with self.assertRaises(ValueError): encoder.compile()

    def test_url_and_interval(self):
        self.assertEqual(canonical_url('https://youtu.be/z3JhXn_onsw?si=test&is=track'),'https://www.youtube.com/watch?v=z3JhXn_onsw')
        validate_interval(224,234)
        for start,end in ((0,46),(1,1),(-1,2),(0,float('nan'))):
            with self.assertRaises(ServiceError): validate_interval(start,end)
        for url in ('https://example.com/watch?v=z3JhXn_onsw','file:///etc/passwd','https://youtube.com.evil.test/watch?v=z3JhXn_onsw'):
            with self.assertRaises(ServiceError): canonical_url(url)

    def test_real_hpss_dsp_encoder(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            fixture(work/'clip.wav',5)
            result = main.build_analysis(work/'clip.wav',work)
            raw = base64.b64decode(result['dzh_base64'],validate=True)
            self.assertEqual(len(raw),448)
            self.assertFalse(result['separation']['guitar_isolated'])
            self.assertEqual(len(result['features']['mfcc']),13)
            self.assertLess(abs(result['features']['spectral_centroid_hz']-220),100)
            self.assertGreater(result['features']['rms'],.05)
            self.assertEqual(result['features']['duration_seconds'],5)
            self.assertEqual(result['preset']['classification']['confidence'],'low')
            with wave.open(str(work/'harmonic.wav')) as audio:
                self.assertEqual(audio.getnframes(),80000)
                self.assertEqual(audio.getnchannels(),1)

    def test_all_heuristic_model_templates_encode(self):
        from services.preset_mapper import PROFILES, suggest
        for model, profile in PROFILES:
            features = {'spectral_centroid_hz':profile[0]*8000,
                        'spectral_rolloff_85_hz':profile[1]*8000,
                        'spectral_flatness':profile[2], 'zero_crossing_rate':profile[3],
                        'crest_factor':profile[4]*20}
            preset = suggest(features)
            amp = next(block for block in preset['blocks'] if block['id']==4)
            self.assertEqual(amp['model_index'],model)
            self.assertEqual(len(encode(preset)),448)

    def test_silence_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            fixture(work/'clip.wav',silent=True)
            with self.assertRaises(ServiceError): main.build_analysis(work/'clip.wav',work)


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import uvicorn
        cls.sock = socket.socket()
        cls.sock.bind(('127.0.0.1',0))
        cls.base = 'http://127.0.0.1:'+str(cls.sock.getsockname()[1])
        cls.server = uvicorn.Server(uvicorn.Config(main.app,log_level='error'))
        cls.thread = threading.Thread(target=cls.server.run,kwargs={'sockets':[cls.sock]},daemon=True)
        cls.thread.start()
        for _ in range(100):
            if cls.server.started: break
            time.sleep(.02)
        assert cls.server.started

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(5)
        cls.sock.close()

    def request(self,path,body=None,method=None,headers=None):
        headers = {'Content-Type':'application/json',**(headers or {})}
        request = urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method=method)
        try: return urllib.request.urlopen(request,timeout=30)
        except urllib.error.HTTPError as error: return error

    def test_health_and_cors(self):
        self.assertEqual(json.load(self.request('/health'))['engine'],'HPSS')
        response = self.request('/api/v1/analyze-link',method='OPTIONS',headers={'Origin':'https://fsantana0701.github.io','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,accept'})
        self.assertEqual(response.status,200)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'],'https://fsantana0701.github.io')

    def test_invalid_interval_before_network(self):
        with patch('main.extract_clip') as extract:
            response = self.request('/api/v1/analyze-link',{'url':'https://youtu.be/z3JhXn_onsw','start_seconds':0,'end_seconds':46})
            self.assertEqual(response.status,400)
            extract.assert_not_called()

    def test_simulated_youtube_real_dsp_http(self):
        def extract(url,start,end,work):
            fixture(work/'clip.wav')
            return {'title':'Synthetic test; no YouTube download','start_seconds':start,'end_seconds':end}
        with patch('main.extract_clip',side_effect=extract):
            body = {'url':'https://youtu.be/z3JhXn_onsw?si=test','start_seconds':224,'end_seconds':226,'firmware':'v75'}
            response = self.request('/api/v1/analyze-link',body)
            self.assertEqual(response.status,200)
            result = json.load(response)
            self.assertEqual(len(base64.b64decode(result['dzh_base64'])),448)
            response = self.request('/api/v1/extract-youtube',body)
            self.assertEqual(response.headers.get_content_type(),'audio/wav')
            self.assertEqual(response.read(4),b'RIFF')

    def test_busy_and_youtube_blocked(self):
        body = {'url':'https://youtu.be/z3JhXn_onsw','start_seconds':0,'end_seconds':2}
        main.processing.acquire()
        try: self.assertEqual(self.request('/api/v1/analyze-link',body).status,503)
        finally: main.processing.release()
        with patch('main.extract_clip',side_effect=YouTubeBlocked()):
            response = self.request('/api/v1/analyze-link',body)
            self.assertEqual(response.status,422)
            self.assertIn('upload',json.load(response)['detail'])


if __name__ == '__main__': unittest.main()
