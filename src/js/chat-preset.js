/* Strict plain-text parser for the seven-module response used by Assistente IA. */
(function (root) {
  'use strict';
  const expected = [
    ['NR (GATE)', 'GATE'], ['DS', 'DS'], ['AMP', 'AMP'], ['EQ', 'EQ'],
    ['CAB', 'CAB'], ['DLY', 'DLY'], ['REV', 'REV']
  ];

  function parseParameters(value) {
    const text = String(value || '').trim();
    if (!text || /^nenhum\.?$/i.test(text)) return {};
    const result = {};
    for (const pair of text.split(/[;；]/)) {
      const match = pair.trim().match(/^([^=]+?)\s*=\s*(-?\d+)$/);
      if (!match) return null;
      const name = match[1].trim().replace(/^\*+|\*+$/g, '').replace(/^`|`$/g, '').trim();
      const number = Number(match[2]);
      if (!name || !Number.isSafeInteger(number) || Object.hasOwn(result, name.toLowerCase())) return null;
      result[name] = number;
    }
    return result;
  }

  function parse(text) {
    if (typeof text !== 'string' || text.length > 24000) return null;
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const sections = [];
    let current = null;
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^\*\*|\*\*$/g, '').trim();
      const heading = line.match(/^([1-7])[.)]\s*(NR\s*\(\s*GATE\s*\)|DS|AMP|EQ|CAB|DLY|REV)\s*:?$/i);
      if (heading) {
        const index = Number(heading[1]) - 1;
        const label = heading[2].replace(/\s+/g, ' ').toUpperCase();
        const expectedLabel = expected[index][0].toUpperCase();
        if (label !== expectedLabel || sections.length !== index) return null;
        current = {key: expected[index][1], fields: {}};
        sections.push(current);
        continue;
      }
      if (!current || !line) continue;
      const field = line.match(/^(Estado|Modelo|Parâmetros)\s*:\s*(.*)$/i);
      if (!field) continue;
      const key = field[1].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      if (Object.hasOwn(current.fields, key)) return null;
      current.fields[key] = field[2].trim().replace(/^\*+|\*+$/g, '').replace(/^`|`$/g, '').trim();
    }
    if (sections.length !== expected.length) return null;
    const modules = {};
    for (const section of sections) {
      const fields = section.fields;
      const enabled = String(fields.estado || '').toLowerCase();
      const model = fields.modelo;
      const parameters = parseParameters(fields.parametros);
      if (!['ligado', 'desligado'].includes(enabled) || !model || model.length > 120 || /^\d+\s*[·.):]\s*/.test(model) || !parameters) return null;
      modules[section.key] = {enabled: enabled === 'ligado', model, parameters};
    }
    return {modules};
  }

  root.AutoPresetChatPreset = Object.freeze({parse});
})(globalThis);
