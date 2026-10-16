"""Exercise the external YouTube contract without downloading media or models."""
import json
import pwa_browser_test as pwa


class YouTubeTests(pwa.PWABrowserTests):
    def configure_api(self):
        self.page.locator("#youtubeLowMemory").uncheck()
        # A previously configured Render endpoint must not override production.
        self.page.evaluate("localStorage.setItem('AUTO_PRESET_API_URL','https://old-service.onrender.com')")
        expected='https://autopreset-studio-production.up.railway.app'
        self.assertEqual(self.page.evaluate('getAutoPresetApi()'),expected)
        self.assertEqual(self.page.locator('#apiBaseUrl').input_value(),expected)
        self.assertTrue(self.page.locator('#apiBaseUrl').evaluate('(input)=>input.readOnly'))

    def test_default_low_memory_link(self):
        import io, wave, math, struct
        self.page.locator('#enterStudio').click()
        self.assertTrue(self.page.locator('#youtubeLowMemory').is_checked())
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        self.page.locator('#youtubeEnd').fill('00:01')
        data=io.BytesIO()
        with wave.open(data,'wb') as wav:
            wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000)
            wav.writeframes(b''.join(struct.pack('<h',round(12000*math.sin(2*math.pi*440*i/16000))) for i in range(16000)))
        calls=[]
        def extract(route):
            self.assertEqual(route.request.headers['accept'],'audio/wav')
            calls.append(route.request.post_data_json)
            route.fulfill(status=200,content_type='audio/wav',body=data.getvalue())
        self.page.route('**/api/v1/extract-youtube',extract)
        self.page.route('**/api/v1/analyze-link',lambda route:self.fail('DSP remoto não deve ser solicitado'))
        self.page.locator('#youtubeAnalyze').click()
        self.page.wait_for_function('youtubeResult !== null')
        self.assertEqual(len(calls),1)
        self.assertEqual(calls[0]['end_seconds'],1)
        self.assertAlmostEqual(self.page.evaluate('youtubeResult.features.spectral_centroid_hz'),440,delta=8)
        self.assertIn('gerado no aparelho',self.page.locator('#youtubeStatus').inner_text())
        with self.page.expect_download() as download:self.page.locator('#youtubeDownload').click()
        self.assertEqual(download.value.path().stat().st_size,448)
        self.page.locator('#youtubeApply').click()
        self.assertEqual(self.page.evaluate('compilePreset().length'),448)

    def test_low_memory_errors_and_size_limit(self):
        self.page.locator('#enterStudio').click()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        for status, content_type, body, expected in [
            (422,'application/json',json.dumps({'code':'DOWNLOAD_BLOCKED'}),'bloqueou'),
            (404,'application/json','{}','HTTP 404'),
            (200,'text/html','not audio','trecho WAV'),
            (200,'audio/wav',b'x'*(16000*45*4+8193),'limite de memória')]:
            self.page.route('**/api/v1/extract-youtube',lambda route, request, status=status, content_type=content_type, body=body:route.fulfill(status=status,content_type=content_type,body=body))
            self.page.locator('#youtubeAnalyze').click()
            self.page.wait_for_function("!document.getElementById('youtubeInputs').disabled")
            # Oversize Content-Length can be rejected before reading the stream.
            text=self.page.locator('#youtubeStatus').inner_text()
            self.assertTrue(expected in text or 'trecho WAV' in text,text)
            self.assertTrue(self.page.locator('#youtubeDownload').is_disabled())
            self.assertTrue(self.page.locator('#youtubeLocalFallback').is_visible())
            self.page.unroute('**/api/v1/extract-youtube')

    def test_request_download_and_editor(self):
        self.page.locator('#enterStudio').click()
        self.configure_api()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        original = self.page.evaluate('Array.from(compilePreset())')
        encoded = self.page.evaluate('btoa(String.fromCharCode(...compilePreset()))')
        requests = []

        def respond(route):
            self.assertEqual(route.request.url,'https://autopreset-studio-production.up.railway.app/api/v1/analyze-link')
            self.assertEqual(route.request.headers['content-type'],'application/json')
            self.assertEqual(route.request.headers['accept'],'application/json')
            requests.append(route.request.post_data_json)
            route.fulfill(status=200, content_type='application/json', body=json.dumps({
                'source': {'title': '<b>Guitar song</b>'},
                'diagnosis': {'selected_models': {'AMP': {'name': 'Test AMP'}, 'DS': {'name': 'Test DS'}}},
                'preset': {'models': {'AMP': {'name': 'Test AMP'}, 'DS': {'name': 'Test DS'}}},
                'dzh': {'base64': encoded, 'size_bytes': 448}}))

        self.page.route('**/api/v1/analyze-link', respond)
        self.page.locator('#youtubeAnalyze').click()
        self.page.locator('#youtubeApply').wait_for(state='visible')
        self.page.wait_for_function("!document.getElementById('youtubeApply').disabled")
        self.assertEqual(requests, [{'url': 'https://www.youtube.com/watch?v=z3JhXn_onsw', 'start_seconds': 0,
                                     'end_seconds': 45, 'firmware': 'v75'}])
        self.assertIn('<b>Guitar song</b>', self.page.locator('#youtubeDiagnosis').inner_text())
        self.assertEqual(self.page.locator('#youtubeDiagnosis b').count(), 0)
        with self.page.expect_download() as download:
            self.page.locator('#youtubeDownload').click()
        self.assertEqual(download.value.suggested_filename, 'AutoPreset_Link.dzh')
        self.assertEqual(list(download.value.path().read_bytes()), original)
        self.assertEqual(download.value.path().stat().st_size,448)
        self.page.locator('#youtubeApply').click()
        self.assertEqual(self.page.evaluate('Array.from(compilePreset())'), original)
        self.assertIn('Parâmetros carregados', self.page.locator('#youtubeStatus').inner_text())
        self.page.locator('#youtubeUrl').fill('https://invalid.example/video')
        self.page.locator('#youtubeAnalyze').click()
        self.assertTrue(self.page.locator('#youtubeDownload').is_disabled(), 'No stale file after a rejected request')
        self.assertTrue(self.page.locator('#youtubeApply').is_disabled())

    def test_download_blocked_mobile_local_fallback(self):
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.locator('#enterStudio').click()
        self.configure_api()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw?si=shared')
        for payload in ({'detail':'DOWNLOAD_BLOCKED','code':'DOWNLOAD_BLOCKED'},
                        {'message':'DOWNLOAD_BLOCKED'}, 'DOWNLOAD_BLOCKED'):
            self.page.unroute('**/api/v1/analyze-link')
            self.page.route('**/api/v1/analyze-link',lambda route,request,body=payload:route.fulfill(
                status=422, content_type='application/json',body=json.dumps(body)))
            self.page.locator('#youtubeAnalyze').click()
            self.page.wait_for_function("!document.getElementById('youtubeInputs').disabled")
            self.page.wait_for_function("document.getElementById('youtubeStatus').textContent.includes('O YouTube bloqueou o download automático')")
            self.assertEqual('O YouTube bloqueou o download automático na nuvem. Use o Cortador Local abaixo para enviar o arquivo diretamente.', self.page.locator('#youtubeStatus').inner_text())
            self.assertTrue(self.page.locator('#youtubeDownload').is_disabled())
            self.assertTrue(self.page.locator('#youtubeApply').is_disabled())
        self.page.route('**/api/v1/analyze-link',lambda route:route.fulfill(status=422,content_type='text/plain',body='invalid'))
        self.page.locator('#youtubeAnalyze').click()
        self.page.wait_for_function("!document.getElementById('youtubeInputs').disabled")
        self.page.wait_for_function("document.getElementById('youtubeStatus').textContent.includes('não aceitou')")

    def test_validation_errors_and_fallback(self):
        self.page.locator('#enterStudio').click()
        self.configure_api()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        requests = []
        self.page.route('**/api/v1/analyze-link', lambda route: (requests.append(True), route.abort()))
        for start, end, url in [('00:00', '00:46', 'https://youtu.be/z3JhXn_onsw'),
                                ('00:05', '00:05', 'https://youtu.be/z3JhXn_onsw'),
                                ('01:01', '00:59', 'https://youtu.be/z3JhXn_onsw'),
                                ('1:60', '02:00', 'https://youtu.be/z3JhXn_onsw'),
                                ('', '00:30', 'https://youtu.be/z3JhXn_onsw'),
                                ('00:00', '00:10', 'https://evil.example/video')]:
            self.page.locator('#youtubeStart').fill(start)
            self.page.locator('#youtubeEnd').fill(end)
            self.page.locator('#youtubeUrl').fill(url)
            self.page.locator('#youtubeAnalyze').click()
            self.assertIn('cortador local', self.page.locator('#youtubeStatus').inner_text())
        self.assertEqual(requests, [])
        self.assertNotIn('Servidor de IA indisponível',self.page.locator('#youtubeStatus').inner_text())
        self.page.locator('#youtubeStart').fill('00:00')
        self.page.locator('#youtubeEnd').fill('00:45')
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        for status in [400, 503, 200, None]:
            self.page.unroute('**/api/v1/analyze-link')
            def fail(route):
                if status is None:
                    route.abort()
                else:
                    route.fulfill(status=status, content_type='application/json', body='{"preset_base64":"invalid"}')
            self.page.route('**/api/v1/analyze-link', fail)
            self.page.locator('#youtubeAnalyze').click()
            self.page.wait_for_function("!document.getElementById('youtubeInputs').disabled")
            self.assertIn('cortador local', self.page.locator('#youtubeStatus').inner_text())
            self.assertTrue(self.page.locator('#youtubeDownload').is_disabled())
            self.assertFalse(self.page.locator('#cropperInputs').is_disabled())

    def test_railway_waiting_progress_and_timeout(self):
        self.page.locator('#enterStudio').click()
        self.configure_api()
        self.page.clock.install()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        pending=[]
        self.page.route('**/api/v1/analyze-link',lambda route:pending.append(route))
        self.page.locator('#youtubeAnalyze').click()
        self.assertIn('A processar áudio no Railway',self.page.locator('#youtubeProgressLabel').inner_text())
        self.assertIsNone(self.page.locator('#youtubeProgress').get_attribute('value'))
        self.page.clock.fast_forward(11000)
        self.assertIn('A analisar componentes harmônicos',self.page.locator('#youtubeProgressLabel').inner_text())
        self.assertIn('Etapas previstas',self.page.locator('#youtubeProgressWrap').inner_text())
        self.page.clock.fast_forward(300000)
        self.page.wait_for_function("!document.querySelector('#youtubeInputs').disabled")
        self.assertIn('5 minutos',self.page.locator('#youtubeStatus').inner_text())
        self.assertTrue(self.page.locator('#youtubeDownload').is_disabled())
        self.assertFalse(self.page.locator('#cropperInputs').is_disabled())
        for route in pending:route.abort()

    def test_invalid_json_and_wrong_binary_sizes(self):
        import base64
        self.page.locator('#enterStudio').click()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        valid=self.page.evaluate('Array.from(compilePreset())')
        bad_chain=bytearray(valid);bad_chain[32]=bad_chain[33]
        bad_state=bytearray(valid);bad_state[43]=255
        payloads=['null','[]','<html>Bad gateway</html>']+[
            json.dumps({'dzh_base64':base64.b64encode(data).decode()})
            for data in [bytes(447),bytes(449),bad_chain,bad_state]
        ]
        for payload in payloads:
            self.page.unroute('**/api/v1/analyze-link')
            self.page.route('**/api/v1/analyze-link',lambda route,request,body=payload:route.fulfill(status=200,content_type='application/json',body=body))
            self.page.locator('#youtubeAnalyze').click()
            self.page.wait_for_function("!document.querySelector('#youtubeInputs').disabled")
            self.assertTrue(self.page.locator('#youtubeDownload').is_disabled())
            self.assertTrue(self.page.locator('#youtubeApply').is_disabled())
            self.assertIn('cortador local',self.page.locator('#youtubeStatus').inner_text())

    def test_minute_inputs_are_converted_before_post(self):
        self.page.locator('#enterStudio').click()
        self.page.locator("#youtubeLowMemory").uncheck()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw')
        self.assertIn('45 segundos',self.page.locator('#youtubeIntervalHelp').inner_text())
        encoded=self.page.evaluate('btoa(String.fromCharCode(...compilePreset()))')
        requests=[]
        def respond(route):
            requests.append(route.request.post_data_json)
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'preset_base64':encoded}))
        self.page.route('**/api/v1/analyze-link',respond)
        for start,end,expected in [('02:16','02:56',(136,176)),('0:59','01:44',(59,104)),('1:30','02:00',(90,120))]:
            self.page.get_by_label('Início (mm:ss)',exact=True).fill(start)
            self.page.get_by_label('Fim (mm:ss)',exact=True).fill(end)
            self.page.locator('#youtubeAnalyze').click()
            self.page.wait_for_function("!document.querySelector('#youtubeDownload').disabled")
            payload=requests[-1]
            self.assertEqual((payload['start_seconds'],payload['end_seconds']),expected)
            self.assertIsInstance(payload['start_seconds'],int)
            self.assertIsInstance(payload['end_seconds'],int)

    def test_shared_links_headers_and_integer_times(self):
        self.page.locator('#enterStudio').click()
        self.page.locator("#youtubeLowMemory").uncheck()
        self.page.evaluate("window.API_BASE_URL='https://old-service.onrender.com////';window.AUTO_PRESET_API='http://localhost:8000/'")
        expected='https://autopreset-studio-production.up.railway.app'
        self.assertEqual(self.page.evaluate('getAutoPresetApi()'),expected)
        self.assertEqual(self.page.evaluate('API_BASE_URL'),expected)
        encoded=self.page.evaluate('btoa(String.fromCharCode(...compilePreset()))')
        requests=[]
        def respond(route):
            self.assertEqual(route.request.url,expected+'/api/v1/analyze-link')
            self.assertEqual(route.request.headers['content-type'],'application/json')
            self.assertEqual(route.request.headers['accept'],'application/json')
            requests.append(route.request.post_data_json)
            route.fulfill(status=200,content_type='application/json',body=json.dumps({'dzh_base64':encoded}))
        self.page.route('**/api/v1/analyze-link',respond)
        for query in ['?is=shared&si=tracking&t=999','?si=tracking']:
            self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw'+query)
            self.page.locator('#youtubeStart').fill('3:44')
            self.page.locator('#youtubeEnd').fill('3:54')
            self.page.locator('#youtubeAnalyze').click()
            self.page.wait_for_function("!document.querySelector('#youtubeDownload').disabled")
            self.assertEqual(requests[-1],{
                'url':'https://www.youtube.com/watch?v=z3JhXn_onsw',
                'start_seconds':224,'end_seconds':234,'firmware':'v75'})
            self.assertIsInstance(requests[-1]['start_seconds'],int)
            self.assertIsInstance(requests[-1]['end_seconds'],int)

    def test_network_error_logs_original_fetch_error(self):
        self.page.locator('#enterStudio').click()
        self.page.locator("#youtubeLowMemory").uncheck()
        errors=[]
        self.page.evaluate("() => {window.fetchErrorDirs=[];const originalDir=console.dir.bind(console);console.dir=(err)=>{window.fetchErrorDirs.push({name:err.name,message:err.message});originalDir(err);};}")
        self.page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
        self.page.route('**/api/v1/analyze-link',lambda route:route.abort())
        self.page.locator('#youtubeUrl').fill('https://youtu.be/z3JhXn_onsw?si=tracking')
        self.page.locator('#youtubeStart').fill('3:44')
        self.page.locator('#youtubeEnd').fill('3:54')
        self.page.locator('#youtubeAnalyze').click()
        self.page.wait_for_function("!document.querySelector('#youtubeInputs').disabled")
        self.assertIn('Não foi possível conectar',self.page.locator('#youtubeStatus').inner_text())
        logged=self.page.evaluate('window.fetchErrorDirs')
        self.assertEqual(len(logged),1)
        self.assertEqual(logged[0]['name'],'TypeError')
        self.assertTrue(logged[0]['message'])
        self.assertIn(logged[0]['message'],self.page.locator('#youtubeStatus').inner_text())
        self.assertTrue(any('[API Fetch Error]:' in message and 'TypeError' in message for message in errors),errors)
        self.assertTrue(self.page.locator('#youtubeDownload').is_disabled())
