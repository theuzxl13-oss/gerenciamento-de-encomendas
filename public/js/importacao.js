// Assistente de importação da relação oficial de quadras e lotes: arquivo → prévia → confirmação → resultado.
import { api } from './api.js';
import { excelJS, modeloQuadrasLotes } from './exportar.js';
import { parseCsv, matrizDeExcel, extrairLinhas, sha256Hex } from './planilha.js';
import { html, mount, $, $$, icon, toast, abrirModal, fmtDataHora } from './ui.js';

const CLASSE = {
  NOVO: 'st-RETIRADA', REATIVAR: 'st-RETIRADA', EXISTENTE: 'st-CANCELADA',
  DUPLICADO_ARQUIVO: 'st-PENDENTE', DUPLICADO_EQUIVALENTE: 'st-PENDENTE', INVALIDO: 'st-PENDENTE',
};
const CURTO = {
  NOVO: 'Novo', REATIVAR: 'Reativar', EXISTENTE: 'Já existe', DUPLICADO_ARQUIVO: 'Duplicado no arquivo',
  DUPLICADO_EQUIVALENTE: 'Duplicado (grafia diferente)', INVALIDO: 'Inválido',
};
const POR_PAGINA = 100;

// Resumo da atualização: base atual × arquivo e conferência da sequência de quadras.
function conferenciaHtml(c, r) {
  if (!c) return '';
  const falt = c.faltantes_na_sequencia || [];
  const seqOk = c.primeira !== undefined && !falt.length;
  return html`<div class="alerta ${seqOk ? 'sucesso' : 'aviso'}"><div>
    <strong>Resumo da atualização</strong>
    <div class="small" style="margin-top:4px;line-height:1.6">
      Base atual: <strong>${c.base_atual.quadras}</strong> quadra(s), <strong>${c.base_atual.lotes}</strong> lote(s) ·
      Arquivo: <strong>${c.total_quadras}</strong> quadra(s), <strong>${r.total_linhas}</strong> registro(s) ·
      Após importar: <strong>${c.base_apos.lotes}</strong> lote(s).<br>
      ${c.primeira !== undefined ? html`Quadras no arquivo: de <strong>${c.primeira}</strong> a <strong>${c.ultima}</strong> —
        ${seqOk ? html`<strong>sequência completa, nenhuma quadra faltando.</strong>` : html`<strong>faltam ${falt.length}:</strong> ${falt.join(', ')}.`}<br>` : ''}
      ${c.quadras_nao_numericas.length ? html`Quadras não numéricas: ${c.quadras_nao_numericas.join(', ')}.<br>` : ''}
      ${c.quadras_novas_lista.length > 30 ? html`<strong>${c.quadras_novas_lista.length}</strong> quadras novas (carga inicial).<br>`
        : c.quadras_novas_lista.length ? html`Quadras novas: <strong>${c.quadras_novas_lista.map((q) => `${q} (${c.lotes_por_quadra_nova[q]} lotes)`).join(', ')}</strong>.<br>` : ''}
      ${r.novos && c.quadras_com_novos_lotes.length && c.quadras_com_novos_lotes.length <= 30 ? html`Quadras que recebem lotes novos: ${c.quadras_com_novos_lotes.join(', ')}.<br>` : ''}
      Registros já cadastrados permanecem como estão; encomendas e histórico não são alterados.
    </div></div></div>`;
}

export function abrirImportacao({ aoConcluir } = {}) {
  let previa = null;
  let arquivo = null;
  let filtro = '';
  let pagina = 1;

  const m = abrirModal({
    titulo: 'Importar relação oficial de quadras e lotes', largo: true,
    corpo: html`<div id="imp-passo"></div>`,
    rodape: html`<span class="small muted" id="imp-status" style="margin-right:auto"></span>
      <button class="btn" data-fechar>Fechar</button>
      <button class="btn" id="imp-previa">${icon('busca')} Gerar prévia</button>
      <button class="btn primario hidden" id="imp-confirmar">${icon('check')} Confirmar importação</button>`,
  });
  const passo = $('#imp-passo', m.el);
  const bPrevia = $('#imp-previa', m.el);
  const bConf = $('#imp-confirmar', m.el);

  function telaArquivo() {
    mount(passo, html`
      <ol style="margin-top:0;padding-left:20px;line-height:1.7">
        <li>Selecione o arquivo oficial em <strong>CSV</strong> ou <strong>Excel (.xlsx)</strong> com as colunas <strong>Quadra</strong> e <strong>Lote</strong>. <a href="#" id="imp-modelo">Baixar modelo</a>.</li>
        <li>Clique em <strong>Gerar prévia</strong> e confira registro por registro. <strong>Nada é gravado nesta etapa.</strong></li>
        <li>Clique em <strong>Confirmar importação</strong> para gravar no banco de dados.</li>
      </ol>
      <div class="alerta info">${icon('info')}<div>Somente <strong>Quadra</strong> e <strong>Lote</strong> são importados, exatamente como escritos no arquivo (zeros à esquerda preservados: "01" continua "01").
        Outras colunas são ignoradas. Registros já cadastrados e duplicados (inclusive "1" × "01") são ignorados. Nenhum registro é apagado.</div></div>
      <div class="campo"><label for="imp-arq">Arquivo</label><input type="file" id="imp-arq" accept=".csv,.xlsx,text/csv"></div>`);
    $('#imp-modelo', passo).addEventListener('click', (e) => { e.preventDefault(); modeloQuadrasLotes().catch((er) => toast(er.message, 'erro')); });
    $('#imp-arq', passo).addEventListener('change', (e) => { arquivo = e.target.files[0] || null; });
    bPrevia.classList.remove('hidden');
    bConf.classList.add('hidden');
  }

  // Dados lidos do arquivo no navegador (enviados na prévia e, idênticos, na confirmação).
  let dados = null;

  async function lerArquivo() {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const nome = arquivo.name.toLowerCase();
    let matriz;
    if (nome.endsWith('.xlsx')) {
      const E = await excelJS();
      const wb = new E.Workbook();
      try { await wb.xlsx.load(bytes.buffer); } catch { throw new Error('Não foi possível ler a planilha Excel. Verifique se o arquivo é .xlsx válido.'); }
      matriz = matrizDeExcel(wb);
    } else if (nome.endsWith('.csv') || nome.endsWith('.txt')) {
      matriz = parseCsv(new TextDecoder('utf-8').decode(bytes));
    } else throw new Error('Formato não suportado. Envie um arquivo .csv ou .xlsx.');
    const { linhas, colunas_ignoradas } = extrairLinhas(matriz);
    return { arquivo_nome: arquivo.name, arquivo_sha256: await sha256Hex(bytes), colunas_ignoradas, linhas };
  }

  async function gerarPrevia() {
    if (!arquivo) { toast('Selecione o arquivo.', 'erro'); return; }
    bPrevia.disabled = true;
    $('#imp-status', m.el).textContent = 'Analisando arquivo…';
    try {
      dados = await lerArquivo();
      previa = await api.post('/quadras-lotes/importar/previa', dados);
      filtro = ''; pagina = 1;
      telaPrevia();
    } catch (err) {
      mount(passo.querySelector('.form-erro') || passo.appendChild(Object.assign(document.createElement('div'), { className: 'form-erro' })),
        html`<div class="alerta erro" style="margin-top:12px">${icon('alerta')}<div>${err.message}</div></div>`);
    } finally { bPrevia.disabled = false; $('#imp-status', m.el).textContent = ''; }
  }

  function telaPrevia() {
    const r = previa.resumo;
    const cartao = (rot, val, cls, f) => html`<div role="button" tabindex="0" class="card kpi ${cls}" data-filtro="${f}" aria-pressed="${filtro === f}" style="cursor:pointer;${filtro === f ? 'outline:3px solid var(--verde-600);outline-offset:-1px' : ''}"><span class="rot">${rot}</span><span class="val">${val}</span></div>`;
    mount(passo, html`
      <div class="alerta aviso">${icon('alerta')}<div><strong>Prévia — nada foi gravado ainda.</strong>
        Arquivo <strong>${previa.arquivo}</strong> · ${r.total_linhas} registro(s) lido(s)${previa.colunas_ignoradas.length ? html` · colunas ignoradas: ${previa.colunas_ignoradas.join(', ')}` : ''}.</div></div>
      <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr));margin-bottom:12px">
        ${cartao('Todos', r.total_linhas, 'total', '')}
        ${cartao('Serão importados', r.importados, 'ret', 'IMPORTAR')}
        ${cartao('Ignorados (já existem)', r.ja_existentes, 'total', 'EXISTENTE')}
        ${cartao('Duplicados', r.duplicados, 'pend', 'DUPLICADO')}
        ${cartao('Inválidos', r.invalidos, 'pend', 'INVALIDO')}
      </div>
      ${conferenciaHtml(previa.conferencia, r)}
      <p class="small" style="margin:0 0 10px">${r.quadras_novas} quadra(s) nova(s)${r.reativados ? html` · ${r.reativados} lote(s) inativo(s) serão reativados` : ''}. Clique nos totais para filtrar a lista.</p>
      ${r.lotes_ausentes_no_arquivo ? html`<label class="check alerta info" style="margin-bottom:12px">
        <input type="checkbox" id="imp-desativar"> <span>Existem <strong>${r.lotes_ausentes_no_arquivo}</strong> lote(s) ativos no sistema que não constam neste arquivo. Marque para <strong>desativá-los</strong> (não são apagados; o histórico de encomendas é preservado).</span></label>` : ''}
      <div id="imp-lista"></div>`);
    $$('[data-filtro]', passo).forEach((b) => {
      const escolher = () => { filtro = b.dataset.filtro; pagina = 1; telaPrevia(); };
      b.addEventListener('click', escolher);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); escolher(); } });
    });
    desenharLista();
    bPrevia.classList.add('hidden');
    bConf.classList.remove('hidden');
    bConf.disabled = !r.importados && !r.lotes_ausentes_no_arquivo;
    bConf.textContent = r.importados ? `Confirmar importação de ${r.importados} registro(s)` : 'Confirmar';
    $('#imp-status', m.el).textContent = r.importados ? '' : 'Nenhum registro novo para importar.';
    const des = $('#imp-desativar', passo);
    if (des) des.addEventListener('change', () => { bConf.disabled = !r.importados && !des.checked; });
  }

  function desenharLista() {
    const todos = previa.registros.filter((x) => !filtro
      || (filtro === 'IMPORTAR' && (x.situacao === 'NOVO' || x.situacao === 'REATIVAR'))
      || (filtro === 'DUPLICADO' && x.situacao.startsWith('DUPLICADO'))
      || x.situacao === filtro);
    const paginas = Math.max(1, Math.ceil(todos.length / POR_PAGINA));
    const itens = todos.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
    const box = $('#imp-lista', passo);
    mount(box, todos.length ? html`<div class="tabela-wrap" style="max-height:42vh;overflow:auto;border:1px solid var(--border);border-radius:8px">
      <table class="tabela"><thead><tr><th>Linha</th><th>Quadra</th><th>Lote</th><th>Situação</th><th>Detalhe</th></tr></thead>
      <tbody>${itens.map((x) => html`<tr><td class="muted">${x.linha}</td><td class="mono"><strong>${x.quadra || '—'}</strong>${x.quadra_nova ? html` <span class="small muted">(nova)</span>` : ''}</td>
        <td class="mono"><strong>${x.lote || '—'}</strong></td><td><span class="badge ${CLASSE[x.situacao]}">${CURTO[x.situacao]}</span></td>
        <td class="small">${x.detalhe || ''}${x.aviso ? html`<div style="color:var(--ambar)">${x.aviso}</div>` : ''}</td></tr>`)}</tbody></table></div>
      <div class="paginacao" style="border:0;padding:8px 0"><span>${todos.length} registro(s)</span><span class="btn-grupo">
        ${pagina > 1 ? html`<button type="button" class="btn sm" data-pg="${pagina - 1}">Anterior</button>` : ''}<span style="align-self:center">Página ${pagina} de ${paginas}</span>
        ${pagina < paginas ? html`<button type="button" class="btn sm" data-pg="${pagina + 1}">Próxima</button>` : ''}</span></div>`
      : html`<div class="vazio">Nenhum registro nesta categoria.</div>`);
    $$('[data-pg]', box).forEach((b) => b.addEventListener('click', () => { pagina = Number(b.dataset.pg); desenharLista(); }));
  }

  async function confirmar() {
    bConf.disabled = true;
    $('#imp-status', m.el).textContent = 'Gravando no banco de dados…';
    try {
      const des = $('#imp-desativar', passo);
      const f = new FormData();
      f.append('dados', JSON.stringify({ ...dados, token: previa.token, desativar_ausentes: !!(des && des.checked) }));
      f.append('arquivo', arquivo, arquivo.name); // cópia do arquivo original para rastreabilidade
      const r = await api.post('/quadras-lotes/importar', f);
      mount(passo, html`<div class="alerta sucesso">${icon('check')}<div><strong>Importação concluída e gravada no banco de dados.</strong>
        Registrada em ${fmtDataHora(r.realizada_em)} por ${r.usuario} (importação nº ${r.importacao_id}).</div></div>
        <div class="kpis" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
          <div class="card kpi total"><span class="rot">Registros no arquivo</span><span class="val">${r.total_linhas}</span></div>
          <div class="card kpi ret"><span class="rot">Importados</span><span class="val">${r.importados}</span><span class="sub">${r.novos} novos · ${r.reativados} reativados</span></div>
          <div class="card kpi total"><span class="rot">Ignorados</span><span class="val">${r.ignorados}</span><span class="sub">${r.ja_existentes} já existiam · ${r.invalidos} inválidos</span></div>
          <div class="card kpi pend"><span class="rot">Duplicados</span><span class="val">${r.duplicados}</span></div>
          <div class="card kpi hoje"><span class="rot">Quadras novas</span><span class="val">${r.quadras_novas}</span></div>
          ${r.desativados ? html`<div class="card kpi outro"><span class="rot">Lotes desativados</span><span class="val">${r.desativados}</span></div>` : ''}
        </div>`);
      bConf.classList.add('hidden');
      $('#imp-status', m.el).textContent = '';
      toast(`Importação concluída: ${r.importados} importado(s), ${r.ignorados} ignorado(s), ${r.duplicados} duplicado(s).`);
      if (aoConcluir) aoConcluir(r);
    } catch (err) {
      bConf.disabled = false;
      $('#imp-status', m.el).textContent = '';
      toast(err.message, 'erro', 8000);
    }
  }

  bPrevia.addEventListener('click', gerarPrevia);
  bConf.addEventListener('click', confirmar);
  telaArquivo();
  return m;
}
