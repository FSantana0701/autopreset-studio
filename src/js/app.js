/* Extra source controls for V75. The core/editor and 448-byte handler remain in index.html. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tabs = [['tabOffline', 'offlineSourcePanel'], ['tabFile', 'fileSourcePanel'], ['tabYoutube', 'youtubeSourcePanel'], ['tabChat', 'chatSourcePanel']];
  function selectTab(id) {
    for (const [tabId, panelId] of tabs) {
      const selected = tabId === id;
      $(tabId).setAttribute('aria-selected', String(selected));
      $(tabId).tabIndex = selected ? 0 : -1;
      $(panelId).hidden = !selected;
    }
  }
  for (const [tab] of tabs) $(tab).addEventListener('click', () => selectTab(tab));
  selectTab('tabOffline');
  $('enterStudio').addEventListener('click', () => setTimeout(() => { if (!$('screenStudio').hidden) document.body.classList.add('studio-ready'); }, 0));
  $('leaveStudio').addEventListener('click', () => document.body.classList.remove('studio-ready'));
  $('youtubeLocalFallback').addEventListener('click', () => $('tabFile').click());
  $('tabYoutube').parentElement.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex(([id]) => id === document.activeElement.id);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    $(tabs[next][0]).focus(); selectTab(tabs[next][0]);
  });

  const chatHistory = [];
  let chatPending = false;
  function addChatMessage(role, text, failed = false) {
    const bubble = document.createElement('article');
    bubble.className = 'chatMessage' + (role === 'user' ? ' chatMessageUser' : '') + (failed ? ' chatMessageError' : '');
    const author = document.createElement('strong'); author.className = 'chatMessageAuthor';
    author.textContent = role === 'user' ? 'Você' : 'Assistente IA';
    const content = document.createElement('p'); content.className = 'chatMessageText';
    // Both user input and model output are untrusted text, never HTML.
    content.textContent = text;
    bubble.append(author, content); $('chatMessages').appendChild(bubble);
    $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
    return bubble;
  }
  function addApplyPresetAction(bubble, reply, audioName = '') {
    const preset = window.AutoPresetChatPreset?.parse(reply);
    if (audioName) {
      const completion = document.createElement('p'); completion.className = 'chatAnalysisComplete';
      completion.setAttribute('role', 'status');
      completion.textContent = preset
        ? '✓ Análise do áudio concluída. A sugestão está pronta; aplique o timbre abaixo para liberar o download do preset .dzh.'
        : '✓ Análise do áudio concluída. Ainda falta uma cadeia completa de 7 módulos para gerar um preset .dzh.';
      bubble.appendChild(completion);
    }
    if (!preset) return;
    const actions = document.createElement('div'); actions.className = 'chatPresetAction';
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'secondary'; button.textContent = '⚡ Aplicar este Timbre';
    const status = document.createElement('span'); status.className = 'chatPresetStatus';
    const download = document.createElement('button'); download.type = 'button'; download.className = 'chatPresetDownload';
    download.textContent = '⬇️ Baixar Preset .dzh'; download.hidden = true;
    const nameLabel = document.createElement('label'); nameLabel.textContent = 'Nome do preset (até 19 bytes UTF-8)';
    const name = document.createElement('input'); name.type = 'text'; name.maxLength = 19;
    name.autocomplete = 'off'; name.value = defaultPresetName(audioName); name.setAttribute('aria-label', nameLabel.textContent);
    nameLabel.appendChild(name); nameLabel.hidden = true;
    button.addEventListener('click', () => {
      if (button.disabled) return;
      button.disabled = true; status.textContent = 'A validar os índices e parâmetros V75…';
      try {
        const result = window.AutoPresetApplyChatPreset(preset);
        button.textContent = '✓ Timbre aplicado'; status.textContent = result + ' Nomeie o preset e toque em Baixar Preset .dzh.';
        nameLabel.hidden = false; download.hidden = false;
      } catch (error) {
        button.disabled = false; status.textContent = 'Não foi aplicado: ' + (error.message || 'resposta incompatível com o catálogo V75.');
      }
    });
    download.addEventListener('click', () => {
      const value = name.value.trim();
      if (!value) { status.textContent = 'Informe um nome para o preset.'; name.focus(); return; }
      if (new TextEncoder().encode(value).length > 19) { status.textContent = 'O nome deve ter no máximo 19 bytes UTF-8.'; name.focus(); return; }
      document.getElementById('name').value = value;
      document.getElementById('generate').click();
      document.getElementById('result').scrollIntoView({behavior: 'smooth', block: 'center'});
    });
    actions.append(button, nameLabel, download, status); bubble.appendChild(actions);
    $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
  }
  function defaultPresetName(source) {
    const stem = String(source || '').replace(/\.[^.]+$/, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_').slice(0, 19);
    return stem || 'Timbre_IA_MK300';
  }
  $('chatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); $('chatForm').requestSubmit();
    }
  });
  $('chatAudio').addEventListener('change', () => {
    const file = $('chatAudio').files?.[0];
    $('chatAudioName').textContent = file ? `${file.name} · ${(file.size / 1048576).toFixed(1)} MiB` : 'Nenhum áudio selecionado';
    if (file && file.size > 15 * 1024 * 1024) $('chatStatus').textContent = 'O áudio excede o limite de 15 MiB.';
    else $('chatStatus').textContent = '';
  });
  $('chatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('chatInput'), message = input.value.trim(), file = $('chatAudio').files?.[0] || null;
    if (chatPending || (!message && !file)) return;
    const status = $('chatStatus');
    if (message.length > 4000) { status.textContent = 'Use até 4000 caracteres por mensagem.'; return; }
    if (file && file.size > 15 * 1024 * 1024) { status.textContent = 'O áudio excede o limite de 15 MiB.'; return; }
    if (file && !/\.(mp3|wav|m4a)$/i.test(file.name)) { status.textContent = 'Anexe um áudio MP3, WAV ou M4A.'; return; }
    if (navigator.onLine === false) { status.textContent = 'Conecte-se à internet para conversar com o assistente.'; return; }
    const outgoingMessage = message || 'Analise este áudio e sugira um timbre inicial para a MK-300.';
    chatPending = true; $('chatSend').disabled = true;
    addChatMessage('user', file ? `${outgoingMessage}\nÁudio: ${file.name}` : outgoingMessage); input.value = '';
    status.textContent = file ? 'A analisar o áudio e a pensar...' : 'A pensar...'; $('chatMessages').setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const api = String(window.API_BASE_URL || window.AUTO_PRESET_API || '').replace(/\/$/, '');
      if (!api) throw new Error('A URL do serviço não está configurada.');
      let endpoint = api + '/api/v1/chat', body, headers;
      if (file) {
        endpoint += '/audio';
        body = new FormData();
        body.append('file', file);
        body.append('message', message);
        body.append('history_json', JSON.stringify(chatHistory));
        body.append('start_seconds', '0'); body.append('end_seconds', '45');
      } else {
        headers = {'Content-Type': 'application/json'};
        body = JSON.stringify({message: outgoingMessage, history: chatHistory});
      }
      const response = await fetch(endpoint, {
        method: 'POST', headers, credentials: 'omit', body, signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `O assistente respondeu HTTP ${response.status}. Tente novamente.`);
      if (typeof data?.response !== 'string' || !data.response.trim()) throw new Error('O assistente retornou uma resposta inválida. Tente novamente.');
      const reply = data.response.trim();
      const replyBubble = addChatMessage('assistant', reply);
      addApplyPresetAction(replyBubble, reply, file?.name || '');
      chatHistory.push({role: 'user', content: outgoingMessage}, {role: 'assistant', content: reply.slice(0, 8000)});
      if (chatHistory.length > 10) chatHistory.splice(0, chatHistory.length - 10);
      if (file) { $('chatAudio').value = ''; $('chatAudioName').textContent = 'Nenhum áudio selecionado'; }
      status.textContent = file ? '✓ Análise do áudio concluída. Veja a resposta: aplique a cadeia para liberar e nomear o download .dzh.' : '';
    } catch (error) {
      const detail = error.name === 'AbortError' ? 'O assistente demorou a responder. Tente novamente.'
        : error instanceof TypeError ? 'Não foi possível conectar ao assistente. Confira a conexão e tente novamente.'
        : error.message || 'Não foi possível obter uma resposta. Tente novamente.';
      addChatMessage('assistant', detail, true); status.textContent = detail;
      if (!input.value) input.value = message;
    } finally {
      clearTimeout(timeout); chatPending = false; $('chatSend').disabled = false;
      $('chatMessages').setAttribute('aria-busy', 'false');
      if (!$('chatSourcePanel').hidden) input.focus();
    }
  });

  const dropZone = $('fileSourcePanel');
  dropZone.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('dropReady'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dropReady'));
  dropZone.addEventListener('drop', event => {
    event.preventDefault(); dropZone.classList.remove('dropReady');
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer(); transfer.items.add(file); $('audioFile').files = transfer.files;
    $('audioFile').dispatchEvent(new Event('change', {bubbles:true}));
  });

  const blockNames = {2: 'NR', 3: 'DS', 4: 'AMP', 5: 'CAB', 6: 'EQ', 8: 'DLY', 9: 'REV'};
  let fileResult = null;
  function renderReview(data) {
    const root = $('serverFileReview');
    root.replaceChildren();
    const title = document.createElement('h3'); title.textContent = 'Revisão dos parâmetros sugeridos'; root.appendChild(title);
    for (const block of (data.preset?.blocks || [])) {
      const section = document.createElement('section');
      const heading = document.createElement('h4');
      heading.textContent = `${blockNames[block.id] || `Bloco ${block.id}`} · ${block.model_name}`;
      section.appendChild(heading);
      const values = document.createElement('p');
      values.textContent = block.knobs.map((name, i) => `${name}: ${block.values[i]}`).join(' · ');
      section.appendChild(values); root.appendChild(section);
    }
    const note = document.createElement('p');
    note.textContent = `DSP · perfil ${data.preset?.classification?.profile || 'não classificado'} · crest ${Number(data.features?.crest_factor_db || 0).toFixed(1)} dB. ${data.preset?.diagnosis?.explanation || ''}`;
    root.appendChild(note); root.hidden = false;
  }
  $('serverFileAnalyze').addEventListener('click', async () => {
    const status = $('serverFileStatus'), button = $('serverFileAnalyze');
    const file = $('serverFileInput').files?.[0] || $('audioFile').files?.[0];
    fileResult = null; $('serverFileApply').disabled = $('serverFileDownload').disabled = true; $('serverFileReview').hidden = true;
    if (!file) { status.textContent = 'Escolha primeiro um MP3, WAV ou M4A.'; status.className = 'status warn'; return; }
    if (file.size > 15 * 1024 * 1024) { status.textContent = 'O limite de envio é 15 MiB.'; status.className = 'status warn'; return; }
    const start = Number($('serverFileStart').value), end = Number($('serverFileEnd').value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 45) {
      status.textContent = 'Escolha um intervalo válido de até 45 segundos.'; status.className = 'status warn'; return;
    }
    button.disabled = true; status.textContent = 'A enviar o trecho e a analisar no servidor…'; status.className = 'status';
    try {
      const api = String(window.AUTO_PRESET_API || window.API_BASE_URL || '').replace(/\/$/, '');
      if (!api) throw new Error('A URL do serviço não está configurada.');
      const form = new FormData(); form.append('file', file); form.append('start_seconds', String(start)); form.append('end_seconds', String(end));
      const response = await fetch(api + '/api/v1/analyze-file', {method: 'POST', body: form, credentials: 'omit'});
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.detail || `O serviço respondeu HTTP ${response.status}.`);
      const encoded = data?.dzh_base64 || data?.dzh?.base64;
      if (typeof encoded !== 'string') throw new Error('A resposta não trouxe o preset .dzh.');
      const raw = atob(encoded); const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
      if (bytes.byteLength !== 448) throw new Error(`O preset recebido tem ${bytes.byteLength} bytes; esperado: 448.`);
      fileResult = {data, bytes}; renderReview(data);
      showPedalboard(bytes, data.source?.title || 'Arquivo · sugestão pronta');
      $('serverFileApply').disabled = $('serverFileDownload').disabled = false;
      const suggestedName = defaultPresetName(file.name);
      $('serverFilePresetName').value = suggestedName;
      status.textContent = '✓ Análise concluída. O preset .dzh de 448 bytes já está disponível para download. Você pode alterar o nome abaixo.'; status.className = 'status good';
    } catch (error) { status.textContent = error.message || 'Falha ao analisar o áudio.'; status.className = 'status warn'; }
    finally { button.disabled = false; }
  });
  $('serverFileDownload').addEventListener('click', () => {
    if (!fileResult) return;
    const url = URL.createObjectURL(new Blob([fileResult.bytes], {type: 'application/octet-stream'}));
    const link = document.createElement('a'); link.href = url; link.download = defaultPresetName($('serverFilePresetName').value) + '.dzh'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('serverFileApply').addEventListener('click', () => {
    if (!fileResult || typeof window.AutoPresetLoadAPIResult !== 'function') return;
    window.AutoPresetLoadAPIResult(fileResult.data, fileResult.bytes, fileResult.data.source?.title || 'Arquivo de áudio');
    $('serverFileStatus').textContent = 'Preset aberto em nova aba de rascunho para revisão no editor.';
    $('serverFileStatus').className = 'status good';
  });
  $('offlineApply').addEventListener('click', () => {
    const style = $('offlineStyle').value;
    $('ytUrl').value = style;
    $('analyzeAI').click();
    $('offlineStatus').textContent = `Perfil local “${style}” criado. Ajuste os parâmetros no editor e exporte o .dzh.`;
    $('offlineStatus').className = 'status good';
  });

  const pedalBlocks = [
    {id:2,label:'NR'}, {id:3,label:'DS'}, {id:4,label:'AMP'}, {id:6,label:'EQ'},
    {id:5,label:'CAB'}, {id:8,label:'DLY'}, {id:9,label:'REV'}
  ];
  function showPedalboard(bytes, origin='Preset carregado') {
    if (!(bytes instanceof Uint8Array)) bytes = Uint8Array.from(bytes || []);
    if (!bytes || bytes.length !== 448) return;
    const catalog = (window.MK300V75Parameters || window.MK300V73Parameters)?.blocks;
    if (!Array.isArray(catalog)) return;
    const root = $('pedalboardGrid'); root.replaceChildren();
    for (const block of pedalBlocks) {
      const modelIndex = bytes[0x36 + block.id] || 0;
      const model = catalog.find(item => item.id === block.id)?.models?.[modelIndex];
      const enabled = (bytes[0x2b + block.id] || 0) !== 0;
      const card = document.createElement('article'); card.className = `pedalCard${enabled ? ' isOn' : ''}`;
      const head = document.createElement('div'); head.className = 'pedalCardHead';
      const name = document.createElement('strong'); name.className = 'pedalName'; name.textContent = block.label;
      const led = document.createElement('span'); led.className = `pedalLed${enabled ? ' isOn' : ''}`; led.setAttribute('aria-label', enabled ? 'Ligado' : 'Desligado');
      head.append(name, led); card.appendChild(head);
      const modelName = document.createElement('p'); modelName.className = 'pedalModel';
      modelName.textContent = model?.name || (block.label === 'CAB' ? `Slot ${modelIndex + 1}` : 'Modelo não identificado'); card.appendChild(modelName);
      const values = document.createElement('div'); values.className = 'pedalValues';
      (model?.knobs || []).slice(0, 3).forEach((knob, i) => {
        const offset = 0x42 + 24 * block.id + 2 * i;
        const raw = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(offset, true);
        const row = document.createElement('div'); row.className = 'pedalValue';
        const label = document.createElement('span'); label.textContent = knob;
        const value = document.createElement('b'); value.textContent = String(raw);
        row.append(label, value); values.appendChild(row);
      });
      card.appendChild(values); root.appendChild(card);
    }
    $('pedalboardOrigin').textContent = origin;
    $('virtualPedalboard').hidden = false;
  }
  window.AutoPresetShowPedalboard = showPedalboard;
  function refreshCompiled(origin) {
    try { if (typeof window.compilePreset === 'function') showPedalboard(window.compilePreset(), origin); } catch (_) { /* Invalid/incomplete edits stay hidden until a valid preset exists. */ }
  }
  const observedStatuses = ['youtubeStatus','serverFileStatus','cropperStatus','audioSuggestionStatus','aiStatus','offlineStatus','projectStatus','result'];
  const statusObserver = new MutationObserver(records => {
    for (const record of records) {
      const node = record.target;
      if (!(node instanceof HTMLElement) || !node.textContent.trim()) continue;
      const tone = node.classList.contains('bad') ? 'bad' : node.classList.contains('warn') ? 'bad' : node.classList.contains('good') ? 'good' : '';
      if (!tone) continue;
      const toast = $('systemToast'); toast.textContent = node.textContent.trim().replace(/\s+/g, ' ').slice(0, 180); toast.dataset.tone = tone; toast.hidden = false;
      clearTimeout(statusObserver.toastTimer); statusObserver.toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
      if (tone === 'good') {
        if (node.id === 'youtubeStatus' && typeof window.AutoPresetGetCurrentBytes === 'function') {
          try { showPedalboard(window.AutoPresetGetCurrentBytes(),'YouTube · preset pronto'); } catch (_) { refreshCompiled('Preset atual · editor'); }
        } else refreshCompiled('Preset atual · editor');
      }
    }
  });
  for (const id of observedStatuses) { const node=$(id); if(node) statusObserver.observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']}); }
  for (const id of ['generate','checkPreset','applyAudioSuggestion','offlineApply','analyzeAI','analyzeYt','importCode','youtubeApply','serverFileApply','cropperInstant','cropperRecord','saveProject']) {
    const node=$(id); if(node) node.addEventListener('click',()=>setTimeout(()=>refreshCompiled('Preset atual · editor'),80));
  }
  $('youtubeDownload').addEventListener('click', () => setTimeout(() => {
    try { const bytes = window.AutoPresetGetCurrentBytes?.(); if (bytes) showPedalboard(bytes,'YouTube'); else refreshCompiled('YouTube · preset pronto'); } catch (_) { refreshCompiled('YouTube · preset pronto'); }
  }, 0));
  $('serverFileDownload').addEventListener('click', () => setTimeout(() => {
    if (fileResult?.bytes) showPedalboard(fileResult.bytes,'Arquivo · preset pronto');
  }, 0));
  $('stickyDownload').addEventListener('click', () => {
    const selected = $('tabFile').getAttribute('aria-selected') === 'true';
    const youtube = $('tabYoutube').getAttribute('aria-selected') === 'true';
    const target = selected ? (!$('serverFileDownload').disabled ? $('serverFileDownload') : !$('cropperDownload').disabled ? $('cropperDownload') : $('generate'))
      : youtube && !$('youtubeDownload').disabled ? $('youtubeDownload') : $('generate');
    target.click();
  });
  $('stickyReview').addEventListener('click', () => {
    if (!$('virtualPedalboard').hidden) $('virtualPedalboard').scrollIntoView({behavior:'smooth',block:'start'});
    $('blockInspector').scrollIntoView({behavior:'smooth',block:'start'});
  });
})();
