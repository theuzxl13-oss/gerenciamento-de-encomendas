// Aplicação: roteamento, layout, login e primeiro acesso.
import { api, definirAoExpirar } from './api.js';
import { html, mount, $, $$, icon, toast, agoraSP, fmtData, iniciais, abrirModal, lerForm, marcarErro } from './ui.js';
import { estado, ehAdmin, carregarTudo } from './estado.js';

import * as dashboard from './paginas/dashboard.js';
import * as nova from './paginas/nova.js';
import * as pendentes from './paginas/pendentes.js';
import * as historico from './paginas/historico.js';
import * as ficha from './paginas/ficha.js';
import * as quadras from './paginas/quadras.js';
import * as relatorios from './paginas/relatorios.js';
import * as usuarios from './paginas/usuarios.js';
import * as auditoria from './paginas/auditoria.js';
import * as configuracoes from './paginas/configuracoes.js';

const app = document.getElementById('app');

const MENU = [
  { rota: 'dashboard', rotulo: 'Dashboard', icone: 'painel', pagina: dashboard },
  { rota: 'nova', rotulo: 'Nova encomenda', icone: 'nova', pagina: nova },
  { rota: 'pendentes', rotulo: 'Encomendas pendentes', icone: 'caixa', pagina: pendentes, badge: true },
  { rota: 'historico', rotulo: 'Histórico de encomendas', icone: 'historico', pagina: historico },
  { rota: 'quadras', rotulo: 'Quadras e lotes', rotuloAdmin: 'Gerenciar quadras e lotes', icone: 'mapa', pagina: quadras },
  { rota: 'relatorios', rotulo: 'Relatórios', icone: 'relatorio', pagina: relatorios },
  { rota: 'usuarios', rotulo: 'Usuários', icone: 'usuarios', pagina: usuarios, admin: true },
  { rota: 'auditoria', rotulo: 'Auditoria', icone: 'escudo', pagina: auditoria, admin: true },
  { rota: 'configuracoes', rotulo: 'Configurações', icone: 'config', pagina: configuracoes },
];
const ROTAS = { ...Object.fromEntries(MENU.map((m) => [m.rota, m])), encomenda: { rota: 'encomenda', rotulo: 'Ficha da encomenda', pagina: ficha, pai: 'historico' } };

export function navegar(hash) {
  if (location.hash === hash) rotear(); else location.hash = hash;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [caminho, query = ''] = h.split('?');
  const [rota, ...params] = caminho.split('/').filter(Boolean);
  return { rota: rota || 'dashboard', params, query: Object.fromEntries(new URLSearchParams(query)) };
}

let relogioTimer;
function layout() {
  const u = estado.usuario;
  mount(app, html`
  <div class="layout" id="layout">
    <aside class="sidebar" aria-label="Menu principal">
      <div class="brand"><img src="/img/simbolo.png" alt=""><div><strong>Fazenda da Ilha</strong><span>Gestão de Encomendas</span></div></div>
      <nav class="nav">
        ${MENU.filter((m) => !m.admin || ehAdmin()).map((m, i) => html`
          ${i === 6 ? html`<div class="grupo">Administração</div>` : ''}
          <a href="#/${m.rota}" data-rota="${m.rota}">${icon(m.icone)}<span>${ehAdmin() && m.rotuloAdmin ? m.rotuloAdmin : m.rotulo}</span>${m.badge ? html`<span class="badge-nav hidden" id="badge-pend"></span>` : ''}</a>`)}
      </nav>
      <div class="sidebar-foot">Livro digital da portaria<br>Horário de Brasília</div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="btn fantasma sm menu-btn" id="menu-btn" aria-label="Abrir menu">${icon('menu')}</button>
        <div class="titulo" id="titulo-pagina"></div>
        <div class="espaco"></div>
        <div class="relogio" id="relogio"></div>
        <div class="usuario-box">
          <div class="avatar" aria-hidden="true">${iniciais(u.nome)}</div>
          <div class="txt"><div class="nome">${u.nome}</div><div class="perfil">${u.perfil === 'ADMIN' ? 'Administrador' : 'Controlador de acesso'}</div></div>
          <button class="btn fantasma sm" id="sair" title="Sair">${icon('sair')}<span class="sr-only">Sair</span></button>
        </div>
      </header>
      <main class="content" id="conteudo"></main>
    </div>
  </div>`);
  $('#sair').addEventListener('click', sair);
  $('#menu-btn').addEventListener('click', () => $('#layout').classList.toggle('menu-aberto'));
  $('#layout').addEventListener('click', (e) => {
    if (e.target.id === 'layout' || e.target.closest('.nav a')) $('#layout').classList.remove('menu-aberto');
  });
  const tick = () => {
    const p = agoraSP();
    const el = $('#relogio');
    if (el) el.textContent = `${fmtData(p.date)} ${p.time}`;
  };
  tick();
  clearInterval(relogioTimer);
  relogioTimer = setInterval(tick, 15000);
}

export async function atualizarBadgePendentes() {
  try {
    const r = await api.get('/encomendas?status=PENDENTE&por_pagina=1');
    const b = $('#badge-pend');
    if (b) { b.textContent = r.total; b.classList.toggle('hidden', !r.total); }
  } catch { /* silencioso */ }
}

let renderId = 0;
async function rotear() {
  if (!estado.usuario) return;
  const { rota, params, query } = parseHash();
  const def = ROTAS[rota] || ROTAS.dashboard;
  if (!$('#layout')) layout();
  if (def.admin && !ehAdmin()) { navegar('#/dashboard'); return; }
  $$('.nav a').forEach((a) => a.classList.toggle('ativo', a.dataset.rota === (def.pai || def.rota)));
  const rotulo = ehAdmin() && def.rotuloAdmin ? def.rotuloAdmin : def.rotulo;
  $('#titulo-pagina').textContent = rotulo;
  document.title = `${rotulo} – Encomendas Fazenda da Ilha`;
  const el = $('#conteudo');
  const id = ++renderId;
  el.innerHTML = '<div class="boot">Carregando…</div>';
  window.scrollTo(0, 0);
  try {
    await def.pagina.render(el, { params, query, navegar, atual: () => id === renderId });
  } catch (e) {
    if (id !== renderId) return;
    if (e.status === 401) return;
    mount(el, html`<div class="alerta erro">${icon('alerta')}<div><strong>Não foi possível carregar a página.</strong>${e.message}</div></div>`);
  }
  atualizarBadgePendentes();
}

async function sair() {
  try { await api.post('/auth/logout'); } catch { /* ignora */ }
  estado.usuario = null;
  telaLogin();
}

// ---------- Login / primeiro acesso ----------
function ladoMarca() {
  return html`<div class="login-lado">
    <div class="marca"><img src="/img/logo.png" alt="Fazenda da Ilha – Condomínio Residencial"><span>Portaria · Gestão de Encomendas</span></div>
    <div><h2>Livro digital de controle de encomendas da portaria</h2>
    <p class="extra">Recebimento, armazenamento, localização e retirada das encomendas dos moradores, com histórico permanente e auditável.</p></div>
    <div class="extra small" style="color:#9fbcae">Acesso restrito a funcionários autorizados. Todas as operações são registradas.</div>
  </div>`;
}

async function telaLogin(msg) {
  let setup = false;
  try { setup = (await api.get('/setup')).precisa_configurar; } catch { /* servidor indisponível: exibe login */ }
  if (setup) return telaSetup();
  document.title = 'Entrar – Encomendas Fazenda da Ilha';
  mount(app, html`<div class="login-page">${ladoMarca()}
    <div class="login-form-wrap"><form class="login-card" id="form-login" novalidate>
      <h1>Entrar</h1><p class="muted" style="margin-top:0">Use seu usuário individual.</p>
      <div class="form-erro">${msg ? html`<div class="alerta info">${icon('info')}<div>${msg}</div></div>` : ''}</div>
      <div class="campo"><label for="login">Usuário ou e-mail</label><input type="text" id="login" name="login" autocomplete="username" autocapitalize="none" required></div>
      <div class="campo"><label for="senha">Senha</label><input type="password" id="senha" name="senha" autocomplete="current-password" required></div>
      <button class="btn primario lg" type="submit">Entrar</button>
    </form></div></div>`);
  $('#login').focus();
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const btn = $('button[type=submit]', f);
    btn.disabled = true;
    try {
      await api.post('/auth/login', lerForm(f));
      await iniciarSessao();
    } catch (err) {
      marcarErro(f, err.message);
      $('#senha').value = '';
      $('#senha').focus();
    } finally { btn.disabled = false; }
  });
}

function telaSetup() {
  document.title = 'Configuração inicial – Encomendas Fazenda da Ilha';
  mount(app, html`<div class="login-page">${ladoMarca()}
    <div class="login-form-wrap"><form class="login-card" id="form-setup" novalidate>
      <h1>Configuração inicial</h1>
      <p class="muted" style="margin-top:0">Nenhum usuário cadastrado. Crie a conta do <strong>administrador</strong> responsável pelo sistema.</p>
      <div class="form-erro"></div>
      <div class="campo"><label>Nome completo</label><input type="text" name="nome" required autocomplete="name"></div>
      <div class="campo"><label>Usuário (login)</label><input type="text" name="login" required autocapitalize="none" autocomplete="username"></div>
      <div class="campo"><label>E-mail (opcional)</label><input type="email" name="email" autocomplete="email"></div>
      <div class="campo"><label>Senha</label><input type="password" name="senha" required autocomplete="new-password"><span class="dica">Mínimo 8 caracteres, com letras e números.</span></div>
      <div class="campo"><label>Confirmar senha</label><input type="password" name="senha2" required autocomplete="new-password"></div>
      <button class="btn primario lg" type="submit">Criar administrador e entrar</button>
    </form></div></div>`);
  $('#form-setup').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const d = lerForm(f);
    if (d.senha !== d.senha2) return marcarErro(f, 'As senhas não conferem.');
    try {
      await api.post('/setup', d);
      await iniciarSessao();
      toast('Administrador criado. Comece cadastrando ou importando a relação oficial de quadras e lotes.');
      navegar('#/quadras');
    } catch (err) { marcarErro(f, err.message); }
  });
}

export function modalTrocarSenha(obrigatorio = false) {
  const m = abrirModal({
    titulo: obrigatorio ? 'Defina uma nova senha' : 'Alterar minha senha',
    corpo: html`<form id="form-senha" novalidate>
      ${obrigatorio ? html`<div class="alerta info">${icon('info')}<div>Sua senha foi definida pelo administrador. Por segurança, crie uma senha pessoal agora.</div></div>` : ''}
      <div class="form-erro"></div>
      <div class="campo" style="margin-bottom:12px"><label>Senha atual</label><input type="password" name="senha_atual" autocomplete="current-password" required></div>
      <div class="campo" style="margin-bottom:12px"><label>Nova senha</label><input type="password" name="nova_senha" autocomplete="new-password" required><span class="dica">Mínimo 8 caracteres, com letras e números.</span></div>
      <div class="campo"><label>Confirmar nova senha</label><input type="password" name="nova_senha2" autocomplete="new-password" required></div>
    </form>`,
    rodape: html`${obrigatorio ? '' : html`<button class="btn" data-fechar>Cancelar</button>`}<button class="btn primario" id="senha-ok">Salvar nova senha</button>`,
  });
  if (obrigatorio) $$('[data-fechar]', m.el).forEach((b) => b.remove());
  const enviar = async () => {
    const f = $('#form-senha', m.el);
    const d = lerForm(f);
    if (d.nova_senha !== d.nova_senha2) return marcarErro(f, 'As senhas não conferem.');
    try {
      await api.post('/auth/senha', d);
      estado.usuario.trocar_senha = false;
      m.fechar();
      toast('Senha alterada com sucesso.');
    } catch (err) { marcarErro(f, err.message); }
  };
  $('#senha-ok', m.el).addEventListener('click', enviar);
  $('#form-senha', m.el).addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
}

async function iniciarSessao() {
  estado.usuario = await api.get('/auth/me');
  await carregarTudo();
  layout();
  if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '#/dashboard';
  await rotear();
  if (estado.usuario.trocar_senha) modalTrocarSenha(true);
}

definirAoExpirar(() => {
  if (!estado.usuario) return;
  estado.usuario = null;
  document.querySelectorAll('.modal-fundo').forEach((m) => m.remove());
  document.body.style.overflow = '';
  telaLogin('Sua sessão expirou. Entre novamente para continuar.');
});

window.addEventListener('hashchange', rotear);

(async () => {
  try {
    estado.usuario = await api.get('/auth/me');
  } catch { estado.usuario = null; }
  if (estado.usuario) {
    try { await iniciarSessao(); } catch (e) { mount(app, html`<div class="boot">Falha ao iniciar: ${e.message}</div>`); }
  } else telaLogin();
})();
