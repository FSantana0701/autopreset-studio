"""Regressões de formatos v1 no HTML real. Requer Playwright e Chromium."""
import json
import hashlib
import os
import unittest
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
LEGACY = json.loads((Path(__file__).parent / 'fixtures/legacy-v1.json').read_text())


class BrowserCompatibilityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        executable = os.getenv('CHROMIUM_PATH')
        options = {'executable_path': executable} if executable else {}
        cls.browser = cls.playwright.chromium.launch(
            headless=True, args=['--no-sandbox', '--disable-crashpad'], **options
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.page = self.browser.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

        def serve(route):
            relative = route.request.url.split('http://autopreset.test/', 1)[-1].split('?')[0]
            file = ROOT / relative
            route.fulfill(body=file.read_bytes(), content_type='text/html' if file.suffix == '.html' else 'application/javascript')

        self.page.route('http://autopreset.test/**', serve)
        self.page.goto('http://autopreset.test/index.html')

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [], 'Nenhum erro JS durante inicialização ou importação')

    def test_old_share_code_exports_identical_bytes(self):
        output = self.page.evaluate('(code)=>{importShared(code);return Array.from(compilePreset())}', LEGACY['code'])
        self.assertEqual(output, LEGACY['bytes'])

    def test_old_project_without_parameters_keeps_gain(self):
        output = self.page.evaluate('(project)=>{restoreProject(project);return Array.from(compilePreset())}', LEGACY['project'])
        self.assertEqual(output, LEGACY['bytes'])
        self.assertEqual(self.page.evaluate('PROJECT_STORAGE_KEY'), 'autopreset-project-v1')

    def test_dzh_upload_and_opaque_knobs_are_preserved(self):
        data = bytearray(LEGACY['bytes'])
        data[0xAC:0xAE] = (234).to_bytes(2, 'little')  # AMP knob 5: antes opaco
        self.page.locator('#base').set_input_files({'name': 'legacy.dzh', 'mimeType': 'application/octet-stream', 'buffer': bytes(data)})
        self.page.wait_for_function('baseBytes !== null')
        self.assertEqual(self.page.evaluate('Array.from(compilePreset())'), list(data))
        self.page.evaluate("parameterValues['4:23:5']=235")
        with self.assertRaisesRegex(Exception, 'deve ser um inteiro'):
            self.page.evaluate('compilePreset()')

    def test_synced_delay_preserves_time_until_edited(self):
        result = self.page.evaluate('''(old) => {
            const bytes=new Uint8Array(old),view=new DataView(bytes.buffer);
            view.setInt16(knobOffset(8,0),500,true);
            view.setInt16(knobOffset(8,DLY_SYNC[bytes[62]]),1,true);
            importShared(encodeShare(bytes));
            const unchanged=Array.from(compilePreset());
            $('time').value='451';const edited=compilePreset(),v=new DataView(edited.buffer);
            return {source:Array.from(bytes),unchanged,time:v.getInt16(knobOffset(8,0),true),sync:v.getInt16(knobOffset(8,DLY_SYNC[bytes[62]]),true)};
        }''', LEGACY['bytes'])
        self.assertEqual(result['unchanged'], result['source'])
        self.assertEqual((result['time'], result['sync']), (451, 0))

    def test_legacy_query_and_crc_validation(self):
        self.page.evaluate("importLegacy('?n=Legacy&b=137&a=23&d=21&dl=17&t=350&f=25&m=20&ag=80&dg=25&on=111')")
        self.assertEqual(self.page.locator('#name').input_value(), 'Legacy')
        self.assertEqual(self.page.locator('#ampGain').input_value(), '80')
        with self.assertRaisesRegex(Exception, 'CRC32'):
            self.page.evaluate('(code)=>decodeShare(code.slice(0,-8)+"00000000")', LEGACY['code'])

    def test_signed_fx_project_and_share_roundtrip(self):
        result = self.page.evaluate('''(old) => {
            const bytes=new Uint8Array(old),view=new DataView(bytes.buffer);
            bytes[55]=14;view.setInt16(knobOffset(1,0),-7,true);
            importShared(encodeShare(bytes));
            const project=projectObject();restoreProject(project);
            return {source:Array.from(bytes),output:Array.from(compilePreset())};
        }''', LEGACY['bytes'])
        self.assertEqual(result['output'], result['source'])

    def test_modular_and_previous_url_start_and_compile(self):
        for path in ['src/index.html', 'index%20(1).html']:
            # Route usa nomes decodificados para o endereço antigo.
            if path.startswith('index%20'):
                self.page.route('http://autopreset.test/index%20(1).html', lambda route: route.fulfill(body=(ROOT / 'index (1).html').read_bytes(), content_type='text/html'))
            self.page.goto('http://autopreset.test/' + path)
            self.assertEqual(self.page.evaluate('compilePreset().length'), 448)

    def test_john_petrucci_pack_is_downloadable_and_opens_as_new_draft(self):
        self.page.locator('#enterStudio').click()
        self.page.locator('#referencePackPanel > summary').click()
        self.assertEqual(self.page.locator('#johnPetrucciPresets .referencePreset').count(), 4)
        original = self.page.evaluate('''() => {
            const preset=AutoPresetReferencePacks.johnPetrucci.presets[0];
            return {bytes:Array.from(Uint8Array.from(atob(preset.base64),c=>c.charCodeAt(0))),name:preset.file};
        }''')
        with self.page.expect_download() as download_info:
            self.page.locator('#johnPetrucciPresets .referencePreset').nth(0).get_by_role('button', name='Baixar .dzh original').click()
        download = download_info.value
        path = download.path()
        self.assertEqual(Path(path).read_bytes(), bytes(original['bytes']))
        self.assertEqual(hashlib.sha256(Path(path).read_bytes()).hexdigest(), '4d68da4928466e84ce362bb58e3a40d1557c2dfc62a55d6e6994481d24d5717e')
        self.page.locator('#johnPetrucciPresets .referencePreset').nth(0).get_by_role('button', name='Abrir como rascunho').click()
        self.assertEqual(self.page.locator('#presetTabs .presetTab').count(), 1)
        self.assertEqual(self.page.evaluate('Array.from(compilePreset())'), original['bytes'])


if __name__ == '__main__':
    unittest.main()

