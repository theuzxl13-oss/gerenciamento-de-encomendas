// Gerenciar quadras e lotes: cadastro, edição, pesquisa, consulta, importação, desativação e exclusão controlada.
import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, abrirModal, lerForm, marcarErro, opcoes, fmtDataHora, pedirJustificativa } from '../ui.js';
import { abrirImportacao } from '../importacao.js';
import { exportarQuadrasLotes } from '../exportar.js';
import { estado, ehAdmin, carregarQuadrasLotes, lotesDaQuadra } from '../estado.js';

// "01" ≡ "1" (somente para pesquisa; o cadastro preserva o texto original)
const equiv = (s) => String(s).toUpperCase().replace(/\s+/g, '').replace(/(^|[^0-9])0+(?=\d)/g, '$1');
const ACOES = { LOTE_CRIADO: 'Lote cadastrado', LOTE_EDITADO: 'Lote alterado', LOTE_EXCLUIDO: 'Lote excluído' };
const CAMPOS = { quadra_id: 'Quadra', codigo: 'Lote', endereco: 'Endereço', observacao: 'Observação', ativo: 'Situação' };

// Pesquisa: aceita "68/00", "68-00", "68 0", "Q68 L00", trecho do endereço ou da observação.
function filtrarLotes(lotes, termo) {
  const t = termo.trim();
  const m = t.match(/^q?\s*([\p{L}\p{N}.]+)\s*[/\-\s]\s*l?\s*([\p{L}\p{N}.]+)$/iu);
  if (m) {
    const exatos = lotes.filter((l) => equiv(l.quadra_codigo) === equiv(m[1]) && equiv(l.codigo) === equiv(m[2]));
    if (exatos.length) return exatos;
  }
  const b = t.toLowerCase();
  return lotes.filter((l) => `${l.quadra_codigo}/${l.codigo} ${l.endereco || ''} ${l.observacao || ''}`.toLowerCase().includes(b)
    || equiv(l.codigo) === equiv(t));
}

const situacaoLote = (l) => (!l.quadra_ativa ? html`<span class="badge ativo-0" title="A quadra está desativada">Quadra inativa</span>`
  : html`<span class="badge ativo-${l.ativo}">${l.ativo ? 'Ativo' : 'Inativo'}</span>`);

export async function render(el, { atual }) {
  await carregarQuadrasLotes();
  if (!atual()) return;
  const admin = ehAdmin();
  let quadraSel = estado.quadras[0] ? estado.quadras[0].id : null;
  let busca = '';
  let buscaQuadra = '';
  let situacao = 'todos';

  mount(el, html`
    <div class="page-head"><div><h1>Gerenciar quadras e lotes</h1><p>Relação oficial de endereços da Fazenda da Ilha. Encomendas só podem ser registradas para lotes ativos desta relação.</p></div>
      <div class="acoes">${admin ? html`<button class="btn" id="importar">${icon('subir')} Importar planilha</button>` : ''}<button class="btn" id="exportar">${icon('baixar')} Exportar</button></div></div>
    <div class="alerta info">${icon('info')}<div>${admin
      ? html`<span>Inclua, altere ou desative quadras e lotes por aqui ou por planilha (CSV/Excel com as colunas Quadra e Lote) — as mudanças valem na hora, sem alterar o sistema. Lotes com encomendas não podem ser excluídos nem ter a identificação alterada: use <strong>Desativar</strong>, e o histórico é preservado.</span>`
      : 'Consulta da relação oficial. Inclusões e alterações são feitas pelo administrador.'}</div></div>
    <div class="small muted" id="totais" style="margin:-4px 0 12px"></div>
    <div class="split">
      <section class="card"><div class="card-head"><h2>Quadras</h2>${admin ? html`<button class="btn sm primario" id="nova-quadra">${icon('nova')} Quadra</button>` : ''}</div>
        <div style="padding:10px 10px 0"><input type="search" id="busca-quadra" placeholder="Filtrar quadras" style="min-height:34px" aria-label="Filtrar quadras"></div>
        <ul class="lista-sel" id="lista-quadras"></ul></section>
      <section class="card"><div class="card-head"><h2 id="titulo-lotes">Lotes</h2>
        <div class="btn-grupo">
          <input type="search" id="busca-lote" placeholder="Pesquisar: 68/00, lote, endereço" style="min-height:34px;width:230px" aria-label="Pesquisar lotes">
          <select id="situacao" style="min-height:34px;width:auto" aria-label="Situação">${opcoes([{ v: 'todos', r: 'Todos' }, { v: 'ativos', r: 'Ativos' }, { v: 'inativos', r: 'Inativos' }], 'todos', { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select>
          ${admin ? html`<button class="btn sm" id="editar-quadra">Editar quadra</button><button class="btn sm primario" id="novo-lote">${icon('nova')} Lote</button>` : ''}</div></div>
        <div id="lotes" class="tabela-wrap"></div></section>
    </div>
    ${admin ? html`<section class="card" style="margin-top:16px"><div class="card-head"><h2>Histórico de importações</h2><span class="small muted">Registro permanente: data, horário, responsável e totais</span></div><div id="hist-imp"></div></section>` : ''}`);

  const desenharTotais = () => {
    const qa = estado.quadras.filter((q) => q.ativo).length;
    const la = estado.lotes.filter((l) => l.ativo && l.quadra_ativa).length;
    mount($('#totais', el), html`<strong>${estado.quadras.length}</strong> quadra(s) (${qa} ativas) · <strong>${estado.lotes.length}</strong> lote(s) (${la} ativos, ${estado.lotes.length - la} inativos)`);
  };

  const desenharQuadras = () => {
    const ul = $('#lista-quadras', el);
    const lista = buscaQuadra ? estado.quadras.filter((q) => equiv(q.codigo).includes(equiv(buscaQuadra)) || (q.descricao || '').toLowerCase().includes(buscaQuadra.toLowerCase())) : estado.quadras;
    if (!lista.length) { mount(ul, html`<li class="vazio">${estado.quadras.length ? 'Nenhuma quadra encontrada.' : 'Nenhuma quadra cadastrada.'}</li>`); return; }
    mount(ul, html`${lista.map((q) => html`<li><button class="${q.id === quadraSel && !busca ? 'ativo' : ''} ${q.ativo ? '' : 'inativa'}" data-q="${q.id}">
      <span>Quadra ${q.codigo}${q.descricao ? html` <span class="small muted">· ${q.descricao}</span>` : ''}</span><span class="small muted">${q.lotes_ativos} lote(s)</span></button></li>`)}`);
    $$('[data-q]', ul).forEach((b) => b.addEventListener('click', () => {
      quadraSel = Number(b.dataset.q);
      busca = ''; $('#busca-lote', el).value = '';
      desenharQuadras(); desenharLotes();
    }));
  };

  const desenharLotes = () => {
    const box = $('#lotes', el);
    const q = estado.quadras.find((x) => x.id === quadraSel);
    let lista;
    if (busca) {
      lista = filtrarLotes(estado.lotes, busca);
      $('#titulo-lotes', el).textContent = `Resultado da pesquisa (${lista.length})`;
    } else {
      lista = q ? lotesDaQuadra(q.id, false) : [];
      $('#titulo-lotes', el).textContent = q ? `Lotes da quadra ${q.codigo}${q.ativo ? '' : ' (inativa)'}` : 'Lotes';
    }
    if (situacao === 'ativos') lista = lista.filter((l) => l.ativo && l.quadra_ativa);
    if (situacao === 'inativos') lista = lista.filter((l) => !l.ativo || !l.quadra_ativa);
    const be = $('#editar-quadra', el);
    if (be) be.classList.toggle('hidden', !q || !!busca);
    if (!lista.length) { mount(box, html`<div class="vazio">${q || busca ? 'Nenhum lote encontrado.' : 'Selecione ou cadastre uma quadra.'}</div>`); return; }
    const mostrar = lista.slice(0, 300);
    mount(box, html`<table class="tabela responsiva"><thead><tr><th>Quadra</th><th>Lote</th><th>Encomendas</th><th>Situação</th><th>Última alteração</th><th></th></tr></thead>
      <tbody>${mostrar.map((l) => html`<tr>
        <td data-rot="Quadra" class="mono">${l.quadra_codigo}</td><td data-rot="Lote" class="mono"><strong>${l.codigo}</strong>${l.endereco ? html`<div class="small muted" style="font-family:inherit">${l.endereco}</div>` : ''}</td>
        <td data-rot="Encomendas">${l.total_encomendas}${l.pendentes ? html` · <a href="#/pendentes?quadra_id=${l.quadra_id}&lote_id=${l.id}">${l.pendentes} pendente(s)</a>` : ''}</td>
        <td data-rot="Situação">${situacaoLote(l)}</td>
        <td data-rot="Última alteração" class="small">${fmtDataHora(l.atualizado_em)}${l.atualizado_por ? html`<div class="muted">${l.atualizado_por}</div>` : ''}</td>
        <td class="acoes"><button class="btn sm" data-ver="${l.id}">Consultar</button>${admin ? html` <button class="btn sm" data-ed-lote="${l.id}">Editar</button>` : ''}</td></tr>`)}</tbody></table>
      ${lista.length > mostrar.length ? html`<div class="paginacao">Exibindo ${mostrar.length} de ${lista.length}. Refine a pesquisa.</div>` : ''}`);
    $$('[data-ver]', box).forEach((b) => b.addEventListener('click', () => consultarLote(Number(b.dataset.ver))));
    $$('[data-ed-lote]', box).forEach((b) => b.addEventListener('click', () => formLote(estado.lotes.find((l) => l.id === Number(b.dataset.edLote)))));
  };

  const atualizar = async () => {
    await carregarQuadrasLotes();
    if (!atual()) return;
    if (!estado.quadras.some((q) => q.id === quadraSel)) quadraSel = estado.quadras[0] ? estado.quadras[0].id : null;
    desenharTotais(); desenharQuadras(); desenharLotes();
  };

  async function excluir(tipo, item, aoConcluir) {
    const rotulo = tipo === 'quadra' ? `a quadra ${item.codigo}` : `o lote ${item.codigo} da quadra ${item.quadra_codigo}`;
    const just = await pedirJustificativa({
      titulo: tipo === 'quadra' ? `Excluir quadra ${item.codigo}` : `Excluir lote ${item.codigo}`,
      mensagem: `Excluir ${rotulo}? Use apenas para cadastro feito por engano. ${tipo === 'quadra' ? 'Os lotes dela também serão excluídos. ' : ''}A exclusão fica registrada na auditoria.`,
      rotulo: 'Justificativa', botao: 'Excluir definitivamente', perigo: true,
    });
    if (!just) return;
    try {
      await api.del(`/${tipo === 'quadra' ? 'quadras' : 'lotes'}/${item.id}`, { justificativa: just });
      toast(tipo === 'quadra' ? 'Quadra excluída.' : 'Lote excluído.');
      aoConcluir();
      atualizar();
    } catch (err) { toast(err.message, 'erro', 9000); }
  }

  function formQuadra(q) {
    const travada = q && q.total_encomendas > 0;
    const m = abrirModal({
      titulo: q ? `Editar quadra ${q.codigo}` : 'Nova quadra',
      corpo: html`<form id="f-q" novalidate><div class="form-erro"></div>
        <div class="campo" style="margin-bottom:12px"><label>Identificação da quadra <span class="req">*</span></label>
          <input type="text" name="codigo" value="${q ? q.codigo : ''}" maxlength="30" required ${travada ? 'readonly' : ''} autocomplete="off">
          <span class="dica">${travada ? `A quadra possui ${q.total_encomendas} encomenda(s): a identificação não pode ser alterada.` : 'Exatamente como na relação oficial (ex.: 01, 115). Não há limite de numeração.'}</span></div>
        <div class="campo" style="margin-bottom:12px"><label>Descrição</label><input type="text" name="descricao" value="${q ? q.descricao || '' : ''}" maxlength="200"></div>
        ${q ? html`<label class="check"><input type="checkbox" name="ativo" ${q.ativo ? 'checked' : ''}> Quadra ativa (desativada, seus lotes deixam de aparecer no cadastro de encomendas)</label>
          <p class="small muted" style="margin:12px 0 0">Criada em ${fmtDataHora(q.criado_em)}${q.criado_por ? ` por ${q.criado_por}` : ''} · última alteração em ${fmtDataHora(q.atualizado_em)}${q.atualizado_por ? ` por ${q.atualizado_por}` : ''}.</p>` : ''}</form>`,
      rodape: html`${q && !q.total_encomendas ? html`<button class="btn perigo" id="q-excluir" style="margin-right:auto">Excluir quadra</button>` : ''}<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="q-ok">Salvar</button>`,
    });
    const enviar = async () => {
      const f = $('#f-q', m.el);
      const d = lerForm(f);
      if (travada) delete d.codigo;
      try {
        const r = q ? await api.put(`/quadras/${q.id}`, d) : await api.post('/quadras', d);
        quadraSel = r.id; m.fechar(); toast('Quadra salva.'); atualizar();
      } catch (err) { marcarErro(f, err.message); }
    };
    $('#q-ok', m.el).addEventListener('click', enviar);
    $('#f-q', m.el).addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
    const bx = $('#q-excluir', m.el);
    if (bx) bx.addEventListener('click', () => excluir('quadra', q, m.fechar));
  }

  function formLote(l) {
    const travado = l && l.total_encomendas > 0;
    const m = abrirModal({
      titulo: l ? `Editar lote ${l.codigo} (quadra ${l.quadra_codigo})` : 'Novo lote',
      corpo: html`<form id="f-l" class="form-grid" novalidate><div class="form-erro c-12"></div>
        <div class="campo c-6"><label>Quadra <span class="req">*</span></label><select name="quadra_id" ${travado ? 'disabled' : ''}>${opcoes(estado.quadras, l ? l.quadra_id : quadraSel, { rotulo: (q) => `Quadra ${q.codigo}${q.ativo ? '' : ' (inativa)'}` })}</select></div>
        <div class="campo c-6"><label>Lote <span class="req">*</span></label><input type="text" name="codigo" value="${l ? l.codigo : ''}" maxlength="30" required ${travado ? 'readonly' : ''} autocomplete="off"></div>
        <div class="c-12 small muted">${travado ? `Este lote possui ${l.total_encomendas} encomenda(s): quadra e número não podem ser alterados para preservar o histórico.` : 'Quadra e lote são campos separados. Informe o número exatamente como na relação oficial (zeros à esquerda são mantidos).'}</div>
        <div class="campo c-12"><label>Endereço (somente se constar na relação oficial)</label><input type="text" name="endereco" value="${l ? l.endereco || '' : ''}" maxlength="300"></div>
        <div class="campo c-12"><label>Observação</label><textarea name="observacao" maxlength="500">${l ? l.observacao || '' : ''}</textarea></div>
        ${l ? html`<label class="check c-12"><input type="checkbox" name="ativo" ${l.ativo ? 'checked' : ''}> Lote ativo (desativado, deixa de aparecer no cadastro de encomendas; o histórico é preservado)</label>` : ''}</form>`,
      rodape: html`${l && !l.total_encomendas ? html`<button class="btn perigo" id="l-excluir" style="margin-right:auto">Excluir lote</button>` : ''}<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="l-ok">Salvar</button>`,
    });
    $('#l-ok', m.el).addEventListener('click', async () => {
      const f = $('#f-l', m.el);
      const d = lerForm(f);
      if (travado) { delete d.codigo; delete d.quadra_id; }
      try {
        if (l) await api.put(`/lotes/${l.id}`, d); else await api.post('/lotes', d);
        m.fechar(); toast('Lote salvo.'); atualizar();
      } catch (err) { marcarErro(f, err.message); }
    });
    const bx = $('#l-excluir', m.el);
    if (bx) bx.addEventListener('click', () => excluir('lote', l, m.fechar));
  }

  async function consultarLote(id) {
    let l;
    try { l = await api.get(`/lotes/${id}`); } catch (err) { toast(err.message, 'erro'); return; }
    const valor = (k, v) => {
      if (v === null || v === undefined || v === '') return '(vazio)';
      if (k === 'ativo') return v ? 'Ativo' : 'Inativo';
      if (k === 'quadra_id') { const q = estado.quadras.find((x) => x.id === v); return q ? `Quadra ${q.codigo}` : `#${v}`; }
      return String(v);
    };
    const m = abrirModal({
      titulo: `Quadra ${l.quadra_codigo} · Lote ${l.codigo}`, largo: true,
      corpo: html`<dl class="dl">
          <dt>Quadra</dt><dd class="mono">${l.quadra_codigo}${l.quadra_ativa ? '' : ' (quadra inativa)'}</dd>
          <dt>Lote</dt><dd class="mono">${l.codigo}</dd>
          <dt>Situação</dt><dd>${situacaoLote(l)}</dd>
          <dt>Endereço</dt><dd>${l.endereco || html`<span class="muted">—</span>`}</dd>
          <dt>Observação</dt><dd>${l.observacao || html`<span class="muted">—</span>`}</dd>
          <dt>Encomendas</dt><dd>${l.total_encomendas} no total · ${l.pendentes} aguardando retirada${l.ultima_encomenda_em ? ` · última recebida em ${fmtDataHora(l.ultima_encomenda_em)}` : ''}</dd>
          <dt>Cadastrado</dt><dd>${fmtDataHora(l.criado_em)}${l.criado_por ? ` por ${l.criado_por}` : ' (importação/sistema)'}</dd>
          <dt>Última alteração</dt><dd>${fmtDataHora(l.atualizado_em)}${l.atualizado_por ? ` por ${l.atualizado_por}` : ''}</dd>
        </dl>
        <h3 style="margin:18px 0 10px">Histórico de alterações do cadastro</h3>
        ${l.alteracoes.length ? html`<ul class="timeline">${l.alteracoes.map((a) => html`<li><div class="quando">${fmtDataHora(a.ocorrido_em)} · ${a.usuario_nome || 'sistema'}</div>
          <div class="oque">${ACOES[a.acao] || a.acao}</div>
          ${a.acao === 'LOTE_EDITADO' && a.detalhes ? html`<div class="diff">${Object.entries(a.detalhes).map(([k, v]) => html`<div><strong>${CAMPOS[k] || k}:</strong> <del>${valor(k, v.antes)}</del> → <ins>${valor(k, v.depois)}</ins></div>`)}</div>` : ''}
          ${a.justificativa ? html`<div class="small"><strong>Justificativa:</strong> ${a.justificativa}</div>` : ''}</li>`)}</ul>`
          : html`<p class="muted small">Sem alterações registradas individualmente (lote incluído por importação — veja o histórico de importações).</p>`}`,
      rodape: html`<a class="btn" href="#/historico?quadra_id=${l.quadra_id}&lote_id=${l.id}&status=*" data-fechar>Ver encomendas do lote</a>${admin ? html`<button class="btn primario" id="c-editar">Editar</button>` : ''}<button class="btn" data-fechar>Fechar</button>`,
    });
    const be = $('#c-editar', m.el);
    if (be) be.addEventListener('click', () => { m.fechar(); formLote(estado.lotes.find((x) => x.id === id) || l); });
  }

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

  desenharTotais();
  desenharQuadras();
  desenharLotes();
  if (admin) desenharHistorico();
  $('#busca-lote', el).addEventListener('input', (e) => { busca = e.target.value.trim(); desenharQuadras(); desenharLotes(); });
  $('#busca-quadra', el).addEventListener('input', (e) => { buscaQuadra = e.target.value.trim(); desenharQuadras(); });
  $('#situacao', el).addEventListener('change', (e) => { situacao = e.target.value; desenharLotes(); });
  $('#exportar', el).addEventListener('click', () => exportarQuadrasLotes(estado.lotes).catch((e) => toast(e.message, 'erro')));
  if (admin) {
    $('#nova-quadra', el).addEventListener('click', () => formQuadra());
    $('#novo-lote', el).addEventListener('click', () => { if (!estado.quadras.length) return toast('Cadastre uma quadra primeiro.', 'erro'); formLote(); });
    $('#importar', el).addEventListener('click', () => abrirImportacao({ aoConcluir: () => { atualizar(); desenharHistorico(); } }));
    $('#editar-quadra', el).addEventListener('click', () => { const q = estado.quadras.find((x) => x.id === quadraSel); if (q) formQuadra(q); });
  }
}
