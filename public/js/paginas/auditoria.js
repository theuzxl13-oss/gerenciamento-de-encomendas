import { api, qs } from '../api.js';
import { html, mount, $, $$, fmtDataHora, opcoes, debounce, hojeSP, addDias } from '../ui.js';
import { estado } from '../estado.js';

const ROTULOS = {
  CONFIGURACAO_INICIAL: 'Configuração inicial', LOGIN: 'Login', LOGOUT: 'Logout', LOGIN_FALHOU: 'Login falhou', LOGIN_BLOQUEADO: 'Usuário bloqueado',
  SENHA_ALTERADA: 'Senha alterada', SENHA_REDEFINIDA: 'Senha redefinida', USUARIO_CRIADO: 'Usuário criado', USUARIO_EDITADO: 'Usuário editado',
  QUADRA_CRIADA: 'Quadra criada', QUADRA_EDITADA: 'Quadra editada', LOTE_CRIADO: 'Lote criado', LOTE_EDITADO: 'Lote editado', QUADRAS_LOTES_IMPORTADOS: 'Importação de quadras/lotes',
  TRANSPORTADORA_CRIADA: 'Transportadora criada', TRANSPORTADORA_EDITADA: 'Transportadora editada', TRANSPORTADORA_REATIVADA: 'Transportadora reativada',
  ENCOMENDA_CADASTRADA: 'Encomenda cadastrada', ENCOMENDA_EDITADA: 'Encomenda corrigida', ENCOMENDA_CANCELADA: 'Encomenda cancelada',
  RETIRADA_REGISTRADA: 'Baixa (retirada)', RETIRADA_OUTRO_PLANTAO_REGISTRADA: 'Retirada de outro plantão lançada', RETIRADA_CORRIGIDA: 'Retirada corrigida', RETIRADA_ESTORNADA: 'Baixa estornada',
  ANEXO_ADICIONADO: 'Comprovante anexado', ANEXO_REMOVIDO: 'Comprovante removido', CONFIGURACOES_ALTERADAS: 'Configurações alteradas',
  BACKUP_CRIADO: 'Backup criado', BACKUP_BAIXADO: 'Backup baixado', RELATORIO_EXPORTADO: 'Relatório exportado',
};

function detalhes(d) {
  if (!d) return '';
  const partes = Object.entries(d).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => {
    if (v && typeof v === 'object' && 'antes' in v) return html`<div><strong>${k}:</strong> <del>${JSON.stringify(v.antes)}</del> → <ins>${JSON.stringify(v.depois)}</ins></div>`;
    return html`<div><strong>${k}:</strong> ${typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>`;
  });
  return html`<div class="diff">${partes}</div>`;
}

export async function render(el, { atual, navegar }) {
  const f = { data_ini: addDias(hojeSP(), -7), data_fim: hojeSP(), usuario_id: '', acao: '', q: '', pagina: 1 };
  mount(el, html`
    <div class="page-head"><div><h1>Auditoria</h1><p>Registro permanente de todas as operações: quem fez, quando (horário de Brasília) e o que foi alterado.</p></div></div>
    <div class="card"><div class="card-body"><form class="filtros" id="f-aud">
      <div class="campo"><label>De</label><input type="date" name="data_ini" value="${f.data_ini}"></div>
      <div class="campo"><label>Até</label><input type="date" name="data_fim" value="${f.data_fim}"></div>
      <div class="campo"><label>Usuário</label><select name="usuario_id">${opcoes(estado.usuarios, '', { vazio: 'Todos' })}</select></div>
      <div class="campo"><label>Ação</label><select name="acao"><option value="">Todas</option></select></div>
      <div class="campo" style="grid-column:span 2"><label>Busca (identificador, detalhes, justificativa)</label><input type="search" name="q"></div>
    </form></div></div>
    <div class="card"><div id="res-aud"></div></div>`);
  const form = $('#f-aud', el);
  let acoesCarregadas = false;
  const carregar = async () => {
    const r = await api.get('/auditoria' + qs({ ...f, por_pagina: 50 }));
    if (!atual()) return;
    if (!acoesCarregadas) {
      mount(form.acao, html`<option value="">Todas</option>${r.acoes.map((a) => html`<option value="${a}">${ROTULOS[a] || a}</option>`)}`);
      acoesCarregadas = true;
    }
    const paginas = Math.max(1, Math.ceil(r.total / r.por_pagina));
    mount($('#res-aud', el), r.itens.length ? html`<div class="tabela-wrap"><table class="tabela responsiva">
      <thead><tr><th>Data/hora</th><th>Usuário</th><th>Ação</th><th>Registro</th><th>Detalhes</th><th>Justificativa</th><th>IP</th></tr></thead>
      <tbody>${r.itens.map((a) => html`<tr>
        <td data-rot="Data/hora" class="nowrap">${fmtDataHora(a.ocorrido_em)}</td>
        <td data-rot="Usuário">${a.usuario_nome || 'sistema'}</td>
        <td data-rot="Ação"><strong>${ROTULOS[a.acao] || a.acao}</strong></td>
        <td data-rot="Registro">${a.encomenda_codigo ? html`<a class="mono" href="#/encomenda/${a.encomenda_id}">${a.encomenda_codigo}</a>` : html`<span class="small muted">${a.entidade}${a.entidade_id ? ` #${a.entidade_id}` : ''}</span>`}</td>
        <td data-rot="Detalhes" style="max-width:380px">${detalhes(a.detalhes)}</td>
        <td data-rot="Justificativa">${a.justificativa || ''}</td>
        <td data-rot="IP" class="small muted">${a.ip || ''}</td></tr>`)}</tbody></table></div>
      <div class="paginacao"><span>${r.total} registro(s)</span><span class="btn-grupo">
        ${r.pagina > 1 ? html`<button class="btn sm" data-pag="${r.pagina - 1}">Anterior</button>` : ''}<span style="align-self:center">Página ${r.pagina} de ${paginas}</span>
        ${r.pagina < paginas ? html`<button class="btn sm" data-pag="${r.pagina + 1}">Próxima</button>` : ''}</span></div>`
      : html`<div class="vazio">Nenhum registro no período.</div>`);
    $$('[data-pag]', el).forEach((b) => b.addEventListener('click', () => { f.pagina = Number(b.dataset.pag); carregar(); }));
  };
  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('change', (e) => { if (e.target.name === 'q') return; f[e.target.name] = e.target.value; f.pagina = 1; carregar(); });
  form.q.addEventListener('input', debounce(() => { f.q = form.q.value.trim(); f.pagina = 1; carregar(); }, 350));
  void navegar;
  await carregar();
}
