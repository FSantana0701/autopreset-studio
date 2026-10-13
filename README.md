# AutoPreset Studio · MK-300 v73

## V29 · análise local guiada por áudio

A biblioteca interna inclui quatro arquivos `.dzh` originais anexados pelo usuário: JP CLEAN, JP OVERDRIVE, JP HEAVY RHYTHM e JP EPIC SOLO. Cada arquivo é validado por SHA-256 no teste e pode ser baixado sem regravação. Também pode ser aberto como novo rascunho, mantendo o arquivo original como base para que os knobs e bytes desconhecidos continuem preservados.

O manual lista seis posições, mas só quatro presets foram fornecidos; JP LIGHT RHYTHM e JP SOLO ficam documentados como ausentes. O pacote anuncia capturas AM3, mas os `.nam` não foram anexados. O manual também requer que o usuário carregue as capturas na ordem indicada e use firmware atualizado. O AutoPreset não instala essas capturas nem grava configurações CTL A/B.

O site agora também pode ser instalado no Android como PWA. O editor, o compilador `.dzh` de 448 bytes e os projetos continuam no navegador; a separação experimental de guitarra roda no próprio aparelho. A análise só fica disponível depois que um MP3/WAV local é selecionado e carregado. O app mostra claramente quando o seletor foi cancelado, quando o formato não é aceito e quando o áudio está pronto.

## Privacidade e custos

- Não é necessária chave de OpenAI, Anthropic ou Gemini.
- O arquivo da música não é enviado ao AutoPreset nem guardado pelo app.
- Na primeira separação, o app baixa o runtime ONNX e o modelo `htdemucs_6s` (aprox. 136 MB). O modelo é fixado a uma revisão específica; a inferência acontece no aparelho. O navegador tenta guardá-lo no Cache Storage para reutilização. A primeira execução pode demorar em rede móvel e ganhou limite de 15 minutos, com opção de cancelar. A interface e o runtime ainda podem precisar de conexão para carregar; o áudio nunca é enviado à API.
- Recomenda-se abrir por HTTPS no Chrome do Android. A página e os recursos PWA podem ser publicados gratuitamente como arquivos estáticos.
- O modelo 6-stem tem uma saída específica de guitarra, mas o resultado é experimental e pode conter vazamento. Após a separação, o usuário pode gerar um preset heurístico usando perfil de referência e medidas de brilho espectral. Isso não é reconhecimento musical por IA nem garante cópia do timbre. A gravação e a avaliação física na MK-300 continuam sendo a referência.

## Correções que ajudam as próximas sugestões

Depois de testar o preset na MK-300, marque a confirmação, informe a avaliação, ajuste os controles no editor e toque em **Salvar este teste como exemplo**. O app guarda localmente as medições, os parâmetros corrigidos e o `.dzh` compilado — sem armazenar o áudio. Em análises futuras, ele pode oferecer o exemplo com características acústicas mais parecidas como ponto de partida.

Isso é aprendizagem por exemplos validados, não retreinamento automático do modelo de separação ou de um LLM. Os exemplos podem ser exportados em JSON para backup ou para uma etapa futura de treinamento.

As sugestões iniciais por texto continuam sendo perfis heurísticos offline. Elas são pontos de partida e não alegam reconhecer exatamente o timbre de uma gravação. O usuário revisa e testa antes de exportar.

## Instalar no Android

1. Publique o conteúdo desta pasta em um host HTTPS estático (GitHub Pages serve).
2. Abra o endereço no Chrome do Android.
3. No menu do Chrome, escolha **Instalar app** ou **Adicionar à tela inicial**.
4. Baixe primeiro o arquivo de áudio para o aparelho (MP3/WAV, até 25 MiB). Um item que está apenas no Google Drive não é visível ao app até ser baixado.
5. A primeira separação precisa de internet para baixar o runtime/modelo. Depois, o app tenta reutilizá-lo localmente.

O projeto não inclui APK nem publicação na Play Store nesta etapa. A PWA instala a interface no aparelho sem taxa de loja.

## Estrutura

- `src/data/`: catálogo v73.
- `src/data/john-petrucci-pack.js`: arquivos binários originais codificados e seus dados de referência.
- `src/core/`: compilador preservado do formato binário de 448 bytes.
- `src/integrations/local-audio.js`: inferência ONNX local, saída guitar do `htdemucs_6s`, medições e WAV.
- `src/integrations/learning-store.js`: exemplos de correção em IndexedDB, com fallback local.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalação e cache da interface PWA.
- `audio-service/`: serviço Python da versão anterior, mantido para referência; não é necessário para a versão local e não é chamado pela interface.

## Gerar o HTML autônomo

Edite `src/` e gere as páginas autônomas `index.html` e `index (1).html` (o endereço legado):

```sh
node src/build-standalone.cjs
```

O runtime ONNX é importado sob demanda de jsDelivr e o modelo é obtido do Hugging Face quando a primeira análise é iniciada. A inferência recebe os dados no navegador; nenhuma requisição envia o áudio.

## Testes

```sh
node src/tests/core.test.cjs
node src/tests/differential.test.cjs
node src/tests/startup.test.cjs
node src/tests/john-petrucci-pack.test.cjs
node src/tests/claude-adapter.test.cjs
node src/tests/tone3000-select.test.cjs
node src/tests/audio-separation.test.cjs
node src/tests/local-audio.test.cjs
node src/tests/learning-store.test.cjs
node src/tests/pwa.test.cjs
python -m unittest discover -s src/tests -p 'audio_service_test.py' -v
```

O diferencial continua exigindo a identidade dos 448 bytes. Separação, consumo de memória e desempenho precisam ser conferidos no aparelho Android real; os testes automatizados deste pacote não substituem essa validação.
