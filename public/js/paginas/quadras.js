import { api, baixar } from '../api.js';
import { html, mount, $, $$, icon, toast, abrirModal, lerForm, marcarErro, opcoes, fmtDataHora } from '../ui.js';
import { abrirImportacao } from '../importacao.js';
import { estado, ehAdmin, carregarQuadrasLotes, lotesDaQuadra } from '../estado.js';

export async function render(el, { atual }) {
  await carregarQuadrasLotes();
  if (!atual()) return;
  const admin = ehAdmin();
  let quadraSel = estado.quadras[0] ? estado.quadras[0].id : null;
  let busca = '';

  mount(el, html`
    <div class="page-head"><div><h1>Quadras e lotes</h1><p>Relação oficial de endereços da Fazenda da Ilha. Encomendas só podem ser registradas para lotes ativos desta relação.</p></div>
      ${admin ? html`<div class="acoes"><button class="btn" id="importar">${icon('subir')} Importar planilha</button><button class="btn" id="exportar">${icon('baixar')} Exportar</button></div>` : ''}</div>
    <div class="alerta info">${icon('info')}<div>A relação oficial de quadras e lotes será fornecida pela administração. Não cadastre endereços que não constem da relação oficial.
      ${admin ? ' Para carregar ou atualizar a relação, use "Importar planilha" (CSV ou Excel com as colunas Quadra e Lote).' : ''}</div></div>
    <div class="split">
      <section class="card"><div class="card-head"><h2>Quadras</h2>${admin ? html`<button class="btn sm primario" id="nova-quadra">${icon('nova')} Quadra</button>` : ''}</div>
        <ul class="lista-sel" id="lista-quadras"></ul></section>
      <section class="card"><div class="card-head"><h2 id="titulo-lotes">Lotes</h2>
        <div class="btn-grupo"><input type="search" id="busca-lote" placeholder="Buscar lote ou endereço" style="min-height:34px;width:200px">
        ${admin ? html`<button class="btn sm primario" id="novo-lote">${icon('nova')} Lote</button>` : ''}</div></div>
        <div id="lotes" class="tabela-wrap"></div></section>
    </div>
    ${admin ? html`<section class="card" style="margin-top:16px"><div class="card-head"><h2>Histórico de importações</h2><span class="small muted">Registro permanente: data, horário, responsável e totais</span></div><div id="hist-imp"></div></section>` : ''}`);

  const desenharQuadras = () => {
    const ul = $('#lista-quadras', el);
    if (!estado.quadras.length) { mount(ul, html`<li class="vazio">Nenhuma quadra cadastrada.</li>`); return; }
    mount(ul, html`${estado.quadras.map((q) => html`<li><button class="${q.id === quadraSel ? 'ativo' : ''} ${q.ativo ? '' : 'inativa'}" data-q="${q.id}">
      <span>Quadra ${q.codigo}${q.descricao ? html` <span class="small muted">· ${q.descricao}</span>` : ''}</span><span class="small muted">${q.lotes_ativos} lote(s)</span></button></li>`)}`);
    $$('[data-q]', ul).forEach((b) => b.addEventListener('click', () => { quadraSel = Number(b.dataset.q); desenharQuadras(); desenharLotes(); }));
  };

  const desenharLotes = () => {
    const box = $('#lotes', el);
    const q = estado.quadras.find((x) => x.id === quadraSel);
    $('#titulo-lotes', el).textContent = q ? `Lotes da quadra ${q.codigo}` : 'Lotes';
    let lista;
    if (busca) {
      const b = busca.toLowerCase();
      lista = estado.lotes.filter((l) => `${l.quadra_codigo} ${l.codigo} ${l.endereco || ''}`.toLowerCase().includes(b));
      $('#titulo-lotes', el).textContent = 'Resultado da busca';
    } else lista = q ? lotesDaQuadra(q.id, false) : [];
    if (!lista.length) { mount(box, html`<div class="vazio">${q || busca ? 'Nenhum lote encontrado.' : 'Selecione ou cadastre uma quadra.'}</div>`); return; }
    mount(box, html`<table class="tabela responsiva"><thead><tr><th>Quadra</th><th>Lote</th><th>Endereço</th><th>Observação</th><th>Pendentes</th><th>Situação</th>${admin ? html`<th></th>` : ''}</tr></thead>
      <tbody>${lista.map((l) => html`<tr>
        <td data-rot="Quadra">${l.quadra_codigo}</td><td data-rot="Lote"><strong>${l.codigo}</strong></td>
        <td data-rot="Endereço">${l.endereco || html`<span class="muted">—</span>`}</td><td data-rot="Observação" class="small">${l.observacao || ''}</td>
        <td data-rot="Pendentes">${l.pendentes ? html`<a href="#/pendentes?quadra_id=${l.quadra_id}&lote_id=${l.id}">${l.pendentes}</a>` : '0'}</td>
        <td data-rot="Situação"><span class="badge ativo-${l.ativo}">${l.ativo ? 'Ativo' : 'Inativo'}</span></td>
        ${admin ? html`<td class="acoes"><button class="btn sm" data-ed-lote="${l.id}">Editar</button></td>` : ''}</tr>`)}</tbody></table>`);
    $$('[data-ed-lote]', box).forEach((b) => b.addEventListener('click', () => formLote(estado.lotes.find((l) => l.id === Number(b.dataset.edLote)))));
  };

  const atualizar = async () => {
    await carregarQuadrasLotes();
    if (!atual()) return;
    if (!estado.quadras.some((q) => q.id === quadraSel)) quadraSel = estado.quadras[0] ? estado.quadras[0].id : null;
    desenharQuadras();
    desenharLotes();
  };

  function formQuadra(q) {
    const m = abrirModal({
      titulo: q ? `Editar quadra ${q.codigo}` : 'Nova quadra',
      corpo: html`<form id="f-q" novalidate><div class="form-erro"></div>
        <div class="campo" style="margin-bottom:12px"><label>Identificação da quadra <span class="req">*</span></label><input type="text" name="codigo" value="${q ? q.codigo : ''}" maxlength="30" required></div>
        <div class="campo" style="margin-bottom:12px"><label>Descrição</label><input type="text" name="descricao" value="${q ? q.descricao || '' : ''}" maxlength="200"></div>
        ${q ? html`<label class="check"><input type="checkbox" name="ativo" ${q.ativo ? 'checked' : ''}> Quadra ativa</label>` : ''}</form>`,
      rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="q-ok">Salvar</button>`,
    });
    const enviar = async () => {
      const f = $('#f-q', m.el);
      try {
        const r = q ? await api.put(`/quadras/${q.id}`, lerForm(f)) : await api.post('/quadras', lerForm(f));
        quadraSel = r.id; m.fechar(); toast('Quadra salva.'); atualizar();
      } catch (err) { marcarErro(f, err.message); }
    };
    $('#q-ok', m.el).addEventListener('click', enviar);
    $('#f-q', m.el).addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
  }

  function formLote(l) {
    const m = abrirModal({
      titulo: l ? `Editar lote ${l.codigo} (quadra ${l.quadra_codigo})` : 'Novo lote',
      corpo: html`<form id="f-l" class="form-grid" novalidate><div class="form-erro c-12"></div>
        <div class="campo c-6"><label>Quadra <span class="req">*</span></label><select name="quadra_id">${opcoes(estado.quadras, l ? l.quadra_id : quadraSel, { rotulo: (q) => `Quadra ${q.codigo}` })}</select></div>
        <div class="campo c-6"><label>Lote <span class="req">*</span></label><input type="text" name="codigo" value="${l ? l.codigo : ''}" maxlength="30" required></div>
        <div class="campo c-12"><label>Endereço (conforme relação oficial)</label><input type="text" name="endereco" value="${l ? l.endereco || '' : ''}" maxlength="300"></div>
        <div class="campo c-12"><label>Observação</label><textarea name="observacao" maxlength="500">${l ? l.observacao || '' : ''}</textarea></div>
        ${l ? html`<label class="check c-12"><input type="checkbox" name="ativo" ${l.ativo ? 'checked' : ''}> Lote ativo (desative em vez de excluir; o histórico é preservado)</label>` : ''}</form>`,
      rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="l-ok">Salvar</button>`,
    });
    $('#l-ok', m.el).addEventListener('click', async () => {
      const f = $('#f-l', m.el);
      try {
        if (l) await api.put(`/lotes/${l.id}`, lerForm(f)); else await api.post('/lotes', lerForm(f));
        m.fechar(); toast('Lote salvo.'); atualizar();
      } catch (err) { marcarErro(f, err.message); }
    });
  }

  const importar = () => abrirImportacao({ aoConcluir: () => { atualizar(); desenharHistorico(); } });

  async function desenharHistorico() {
    if (!$('#hist-imp', el)) return;
    const lista = await api.get('/quadras-lotes/importacoes');
    const box = $('#hist-imp', el);
    if (!box || !atual()) return;
    mount(box, lista.length ? html`<div class="tabela-wrap"><table class="tabela responsiva"><thead><tr><th>Data/hora</th><th>Responsável</th><th>Arquivo</th>
      <th class="right">Linhas</th><th class="right">Importados</th><th class="right">Ignorados</th><th class="right">Duplicados</th><th class="right">Quadras novas</th><th class="right">Desativados</th></tr></thead>
      <tbody>${lista.map((i) => html`<tr><td data-rot="Data/hora" class="nowrap">${fmtDataHora(i.realizada_em)}</td><td data-rot="Responsável">${i.usuario_nome}</td>
        <td data-rot="Arquivo"><span class="small">${i.arquivo_nome}</span><div class="small muted mono" title="SHA-256">${i.arquivo_sha256.slice(0, 16)}…</div></td>
        <td data-rot="Linhas" class="right">${i.total_linhas}</td><td data-rot="Importados" class="right">${i.importados}${i.reativados ? html` <span class="small muted">(${i.reativados} reativ.)</span>` : ''}</td>
        <td data-rot="Ignorados" class="right">${i.ignorados}</td><td data-rot="Duplicados" class="right">${i.duplicados}</td>
        <td data-rot="Quadras novas" class="right">${i.quadras_novas}</td><td data-rot="Desativados" class="right">${i.desativados}</td></tr>`)}</tbody></table></div>`
      : html`<div class="vazio">Nenhuma importação realizada.</div>`);
  }

  desenharQuadras();
  desenharLotes();
  if (admin) desenharHistorico();
  $('#busca-lote', el).addEventListener('input', (e) => { busca = e.target.value.trim(); desenharLotes(); });
  if (admin) {
    $('#nova-quadra', el).addEventListener('click', () => formQuadra());
    $('#novo-lote', el).addEventListener('click', () => { if (!estado.quadras.length) return toast('Cadastre uma quadra primeiro.', 'erro'); formLote(); });
    $('#importar', el).addEventListener('click', importar);
    $('#exportar', el).addEventListener('click', () => baixar('/quadras-lotes/exportar.xlsx').catch((e) => toast(e.message, 'erro')));
    $('#lista-quadras', el).addEventListener('dblclick', (e) => {
      const b = e.target.closest('[data-q]');
      if (b) formQuadra(estado.quadras.find((q) => q.id === Number(b.dataset.q)));
    });
    // botão de edição da quadra selecionada
    const be = document.createElement('button');
    be.className = 'btn sm';
    be.textContent = 'Editar quadra';
    be.addEventListener('click', () => { const q = estado.quadras.find((x) => x.id === quadraSel); if (q) formQuadra(q); });
    $('#busca-lote', el).before(be);
  }
}
