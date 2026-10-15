"""Exercise the external YouTube contract without downloading media or models."""
import json
import pwa_browser_test as pwa


class YouTubeTests(pwa.PWABrowserTests):
    def configure_api(self):
        # A previously configured Render endpoint must not override production.
        self.page.evaluate("localStorage.setItem('AUTO_PRESET_API_URL','https://old-service.onrender.com')")
        expected='https://autopreset-studio-production.up.railway.app'
        self.assertEqual(self.page.evaluate('getAutoPresetApi()'),expected)
        self.assertEqual(self.page.locator('#apiBaseUrl').input_value(),expected)
        self.assertTrue(self.page.locator('#apiBaseUrl').evaluate('(input)=>input.readOnly'))

    def test_request_download_and_editor(self):
        self.page.locator('#enterStudio').click()
        self.configure_api()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/example')
        original = self.page.evaluate('Array.from(compilePreset())')
        encoded = self.page.evaluate('btoa(String.fromCharCode(...compilePreset()))')
        requests = []

        def respond(route):
            self.assertEqual(route.request.url,'https://autopreset-studio-production.up.railway.app/api/v1/analyze-link')
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
        self.assertEqual(requests, [{'url': 'https://youtu.be/example', 'start_seconds': 0,
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

    def test_validation_errors_and_fallback(self):
        self.page.locator('#enterStudio').click()
        self.configure_api()
        self.page.locator('#youtubeUrl').fill('https://youtu.be/example')
        requests = []
        self.page.route('**/api/v1/analyze-link', lambda route: (requests.append(True), route.abort()))
        for start, end, url in [('0', '46', 'https://youtu.be/example'),
                                ('5', '5', 'https://youtu.be/example'),
                                ('0', '10', 'https://evil.example/video')]:
            self.page.locator('#youtubeStart').fill(start)
            self.page.locator('#youtubeEnd').fill(end)
            self.page.locator('#youtubeUrl').fill(url)
            self.page.locator('#youtubeAnalyze').click()
            self.assertIn('cortador local', self.page.locator('#youtubeStatus').inner_text())
        self.assertEqual(requests, [])
        self.page.locator('#youtubeStart').fill('0')
        self.page.locator('#youtubeEnd').fill('45')
        self.page.locator('#youtubeUrl').fill('https://youtu.be/example')
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
        self.page.locator('#youtubeUrl').fill('https://youtu.be/example')
        pending=[]
        self.page.route('**/api/v1/analyze-link',lambda route:pending.append(route))
        self.page.locator('#youtubeAnalyze').click()
        self.assertIn('A processar áudio no Railway',self.page.locator('#youtubeProgressLabel').inner_text())
        self.assertIsNone(self.page.locator('#youtubeProgress').get_attribute('value'))
        self.page.clock.fast_forward(11000)
        self.assertIn('A isolar guitarra com Demucs',self.page.locator('#youtubeProgressLabel').inner_text())
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
        self.page.locator('#youtubeUrl').fill('https://youtu.be/example')
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
