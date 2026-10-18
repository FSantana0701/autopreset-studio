"""PWA real em subdiretório, offline e layouts responsivos. Requer Chromium."""
import functools
import os
import threading
import unittest
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        prefix = '/autopreset-studio/'
        if path.startswith(prefix):
            path = '/' + path[len(prefix):]
        return super().translate_path(path)

    def log_message(self, *args):
        pass


class PWABrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/autopreset-studio/'
        cls.playwright = sync_playwright().start()
        executable = os.getenv('CHROMIUM_PATH')
        options = {'executable_path': executable} if executable else {}
        cls.browser = cls.playwright.chromium.launch(headless=True, args=['--no-sandbox', '--disable-crashpad'], **options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context()
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.goto(self.url)
        self.page.wait_for_function('navigator.serviceWorker.controller !== null')

    def tearDown(self):
        self.context.close()
        self.assertEqual(self.errors, [])

    def test_scope_offline_shell_and_icons(self):
        self.assertEqual(self.page.evaluate('(async()=> (await navigator.serviceWorker.ready).scope)()'), self.url)
        self.assertIn('shell-v20', self.page.evaluate('caches.keys()'))
        self.context.set_offline(True)
        self.page.reload()
        self.assertIn('M-VAVE MK-300 V75', self.page.locator('.brand').inner_text())
        self.assertEqual(self.page.evaluate('compilePreset().length'), 448)
        self.assertTrue(self.page.evaluate("fetch('./manifest.webmanifest').then(r=>r.ok)"))
        self.assertTrue(self.page.evaluate("fetch('./icons/autopreset-192.png').then(r=>r.ok)"))
        self.page.locator('#enterStudio').click()
        self.page.locator('#tabFile').click()
        self.assertTrue(self.page.locator('#audioCropperSection').is_visible())

    def test_source_tabs_and_virtual_pedalboard(self):
        self.page.locator('#enterStudio').click()
        self.assertTrue(self.page.locator('#offlineSourcePanel').is_visible())
        self.assertFalse(self.page.locator('#fileSourcePanel').is_visible())
        self.assertFalse(self.page.locator('#youtubeSourcePanel').is_visible())
        self.page.locator('#tabFile').click()
        self.assertTrue(self.page.locator('#fileSourcePanel').is_visible())
        self.assertTrue(self.page.locator('#audioCropperSection').is_visible())
        self.assertFalse(self.page.locator('#offlineSourcePanel').is_visible())
        self.page.locator('#tabYoutube').click()
        self.assertTrue(self.page.locator('#youtubeSourcePanel').is_visible())
        self.assertFalse(self.page.locator('#fileSourcePanel').is_visible())
        self.assertTrue(self.page.locator('#virtualPedalboard').is_hidden())
        self.page.locator('#tabOffline').click()
        self.page.locator('#offlineApply').click()
        self.page.wait_for_function("!document.querySelector('#virtualPedalboard').hidden")
        self.assertEqual(self.page.locator('#pedalboardGrid .pedalCard').count(), 7)
        self.assertEqual(self.page.locator('#pedalboardGrid .pedalName').all_text_contents(), ['NR','DS','AMP','EQ','CAB','DLY','REV'])

    def test_local_dsp_offline(self):
        self.context.set_offline(True)
        result = self.page.evaluate("""async () => {
          const buffer = new AudioBuffer({length:16000, sampleRate:16000, numberOfChannels:2});
          for(let i=0;i<16000;i++) { const v=0.4*Math.sin(2*Math.PI*440*i/16000); buffer.getChannelData(0)[i]=v;buffer.getChannelData(1)[i]=-v; }
          const f=await AutoPresetDSPLocal.extractFeatures(buffer);
          const base=compilePreset(), bytes=AutoPresetDSPLocal.encode(f,base);
          return {centroid:f.spectral_centroid_hz, peak:f.frequency_peaks[0]?.frequency_hz, size:bytes.length,
            reserved:Array.from(bytes.slice(330)).join()===Array.from(base.slice(330)).join(),
            amp:bytes[58], expected:AutoPresetAudioHeuristics.matchPreset(f).amp};
        }""")
        self.assertAlmostEqual(result['centroid'], 440, delta=8)
        self.assertAlmostEqual(result['peak'], 440, delta=8)
        self.assertEqual(result['size'],448)
        self.assertTrue(result['reserved'])
        self.assertEqual(result['amp'],result['expected'])

    def test_cropper_instant_upload_and_download(self):
        import io, wave, math, struct
        data = io.BytesIO()
        with wave.open(data, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b''.join(struct.pack('<h',round(12000*math.sin(2*math.pi*440*i/16000))) for i in range(16000)))
        self.page.locator('#enterStudio').click()
        self.page.locator('#tabFile').click()
        self.context.set_offline(True)
        self.page.locator('#cropperFile').set_input_files({'name':'tone.wav','mimeType':'audio/wav','buffer':data.getvalue()})
        self.page.wait_for_function("Number.isFinite(document.getElementById('cropperAudio').duration)")
        self.page.locator('#cropperInstant').click()
        self.page.wait_for_function('localDzh !== null && activeAIRequest === null')
        self.assertEqual(self.page.evaluate('localDzh.length'),448)
        self.assertTrue(self.page.locator('#cropperDownload').is_enabled())
        self.assertIn('448 bytes',self.page.locator('#cropperStatus').inner_text())

    def test_mobile_tablet_desktop_preserve_tools(self):
        for width, height in [(360,800), (390,844), (768,1024), (1440,900)]:
            self.page.set_viewport_size({'width': width, 'height': height})
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
            self.page.locator('#enterStudio').click()
            self.page.locator('#tabFile').click()
            self.assertTrue(self.page.locator('#audioCropperSection').is_visible())
            self.assertTrue(self.page.locator('#cropperRecord').is_visible())
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
            self.page.locator('#leaveStudio').click()
