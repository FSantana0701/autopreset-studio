"""PWA real em subdiretório, offline e layouts responsivos. Requer Chromium."""
import functools
import json
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
        self.assertIn('shell-v23', self.page.evaluate('caches.keys()'))
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

    def open_chat(self):
        self.page.locator('#enterStudio').click()
        self.page.locator('#tabChat').click()
        self.assertTrue(self.page.locator('#chatSourcePanel').is_visible())
        for panel in ['offlineSourcePanel', 'fileSourcePanel', 'youtubeSourcePanel']:
            self.assertTrue(self.page.locator('#' + panel).is_hidden())

    def test_chat_pending_safe_multiline_reply_history_and_unchanged_preset(self):
        pending, bodies = [], []
        def upstream(route):
            bodies.append(route.request.post_data_json)
            pending.append(route)
        self.page.route('**/api/v1/chat', upstream)
        self.open_chat()
        before = self.page.evaluate('Array.from(compilePreset())')
        message = '<img src=x onerror="window.chatXss=true"> Quero um clean'
        reply = 'NR: Soft Gate\nDS: MW-808 desligado\nAMP: Fender Super\n<img src=x onerror="window.chatXss=true">'
        self.page.locator('#chatInput').fill(message)
        self.page.locator('#chatSend').click()
        self.page.wait_for_function("document.querySelector('#chatMessages').getAttribute('aria-busy') === 'true'")
        self.page.wait_for_timeout(100)
        self.assertEqual(self.page.locator('#chatStatus').inner_text(), 'A pensar...')
        self.assertTrue(self.page.locator('#chatSend').is_disabled())
        self.page.evaluate("document.querySelector('#chatForm').dispatchEvent(new Event('submit', {bubbles:true, cancelable:true}))")
        self.assertEqual(len(pending), 1)
        self.assertEqual(bodies[0], {'message': message, 'history': []})
        pending.pop(0).fulfill(status=200, content_type='application/json', body=json.dumps({'response': reply}))
        self.page.wait_for_function("!document.querySelector('#chatSend').disabled")
        self.assertEqual(self.page.locator('.chatMessageText').last.text_content(), reply)
        self.assertEqual(self.page.locator('#chatMessages img').count(), 0)
        self.assertFalse(self.page.evaluate('Boolean(window.chatXss)'))
        self.assertEqual(self.page.locator('.chatMessageText').last.evaluate('(node)=>getComputedStyle(node).whiteSpace'), 'pre-wrap')
        self.page.locator('#chatInput').fill('Mais grave')
        self.page.locator('#chatInput').press('Enter')
        self.page.wait_for_timeout(100)
        self.assertEqual(bodies[1]['history'], [{'role': 'user', 'content': message}, {'role': 'assistant', 'content': reply}])
        pending.pop(0).fulfill(status=200, content_type='application/json', body=json.dumps({'response': 'AMP: Fender Super\nBass: 60'}))
        self.page.wait_for_function("!document.querySelector('#chatSend').disabled")
        self.assertEqual(self.page.evaluate('Array.from(compilePreset())'), before)
        self.assertEqual(self.page.evaluate("Object.keys(localStorage).filter(key=>/chat/i.test(key))"), [])

    def test_chat_audio_upload_uses_server_analysis_endpoint(self):
        import io, wave, math, struct
        data = io.BytesIO()
        with wave.open(data, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b''.join(struct.pack('<h', round(9000 * math.sin(2 * math.pi * 330 * i / 16000))) for i in range(16000)))
        uploads = []
        def upstream(route):
            uploads.append(route.request.post_data or '')
            route.fulfill(status=200, content_type='application/json', body=json.dumps({'response':'Áudio recebido; sugestão inicial pronta.'}))
        self.page.route('**/api/v1/chat/audio', upstream)
        self.open_chat()
        self.page.locator('#chatAudio').set_input_files({'name':'ensaio.wav','mimeType':'audio/wav','buffer':data.getvalue()})
        self.page.locator('#chatInput').fill('Quero reduzir o brilho excessivo')
        self.page.locator('#chatSend').click()
        self.page.wait_for_function("!document.querySelector('#chatSend').disabled")
        self.assertEqual(len(uploads), 1)
        self.assertIn('name="file"', uploads[0])
        self.assertIn('ensaio.wav', uploads[0])
        self.assertIn('name="history_json"', uploads[0])
        self.assertIn('Quero reduzir o brilho excessivo', uploads[0])
        self.assertIn('Áudio: ensaio.wav', self.page.locator('.chatMessageUser').last.inner_text())
        self.assertEqual(self.page.locator('#chatAudio').input_value(), '')
        self.assertIn('servidor analisa', self.page.locator('#chatHelp').inner_text())

    def test_chat_server_error_retry_and_failed_turn_not_in_history(self):
        bodies = []
        def upstream(route):
            bodies.append(route.request.post_data_json)
            if len(bodies) == 1:
                route.fulfill(status=503, content_type='application/json', body=json.dumps({
                    'detail': 'Chave de API não configurada no servidor', 'code': 'chat_not_configured'}))
            else:
                route.fulfill(status=200, content_type='application/json', body=json.dumps({'response': 'AMP: Fender Super'}))
        self.page.route('**/api/v1/chat', upstream)
        self.open_chat()
        self.page.locator('#chatInput').fill('Quero um clean')
        self.page.locator('#chatSend').click()
        self.page.wait_for_function("document.querySelector('.chatMessageError') !== null")
        self.assertEqual(self.page.locator('.chatMessageError .chatMessageText').inner_text(), 'Chave de API não configurada no servidor')
        self.assertEqual(self.page.locator('#chatInput').input_value(), 'Quero um clean')
        self.assertTrue(self.page.locator('#chatSend').is_enabled())
        self.page.locator('#chatSend').click()
        self.page.wait_for_function("document.querySelector('#chatStatus').textContent === ''")
        self.assertEqual(bodies[1]['history'], [])

    def test_chat_network_and_invalid_json_failures_leave_composer_usable(self):
        self.open_chat()
        for handler in [lambda route: route.abort('failed'),
                        lambda route: route.fulfill(status=502, content_type='text/html', body='<h1>Bad gateway</h1>'),
                        lambda route: route.fulfill(status=200, content_type='application/json', body='{"response":""}')]:
            self.page.route('**/api/v1/chat', handler)
            self.page.locator('#chatInput').fill('Quero um timbre')
            self.page.locator('#chatSend').click()
            self.page.wait_for_function("!document.querySelector('#chatSend').disabled")
            self.assertEqual(self.page.locator('#chatInput').input_value(), 'Quero um timbre')
            self.assertNotEqual(self.page.locator('#chatStatus').inner_text(), '')
            self.page.unroute('**/api/v1/chat', handler)
        self.assertEqual(self.page.locator('.chatMessageError').count(), 3)

    def test_chat_offline_and_whitespace_do_not_send_or_lose_draft(self):
        self.open_chat()
        self.page.locator('#chatInput').fill('   ')
        self.page.locator('#chatSend').click()
        self.assertEqual(self.page.locator('.chatMessageUser').count(), 0)
        self.context.set_offline(True)
        self.page.locator('#chatInput').fill('Quero um clean')
        self.page.locator('#chatSend').click()
        self.assertIn('Conecte-se', self.page.locator('#chatStatus').inner_text())
        self.assertEqual(self.page.locator('#chatInput').input_value(), 'Quero um clean')
        self.assertEqual(self.page.locator('.chatMessageUser').count(), 0)

    def test_chat_history_is_bounded_and_survives_tab_switches(self):
        bodies = []
        def upstream(route):
            bodies.append(route.request.post_data_json)
            route.fulfill(status=200, content_type='application/json', body='{"response":"AMP: Fender Super"}')
        self.page.route('**/api/v1/chat', upstream)
        self.open_chat()
        for turn in range(7):
            self.page.locator('#chatInput').fill(f'Ajuste {turn}')
            self.page.locator('#chatSend').click()
            self.page.wait_for_function("!document.querySelector('#chatSend').disabled")
        self.assertEqual(len(bodies[-1]['history']), 10)
        self.assertEqual(bodies[-1]['history'][0]['content'], 'Ajuste 1')
        self.page.locator('#tabFile').click()
        self.page.locator('#tabChat').click()
        self.assertEqual(self.page.locator('.chatMessageUser').count(), 7)

    def test_chat_mobile_layout_and_keyboard_tab_navigation(self):
        self.open_chat()
        for width, height in [(360,800), (390,844), (768,1024), (1440,900)]:
            self.page.set_viewport_size({'width': width, 'height': height})
            self.page.locator('#chatSend').scroll_into_view_if_needed()
            self.assertTrue(self.page.locator('#chatSend').is_visible())
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
        self.page.locator('#tabChat').focus()
        self.page.keyboard.press('Home')
        self.assertEqual(self.page.locator('#tabOffline').get_attribute('aria-selected'), 'true')
        self.page.keyboard.press('End')
        self.assertEqual(self.page.locator('#tabChat').get_attribute('aria-selected'), 'true')
        self.page.keyboard.press('ArrowRight')
        self.assertEqual(self.page.locator('#tabOffline').get_attribute('aria-selected'), 'true')
        self.page.keyboard.press('ArrowLeft')
        self.assertEqual(self.page.locator('#tabChat').get_attribute('aria-selected'), 'true')
        self.page.locator('#chatInput').fill('Linha 1')
        self.page.locator('#chatInput').press('Shift+Enter')
        self.assertIn('\n', self.page.locator('#chatInput').input_value())
