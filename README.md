# AutoPreset Studio V27 — MK-300 v73

O GitHub Pages publica o HTML autônomo em `index.html`. O fonte modular fica em `src/`; o processador de guitarra está separado em `audio-service/`.

## Separação de guitarra

O HTML do GitHub Pages não executa Python. O áudio é enviado somente ao serviço Demucs configurado pelo usuário. Ele processa o recorte, devolve um WAV e apaga os arquivos temporários. A interface requer o endereço HTTPS e a chave privada definidos no serviço. A chave não é gravada no site.

Para disponibilizar o endpoint, veja [`audio-service/README.md`](audio-service/README.md). A publicação automatizada usa Hugging Face Spaces e `.github/workflows/deploy-audio-space.yml`. Isso exige um Docker Space existente, capacidade de execução disponível na conta e um token de escrita; o código não cria recursos pagos nem configura segredos automaticamente.

Com o GitHub Pages configurado para publicar `main` / `(root)`, mesclar alterações à `main` atualiza a página. A sincronização da API é opcional e só roda quando `HF_SPACE_REPO` estiver definido. Em seguida, no site, abra **Separação experimental → Conectar ao serviço experimental**, informe o endereço `https://<subdomínio>.hf.space` e a chave `AUTOPRESET_API_KEY`.

## Atualizar o HTML publicado

Edite o fonte em `src/` e gere a página na raiz do repositório:

```sh
node src/build-standalone.cjs
```

## Verificações

```sh
cd src
node tests/core.test.cjs
node tests/differential.test.cjs
node tests/startup.test.cjs
node tests/claude-adapter.test.cjs
node tests/tone3000-select.test.cjs
node tests/audio-separation.test.cjs
python -m unittest discover -s tests -p 'audio_service_test.py' -v
```

O compilador MK-300 continua gerando 448 bytes; os testes diferenciais verificam identidade byte a byte.

## Compatibilidade e publicação do site

Em **Settings → Pages**, selecione **Deploy from a branch**, branch **main** e pasta **/(root)**. A página ficará em `https://fsantana0701.github.io/autopreset-studio/`. Não há build remoto, domínio personalizado ou segredo obrigatório para o site estático. A configuração atual do Pages não foi consultada; confira-a antes de publicar.

O build também atualiza `index (1).html` para preservar o endereço anterior e seu uso offline. Os formatos `.dzh` (448 bytes), compartilhamento `v=1` com CRC32, links antigos por query string e `AutoPresetProject` versão 1 continuam suportados. O armazenamento usa `autopreset-project-v1`. Knobs brutos não editados e a região reservada são preservados; valores editados passam pela validação do catálogo. Projetos antigos sem `parameters` mantêm os valores dos controles. Sync e tempo bruto do delay são preservados até editar o delay.

### Testes adicionais e CI

Na raiz:

```sh
node mk300-binary.test.cjs
node 'mk300-binary.test (1).cjs'
python -m pip install -r src/tests/requirements.txt
python -m playwright install chromium
python -m unittest discover -s src/tests -p browser_compatibility_test.py -v
```

Para usar um Chromium já instalado, defina `CHROMIUM_PATH`. O workflow `tests.yml` executa os testes JavaScript, Python e de navegador e verifica se os dois HTMLs publicados correspondem ao fonte. Os testes do serviço usam mocks de FFmpeg/Demucs: não executam separação real nem chamadas a provedores de IA/TONE3000. Dois casos de fixtures reais `.dzh` permanecem desabilitados até adicionar arquivos de hardware no diretório `fixtures/` junto aos testes da raiz. A fixture v1 do navegador foi gerada pelo HTML anterior do repositório; não é uma captura de hardware.
