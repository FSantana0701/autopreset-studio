# AutoPreset Studio V30

Ferramenta responsiva de palco para preparar, revisar e exportar presets da **M‑VAVE MK‑300 (firmware v73)**. O AutoPreset Studio combina análise leve de áudio no navegador, edição manual e um compilador binário que preserva os dados originais do preset-base.

## Recursos principais

- **PWA com suporte offline:** instale o app pelo navegador e use as funções locais — abrir projetos, editar presets e exportar arquivos — quando a interface já estiver armazenada no dispositivo. A primeira instalação exige conexão. Recursos que consultam serviços externos, como o catálogo e os downloads do TONE3000, precisam de internet.
- **Analisador heurístico de áudio:** usa a Web Audio API nativa para medir RMS, taxa de cruzamentos por zero e fator de crista em trechos da mixagem. Não carrega modelos ONNX nem envia o áudio para um serviço de análise. Os limites de tamanho e duração ajudam a controlar o uso de memória durante a decodificação.
- **Capturas NAM A2 pelo TONE3000:** permite selecionar capturas compatíveis A2-Lite, conferir metadados e baixar o arquivo .nam escolhido. A captura é importada no software compatível da M‑VAVE; ela não é incorporada ao arquivo .dzh.
- **Perfis textuais offline:** referências de estilo podem servir como ponto de partida heurístico. São sugestões para revisão e teste, não uma reprodução garantida de uma gravação.
- **Edição e projetos:** ajuste blocos e parâmetros, salve uma sessão em JSON, recupere um rascunho e exporte presets individualmente ou em lote.
- **Compartilhamento:** gere ou importe códigos de preset sem alterar o formato binário do equipamento.

## Análise de áudio

1. Abra o app e carregue um arquivo MP3 ou WAV salvo no dispositivo.
2. Aguarde a leitura da duração e defina um ou mais trechos de até 45 segundos.
3. Execute a análise para visualizar as medições e usar as sugestões como ponto de partida.
4. Revise os parâmetros no editor, confira o resultado na MK‑300 e exporte o preset.

O analisador trabalha com a **mixagem completa**. RMS, ZCR e fator de crista não isolam a guitarra nem identificam com certeza amplificadores, pedais ou efeitos presentes na gravação. A decodificação de MP3 cria dados PCM em memória; por isso, o app limita os arquivos a **25 MiB**, a duração a **5 minutos** e cada trecho a **45 segundos**. Para aparelhos com pouca memória, prefira arquivos menores e feche outros apps durante a decodificação.

A análise local não precisa de chave de API. Funções de provedores externos, quando usadas, dependem de internet e das credenciais configuradas pelo próprio usuário.

## Capturas NAM A2

O seletor conecta ao TONE3000 por meio do fluxo de autorização do serviço. O usuário escolhe uma variante **A2-Lite**, confirma o slot e baixa o arquivo .nam para importá-lo no M‑EFCS/M‑Efect compatível.

O projeto não hospeda nem espelha capturas do TONE3000. A compatibilidade deve ser confirmada no software e no equipamento. Se a captura incluir amplificador e gabinete, desligue o bloco CAB da MK‑300 para evitar duplicação de gabinete. O .dzh guarda parâmetros e o slot escolhido; não contém o modelo NAM.

## Compilador .dzh

O gerador produz arquivos com **exatamente 448 bytes**, destinados à M‑VAVE MK‑300 com firmware v73. Ele escreve os campos conhecidos nos offsets definidos pelo formato, usa little-endian para valores numéricos e preserva os dados desconhecidos da base. A região reservada dos bytes **330–447** é verificada para garantir que permaneça idêntica à base.

O nome do preset é limitado a 19 bytes UTF‑8. Antes de exportar, use **Verificar preset** para revisar os parâmetros e alertas. A exportação não substitui a validação no M‑EFCS nem o teste com a pedaleira.

## Pack John Petrucci

A biblioteca do projeto inclui quatro arquivos .dzh originais fornecidos para referência: **JP CLEAN**, **JP OVERDRIVE**, **JP HEAVY RHYTHM** e **JP EPIC SOLO**. Os originais são validados por SHA‑256 e podem ser baixados sem regravação. Ao abrir um deles para edição, o arquivo original continua sendo a base, preservando knobs e bytes desconhecidos.

O material de referência lista seis posições, mas **JP LIGHT RHYTHM** e **JP SOLO** não foram fornecidos. O anúncio do pack menciona capturas AM3; os arquivos dessas capturas também não fazem parte da biblioteca do app. O AutoPreset Studio não instala NAMs nem configura os controles CTL A/B.

## Instalação no Android

1. Abra o [AutoPreset Studio](https://fsantana0701.github.io/autopreset-studio/) no Chrome usando HTTPS.
2. No menu do navegador, escolha **Instalar app** ou **Adicionar à tela inicial**.
3. Abra o app instalado. Para trabalhar offline, carregue a interface enquanto estiver conectado antes de sair da rede.
4. Salve os arquivos de áudio no aparelho antes de selecioná-los; arquivos que permanecem apenas em serviços de nuvem não ficam disponíveis ao seletor local.

A PWA não é um APK e não está publicada na Play Store.

## Privacidade e limites

- A análise heurística local não envia nem armazena o arquivo de áudio.
- As medições e projetos podem permanecer no armazenamento local do navegador para permitir rascunhos e exemplos; use os controles de exportação/importação do app para fazer cópias.
- Downloads e autorização do TONE3000 são feitos diretamente com o serviço. Revise os termos e a licença apresentados pelo criador da captura.
- Resultados heurísticos são aproximados. Sempre revise o som, teste na MK‑300 e ajuste para sua guitarra, amplificação e saída.

## Estrutura do projeto

- **index.html**: aplicação autônoma publicada no GitHub Pages.
- **src/index.html**: fonte usada para gerar as páginas autônomas.
- **src/data/**: catálogo do firmware v73 e dados do pack.
- **src/core/mk300-preset-handler.js**: validação e compilação binária do preset.
- **src/integrations/audio-heuristic-analyzer.js**: medições locais com Web Audio.
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
node src/tests/core.test.cjs
node src/tests/differential.test.cjs
node src/tests/startup.test.cjs
node src/tests/john-petrucci-pack.test.cjs
node src/tests/claude-adapter.test.cjs
node src/tests/tone3000-select.test.cjs
node src/tests/audio-heuristic-analyzer.test.cjs
node src/tests/learning-store.test.cjs
node src/tests/pwa.test.cjs
python -m unittest discover -s src/tests -p 'audio_service_test.py' -v
~~~

Os testes automatizados não substituem a validação em um Android real, no M‑EFCS e na pedaleira. Confirme o funcionamento, o nível de saída e a compatibilidade de cada preset no seu equipamento antes de usá-lo ao vivo.
