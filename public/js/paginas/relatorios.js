import { api, qs, baixar } from '../api.js';
import { html, mount, $, icon, toast, statusBadge, endereco, fmtDataHora, fmtRetirada, opcoes, hojeSP, addDias, lerForm } from '../ui.js';
import { estado, lotesDaQuadra } from '../estado.js';

const SITUACOES = [
  { v: '', r: 'Todas' },
  { v: 'PENDENTE', r: 'Pendentes' },
  { v: 'RETIRADA,RETIRADA_OUTRO_PLANTAO', r: 'Retiradas (todas)' },
  { v: 'RETIRADA', r: 'Retiradas na portaria' },
  { v: 'RETIRADA_OUTRO_PLANTAO', r: 'Retiradas por outros plantões' },
  { v: 'CANCELADA', r: 'Canceladas' },
];

export async function render(el) {
  const hoje = hojeSP();
  const ini = addDias(hoje, -30);
  mount(el, html`
    <div class="page-head"><div><h1>Relatórios</h1><p>Consulte e exporte em PDF ou Excel. Datas no horário de Brasília.</p></div></div>
    <section class="card"><div class="card-head"><h2>Relatório de encomendas</h2></div><div class="card-body">
      <form class="filtros" id="f-rel">
        <div class="campo"><label>Período por</label><select name="base">${opcoes([{ v: 'receb', r: 'Data de recebimento' }, { v: 'ret', r: 'Data de retirada' }], 'receb', { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select></div>
        <div class="campo"><label>De</label><input type="date" name="ini" value="${ini}"></div>
        <div class="campo"><label>Até</label><input type="date" name="fim" value="${hoje}"></div>
        <div class="campo"><label>Situação</label><select name="status">${opcoes(SITUACOES, '', { rotulo: (o) => o.r, valorDe: (o) => o.v })}</select></div>
        <div class="campo"><label>Quadra</label><select name="quadra_id">${opcoes(estado.quadras, '', { vazio: 'Todas', rotulo: (q) => `Quadra ${q.codigo}` })}</select></div>
        <div class="campo"><label>Lote</label><select name="lote_id" disabled><option value="">—</option></select></div>
        <div class="campo"><label>Transportadora</label><select name="transportadora_id">${opcoes(estado.transportadoras, '', { vazio: 'Todas' })}</select></div>
        <div class="campo"><label>Controlador</label><select name="controlador_id">${opcoes(estado.usuarios, '', { vazio: 'Todos' })}</select><span class="dica">Recebeu, entregou ou lançou</span></div>
      </form>
      <div class="btn-grupo" style="margin-top:14px">
        <button class="btn primario" id="ver">${icon('busca')} Visualizar</button>
        <button class="btn" id="pdf">${icon('baixar')} Exportar PDF</button>
        <button class="btn" id="xlsx">${icon('baixar')} Exportar Excel</button>
      </div>
    </div><div id="res"></div></section>

    <section class="card"><div class="card-head"><h2>Relatório por funcionário</h2></div><div class="card-body">
      <p class="small muted" style="margin-top:0">Recebimentos, entregas e lançamentos de retiradas de outros plantões por funcionário. Entregas informadas por outro plantão são contadas para quem efetivamente entregou, separadamente de quem lançou.</p>
      <form class="filtros" id="f-func">
        <div class="campo"><label>De</label><input type="date" name="data_ini" value="${ini}"></div>
        <div class="campo"><label>Até</label><input type="date" name="data_fim" value="${hoje}"></div>
        <div class="acoes-filtro"><button type="button" class="btn primario" id="ver-f">Visualizar</button><button type="button" class="btn" id="pdf-f">PDF</button><button type="button" class="btn" id="xlsx-f">Excel</button></div>
      </form></div><div id="res-f"></div></section>`);

  const f = $('#f-rel', el);
  f.quadra_id.addEventListener('change', () => {
    mount(f.lote_id, opcoes(f.quadra_id.value ? lotesDaQuadra(f.quadra_id.value, false) : [], '', { vazio: f.quadra_id.value ? 'Todos' : '—', rotulo: (l) => `Lote ${l.codigo}` }));
    f.lote_id.disabled = !f.quadra_id.value;
  });
  const params = () => {
    const d = lerForm(f);
    const p = { status: d.status, quadra_id: d.quadra_id, lote_id: d.lote_id, transportadora_id: d.transportadora_id, controlador_id: d.controlador_id };
    if (d.base === 'ret') { p.retirada_ini = d.ini; p.retirada_fim = d.fim; p.ordem = 'retirada_desc'; } else { p.data_ini = d.ini; p.data_fim = d.fim; }
    if (d.status === 'CANCELADA') p.incluir_canceladas = '1';
    return p;
  };
  const exp = async (formato, btn) => {
    btn.disabled = true;
    try { await baixar('/relatorios' + qs({ ...params(), formato })); } catch (e) { toast(e.message, 'erro'); } finally { btn.disabled = false; }
  };
  $('#pdf', el).addEventListener('click', (e) => exp('pdf', e.currentTarget));
  $('#xlsx', el).addEventListener('click', (e) => exp('xlsx', e.currentTarget));
  $('#ver', el).addEventListener('click', async () => {
    const box = $('#res', el);
    try {
      const r = await api.get('/relatorios' + qs(params()));
      mount(box, html`<div class="card-body" style="border-top:1px solid var(--border)">
        <p class="small muted" style="margin-top:0">${r.filtros}</p>
        <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(170px,1fr))">
          <div class="card kpi total"><span class="rot">Total</span><span class="val">${r.resumo.total}</span></div>
          ${r.resumo.por_status.map((s) => html`<div class="card kpi ${s.status === 'PENDENTE' ? 'pend' : s.status === 'RETIRADA' ? 'ret' : s.status === 'RETIRADA_OUTRO_PLANTAO' ? 'outro' : 'total'}"><span class="rot">${s.rotulo}</span><span class="val">${s.n}</span></div>`)}
        </div>
        ${r.resumo.por_transportadora.length ? html`<p class="small"><strong>Por transportadora:</strong> ${r.resumo.por_transportadora.map((t) => `${t.nome}: ${t.n}`).join(' · ')}</p>` : ''}
      </div>
      ${r.itens.length ? html`<div class="tabela-wrap"><table class="tabela responsiva"><thead><tr><th>Identificador</th><th>Recebida em</th><th>Quadra/Lote</th><th>Descrição</th><th>Transportadora</th><th>Recebido por</th><th>Situação</th><th>Retirada</th><th>Retirado por</th><th>Entregue por</th><th>Lançado por</th></tr></thead>
        <tbody>${r.itens.map((e) => html`<tr>
          <td data-rot="Identificador"><a class="mono" href="#/encomenda/${e.id}">${e.codigo}</a></td><td data-rot="Recebida em" class="nowrap">${fmtDataHora(e.recebido_em)}</td>
          <td data-rot="Quadra/Lote">${endereco(e)}</td><td data-rot="Descrição" class="desc">${e.descricao}</td><td data-rot="Transportadora">${e.transportadora}</td>
          <td data-rot="Recebido por">${e.recebido_por}</td><td data-rot="Situação">${statusBadge(e.status)}</td><td data-rot="Retirada" class="nowrap">${fmtRetirada(e)}</td>
          <td data-rot="Retirado por">${e.retirado_por_nome || ''}</td><td data-rot="Entregue por">${e.retirada_id ? e.entregue_por || 'não identificado' : ''}</td><td data-rot="Lançado por">${e.lancado_por || ''}</td></tr>`)}</tbody></table></div>
        ${r.total > r.itens.length ? html`<div class="paginacao">Exibindo ${r.itens.length} de ${r.total}. Exporte para ver todas.</div>` : ''}` : html`<div class="vazio">Nenhuma encomenda para os filtros informados.</div>`}`);
    } catch (e) { toast(e.message, 'erro'); }
  });

  const ff = $('#f-func', el);
  const pf = () => lerForm(ff);
  $('#pdf-f', el).addEventListener('click', () => baixar('/relatorios/funcionarios' + qs({ ...pf(), formato: 'pdf' })).catch((e) => toast(e.message, 'erro')));
  $('#xlsx-f', el).addEventListener('click', () => baixar('/relatorios/funcionarios' + qs({ ...pf(), formato: 'xlsx' })).catch((e) => toast(e.message, 'erro')));
  $('#ver-f', el).addEventListener('click', async () => {
    try {
      const r = await api.get('/relatorios/funcionarios' + qs(pf()));
      mount($('#res-f', el), html`<div class="tabela-wrap" style="border-top:1px solid var(--border)"><table class="tabela responsiva"><thead><tr><th>Funcionário</th><th>Perfil</th><th class="right">Recebidas</th><th class="right">Cadastros</th><th class="right">Entregas (baixas)</th><th class="right">Entregas informadas por outro plantão</th><th class="right">Lançamentos de outro plantão</th></tr></thead>
        <tbody>${r.linhas.map((l) => html`<tr><td data-rot="Funcionário"><strong>${l.nome}</strong></td><td data-rot="Perfil">${l.perfil === 'ADMIN' ? 'Administrador' : 'Controlador'}</td>
          <td data-rot="Recebidas" class="right">${l.recebidas}</td><td data-rot="Cadastros" class="right">${l.cadastradas}</td><td data-rot="Entregas" class="right">${l.entregas}</td>
          <td data-rot="Entregas (outro plantão)" class="right">${l.entregas_informadas_outro_plantao}</td><td data-rot="Lançamentos" class="right">${l.lancamentos_outro_plantao}</td></tr>`)}</tbody></table></div>`);
    } catch (e) { toast(e.message, 'erro'); }
  });
}
