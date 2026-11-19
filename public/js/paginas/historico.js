import { api, qs, baixar } from '../api.js';
import { html, mount, $, $$, icon, toast, statusBadge, diasBadge, endereco, fmtDataHora, fmtRetirada, opcoes, debounce } from '../ui.js';
import { estado, lotesDaQuadra } from '../estado.js';

const SITUACOES = [
  { v: '', r: 'Todas (exceto canceladas)' },
  { v: 'PENDENTE', r: 'Aguardando retirada' },
  { v: 'RETIRADA', r: 'Retiradas na portaria' },
  { v: 'RETIRADA_OUTRO_PLANTAO', r: 'Retiradas por outro plantão' },
  { v: 'RETIRADA,RETIRADA_OUTRO_PLANTAO', r: 'Todas as retiradas' },
  { v: 'CANCELADA', r: 'Canceladas' },
  { v: '*', r: 'Todas, inclusive canceladas' },
];
const CAMPOS = ['q', 'codigo', 'quadra_id', 'lote_id', 'descricao', 'transportadora_id', 'status', 'data_ini', 'data_fim', 'retirada_ini', 'retirada_fim', 'recebido_por_id', 'retirado_por', 'entregue_por', 'plantao', 'tipo_retirada', 'ordem'];

export async function render(el, { navegar, query, atual }) {
  const f = Object.fromEntries(CAMPOS.map((k) => [k, query[k] || '']));
  if (!f.ordem) f.ordem = 'recebido_desc';
  let pagina = 1;
  const avancado = CAMPOS.slice(4).some((k) => k !== 'ordem' && k !== 'status' && f[k]);

  mount(el, html`
    <div class="page-head"><div><h1>Histórico de encomendas</h1><p>Arquivo digital permanente: todas as encomendas de qualquer período, pendentes ou retiradas.</p></div>
      <div class="acoes"><button class="btn" id="exp-pdf">${icon('baixar')} PDF</button><button class="btn" id="exp-xlsx">${icon('baixar')} Excel</button></div></div>
    <div class="card"><div class="card-body">
      <form class="filtros" id="filtros" autocomplete="off">
        <div class="campo" style="grid-column:span 2"><label>Busca geral</label><input type="search" name="q" value="${f.q}" placeholder="Descrição, identificador, rastreio, nome de quem retirou…"></div>
        <div class="campo"><label>Quadra</label><select name="quadra_id">${opcoes(estado.quadras, f.quadra_id, { vazio: 'Todas', rotulo: (q) => `Quadra ${q.codigo}` })}</select></div>
        <div class="campo"><label>Lote</label><select name="lote_id"></select></div>
        <div class="campo"><label>Situação</label><select name="status">${opcoes(SITUACOES, f.status, { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select></div>
        <div class="campo"><label>Recebida de</label><input type="date" name="data_ini" value="${f.data_ini}"></div>
        <div class="campo"><label>Recebida até</label><input type="date" name="data_fim" value="${f.data_fim}"></div>
        <div class="acoes-filtro"><button type="button" class="btn" id="mais">${avancado ? 'Menos filtros' : 'Mais filtros'}</button><button type="button" class="btn" id="limpar">Limpar</button></div>
      </form>
      <form class="filtros ${avancado ? '' : 'hidden'}" id="filtros2" style="margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)" autocomplete="off">
        <div class="campo"><label>Identificador</label><input type="text" name="codigo" value="${f.codigo}" placeholder="FI-…"></div>
        <div class="campo"><label>Descrição</label><input type="text" name="descricao" value="${f.descricao}"></div>
        <div class="campo"><label>Transportadora</label><select name="transportadora_id">${opcoes(estado.transportadoras, f.transportadora_id, { vazio: 'Todas' })}</select></div>
        <div class="campo"><label>Recebido por</label><select name="recebido_por_id">${opcoes(estado.usuarios, f.recebido_por_id, { vazio: 'Todos' })}</select></div>
        <div class="campo"><label>Nome de quem retirou</label><input type="text" name="retirado_por" value="${f.retirado_por}"></div>
        <div class="campo"><label>Controlador que entregou</label><input type="text" name="entregue_por" value="${f.entregue_por}" list="dl-usuarios"></div>
        <div class="campo"><label>Plantão</label><input type="text" name="plantao" value="${f.plantao}" list="dl-plantoes"></div>
        <div class="campo"><label>Retirada de</label><input type="date" name="retirada_ini" value="${f.retirada_ini}"></div>
        <div class="campo"><label>Retirada até</label><input type="date" name="retirada_fim" value="${f.retirada_fim}"></div>
        <div class="campo"><label>Ordenar</label><select name="ordem">${opcoes([{ v: 'recebido_desc', r: 'Recebimento (recentes)' }, { v: 'recebido_asc', r: 'Recebimento (antigas)' }, { v: 'retirada_desc', r: 'Retirada (recentes)' }, { v: 'quadra', r: 'Quadra e lote' }], f.ordem, { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select></div>
        <datalist id="dl-usuarios">${estado.usuarios.map((u) => html`<option value="${u.nome}">`)}</datalist>
        <datalist id="dl-plantoes">${(estado.config.plantoes || []).map((p) => html`<option value="${p}">`)}</datalist>
      </form>
    </div></div>
    <div class="card"><div id="resultado"><div class="vazio">Carregando…</div></div></div>`);

  const forms = [$('#filtros', el), $('#filtros2', el)];
  const form = forms[0];
  const preencherLotes = () => {
    mount(form.lote_id, opcoes(f.quadra_id ? lotesDaQuadra(f.quadra_id, false) : [], f.lote_id, { vazio: f.quadra_id ? 'Todos' : '—', rotulo: (l) => `Lote ${l.codigo}` }));
    form.lote_id.disabled = !f.quadra_id;
  };
  preencherLotes();

  const params = () => {
    const p = { ...f };
    if (p.status === '*') { p.status = ''; p.incluir_canceladas = '1'; }
    return p;
  };
  const carregar = async () => {
    const r = await api.get('/encomendas' + qs({ ...params(), pagina, por_pagina: 50 }));
    if (!atual()) return;
    desenhar(r);
  };
  const recarregar = () => { pagina = 1; carregar(); };
  const textoDeb = debounce(recarregar, 350);
  for (const fm of forms) {
    fm.addEventListener('submit', (e) => e.preventDefault());
    fm.addEventListener('input', (e) => {
      if (e.target.tagName !== 'INPUT' || ['date'].includes(e.target.type)) return;
      f[e.target.name] = e.target.value.trim();
      textoDeb();
    });
    fm.addEventListener('change', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'date') return;
      f[e.target.name] = e.target.value;
      if (e.target.name === 'quadra_id') { f.lote_id = ''; preencherLotes(); }
      recarregar();
    });
  }
  $('#mais', el).addEventListener('click', (e) => {
    const h = $('#filtros2', el).classList.toggle('hidden');
    e.target.textContent = h ? 'Mais filtros' : 'Menos filtros';
  });
  $('#limpar', el).addEventListener('click', () => navegar('#/historico'));
  const exportar = async (formato, btn) => {
    btn.disabled = true;
    try { await baixar('/relatorios' + qs({ ...params(), formato, ordem: f.ordem })); } catch (e) { toast(e.message, 'erro'); } finally { btn.disabled = false; }
  };
  $('#exp-pdf', el).addEventListener('click', (e) => exportar('pdf', e.currentTarget));
  $('#exp-xlsx', el).addEventListener('click', (e) => exportar('xlsx', e.currentTarget));

  function desenhar(r) {
    const box = $('#resultado', el);
    if (!r.itens.length) { mount(box, html`<div class="vazio">Nenhuma encomenda encontrada para os filtros informados.</div>`); return; }
    const paginas = Math.ceil(r.total / r.por_pagina);
    mount(box, html`<div class="tabela-wrap"><table class="tabela responsiva">
      <thead><tr><th>Identificador</th><th>Recebida em</th><th>Quadra/Lote</th><th>Descrição</th><th>Transportadora</th><th>Recebido por</th><th>Situação</th><th>Retirada</th><th>Retirado por</th><th>Entregue por</th></tr></thead>
      <tbody>${r.itens.map((e) => html`<tr class="clicavel" data-id="${e.id}">
        <td data-rot="Identificador" class="mono nowrap">${e.codigo}</td>
        <td data-rot="Recebida em" class="nowrap">${fmtDataHora(e.recebido_em)}</td>
        <td data-rot="Quadra/Lote">${endereco(e)}</td>
        <td data-rot="Descrição" class="desc">${e.descricao}</td>
        <td data-rot="Transportadora">${e.transportadora}</td>
        <td data-rot="Recebido por">${e.recebido_por}</td>
        <td data-rot="Situação">${statusBadge(e.status)}${e.status === 'PENDENTE' ? html` ${diasBadge(e.dias_espera, estado.config)}` : ''}</td>
        <td data-rot="Retirada" class="nowrap">${fmtRetirada(e)}</td>
        <td data-rot="Retirado por">${e.retirado_por_nome || ''}</td>
        <td data-rot="Entregue por"><span>${e.retirada_id ? (e.entregue_por || html`<span class="muted">não identificado</span>`) : ''}${e.retirada_tipo === 'OUTRO_PLANTAO' ? html`<div class="small muted">lançado por ${e.lancado_por}</div>` : ''}</span></td>
      </tr>`)}</tbody></table></div>
      <div class="paginacao"><span>${r.total} encomenda(s) encontrada(s)</span>
        <span class="btn-grupo">${r.pagina > 1 ? html`<button class="btn sm" data-pag="${r.pagina - 1}">Anterior</button>` : ''}
        <span style="align-self:center">Página ${r.pagina} de ${paginas}</span>
        ${r.pagina < paginas ? html`<button class="btn sm" data-pag="${r.pagina + 1}">Próxima</button>` : ''}</span></div>`);
    $$('tr[data-id]', box).forEach((tr) => tr.addEventListener('click', () => navegar(`#/encomenda/${tr.dataset.id}`)));
    $$('[data-pag]', box).forEach((b) => b.addEventListener('click', () => { pagina = Number(b.dataset.pag); carregar(); window.scrollTo(0, 0); }));
  }

  await carregar();
}
