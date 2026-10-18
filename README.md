# AutoPreset Studio V30

Ferramenta responsiva de palco para preparar, revisar e exportar presets da **M-VAVE MK-300 V75**. O AutoPreset Studio combina análise leve de áudio no navegador, edição manual e um compilador binário que preserva os dados originais do preset-base.

## Compatibilidade com Firmware MK-300 V75

A interface e a documentação reconhecem explicitamente a **M-VAVE MK-300 V75**, mantendo o formato `.dzh` de **exatamente 448 bytes** utilizado pelos presets V73/V74/V75. O compilador, os offsets, índices, checksums, tabelas de efeitos e algoritmos de ganho e equalização permanecem inalterados. Identificadores internos `V73` continuam designando essas estruturas válidas; não representam uma limitação do firmware mostrado na interface.

A compatibilidade de formato é sustentada pelos testes binários e diferenciais V73 e pela integridade dos presets de referência. A confirmação do comportamento sonoro e da importação em cada firmware exige teste no equipamento; a PWA não atualiza o firmware nem simula seu processamento interno.

O fluxo com **IRs** preserva o slot, os controles de CAB e os cortes de frequência no preset. Instale o IR correspondente no equipamento pelo software compatível da M-VAVE: o `.dzh` não incorpora o arquivo IR. As melhorias de resposta dinâmica e leitura de IRs atribuídas à V75 pertencem ao firmware e devem ser verificadas na documentação do fabricante e na pedaleira; esta atualização apenas alinha a aplicação a esse fluxo, sem implementar ou comprovar essas melhorias de DSP.

A PWA usa o cache **`shell-v18`**. Ao abrir o app conectado, o navegador instala o Service Worker atualizado, remove caches legados da aplicação e ativa o novo shell. A navegação consulta a rede antes do cache para evitar HTML antigo; sem conexão, usa o shell armazenado. Em uma aba já aberta, recarregue após a atualização para exibir a nova interface. Projetos e exemplos locais são preservados.

## Recursos principais

- **PWA com suporte offline:** instale o app pelo navegador e use as funções locais — abrir projetos, editar presets e exportar arquivos — quando a interface já estiver armazenada no dispositivo. A primeira instalação exige conexão. Recursos que consultam serviços externos, como o catálogo e os downloads do TONE3000, precisam de internet.
- **Estúdio de Preparação / Cortador em Tempo Real:** marque Início e Fim no player e grave até 45 segundos da faixa para análise local, sem decodificar o arquivo original inteiro.
- **Analisador heurístico de áudio:** usa a Web Audio API nativa para medir RMS, taxa de cruzamentos por zero e fator de crista em trechos da mixagem. Não carrega modelos ONNX nem envia o áudio para um serviço de análise. Os limites de tamanho e duração ajudam a controlar o uso de memória durante a decodificação.
- **Capturas NAM A2 pelo TONE3000:** permite selecionar capturas compatíveis A2-Lite, conferir metadados e baixar o arquivo .nam escolhido. A captura é importada no software compatível da M‑VAVE; ela não é incorporada ao arquivo .dzh.
- **Perfis textuais offline:** referências de estilo podem servir como ponto de partida heurístico. São sugestões para revisão e teste, não uma reprodução garantida de uma gravação.
- **Fontes de preset:** a tela do estúdio separa YouTube, arquivo e perfis locais em abas. O envio de arquivo é opcional (MP3/WAV/M4A, 15 MiB, trecho de até 45 s); a análise local continua disponível no aparelho. Os cinco perfis offline não precisam do backend.
- **Edição e projetos:** ajuste blocos e parâmetros, salve uma sessão em JSON, recupere um rascunho e exporte presets individualmente ou em lote.
- **Compartilhamento:** gere ou importe códigos de preset sem alterar o formato binário do equipamento.

## Estúdio de Preparação / Cortador em Tempo Real

Prepare faixas longas diretamente na PWA: escolha um arquivo salvo no aparelho, ouça no player HTML5 e use **Capturar Início** e **Capturar Fim** para marcar um trecho de até **45 segundos**. Toque em **Gravar e Analisar Trecho** e mantenha a tela aberta até a conclusão; as medições e sugestões aparecem na área de análise.

A captura combina `HTMLMediaElement.captureStream()` e `MediaRecorder`, APIs nativas de mídia do navegador, para recortar a música por **streaming em tempo real**. O player reproduz o intervalo selecionado e o gravador gera um Blob contendo apenas esse trecho. Depois, a Web Audio API decodifica somente o Blob e o analisador heurístico calcula RMS, ZCR e fator de crista.

Essa arquitetura evita carregar o arquivo original inteiro como PCM na memória, removendo desse fluxo o principal gargalo de RAM que pode causar **Out of Memory** em dispositivos móveis. O processamento permanece local e offline, sem bibliotecas externas, modelos ou envio de áudio, mantendo a PWA leve. O uso de memória da análise fica limitado ao trecho gravado.

O navegador precisa oferecer `captureStream()` e `MediaRecorder`. A gravação leva o tempo do trecho e pode ser cancelada; mudanças de posição, pausas ou ocultação da tela interrompem a captura. Os limites temporais dependem do navegador e do codec, sem precisão garantida por amostra. O recorte preserva a mixagem: não separa a guitarra dos demais instrumentos.

## Análise de áudio

1. Abra o app e carregue um arquivo MP3 ou WAV salvo no dispositivo.
2. Aguarde a leitura da duração e defina um ou mais trechos de até 45 segundos.
3. Execute a análise para visualizar as medições e usar as sugestões como ponto de partida.
4. Revise os parâmetros no editor, confira o resultado na MK‑300 e exporte o preset.

O analisador trabalha com a **mixagem completa**. RMS, ZCR e fator de crista não isolam a guitarra nem identificam com certeza amplificadores, pedais ou efeitos presentes na gravação. No fluxo de importação direta acima, a decodificação de MP3 cria dados PCM em memória; por isso, o app limita os arquivos a **25 MiB**, a duração a **5 minutos** e cada trecho a **45 segundos**. Para faixas longas ou aparelhos com pouca memória, use o **Estúdio de Preparação / Cortador em Tempo Real**, que analisa somente a gravação do trecho selecionado.

A análise local não precisa de chave de API. Funções de provedores externos, quando usadas, dependem de internet e das credenciais configuradas pelo próprio usuário.

## DSP espectral local

O trecho do Estúdio de Preparação alimenta uma FFT radix-2 nativa de 2048 pontos com janela Hann e até cerca de 50 quadros por segundo. A análise reutiliza os vetores de trabalho, soma a potência dos canais sem cancelar estéreo em oposição de fase e cede tempo à interface entre lotes, permitindo cancelamento. Para até 45 segundos, os vetores temporários de DSP ocupam menos de 320 KiB; esse valor exclui o buffer PCM decodificado, o WAV de saída e o overhead do navegador. Nenhuma cópia PCM da faixa inteira é criada pelo DSP.

As métricas combinam SFM (média geométrica/aritmética da potência), centroide, rolloff de 85% da energia, fluxo de magnitudes normalizadas, fator de crista, ZCR e energia harmônica. A autocorrelação da envoltória de ataques a aproximadamente 200 Hz procura repetições entre 80 e 1200 ms; um ajuste logarítmico da cauda produz um indicador de decaimento. Trechos sem evidência suficiente não alteram Delay ou Reverb. Os exemplos locais antigos continuam compatíveis; novos exemplos também armazenam métricas espectrais para comparação.

O matcher usa somente IDs e nomes existentes no catálogo preservado para V75:

| Hipótese | AMP | DS | Referência de CAB |
|---|---|---|---|
| Clean | 1J120_CL | 2TS8 (desligado) | 69FenDeluX |
| Crunch | 34OR_CRUNCH | 2TS8 | 10MAR1960_412 |
| Hi-Gain | 67EHV5150_DS | 11RAT | 63EAGLProV30s |
| Fuzz | 34OR_CRUNCH | 39BIG-MUFF | 36Recto_112 |

Brilho elevado também seleciona referências 63EAGLProV30s ou 77J120Rolnd, conforme a classe. Gain, Bass, Middle, Treble e Pres recebem sugestões cruzadas; o EQ usa as seis bandas reais de Guitar EQ 6. O GATE usa o Threshold assinado de Soft Gate ou Threshold/Release de Pro Gate para ataques mais marcados. AI Gate não expõe Threshold/Decay nesse catálogo, e Soft Gate não tem Decay; nenhum campo binário é inventado. Os cortes de CAB são recomendados em Hz, mas seus valores brutos são preservados até existir uma conversão calibrada. Confirme o IR instalado no slot de referência. Em modo NAM, AMP e CAB são preservados.

As classificações Clean/Crunch/Hi-Gain/Fuzz são **hipóteses de baixa confiança**, não identificação exata de pedais ou amplificadores. Bateria, ruído e compressão da mixagem alteram as métricas; ritmo pode parecer delay, e sustain pode parecer reverb. A precisão matemática dos descritores não comprova a precisão do diagnóstico musical. Revise e teste as sugestões na pedaleira. O compilador e o formato `.dzh` de 448 bytes permanecem inalterados.

## Capturas NAM A2

O seletor conecta ao TONE3000 por meio do fluxo de autorização do serviço. O usuário escolhe uma variante **A2-Lite**, confirma o slot e baixa o arquivo .nam para importá-lo no M‑EFCS/M‑Efect compatível.

O projeto não hospeda nem espelha capturas do TONE3000. A compatibilidade deve ser confirmada no software e no equipamento. Se a captura incluir amplificador e gabinete, desligue o bloco CAB da MK‑300 para evitar duplicação de gabinete. O .dzh guarda parâmetros e o slot escolhido; não contém o modelo NAM.

## Compilador .dzh

O gerador produz arquivos com **exatamente 448 bytes**, destinados à M‑VAVE MK‑300 com firmware V75, preservando a estrutura dos presets anteriores. Ele escreve os campos conhecidos nos offsets definidos pelo formato, usa little-endian para valores numéricos e preserva os dados desconhecidos da base. A região reservada dos bytes **330–447** é verificada para garantir que permaneça idêntica à base.

O nome do preset é limitado a 19 bytes UTF‑8. Antes de exportar, use **Verificar preset** para revisar os parâmetros e alertas. A exportação não substitui a validação no M‑EFCS nem o teste com a pedaleira.

## Pack John Petrucci

A biblioteca do projeto inclui quatro arquivos .dzh originais fornecidos para referência: **JP CLEAN**, **JP OVERDRIVE**, **JP HEAVY RHYTHM** e **JP EPIC SOLO**. Os originais são validados por SHA‑256 e podem ser baixados sem regravação. Ao abrir um deles para edição, o arquivo original continua sendo a base, preservando knobs e bytes desconhecidos.

## API V75 · upload e catálogo

O backend oferece `GET /health`, `GET /api/v1/catalog`, `GET /api/v1/offline-catalog`, `POST /api/v1/analyze-link` e `POST /api/v1/analyze-file`. O upload aceita `.mp3`, `.wav` ou `.m4a`, até 15 MiB; os endpoints de análise limitam o trecho a 45 s. Horários do YouTube aceitam segundos ou `mm:ss`. A resposta do analisador inclui métricas, parâmetros do preset e Base64 de um `.dzh` de 448 bytes. O upload usa FFmpeg instalado pelo Dockerfile.

O catálogo expõe os modelos e índices já embarcados no editor (120 AMP, 40 DS, 100 CAB, 27 DLY e 18 REV); os nomes técnicos e os slots são mantidos. O perfil de cinco bandas a 100, 300, 1k, 3k e 8k Hz é usado para medir espectro e interpolado para as seis bandas graváveis do Guitar EQ 6. O preset é codificado com o encoder de 448 bytes já validado e mantém os bytes reservados intactos. A separação é HPSS harmônico/percussivo, não isolamento exclusivo de guitarra.

Configuração local: `python -m pip install -r requirements.txt`, instale FFmpeg e execute `uvicorn main:app --host 0.0.0.0 --port 7860 --workers 1`. O endereço de produção da PWA está em `src/config.js`.

## Assistente IA de timbres

A aba **💬 Assistente IA** conversa com `gpt-4o-mini` por `POST /api/v1/chat`.
No Railway, configure a variável **OPENAI_API_KEY** no serviço do backend e aplique
o deploy. A chave é lida apenas no servidor; a PWA não pede nem armazena chaves.
Sem a variável, a API inicia normalmente e o chat retorna HTTP 503 com
`Chave de API não configurada no servidor`.

Contrato mínimo: `{"message":"Quero um lead com sustain"}` →
`{"response":"..."}`. Opcionalmente, `history` aceita até 10 mensagens com
`role` (`user` ou `assistant`) e `content`. A nova mensagem aceita até 4000
caracteres e cada item de histórico até 8000. O cliente mantém as cinco últimas
trocas bem-sucedidas apenas em memória, sem incluir falhas ou instruções de sistema.
O prompt injeta o catálogo V75 de `services/catalog.py`, os controles conhecidos e
a exclusividade NAM/DS, e solicita ajustes para NR, DS, AMP, EQ, CAB, DLY e REV.
Os nomes legados do catálogo binário não são oferecidos ao assistente.

O chat exige internet e envia o texto e o histórico recente à OpenAI pelo backend;
não envia áudio nem altera automaticamente o preset aberto. Falhas de chave,
conexão, limite de uso e timeout recebem mensagens em português. Os testes usam
um transporte HTTP simulado, sem chave real nem consumo da API.

O material de referência lista seis posições, mas **JP LIGHT RHYTHM** e **JP SOLO** não foram fornecidos. O anúncio do pack menciona capturas AM3; os arquivos dessas capturas também não fazem parte da biblioteca do app. O AutoPreset Studio não instala NAMs nem configura os controles CTL A/B.

## Instalação no Android

1. Abra o [AutoPreset Studio](https://fsantana0701.github.io/autopreset-studio/) no Chrome usando HTTPS.
2. No menu do navegador, escolha **Instalar app** ou **Adicionar à tela inicial**.
3. Abra o app instalado. Para trabalhar offline, carregue a interface enquanto estiver conectado antes de sair da rede.
4. Salve os arquivos de áudio no aparelho antes de selecioná-los; arquivos que permanecem apenas em serviços de nuvem não ficam disponíveis ao seletor local.

A PWA não é um APK e não está publicada na Play Store.

## Privacidade e limites

- A análise heurística local não envia nem armazena o arquivo de áudio.
- O Assistente IA envia as mensagens e o histórico recente ao backend e à OpenAI; o histórico desta sessão não é salvo no projeto nem no cache da PWA.
- As medições e projetos podem permanecer no armazenamento local do navegador para permitir rascunhos e exemplos; use os controles de exportação/importação do app para fazer cópias.
- Downloads e autorização do TONE3000 são feitos diretamente com o serviço. Revise os termos e a licença apresentados pelo criador da captura.
- Resultados heurísticos são aproximados. Sempre revise o som, teste na MK‑300 e ajuste para sua guitarra, amplificação e saída.

## Estrutura do projeto

- **index.html**: aplicação autônoma publicada no GitHub Pages.
- **src/index.html**: fonte usada para gerar as páginas autônomas.
- **src/css/style.css**, **src/js/app.js**: estilos e interação do Assistente IA, incorporados nas páginas autônomas pelo build.
- **services/ai_chat.py**: catálogo e integração OpenAI exclusivamente no servidor.
- **src/data/**: catálogo do firmware v73 e dados do pack.
- **src/core/mk300-preset-handler.js**: validação e compilação binária do preset.
- **src/integrations/audio-heuristic-analyzer.js**: captura em tempo real e medições locais com Web Audio.
- **src/integrations/learning-store.js**: exemplos de correção armazenados localmente.
- **src/integrations/tone3000-select.js**: seleção e download de capturas NAM compatíveis.
- **manifest.webmanifest**, **sw.js** e **icons/**: instalação e cache da PWA.

Edite os fontes em **src/** e gere os arquivos autônomos com:

~~~sh
node src/build-standalone.cjs
~~~

## Testes

Execute da raiz do repositório:

~~~sh
npm test
python -m pytest tests/backend tests/test_v75_sources.py -q
node src/tests/core.test.cjs
node src/tests/differential.test.cjs
node src/tests/startup.test.cjs
node src/tests/john-petrucci-pack.test.cjs
node src/tests/claude-adapter.test.cjs
node src/tests/tone3000-select.test.cjs
node src/tests/audio-heuristic-analyzer.test.cjs
node src/tests/audio-cropper.test.cjs
node src/tests/spectral-dsp.test.cjs
node src/tests/learning-store.test.cjs
node src/tests/pwa.test.cjs
python -m unittest discover -s src/tests -p 'audio_service_test.py' -v
python -m unittest discover -s src/tests -p 'browser_compatibility_test.py' -v
python -m unittest discover -s src/tests -p 'pwa_browser_test.py' -v
python -m unittest discover -s src/tests -p 'youtube_browser_test.py' -v
~~~

Os testes automatizados não substituem a validação em um Android real, no M‑EFCS e na pedaleira. Confirme o funcionamento, o nível de saída e a compatibilidade de cada preset no seu equipamento antes de usá-lo ao vivo.

## API de análise YouTube

A constante `API_BASE_URL` em `src/config.js` aponta para `https://autopreset-studio-production.up.railway.app`. As chamadas de IA usam esse destino de produção; URLs antigas gravadas no navegador não o substituem. O backend deve permitir `https://fsantana0701.github.io` no CORS. Sem serviço, o cortador e a análise local permanecem disponíveis.

Links de vídeo `youtu.be`, `watch`, `shorts`, `embed` e `live` são normalizados para `https://www.youtube.com/watch?v=ID`. Parâmetros de compartilhamento/rastreamento (`si`, `is`, `feature`), playlists, fragmentos e tempos da URL são removidos; o intervalo enviado é sempre o dos campos do formulário.

Os campos Início/Fim aceitam `m:ss` ou `mm:ss` (segundos entre `00` e `59`). Ex.: `02:16` até `02:56` é enviado como `136` e `176` segundos. Intervalos vazios, invertidos, de zero ou maiores que 45 segundos são bloqueados antes do POST.

O cliente envia `POST /api/v1/analyze-link` com `{url, start_seconds, end_seconds, firmware: "v75"}` (intervalo até 45 s). Espera JSON com `dzh_base64`, `features`, `preset`, `source` e `separation`; o preset deve ser um .dzh válido de 448 bytes. Os controles são preenchidos a partir do binário para preservar todos os parâmetros; o download da API mantém o original, e a exportação do editor inclui as revisões. O progresso é indeterminado e os rótulos indicam etapas previstas: o POST não informa a fase real. A interface aguarda até 5 minutos, rejeita JSON/Base64/binário inválidos e só habilita o download depois de validar os 448 bytes. A rota está implementada em `main.py`; a extração YouTube usa yt-dlp/FFmpeg no serviço configurado no Railway.

### Diagnóstico de conexão Railway

O POST envia `Content-Type: application/json` e `Accept: application/json`. Em falhas, o DevTools registra `[API Fetch Error]:` com o erro capturado. Um `TypeError: Failed to fetch` não distingue sozinho CORS, DNS, TLS ou indisponibilidade; a URL compartilhada no corpo também não determina o preflight. No painel Network, confira `OPTIONS` e `POST /api/v1/analyze-link`.

O backend deve autorizar a origem `https://fsantana0701.github.io`, o método `POST` e os cabeçalhos JSON no preflight, inclusive nas respostas de erro. A configuração CORS está em `main.py`; `mode: no-cors` não resolve a leitura do JSON. O arquivo `railway.json` seleciona o Dockerfile da raiz e define `/health` como verificação de implantação. Depois de um deploy correto, `GET /health` deve devolver JSON (`status: ok`, `engine: HPSS`) e `/openapi.json` deve listar as rotas da API. Se `/health` vier vazio ou a rota responder 404, o domínio está ligado a outro serviço/build ou a um deploy antigo; CORS não é a causa.

### Análise local e aprendizado

A análise local é um DSP heurístico no próprio navegador: mede a mixagem completa e não envia o áudio para Claude, OpenAI ou Gemini. As correções avaliadas pelo usuário ficam no IndexedDB local (não guardam o áudio); análises futuras podem oferecer o exemplo de correção com métricas mais parecidas. Isso é recuperação de exemplos personalizados, não treinamento de um modelo neural. A aplicação só deve descrever o resultado como uma hipótese de timbre de baixa confiança; não afirma que isolou ou reconheceu a guitarra.
