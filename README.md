# AutoPreset Studio — MK-300 v73

O GitHub Pages publica o HTML autônomo em `index.html`. O fonte modular fica em `src/`; o serviço do servidor está em `audio-service/`.

## Assistente e análise de áudio

O serviço recebe o trecho selecionado, separa a guitarra com Demucs, calcula métricas acústicas com librosa e usa essas métricas para pedir ao Claude uma sugestão de timbre. O arquivo de áudio não é enviado ao Claude. O navegador valida a sugestão e mantém o compilador binário de 448 bytes. Arquivos temporários são removidos ao fim do processamento.

Para disponibilizar o endpoint, veja [`audio-service/README.md`](audio-service/README.md). A publicação automatizada usa Hugging Face Spaces e `.github/workflows/deploy-audio-space.yml`. Isso exige um Docker Space existente, capacidade de execução disponível na conta e um token de escrita; o código não cria recursos pagos nem configura segredos automaticamente.

Com o GitHub Pages configurado para publicar `main` / `(root)`, mesclar alterações à `main` atualiza a página. Para ativar IA e separação, configure `ANTHROPIC_API_KEY` como Secret do Hugging Face Space e `AUTOPRESET_ALLOWED_ORIGINS=https://fsantana0701.github.io` como variável. Em `src/config.js`, configure apenas a URL pública do Space; gere e publique o HTML autônomo. O usuário final não precisa colar nenhuma chave.

A chave Claude continua necessária no servidor e o administrador paga o uso da API, separado do plano Claude.ai. Configure limites de gasto no provedor. A API também aplica limite simples por IP; CORS não substitui limites de conta nem proteção contra abuso.

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
