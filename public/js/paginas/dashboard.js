import { api } from '../api.js';
import { html, mount, $$, icon, statusBadge, diasBadge, endereco, fmtDataHora, fmtData } from '../ui.js';
import { ehAdmin } from '../estado.js';

export async function render(el, { navegar, atual }) {
  const d = await api.get('/dashboard');
  if (!atual()) return;
  const i = d.indicadores;
  const cfg = d.config;
  mount(el, html`
    <div class="page-head"><div><h1>Dashboard</h1><p>Movimento da portaria em ${fmtData(d.hoje)} · horário de Brasília</p></div></div>

    ${i.lotes_cadastrados === 0 ? html`<div class="alerta aviso">${icon('alerta')}<div><strong>A relação oficial de quadras e lotes ainda não foi cadastrada.</strong>
      Encomendas só podem ser registradas para endereços da relação oficial. ${ehAdmin() ? html`<a href="#/quadras">Cadastrar ou importar quadras e lotes</a>.` : 'Solicite ao administrador.'}</div></div>` : ''}
    ${i.pendentes_criticas ? html`<div class="alerta erro">${icon('alerta')}<div><strong>${i.pendentes_criticas} encomenda(s) aguardando há ${cfg.dias_critico} dias ou mais.</strong>
      <a href="#/pendentes?dias_min=${cfg.dias_critico}">Ver encomendas antigas</a></div></div>`
      : i.pendentes_alerta ? html`<div class="alerta aviso">${icon('relogio')}<div><strong>${i.pendentes_alerta} encomenda(s) aguardando há ${cfg.dias_alerta} dias ou mais.</strong>
      <a href="#/pendentes?dias_min=${cfg.dias_alerta}">Ver encomendas antigas</a></div></div>` : ''}

    <div class="kpis">
      <a class="card kpi total" href="#/historico"><span class="rot">Total recebido</span><span class="val">${i.total_recebido}</span><span class="sub">desde o início do registro</span></a>
      <a class="card kpi pend" href="#/pendentes"><span class="rot">Pendentes</span><span class="val">${i.pendentes}</span><span class="sub">aguardando retirada</span></a>
      <a class="card kpi hoje" href="#/historico?data_ini=${d.hoje}&data_fim=${d.hoje}"><span class="rot">Recebidas hoje</span><span class="val">${i.recebidas_hoje}</span><span class="sub">${fmtData(d.hoje)}</span></a>
      <a class="card kpi ret" href="#/historico?retirada_ini=${d.hoje}&retirada_fim=${d.hoje}&tipo_retirada=PROPRIA"><span class="rot">Retiradas hoje</span><span class="val">${i.retiradas_hoje}</span><span class="sub">baixas na portaria</span></a>
      <a class="card kpi outro" href="#/historico?status=RETIRADA_OUTRO_PLANTAO"><span class="rot">Retiradas por outros plantões</span><span class="val">${i.outro_plantao_hoje}</span><span class="sub">lançadas hoje · ${i.outro_plantao_total} no total</span></a>
    </div>

    <div class="atalhos">
      <a class="card atalho primario" href="#/nova">${icon('nova')} Nova encomenda</a>
      <a class="card atalho" href="#/pendentes">${icon('busca')} Consultar pendentes</a>
      <a class="card atalho" href="#/historico">${icon('historico')} Histórico</a>
      <a class="card atalho" href="#/relatorios">${icon('relatorio')} Relatórios</a>
    </div>

    <div class="grid grid-dash">
      <section class="card">
        <div class="card-head"><h2>Encomendas recentes</h2><a class="btn sm" href="#/historico">Ver histórico</a></div>
        <div class="card-body flush tabela-wrap">
          ${d.recentes.length ? html`<table class="tabela responsiva"><thead><tr><th>Data</th><th>Quadra/Lote</th><th>Descrição</th><th>Transportadora</th><th>Responsável</th><th>Status</th></tr></thead><tbody>
            ${d.recentes.map((e) => html`<tr class="clicavel" data-id="${e.id}">
              <td data-rot="Data" class="nowrap">${fmtDataHora(e.recebido_em)}</td>
              <td data-rot="Quadra/Lote">${endereco(e)}</td>
              <td data-rot="Descrição" class="desc">${e.descricao}</td>
              <td data-rot="Transportadora">${e.transportadora}</td>
              <td data-rot="Responsável">${e.recebido_por}</td>
              <td data-rot="Status">${statusBadge(e.status)}</td></tr>`)}
          </tbody></table>` : html`<div class="vazio">Nenhuma encomenda registrada ainda.</div>`}
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Aguardando há mais tempo</h2><a class="btn sm" href="#/pendentes">Pendentes</a></div>
        <div class="card-body flush tabela-wrap">
          ${d.antigas.length ? html`<table class="tabela"><tbody>
            ${d.antigas.map((e) => html`<tr class="clicavel" data-id="${e.id}">
              <td>${endereco(e)}<div class="small muted">${e.descricao}</div></td>
              <td class="right">${diasBadge(e.dias_espera, cfg)}</td></tr>`)}
          </tbody></table>` : html`<div class="vazio">Nenhuma encomenda pendente.</div>`}
        </div>
      </section>
    </div>`);
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => navegar(`#/encomenda/${tr.dataset.id}`)));
}
