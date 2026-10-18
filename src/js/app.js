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
  }
  $('chatInput').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); $('chatForm').requestSubmit();
    }
  });
  $('chatForm').addEventListener('submit', async event => {
    event.preventDefault();
    const input = $('chatInput'), message = input.value.trim();
    if (chatPending || !message) return;
    const status = $('chatStatus');
    if (message.length > 4000) { status.textContent = 'Use até 4000 caracteres por mensagem.'; return; }
    if (navigator.onLine === false) { status.textContent = 'Conecte-se à internet para conversar com o assistente.'; return; }
    chatPending = true; $('chatSend').disabled = true;
    addChatMessage('user', message); input.value = '';
    status.textContent = 'A pensar...'; $('chatMessages').setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const api = String(window.API_BASE_URL || window.AUTO_PRESET_API || '').replace(/\/$/, '');
      if (!api) throw new Error('A URL do serviço não está configurada.');
      const response = await fetch(api + '/api/v1/chat', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'omit',
        body: JSON.stringify({message, history: chatHistory}), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `O assistente respondeu HTTP ${response.status}. Tente novamente.`);
      if (typeof data?.response !== 'string' || !data.response.trim()) throw new Error('O assistente retornou uma resposta inválida. Tente novamente.');
      const reply = data.response.trim();
      addChatMessage('assistant', reply);
      chatHistory.push({role: 'user', content: message}, {role: 'assistant', content: reply.slice(0, 8000)});
      if (chatHistory.length > 10) chatHistory.splice(0, chatHistory.length - 10);
      status.textContent = '';
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
      status.textContent = 'Análise concluída. Revise os blocos e ouça/ajuste o preset antes de usar.'; status.className = 'status good';
    } catch (error) { status.textContent = error.message || 'Falha ao analisar o áudio.'; status.className = 'status warn'; }
    finally { button.disabled = false; }
  });
  $('serverFileDownload').addEventListener('click', () => {
    if (!fileResult) return;
    const url = URL.createObjectURL(new Blob([fileResult.bytes], {type: 'application/octet-stream'}));
    const link = document.createElement('a'); link.href = url; link.download = 'AutoPreset_Arquivo.dzh'; link.click();
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
