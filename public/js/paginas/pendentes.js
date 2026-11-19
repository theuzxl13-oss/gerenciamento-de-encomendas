import { api, qs } from '../api.js';
import { html, mount, $, $$, icon, diasBadge, endereco, fmtDataHora, opcoes, debounce } from '../ui.js';
import { estado, quadrasAtivas, lotesDaQuadra } from '../estado.js';
import { abrirRetirada } from '../retirada.js';

export async function render(el, { navegar, query, atual }) {
  const cfg = estado.config;
  const f = { quadra_id: query.quadra_id || '', lote_id: query.lote_id || '', q: query.q || '', transportadora_id: query.transportadora_id || '', dias_min: query.dias_min || '', ordem: query.ordem || 'recebido_asc', pagina: 1 };
  const selecionadas = new Map();

  mount(el, html`
    <div class="page-head"><div><h1>Encomendas pendentes</h1><p>Encomendas aguardando retirada. Localize pelo endereço do morador e registre a baixa.</p></div>
      <div class="acoes"><a class="btn primario" href="#/nova">${icon('nova')} Nova encomenda</a></div></div>
    <div class="card"><div class="card-body">
      <form class="filtros" id="filtros" autocomplete="off">
        <div class="campo"><label>Quadra</label><select name="quadra_id">${opcoes(quadrasAtivas(), f.quadra_id, { vazio: 'Todas', rotulo: (q) => `Quadra ${q.codigo}` })}</select></div>
        <div class="campo"><label>Lote</label><select name="lote_id"></select></div>
        <div class="campo" style="grid-column:span 2"><label>Busca (descrição, código, rastreio…)</label><input type="search" name="q" value="${f.q}" placeholder="Digite para pesquisar"></div>
        <div class="campo"><label>Transportadora</label><select name="transportadora_id">${opcoes(estado.transportadoras, f.transportadora_id, { vazio: 'Todas' })}</select></div>
        <div class="campo"><label>Tempo de espera</label><select name="dias_min">
          ${opcoes([{ v: '', r: 'Qualquer' }, { v: '1', r: '1 dia ou mais' }, { v: '3', r: '3 dias ou mais' }, { v: String(cfg.dias_alerta), r: `${cfg.dias_alerta} dias ou mais (alerta)` }, { v: String(cfg.dias_critico), r: `${cfg.dias_critico} dias ou mais (crítico)` }, { v: '30', r: '30 dias ou mais' }]
            .filter((o, i, a) => a.findIndex((x) => x.v === o.v) === i), f.dias_min, { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select></div>
        <div class="campo"><label>Ordenar</label><select name="ordem">${opcoes([{ v: 'recebido_asc', r: 'Mais antigas primeiro' }, { v: 'recebido_desc', r: 'Mais recentes primeiro' }, { v: 'quadra', r: 'Quadra e lote' }], f.ordem, { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select></div>
        <div class="acoes-filtro"><button type="button" class="btn" id="limpar">Limpar</button></div>
      </form>
    </div></div>
    <div class="card"><div id="resultado"><div class="vazio">Carregando…</div></div></div>
    <div id="barra"></div>`);

  const form = $('#filtros', el);
  const preencherLotes = () => {
    mount(form.lote_id, opcoes(f.quadra_id ? lotesDaQuadra(f.quadra_id, false) : [], f.lote_id, { vazio: f.quadra_id ? 'Todos' : '—', rotulo: (l) => `Lote ${l.codigo}` }));
    form.lote_id.disabled = !f.quadra_id;
  };
  preencherLotes();

  const carregar = async () => {
    const r = await api.get('/encomendas' + qs({ ...f, status: 'PENDENTE', por_pagina: 50 }));
    if (!atual()) return;
    desenharTabela(r);
  };
  const recarregar = () => { f.pagina = 1; carregar(); };

  form.addEventListener('change', (e) => {
    const n = e.target.name;
    if (n === 'q') return;
    f[n] = e.target.value;
    if (n === 'quadra_id') { f.lote_id = ''; preencherLotes(); }
    recarregar();
  });
  form.q.addEventListener('input', debounce(() => { f.q = form.q.value.trim(); recarregar(); }, 300));
  form.addEventListener('submit', (e) => e.preventDefault());
  $('#limpar', el).addEventListener('click', () => navegar('#/pendentes'));

  function desenharTabela(r) {
    const box = $('#resultado', el);
    if (!r.itens.length) {
      mount(box, html`<div class="vazio">${icon('check')}<br>Nenhuma encomenda pendente ${f.q || f.quadra_id || f.dias_min || f.transportadora_id ? 'para os filtros informados' : ''}.</div>`);
      return desenharBarra();
    }
    const paginas = Math.ceil(r.total / r.por_pagina);
    mount(box, html`
      <div class="tabela-wrap"><table class="tabela responsiva">
        <thead><tr><th class="chk"><input type="checkbox" id="chk-todos" aria-label="Selecionar todas"></th><th>Identificador</th><th>Recebida em</th><th>Quadra/Lote</th><th>Descrição</th><th>Transportadora</th><th>Recebido por</th><th>Aguardando</th><th></th></tr></thead>
        <tbody>${r.itens.map((e) => html`
          <tr class="${e.dias_espera >= cfg.dias_critico ? 'critica' : e.dias_espera >= cfg.dias_alerta ? 'antiga' : ''} ${selecionadas.has(e.id) ? 'selecionada' : ''}" data-id="${e.id}">
            <td class="chk"><input type="checkbox" data-sel="${e.id}" ${selecionadas.has(e.id) ? 'checked' : ''} aria-label="Selecionar ${e.codigo}"></td>
            <td data-rot="Identificador"><a class="mono" href="#/encomenda/${e.id}">${e.codigo}</a></td>
            <td data-rot="Recebida em" class="nowrap">${fmtDataHora(e.recebido_em)}</td>
            <td data-rot="Quadra/Lote">${endereco(e)}${e.endereco_complementar ? html`<div class="small muted">${e.endereco_complementar}</div>` : ''}</td>
            <td data-rot="Descrição" class="desc">${e.descricao}${e.observacoes ? html`<div class="small muted">${e.observacoes}</div>` : ''}</td>
            <td data-rot="Transportadora">${e.transportadora}</td>
            <td data-rot="Recebido por">${e.recebido_por}</td>
            <td data-rot="Aguardando">${diasBadge(e.dias_espera, cfg)}</td>
            <td class="acoes acoes-pilha"><button class="btn primario sm" data-retirar="${e.id}">Registrar retirada</button>
              <button class="btn sm" data-outro="${e.id}" title="Retirada realizada por outro plantão">Outro plantão</button></td>
          </tr>`)}</tbody></table></div>
      <div class="paginacao"><span>${r.total} encomenda(s) pendente(s)</span>
        <span class="btn-grupo">${r.pagina > 1 ? html`<button class="btn sm" data-pag="${r.pagina - 1}">Anterior</button>` : ''}
        <span style="align-self:center">Página ${r.pagina} de ${paginas}</span>
        ${r.pagina < paginas ? html`<button class="btn sm" data-pag="${r.pagina + 1}">Próxima</button>` : ''}</span></div>`);
    const porId = new Map(r.itens.map((e) => [String(e.id), e]));
    $$('[data-retirar]', box).forEach((b) => b.addEventListener('click', () => abrirRetirada({ encomendas: [porId.get(b.dataset.retirar)], tipo: 'PROPRIA', aoConcluir: aposBaixa })));
    $$('[data-outro]', box).forEach((b) => b.addEventListener('click', () => abrirRetirada({ encomendas: [porId.get(b.dataset.outro)], tipo: 'OUTRO_PLANTAO', aoConcluir: aposBaixa })));
    $$('[data-pag]', box).forEach((b) => b.addEventListener('click', () => { f.pagina = Number(b.dataset.pag); carregar(); }));
    $$('[data-sel]', box).forEach((c) => c.addEventListener('change', () => {
      const e = porId.get(c.dataset.sel);
      if (c.checked) selecionadas.set(e.id, e); else selecionadas.delete(e.id);
      c.closest('tr').classList.toggle('selecionada', c.checked);
      desenharBarra();
    }));
    $('#chk-todos', box).addEventListener('change', (ev) => {
      $$('[data-sel]', box).forEach((c) => { if (c.checked !== ev.target.checked) { c.checked = ev.target.checked; c.dispatchEvent(new Event('change')); } });
    });
    desenharBarra();
  }

  function desenharBarra() {
    const barra = $('#barra', el);
    if (!selecionadas.size) { barra.innerHTML = ''; return; }
    const lotes = new Set([...selecionadas.values()].map((e) => e.lote_id));
    mount(barra, html`<div class="barra-selecao"><strong>${selecionadas.size} selecionada(s)</strong>
      ${lotes.size > 1 ? html`<span class="small" style="color:#f3d58f">${icon('alerta')} endereços diferentes</span>` : ''}
      <span class="espaco"></span>
      <button class="btn sm" id="b-limpar">Desmarcar</button>
      <button class="btn sm" id="b-outro">Outro plantão</button>
      <button class="btn primario sm" id="b-ret" style="background:#fff;color:var(--verde-800)">Registrar retirada (${selecionadas.size})</button></div>`);
    $('#b-limpar', barra).addEventListener('click', () => { selecionadas.clear(); carregar(); });
    $('#b-ret', barra).addEventListener('click', () => abrirRetirada({ encomendas: [...selecionadas.values()], tipo: 'PROPRIA', aoConcluir: aposBaixa }));
    $('#b-outro', barra).addEventListener('click', () => abrirRetirada({ encomendas: [...selecionadas.values()], tipo: 'OUTRO_PLANTAO', aoConcluir: aposBaixa }));
  }

  async function aposBaixa() {
    selecionadas.clear();
    await carregar();
    const { atualizarBadgePendentes } = await import('../main.js');
    atualizarBadgePendentes();
  }

  await carregar();
  if (!f.q) form.q.focus();
}
