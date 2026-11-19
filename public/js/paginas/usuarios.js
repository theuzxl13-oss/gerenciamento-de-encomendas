import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, abrirModal, lerForm, marcarErro, opcoes, fmtDataHora } from '../ui.js';
import { estado, carregarUsuarios } from '../estado.js';

const PERFIS = [{ v: 'CONTROLADOR', r: 'Controlador de acesso' }, { v: 'ADMIN', r: 'Administrador' }];

export async function render(el, { atual }) {
  const lista = await api.get('/usuarios');
  if (!atual()) return;
  mount(el, html`
    <div class="page-head"><div><h1>Usuários</h1><p>Cada funcionário deve ter seu próprio acesso. Usuários não são excluídos, apenas desativados, para preservar o histórico.</p></div>
      <div class="acoes"><button class="btn primario" id="novo">${icon('nova')} Novo usuário</button></div></div>
    <div class="card"><div class="tabela-wrap"><table class="tabela responsiva">
      <thead><tr><th>Nome</th><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
      <tbody>${lista.map((u) => html`<tr>
        <td data-rot="Nome"><strong>${u.nome}</strong>${u.id === estado.usuario.id ? html` <span class="small muted">(você)</span>` : ''}</td>
        <td data-rot="Usuário" class="mono">${u.login}</td><td data-rot="E-mail">${u.email || ''}</td>
        <td data-rot="Perfil"><span class="badge perfil-${u.perfil}">${u.perfil === 'ADMIN' ? 'Administrador' : 'Controlador'}</span></td>
        <td data-rot="Situação"><span class="badge ativo-${u.ativo}">${u.ativo ? 'Ativo' : 'Inativo'}</span>${u.bloqueado_ate && u.bloqueado_ate > new Date().toISOString() ? html` <span class="badge st-PENDENTE">bloqueado</span>` : ''}</td>
        <td data-rot="Último acesso" class="nowrap">${u.ultimo_login_em ? fmtDataHora(u.ultimo_login_em) : html`<span class="muted">nunca</span>`}</td>
        <td class="acoes"><button class="btn sm" data-ed="${u.id}">Editar</button> <button class="btn sm" data-senha="${u.id}">Redefinir senha</button></td></tr>`)}</tbody></table></div></div>`);

  const recarregar = async () => { await carregarUsuarios(); render(el, { atual }); };
  $('#novo', el).addEventListener('click', () => form(null, recarregar));
  $$('[data-ed]', el).forEach((b) => b.addEventListener('click', () => form(lista.find((u) => u.id === Number(b.dataset.ed)), recarregar)));
  $$('[data-senha]', el).forEach((b) => b.addEventListener('click', () => redefinir(lista.find((u) => u.id === Number(b.dataset.senha)), recarregar)));
}

function form(u, recarregar) {
  const m = abrirModal({
    titulo: u ? `Editar ${u.nome}` : 'Novo usuário',
    corpo: html`<form id="f-u" class="form-grid" novalidate><div class="form-erro c-12"></div>
      <div class="campo c-12"><label>Nome completo <span class="req">*</span></label><input type="text" name="nome" value="${u ? u.nome : ''}" maxlength="120" required></div>
      <div class="campo c-6"><label>Usuário (login) <span class="req">*</span></label><input type="text" name="login" value="${u ? u.login : ''}" maxlength="60" autocapitalize="none" required></div>
      <div class="campo c-6"><label>E-mail</label><input type="email" name="email" value="${u ? u.email || '' : ''}" maxlength="160"></div>
      <div class="campo c-6"><label>Perfil <span class="req">*</span></label><select name="perfil">${opcoes(PERFIS, u ? u.perfil : 'CONTROLADOR', { rotulo: (p) => p.r, valorDe: (p) => p.v })}</select></div>
      ${u ? html`<div class="campo c-6"><label>Situação</label><label class="check" style="min-height:40px"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Usuário ativo</label></div>`
        : html`<div class="campo c-6"><label>Senha inicial <span class="req">*</span></label><input type="password" name="senha" autocomplete="new-password" required><span class="dica">O usuário deverá trocá-la no primeiro acesso.</span></div>`}
      <div class="c-12 small muted"><strong>Administrador:</strong> acesso total (usuários, configurações, auditoria, correções e estornos). <strong>Controlador de acesso:</strong> rotina da portaria (cadastro, consulta, baixas, relatórios).</div>
    </form>`,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="u-ok">Salvar</button>`,
  });
  $('#u-ok', m.el).addEventListener('click', async () => {
    const f = $('#f-u', m.el);
    try {
      if (u) await api.put(`/usuarios/${u.id}`, lerForm(f)); else await api.post('/usuarios', lerForm(f));
      m.fechar(); toast('Usuário salvo.'); recarregar();
    } catch (err) { marcarErro(f, err.message); }
  });
}

function redefinir(u, recarregar) {
  const m = abrirModal({
    titulo: `Redefinir senha – ${u.nome}`,
    corpo: html`<form id="f-s" novalidate><div class="form-erro"></div>
      <div class="campo"><label>Nova senha temporária</label><input type="password" name="senha" autocomplete="new-password" required><span class="dica">Mínimo 8 caracteres com letras e números. O usuário deverá trocá-la ao entrar. Sessões abertas serão encerradas e o bloqueio por tentativas será removido.</span></div></form>`,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="s-ok">Redefinir</button>`,
  });
  $('#s-ok', m.el).addEventListener('click', async () => {
    const f = $('#f-s', m.el);
    try { await api.post(`/usuarios/${u.id}/redefinir-senha`, lerForm(f)); m.fechar(); toast('Senha redefinida.'); recarregar(); } catch (err) { marcarErro(f, err.message); }
  });
}
