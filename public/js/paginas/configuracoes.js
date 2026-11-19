import { api, baixar } from '../api.js';
import { html, mount, $, $$, icon, toast, lerForm, marcarErro, fmtDataHora, fmtBytes, abrirModal } from '../ui.js';
import { estado, ehAdmin, carregarConfig, carregarTransportadoras } from '../estado.js';
import { modalTrocarSenha } from '../main.js';

export async function render(el, { atual }) {
  const admin = ehAdmin();
  const [transps, backups] = admin ? await Promise.all([api.get('/transportadoras?todas=1'), api.get('/backups')]) : [[], []];
  if (!atual()) return;
  await carregarConfig();
  const c = estado.config;
  mount(el, html`
    <div class="page-head"><div><h1>Configurações</h1><p>${admin ? 'Parâmetros do sistema, transportadoras, backups e sua conta.' : 'Sua conta de acesso.'}</p></div></div>
    <section class="card"><div class="card-head"><h2>Minha conta</h2></div><div class="card-body">
      <dl class="dl"><dt>Nome</dt><dd>${estado.usuario.nome}</dd><dt>Usuário</dt><dd class="mono">${estado.usuario.login}</dd>
      <dt>Perfil</dt><dd>${admin ? 'Administrador' : 'Controlador de acesso'}</dd></dl>
      <button class="btn" id="trocar-senha" style="margin-top:12px">Alterar minha senha</button></div></section>
    ${admin ? html`
    <section class="card"><div class="card-head"><h2>Parâmetros da portaria</h2></div><div class="card-body">
      <form id="f-cfg" class="form-grid" novalidate><div class="form-erro c-12"></div>
        <div class="campo c-12"><label>Plantões (um por linha)</label><textarea name="plantoes" rows="4" placeholder="Informe os plantões/escalas usados na portaria">${(c.plantoes || []).join('\n')}</textarea>
          <span class="dica">Usados na "retirada por outro plantão". Se vazio, o plantão é digitado livremente.</span></div>
        <div class="campo c-3"><label>Alerta de espera (dias)</label><input type="number" name="dias_alerta" min="1" max="365" value="${c.dias_alerta}"></div>
        <div class="campo c-3"><label>Espera crítica (dias)</label><input type="number" name="dias_critico" min="1" max="365" value="${c.dias_critico}"></div>
        <div class="campo c-3"><label>Tolerância de horário (min)</label><input type="number" name="minutos_tolerancia_horario" min="1" max="1440" value="${c.minutos_tolerancia_horario}"><span class="dica">Acima disso, a baixa exige justificativa.</span></div>
        <div class="campo c-3"><label>Retenção de backups (dias)</label><input type="number" name="backup_retencao_dias" min="1" max="3650" value="${c.backup_retencao_dias}"></div>
        <label class="check c-12"><input type="checkbox" name="backup_automatico" ${c.backup_automatico ? 'checked' : ''}> Backup automático diário do banco de dados</label>
        <div class="c-12 form-acoes"><button class="btn primario" type="submit">Salvar parâmetros</button></div>
      </form></div></section>

    <section class="card"><div class="card-head"><h2>Transportadoras</h2><button class="btn sm primario" id="nova-t">${icon('nova')} Incluir</button></div>
      <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th>Encomendas</th><th>Situação</th><th></th></tr></thead>
      <tbody>${transps.map((t) => html`<tr><td>${t.nome}</td><td>${t.uso}</td><td><span class="badge ativo-${t.ativo}">${t.ativo ? 'Ativa' : 'Inativa'}</span></td>
        <td class="acoes"><button class="btn sm" data-ren="${t.id}">Renomear</button> <button class="btn sm" data-tog="${t.id}">${t.ativo ? 'Desativar' : 'Ativar'}</button></td></tr>`)}</tbody></table></div></section>

    <section class="card"><div class="card-head"><h2>Backups do banco de dados</h2><button class="btn sm primario" id="backup">Criar backup agora</button></div>
      <div class="card-body small muted" style="padding-bottom:0">Os backups ficam na pasta <span class="mono">data/backups</span> do servidor. Recomenda-se copiá-los periodicamente para outro local (pen drive, nuvem). Comprovantes ficam em <span class="mono">data/uploads</span>.</div>
      ${backups.length ? html`<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Arquivo</th><th>Criado em</th><th>Tamanho</th><th></th></tr></thead>
        <tbody>${backups.slice(0, 30).map((b) => html`<tr><td class="mono small">${b.nome}</td><td>${fmtDataHora(b.criado_em)}</td><td>${fmtBytes(b.tamanho)}</td>
          <td class="acoes"><button class="btn sm" data-bk="${b.nome}">${icon('baixar')} Baixar</button></td></tr>`)}</tbody></table></div>` : html`<div class="vazio">Nenhum backup ainda.</div>`}</section>` : ''}`);

  $('#trocar-senha', el).addEventListener('click', () => modalTrocarSenha(false));
  if (!admin) return;
  const recarregar = () => render(el, { atual });
  const f = $('#f-cfg', el);
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = lerForm(f);
    try {
      await api.put('/configuracoes', { ...d, plantoes: d.plantoes.split('\n').map((s) => s.trim()).filter(Boolean) });
      await carregarConfig();
      toast('Parâmetros salvos.');
      marcarErro(f, null);
    } catch (err) { marcarErro(f, err.message); }
  });
  $('#nova-t', el).addEventListener('click', () => nomeTransp(null, recarregar));
  $$('[data-ren]', el).forEach((b) => b.addEventListener('click', () => nomeTransp(transps.find((t) => t.id === Number(b.dataset.ren)), recarregar)));
  $$('[data-tog]', el).forEach((b) => b.addEventListener('click', async () => {
    const t = transps.find((x) => x.id === Number(b.dataset.tog));
    try { await api.put(`/transportadoras/${t.id}`, { ativo: !t.ativo }); await carregarTransportadoras(); recarregar(); } catch (err) { toast(err.message, 'erro'); }
  }));
  $('#backup', el).addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { const b = await api.post('/backups'); toast(`Backup criado: ${b.nome}`); recarregar(); } catch (err) { toast(err.message, 'erro'); }
  });
  $$('[data-bk]', el).forEach((b) => b.addEventListener('click', () => baixar(`/backups/${encodeURIComponent(b.dataset.bk)}`).catch((e) => toast(e.message, 'erro'))));
}

function nomeTransp(t, recarregar) {
  const m = abrirModal({
    titulo: t ? `Renomear ${t.nome}` : 'Nova transportadora',
    corpo: html`<form id="f-t" novalidate><div class="form-erro"></div><div class="campo"><label>Nome</label><input type="text" name="nome" value="${t ? t.nome : ''}" maxlength="80"></div></form>`,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="t-ok">Salvar</button>`,
  });
  const enviar = async () => {
    const f = $('#f-t', m.el);
    try {
      if (t) await api.put(`/transportadoras/${t.id}`, lerForm(f)); else await api.post('/transportadoras', lerForm(f));
      await carregarTransportadoras(); m.fechar(); toast('Transportadora salva.'); recarregar();
    } catch (err) { marcarErro(f, err.message); }
  };
  $('#t-ok', m.el).addEventListener('click', enviar);
  $('#f-t', m.el).addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
}
