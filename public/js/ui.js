// Utilitários de interface: templates seguros, formatação (America/Sao_Paulo), modais e avisos.
export const TZ = 'America/Sao_Paulo';

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s));
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(String(v));
}
// Template HTML com escape automático das interpolações
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += render(vals[i]); });
  return new Raw(out);
}
// Ignora alvos ausentes: respostas assíncronas podem chegar depois que o usuário mudou de página.
export function mount(el, tpl) { if (el) el.innerHTML = render(tpl); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Datas ----------
const fmtParts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
export function agoraSP(d = new Date()) {
  const p = {}; for (const { type, value } of fmtParts.formatToParts(d)) p[type] = value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, sec: p.second };
}
export const hojeSP = () => agoraSP().date;
export function addDias(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function fmtData(date) { if (!date) return ''; const [y, m, d] = date.split('-'); return `${d}/${m}/${y}`; }
export function fmtDataHora(iso) { if (!iso) return ''; const p = agoraSP(new Date(iso)); return `${fmtData(p.date)} ${p.time}`; }
export function fmtHoraIso(iso) { return iso ? agoraSP(new Date(iso)).time : ''; }
export function fmtRetirada(e) {
  if (!e.retirada_data) return '';
  return `${fmtData(e.retirada_data)} ${e.retirada_hora || '(horário não informado)'}`;
}
export function fmtBytes(n) { return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`; }

// ---------- Rótulos ----------
export const STATUS = {
  PENDENTE: 'Aguardando retirada',
  RETIRADA: 'Retirada',
  RETIRADA_OUTRO_PLANTAO: 'Retirada por outro plantão',
  CANCELADA: 'Cancelada',
};
export const statusBadge = (s) => html`<span class="badge st-${s}">${STATUS[s] || s}</span>`;
export function diasBadge(dias, cfg = {}) {
  if (dias === null || dias === undefined) return '';
  const a = cfg.dias_alerta ?? 7; const c = cfg.dias_critico ?? 15;
  const cls = dias >= c ? 'critico-d' : dias >= a ? 'alerta-d' : '';
  const txt = dias === 0 ? 'hoje' : dias === 1 ? '1 dia' : `${dias} dias`;
  return html`<span class="dias ${cls}" title="Aguardando há ${txt}">${txt}</span>`;
}
export const endereco = (e) => html`<span class="end">Q ${e.quadra} · L ${e.lote}</span>`;
export const iniciais = (nome) => String(nome || '?').split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

// ---------- Ícones (traço, 24x24) ----------
const P = {
  painel: 'M3 13h8V3H3zM13 21h8v-8h-8zM3 21h8v-6H3zM13 3v8h8V3z',
  nova: 'M12 5v14M5 12h14',
  caixa: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  relogio: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  historico: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 8v4l3 2',
  mapa: 'M9 3L3 6v15l6-3 6 3 6-3V3l-6 3zM9 3v15M15 6v15',
  relatorio: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  usuarios: 'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  config: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  escudo: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  sair: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 6h18M3 12h18M3 18h18',
  check: 'M20 6L9 17l-5-5',
  troca: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  busca: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  baixar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  subir: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  alerta: 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  x: 'M18 6L6 18M6 6l12 12',
  editar: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  imprimir: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  anexo: 'M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5',
  caneta: 'M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6M11 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  voltar: 'M19 12H5M12 19l-7-7 7-7',
  lixo: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
};
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n] || ''}"/></svg>`);

// ---------- Toast ----------
export function toast(msg, tipo = 'ok', ms = 4200) {
  const t = document.createElement('div');
  t.className = `toast ${tipo === 'erro' ? 'erro' : ''}`;
  t.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  t.textContent = msg;
  const box = document.getElementById('toasts');
  box.appendChild(t);
  // no máximo 3 avisos visíveis, para não cobrir a tela
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => t.remove(), ms);
}

// ---------- Modal ----------
// abrirModal({titulo, corpo (html), rodape (html), largo, classeHead}) → {el, fechar, onClose}
export function abrirModal({ titulo, corpo, rodape, largo = false, classeHead = '', aoFechar } = {}) {
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  mount(fundo, html`
    <div class="modal ${largo ? 'largo' : ''}" role="dialog" aria-modal="true" aria-label="${titulo}">
      <div class="modal-head ${classeHead}"><h2>${titulo}</h2><button class="btn fantasma sm" data-fechar aria-label="Fechar">${icon('x')}</button></div>
      <div class="modal-body">${corpo}</div>
      ${rodape ? html`<div class="modal-foot">${rodape}</div>` : ''}
    </div>`);
  document.body.appendChild(fundo);
  document.body.style.overflow = 'hidden';
  const fechar = () => {
    fundo.remove();
    if (!document.querySelector('.modal-fundo')) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (aoFechar) aoFechar();
  };
  const onKey = (e) => { if (e.key === 'Escape' && fundo === [...document.querySelectorAll('.modal-fundo')].pop()) fechar(); };
  document.addEventListener('keydown', onKey);
  fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fundo.dataset.down = '1'; });
  fundo.addEventListener('mouseup', (e) => { if (e.target === fundo && fundo.dataset.down === '1') fechar(); fundo.dataset.down = ''; });
  $$('[data-fechar]', fundo).forEach((b) => b.addEventListener('click', fechar));
  // Foco inicial imediato (nunca atrasado, para não tirar o cursor de quem já começou a digitar)
  if (!fundo.contains(document.activeElement)) {
    const f = fundo.querySelector('.modal-body input:not([type=hidden]):not([readonly]):not([type=file]), .modal-body select, .modal-body textarea');
    if (f) f.focus();
  }
  return { el: fundo, fechar };
}

// Confirmação com campo de justificativa obrigatório
export function pedirJustificativa({ titulo, mensagem, rotulo = 'Justificativa', botao = 'Confirmar', perigo = false }) {
  return new Promise((resolve) => {
    let resolvido = false;
    const m = abrirModal({
      titulo,
      corpo: html`${mensagem ? html`<p style="margin-top:0">${mensagem}</p>` : ''}
        <div class="campo"><label for="just-txt">${rotulo} <span class="req">*</span></label>
        <textarea id="just-txt" maxlength="1000" required></textarea>
        <span class="dica">Registrada permanentemente na auditoria.</span></div>`,
      rodape: html`<button class="btn" data-fechar>Voltar</button><button class="btn ${perigo ? 'perigo cheio' : 'primario'}" id="just-ok">${botao}</button>`,
      aoFechar: () => { if (!resolvido) resolve(null); },
    });
    $('#just-ok', m.el).addEventListener('click', () => {
      const v = $('#just-txt', m.el).value.trim();
      if (!v) { $('#just-txt', m.el).closest('.campo').classList.add('erro'); $('#just-txt', m.el).focus(); return; }
      resolvido = true; m.fechar(); resolve(v);
    });
  });
}

export function confirmar({ titulo, mensagem, botao = 'Confirmar' }) {
  return new Promise((resolve) => {
    let ok = false;
    const m = abrirModal({ titulo, corpo: html`<p style="margin:0">${mensagem}</p>`,
      rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="cf-ok">${botao}</button>`,
      aoFechar: () => resolve(ok) });
    $('#cf-ok', m.el).addEventListener('click', () => { ok = true; m.fechar(); });
  });
}

// Lê os campos de um formulário em objeto
export function lerForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; } else out[el.name] = el.value;
  }
  return out;
}

export function marcarErro(form, msg) {
  $$('.campo.erro', form).forEach((c) => c.classList.remove('erro'));
  const box = $('.form-erro', form);
  if (box) { box.innerHTML = ''; if (msg) mount(box, html`<div class="alerta erro">${icon('alerta')}<div>${msg}</div></div>`); }
}

export function opcoes(lista, valor, { vazio, rotulo = (x) => x.nome, valorDe = (x) => x.id } = {}) {
  return html`${vazio !== undefined ? html`<option value="">${vazio}</option>` : ''}${lista.map((x) => html`<option value="${valorDe(x)}" ${String(valorDe(x)) === String(valor ?? '') ? raw('selected') : ''}>${rotulo(x)}</option>`)}`;
}

export function debounce(fn, ms = 300) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export const natural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
