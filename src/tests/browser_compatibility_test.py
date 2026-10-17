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

    def test_six_owner_v75_presets_import_and_export_identically(self):
        fixtures = Path(__file__).parent / 'fixtures/v75'
        for fixture in json.loads((fixtures / 'manifest.json').read_text()):
            raw = (fixtures / fixture['file']).read_bytes()
            self.page.locator('#base').set_input_files({
                'name': fixture['original_name'], 'mimeType': 'application/octet-stream', 'buffer': raw
            })
            self.page.wait_for_function("document.getElementById('baseStatus').classList.contains('good')")
            output = self.page.evaluate('Array.from(compilePreset())')
            self.assertEqual(bytes(output), raw, fixture['original_name'])
            shared = self.page.evaluate('code => Array.from(decodeShare(code))',
                                        self.page.evaluate('encodeShare(compilePreset())'))
            self.assertEqual(bytes(shared), raw)

    def test_nam_disables_ds_and_supports_observed_custom_indices(self):
        for index in (115, 117, 118):
            result = self.page.evaluate('''index => {
                $('dsOn').checked=true;
                $('namSlot').value=String(index+1);$('namMode').checked=true;
                $('namKind').value='amp_only';$('namInstalled').checked=true;
                refreshUI();
                const output=compilePreset();
                return {index:output[58], ds:output[46], disabled:$('dsOn').disabled, size:output.length};
            }''', index)
            self.assertEqual(result, {'index': index, 'ds': 0, 'disabled': True, 'size': 448})
        result = self.page.evaluate("() => { $('namMode').checked=false; refreshUI(); return $('dsOn').disabled; }")
        self.assertFalse(result)

    def test_v75_labels_and_legacy_projects_coexist(self):
        self.assertIn('MW-808', self.page.locator('#drive option[value="40"]').inner_text())
        self.assertIn('MW-GOLD', self.page.locator('#drive option[value="41"]').inner_text())
        self.assertIn('Fender Super', self.page.locator('#amp option[value="0"]').inner_text())
        self.assertIn('6DS-MarsFD100', self.page.locator('#amp option[value="5"]').inner_text())
        self.assertIn('53DS-Pey5150', self.page.locator('#amp option[value="52"]').inner_text())
        self.assertIn('44MarVal4', self.page.locator('#cabSlot option[value="44"]').inner_text())
        self.assertTrue(self.page.evaluate("!AMP_CATALOG.includes('Jcm800') && !AMP_CATALOG.includes('Boss DS-2 Mod')"))

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

    def test_audio_picker_explains_missing_file_and_rejects_invalid_format(self):
        self.page.locator('#enterStudio').click()
        self.page.locator('#tabFile').click()
        self.assertIn('Nenhum áudio selecionado', self.page.locator('#audioInfo').inner_text())
        self.assertTrue(self.page.get_by_role('button', name='Analisar trecho da mixagem').is_disabled())
        self.page.locator('#audioFile').set_input_files({
            'name': 'notas.txt', 'mimeType': 'text/plain', 'buffer': b'not an audio file'
        })
        self.page.wait_for_function("document.querySelector('#audioInfo').textContent.includes('Formato não aceito')")
        self.assertIn('Formato não aceito', self.page.locator('#audioStatus').inner_text())

    def test_raw_mix_analysis_plays_and_uses_no_model_or_network(self):
        import io, wave, math, struct
        data=io.BytesIO()
        with wave.open(data,'wb') as wav:
            wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(44100)
            samples=bytearray()
            for i in range(44100*2):
                value=round(12000*math.sin(2*math.pi*440*i/44100))
                samples.extend(struct.pack('<hh',value,-value))
            wav.writeframes(samples)
        self.page.set_viewport_size({'width':360,'height':800})
        requests=[]
        self.page.on('request',lambda request:requests.append(request.url))
        self.page.locator('#enterStudio').click()
        self.page.locator('#tabFile').click()
        self.page.locator('#audioFile').set_input_files({'name':'diagnostic-mix.wav','mimeType':'audio/wav','buffer':data.getvalue()})
        self.page.wait_for_function('audioReady')
        self.page.get_by_label('Início do trecho 1',exact=True).fill('0')
        self.page.get_by_label('Fim do trecho 1',exact=True).fill('1')
        self.page.get_by_role('button',name='Analisar trecho da mixagem').click()
        self.page.wait_for_function('lastLocalAnalysis !== null && activeAIRequest === null')
        features=self.page.evaluate('lastLocalAnalysis.features')
        self.assertEqual(features['audio_source'],'full_mix')
        self.assertAlmostEqual(features['rms'],12000/32768/math.sqrt(2),delta=0.001)
        self.assertAlmostEqual(features['crest_factor'],math.sqrt(2),delta=0.01)
        self.assertFalse(self.page.locator('#separationOutput').is_hidden())
        self.page.locator('#guitarStemPreview').evaluate('(audio)=>audio.play()')
        self.page.wait_for_function("document.querySelector('#guitarStemPreview').currentTime>0.05")
        self.assertTrue(all(url.startswith('blob:') for url in requests),requests)
        self.page.locator('#applyAudioSuggestion').click()
        self.assertEqual(self.page.evaluate('compilePreset().length'),448)
        self.assertIn('banda inteira',self.page.locator('#audioSuggestionStatus').inner_text())
        self.assertLessEqual(self.page.evaluate('document.documentElement.scrollWidth'),360)

    def test_spectral_plan_compiles_exact_parameters_and_preserves_reserved_bytes(self):
        result = self.page.evaluate('''async old => {
            importShared(encodeShare(new Uint8Array(old)));
            const before=compilePreset(), rate=16000;
            const samples=Float32Array.from({length:rate*2},(_,i)=>0.4*Math.sign(Math.sin(2*Math.PI*220*i/rate)));
            const features=await AutoPresetAudioHeuristics.extractFeatures({sampleRate:rate,numberOfChannels:1,length:samples.length,duration:2,getChannelData:()=>samples});
            const plan=AutoPresetAudioHeuristics.matchPreset(features);
            const oldDelay={model:$('delay').value,time:$('time').value,active:$('dlyOn').checked};
            const cuts=[$('cabLow').value,$('cabHigh').value];
            $('ytUrl').value='Clean jazz reference must not override measured DSP';
            const message=applySpectralSuggestion(features), bytes=compilePreset(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
            return {length:bytes.length,amp:bytes[0x3A],ds:bytes[0x39],cab:bytes[0x3B],gate:bytes[0x38],eq:bytes[0x3C],
                expected:{amp:plan.amp,ds:plan.drive,cab:plan.cabSlot-1,gate:plan.gate,eq:plan.eq},
                presence:view.getInt16(knobOffset(4,6),true),expectedPresence:plan.presence,
                threshold:view.getInt16(knobOffset(2,PARAMETER_BLOCKS[2].models[plan.gate].knobs.indexOf('Thd')),true),
                expectedThreshold:plan.gate_threshold_db,
                reserved:Array.from(bytes.slice(330)),oldReserved:Array.from(before.slice(330)),
                oldDelay,newDelay:{model:$('delay').value,time:$('time').value,active:$('dlyOn').checked},
                cuts,newCuts:[$('cabLow').value,$('cabHigh').value],classification:plan.classification,message};
        }''', LEGACY['bytes'])
        self.assertEqual(result['length'],448)
        for key in ['amp','ds','cab','gate','eq']:
            self.assertEqual(result[key],result['expected'][key])
        self.assertEqual(result['presence'],result['expectedPresence'])
        self.assertEqual(result['threshold'],result['expectedThreshold'])
        self.assertEqual(result['reserved'],result['oldReserved'])
        self.assertEqual(result['oldDelay'],result['newDelay'])
        self.assertEqual(result['cuts'],result['newCuts'])
        self.assertEqual(result['classification'],'Hi-Gain')

    def test_spectral_suggestion_keeps_nam_and_integrated_cab(self):
        result = self.page.evaluate('''async () => {
            $('namMode').checked=true;$('namSlot').value='5';$('namLabel').value='Installed capture';
            $('namKind').value='amp_cab';$('namInstalled').checked=true;refreshUI();
            const old={amp:$('amp').value,gain:$('ampGain').value,cab:$('cabSlot').value};
            const samples=Float32Array.from({length:16000},(_,i)=>0.4*Math.sin(2*Math.PI*440*i/16000));
            const features=await AutoPresetAudioHeuristics.extractFeatures({sampleRate:16000,numberOfChannels:1,length:16000,duration:1,getChannelData:()=>samples});
            applySpectralSuggestion(features);
            return {old,current:{amp:$('amp').value,gain:$('ampGain').value,cab:$('cabSlot').value},nam:$('namMode').checked,cabOn:$('cabOn').checked,size:compilePreset().length};
        }''')
        self.assertEqual(result['old'],result['current'])
        self.assertTrue(result['nam'])
        self.assertFalse(result['cabOn'])
        self.assertEqual(result['size'],448)

    def test_spectral_repetition_and_decay_are_written_to_real_knobs(self):
        result = self.page.evaluate('''async () => {
            const rate=16000;
            const analyze=async fn=>{
                const data=Float32Array.from({length:rate*2},(_,i)=>fn(i/rate));
                return AutoPresetAudioHeuristics.extractFeatures({sampleRate:rate,numberOfChannels:1,length:data.length,duration:2,getChannelData:()=>data});
            };
            const pulses=await analyze(t=>t%0.25<0.02?0.4*Math.sin(2*Math.PI*440*t):0);
            const plan=AutoPresetAudioHeuristics.matchPreset(pulses);
            applySpectralSuggestion(pulses);
            let bytes=compilePreset(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
            const delay={time:view.getInt16(knobOffset(8,0),true),sync:view.getInt16(knobOffset(8,DLY_SYNC[bytes[62]]),true),active:bytes[0x2B+8],release:view.getInt16(knobOffset(2,1),true),expectedRelease:plan.gate_release_percent};
            const tail=await analyze(t=>t<0.05?0:0.4*Math.exp(-(t-0.05)*6)*Math.sin(2*Math.PI*440*t));
            const tailPlan=AutoPresetAudioHeuristics.matchPreset(tail);
            applySpectralSuggestion(tail);
            bytes=compilePreset();view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
            return {delay,reverb:{decay:view.getInt16(knobOffset(9,0),true),mix:view.getInt16(knobOffset(9,1),true),expectedDecay:tailPlan.reverb_decay,expectedMix:tailPlan.reverb_mix},size:bytes.length};
        }''')
        self.assertEqual(result['delay']['time'],250)
        self.assertEqual(result['delay']['sync'],0)
        self.assertEqual(result['delay']['active'],1)
        self.assertEqual(result['delay']['release'],result['delay']['expectedRelease'])
        self.assertEqual(result['reverb']['decay'],result['reverb']['expectedDecay'])
        self.assertEqual(result['reverb']['mix'],result['reverb']['expectedMix'])
        self.assertEqual(result['size'],448)


if __name__ == '__main__':
    unittest.main()

