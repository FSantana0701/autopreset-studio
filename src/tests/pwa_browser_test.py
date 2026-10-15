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
        self.assertIn('shell-v10', self.page.evaluate('caches.keys()'))
        self.context.set_offline(True)
        self.page.reload()
        self.assertIn('M-VAVE MK-300 V75', self.page.locator('.brand').inner_text())
        self.assertEqual(self.page.evaluate('compilePreset().length'), 448)
        self.assertTrue(self.page.evaluate("fetch('./manifest.webmanifest').then(r=>r.ok)"))
        self.assertTrue(self.page.evaluate("fetch('./icons/autopreset-192.png').then(r=>r.ok)"))
        self.page.locator('#enterStudio').click()
        self.assertTrue(self.page.locator('#audioCropperSection').is_visible())

    def test_mobile_tablet_desktop_preserve_tools(self):
        for width, height in [(360,800), (390,844), (768,1024), (1440,900)]:
            self.page.set_viewport_size({'width': width, 'height': height})
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
            self.page.locator('#enterStudio').click()
            self.assertTrue(self.page.locator('#audioCropperSection').is_visible())
            self.assertTrue(self.page.locator('#cropperRecord').is_visible())
            self.assertFalse(self.page.evaluate('document.documentElement.scrollWidth > innerWidth'))
            self.page.locator('#leaveStudio').click()
