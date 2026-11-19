import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, statusBadge, diasBadge, fmtDataHora, fmtData, fmtBytes, abrirModal, lerForm, marcarErro, opcoes, pedirJustificativa, agoraSP } from '../ui.js';
import { estado, ehAdmin, quadrasAtivas, lotesDaQuadra } from '../estado.js';
import { abrirRetirada, enviarAnexo, padAssinatura } from '../retirada.js';

const ACOES = {
  ENCOMENDA_CADASTRADA: 'Encomenda cadastrada',
  ENCOMENDA_EDITADA: 'Dados corrigidos',
  ENCOMENDA_CANCELADA: 'Encomenda cancelada',
  RETIRADA_REGISTRADA: 'Retirada registrada (baixa)',
  RETIRADA_OUTRO_PLANTAO_REGISTRADA: 'Retirada por outro plantão lançada',
  RETIRADA_CORRIGIDA: 'Retirada corrigida',
  RETIRADA_ESTORNADA: 'Retirada estornada',
  ANEXO_ADICIONADO: 'Comprovante anexado',
  ANEXO_REMOVIDO: 'Comprovante removido',
};
const CAMPOS = {
  recebido_em: 'Data/hora de recebimento', lote_id: 'Lote', descricao: 'Descrição', endereco_complementar: 'Endereço complementar',
  transportadora_id: 'Transportadora', codigo_rastreio: 'Código de rastreio', recebido_por_id: 'Funcionário que recebeu', observacoes: 'Observações',
  data_local: 'Data da retirada', hora_local: 'Horário da retirada', retirado_por_nome: 'Quem retirou', documento_retirante: 'Documento',
  entregue_por_id: 'Controlador que entregou', entregue_por_nome: 'Entregue por (nome)', entregador_desconhecido: 'Entregador não identificado',
  plantao: 'Plantão', observacoes_r: 'Observações',
};

function valorLegivel(campo, v) {
  if (v === null || v === undefined || v === '') return '(vazio)';
  if (campo === 'recebido_em') return fmtDataHora(v);
  if (campo === 'lote_id') { const l = estado.lotes.find((x) => x.id === v); return l ? `Quadra ${l.quadra_codigo} · Lote ${l.codigo}` : `#${v}`; }
  if (campo === 'transportadora_id') { const t = estado.transportadoras.find((x) => x.id === v); return t ? t.nome : `#${v}`; }
  if (campo === 'recebido_por_id' || campo === 'entregue_por_id') { const u = estado.usuarios.find((x) => x.id === v); return u ? u.nome : `#${v}`; }
  if (campo === 'data_local') return fmtData(v);
  if (campo === 'entregador_desconhecido') return v ? 'Sim' : 'Não';
  return String(v);
}

function linhaTempo(alts) {
  return html`<ul class="timeline">${alts.map((a) => {
    const det = a.detalhes || {};
    const diffs = ['ENCOMENDA_EDITADA', 'RETIRADA_CORRIGIDA'].includes(a.acao)
      ? Object.entries(det).map(([k, v]) => html`<div><strong>${CAMPOS[k] || k}:</strong> <del>${valorLegivel(k, v.antes)}</del> → <ins>${valorLegivel(k, v.depois)}</ins></div>`) : [];
    return html`<li><div class="quando">${fmtDataHora(a.ocorrido_em)} · ${a.usuario_nome || 'sistema'}</div>
      <div class="oque">${ACOES[a.acao] || a.acao}</div>
      ${diffs.length ? html`<div class="diff">${diffs}</div>` : ''}
      ${a.acao === 'ANEXO_ADICIONADO' && det.tipo ? html`<div class="small muted">${det.tipo.toLowerCase()} · ${det.nome || ''}</div>` : ''}
      ${a.justificativa ? html`<div class="small"><strong>Justificativa:</strong> ${a.justificativa}</div>` : ''}</li>`;
  })}</ul>`;
}

export async function render(el, { params, navegar, atual }) {
  const id = Number(params[0]);
  const e = await api.get(`/encomendas/${id}`);
  if (!atual()) return;
  const cfg = estado.config;
  const ret = e.retiradas.find((r) => !r.estornada_em);
  const estornadas = e.retiradas.filter((r) => r.estornada_em);
  const perm = e.permissoes;
  const recarregar = () => render(el, { params, navegar, atual });

  mount(el, html`
    <div class="page-head">
      <div><a href="#/historico" class="small nao-imprimir" id="voltar">${icon('voltar')} Voltar</a>
        <div class="ficha-head" style="margin-top:6px"><span class="ficha-codigo mono">${e.codigo}</span> ${statusBadge(e.status)}
          ${e.status === 'PENDENTE' ? html`<span class="muted">aguardando há</span> ${diasBadge(e.dias_espera, cfg)}` : ''}</div>
        <p>Quadra ${e.quadra} · Lote ${e.lote} — ${e.descricao}</p></div>
      <div class="acoes">
        ${perm.retirar ? html`<button class="btn primario" id="a-ret">${icon('check')} Registrar retirada</button><button class="btn" id="a-outro">${icon('troca')} Retirada por outro plantão</button>` : ''}
        ${perm.editar ? html`<button class="btn" id="a-editar">${icon('editar')} Corrigir dados</button>` : ''}
        <button class="btn" id="a-imprimir">${icon('imprimir')} Imprimir</button>
        ${perm.cancelar ? html`<button class="btn perigo" id="a-cancelar">Cancelar encomenda</button>` : ''}
      </div>
    </div>
    ${e.status === 'CANCELADA' ? html`<div class="alerta erro">${icon('alerta')}<div><strong>Encomenda cancelada em ${fmtDataHora(e.cancelado_em)}.</strong>Motivo: ${e.motivo_cancelamento}</div></div>` : ''}

    <div class="grid grid-2">
      <section class="card"><div class="card-head"><h2>Recebimento e endereço</h2></div><div class="card-body">
        <dl class="dl">
          <dt>Identificador</dt><dd class="mono">${e.codigo}</dd>
          <dt>Recebida em</dt><dd>${fmtDataHora(e.recebido_em)}</dd>
          <dt>Funcionário que recebeu</dt><dd>${e.recebido_por}</dd>
          <dt>Cadastrada por</dt><dd>${e.cadastrado_por} em ${fmtDataHora(e.cadastrado_em)}</dd>
          <dt>Quadra / Lote</dt><dd><strong>Quadra ${e.quadra} · Lote ${e.lote}</strong></dd>
          ${e.lote_endereco ? html`<dt>Endereço oficial</dt><dd>${e.lote_endereco}</dd>` : ''}
          <dt>Endereço complementar</dt><dd>${e.endereco_complementar || html`<span class="muted">—</span>`}</dd>
          <dt>Descrição</dt><dd>${e.descricao}</dd>
          <dt>Transportadora</dt><dd>${e.transportadora}</dd>
          <dt>Código de rastreio</dt><dd>${e.codigo_rastreio || html`<span class="muted">—</span>`}</dd>
          <dt>Observações</dt><dd style="white-space:pre-wrap">${e.observacoes || html`<span class="muted">—</span>`}</dd>
        </dl></div></section>

      <section class="card"><div class="card-head"><h2>Retirada</h2>
        ${ret && (perm.corrigir_retirada || perm.estornar) ? html`<div class="btn-grupo nao-imprimir">
          ${perm.corrigir_retirada ? html`<button class="btn sm" id="a-corrigir">${icon('editar')} Corrigir</button>` : ''}
          ${perm.estornar ? html`<button class="btn sm perigo" id="a-estornar">Estornar baixa</button>` : ''}</div>` : ''}</div>
        <div class="card-body">
        ${ret ? html`
          ${ret.tipo === 'OUTRO_PLANTAO' ? html`<div class="faixa-outro">RETIRADA REALIZADA POR OUTRO PLANTÃO</div>` : ''}
          <dl class="dl">
            <dt>Data</dt><dd>${fmtData(ret.data_local)}</dd>
            <dt>Horário</dt><dd>${ret.hora_local || html`<span class="muted">não informado (desconhecido)</span>`}</dd>
            <dt>Retirada por</dt><dd><strong>${ret.retirado_por_nome}</strong>${ret.documento_retirante ? html` · doc. ${ret.documento_retirante}` : ''}</dd>
            <dt>Controlador que entregou</dt><dd>${ret.entregue_por || html`<span class="muted">não identificado</span>`}</dd>
            ${ret.tipo === 'OUTRO_PLANTAO' ? html`<dt>Plantão</dt><dd>${ret.plantao}</dd>` : ''}
            <dt>${ret.tipo === 'OUTRO_PLANTAO' ? 'Lançado por' : 'Registrado por'}</dt><dd>${ret.lancado_por} em ${fmtDataHora(ret.lancado_em)}</dd>
            <dt>Observações</dt><dd style="white-space:pre-wrap">${ret.observacoes || html`<span class="muted">—</span>`}</dd>
            ${ret.justificativa_horario ? html`<dt>Justificativa do horário</dt><dd>${ret.justificativa_horario}</dd>` : ''}
            <dt>Tempo de espera</dt><dd>${e.dias_espera === 0 ? 'retirada no mesmo dia' : `${e.dias_espera} dia(s)`}</dd>
          </dl>` : html`<div class="vazio" style="padding:20px">${e.status === 'CANCELADA' ? 'Encomenda cancelada.' : 'Aguardando retirada.'}</div>`}
        ${estornadas.map((r) => html`<div class="retirada-estornada"><strong>Retirada estornada</strong> — registrada em ${fmtData(r.data_local)} ${r.hora_local || ''} (${r.tipo === 'OUTRO_PLANTAO' ? 'outro plantão' : 'portaria'}), retirada por ${r.retirado_por_nome}, lançada por ${r.lancado_por}.<br>
          Estornada por ${r.estornada_por} em ${fmtDataHora(r.estornada_em)}. Motivo: ${r.motivo_estorno}</div>`)}
      </div></section>
    </div>

    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Comprovantes</h2>
      <div class="btn-grupo nao-imprimir"><button class="btn sm" id="a-assinar">${icon('caneta')} Coletar assinatura</button>
      <label class="btn sm">${icon('anexo')} Anexar foto/documento<input type="file" id="a-arquivo" accept="image/*,application/pdf" hidden></label></div></div>
      <div class="card-body">
        ${e.anexos.length ? html`<div class="anexos">${e.anexos.map((a) => html`
          <div class="anexo ${a.removido_em ? 'removido' : ''}">
            <a class="thumb" href="/api/anexos/${a.id}/arquivo" target="_blank" rel="noopener">${a.mime.startsWith('image/') && (!a.removido_em || ehAdmin()) ? html`<img src="/api/anexos/${a.id}/arquivo" alt="${a.tipo}" loading="lazy">` : html`<span class="muted">${a.mime === 'application/pdf' ? 'PDF' : 'arquivo'}</span>`}</a>
            <div class="info"><strong>${a.tipo === 'ASSINATURA' ? 'Assinatura' : a.tipo === 'FOTO' ? 'Foto' : 'Documento'}</strong> · ${fmtBytes(a.tamanho)}<br>
              <span class="muted">${fmtDataHora(a.enviado_em)} · ${a.enviado_por}</span>
              ${a.removido_em ? html`<br><span style="color:var(--vermelho)">Removido: ${a.motivo_remocao}</span>` : perm.remover_anexo ? html`<br><button class="btn fantasma sm perigo" data-remover="${a.id}" style="padding:2px 6px;min-height:0">Remover</button>` : ''}</div>
          </div>`)}</div>` : html`<p class="muted" style="margin:0">Nenhum comprovante anexado. Assinaturas, fotos e documentos ficam acessíveis somente a usuários autenticados.</p>`}
      </div></section>

    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Histórico de alterações</h2><span class="small muted">Registro permanente — não pode ser alterado</span></div>
      <div class="card-body">${linhaTempo(e.alteracoes)}</div></section>`);

  const on = (sel, fn) => { const b = $(sel, el); if (b) b.addEventListener('click', fn); };
  on('#voltar', (ev) => { if (history.length > 1) { ev.preventDefault(); history.back(); } });
  on('#a-imprimir', () => window.print());
  on('#a-ret', () => abrirRetirada({ encomendas: [e], tipo: 'PROPRIA', aoConcluir: recarregar }));
  on('#a-outro', () => abrirRetirada({ encomendas: [e], tipo: 'OUTRO_PLANTAO', aoConcluir: recarregar }));
  on('#a-editar', () => editar(e, recarregar));
  on('#a-corrigir', () => corrigirRetirada(e, ret, recarregar));
  on('#a-cancelar', async () => {
    const motivo = await pedirJustificativa({ titulo: `Cancelar encomenda ${e.codigo}`, mensagem: 'A encomenda não será apagada: ficará marcada como cancelada no histórico, com o motivo informado.', rotulo: 'Motivo do cancelamento', botao: 'Cancelar encomenda', perigo: true });
    if (!motivo) return;
    try { await api.post(`/encomendas/${e.id}/cancelar`, { motivo }); toast('Encomenda cancelada.'); recarregar(); } catch (err) { toast(err.message, 'erro'); }
  });
  on('#a-estornar', async () => {
    const motivo = await pedirJustificativa({ titulo: 'Estornar baixa', mensagem: 'A retirada será mantida no histórico como estornada e a encomenda voltará a "aguardando retirada".', rotulo: 'Motivo do estorno', botao: 'Estornar', perigo: true });
    if (!motivo) return;
    try { await api.post(`/retiradas/${ret.id}/estornar`, { motivo }); toast('Baixa estornada.'); recarregar(); } catch (err) { toast(err.message, 'erro'); }
  });
  on('#a-assinar', () => coletarAssinatura(e, ret, recarregar));
  const arq = $('#a-arquivo', el);
  arq.addEventListener('change', async () => {
    const file = arq.files[0];
    if (!file) return;
    try {
      await enviarAnexo(e.id, file.type === 'application/pdf' ? 'DOCUMENTO' : 'FOTO', file, file.name, ret && ret.id);
      toast('Comprovante anexado.');
      recarregar();
    } catch (err) { toast(err.message, 'erro'); }
  });
  $$('[data-remover]', el).forEach((b) => b.addEventListener('click', async () => {
    const motivo = await pedirJustificativa({ titulo: 'Remover comprovante', mensagem: 'O arquivo continuará guardado para auditoria, mas deixará de aparecer para os controladores.', rotulo: 'Motivo da remoção', botao: 'Remover', perigo: true });
    if (!motivo) return;
    try { await api.post(`/anexos/${b.dataset.remover}/remover`, { motivo }); toast('Comprovante removido.'); recarregar(); } catch (err) { toast(err.message, 'erro'); }
  }));
}

function coletarAssinatura(e, ret, recarregar) {
  const m = abrirModal({
    titulo: 'Coletar assinatura', corpo: html`<p style="margin-top:0">Peça para ${ret ? html`<strong>${ret.retirado_por_nome}</strong>` : 'quem está retirando'} assinar no quadro abaixo.</p><div id="pad-f"></div>`,
    rodape: html`<button class="btn" id="limpar-f">Limpar</button><button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="salvar-f">Salvar assinatura</button>`,
  });
  const pad = padAssinatura($('#pad-f', m.el));
  $('#limpar-f', m.el).addEventListener('click', () => pad.limpar());
  $('#salvar-f', m.el).addEventListener('click', async () => {
    if (pad.vazio()) { toast('A assinatura está em branco.', 'erro'); return; }
    try {
      await enviarAnexo(e.id, 'ASSINATURA', await pad.blob(), `assinatura-${e.codigo}.png`, ret && ret.id);
      m.fechar(); toast('Assinatura salva.'); recarregar();
    } catch (err) { toast(err.message, 'erro'); }
  });
}

function editar(e, recarregar) {
  const p = agoraSP(new Date(e.recebido_em));
  const m = abrirModal({
    titulo: `Corrigir dados – ${e.codigo}`, largo: true,
    corpo: html`<form id="f-ed" class="form-grid" novalidate><div class="form-erro c-12"></div>
      <div class="campo c-3"><label>Data</label><input type="date" name="data" value="${p.date}" max="${agoraSP().date}"></div>
      <div class="campo c-3"><label>Horário</label><input type="time" name="hora" value="${p.time}"></div>
      <div class="campo c-6"><label>Funcionário que recebeu</label><select name="recebido_por_id">${opcoes(estado.usuarios.filter((u) => u.ativo || u.id === e.recebido_por_id), e.recebido_por_id)}</select></div>
      <div class="campo c-3"><label>Quadra</label><select name="quadra_id">${opcoes(quadrasAtivas(), e.quadra_id, { rotulo: (q) => `Quadra ${q.codigo}` })}</select></div>
      <div class="campo c-3"><label>Lote</label><select name="lote_id"></select></div>
      <div class="campo c-6"><label>Endereço complementar</label><input type="text" name="endereco_complementar" value="${e.endereco_complementar || ''}" maxlength="300"></div>
      <div class="campo c-6"><label>Descrição</label><input type="text" name="descricao" value="${e.descricao}" maxlength="300"></div>
      <div class="campo c-3"><label>Transportadora</label><select name="transportadora_id">${opcoes(estado.transportadoras.filter((t) => t.ativo || t.id === e.transportadora_id), e.transportadora_id)}</select></div>
      <div class="campo c-3"><label>Código de rastreio</label><input type="text" name="codigo_rastreio" value="${e.codigo_rastreio || ''}" maxlength="80"></div>
      <div class="campo c-12"><label>Observações</label><textarea name="observacoes" maxlength="4000">${e.observacoes || ''}</textarea></div>
      <div class="campo c-12"><label>Justificativa da correção <span class="req">*</span></label><input type="text" name="justificativa" maxlength="1000" required><span class="dica">Registrada na auditoria com os valores anteriores e novos.</span></div>
    </form>`,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="ed-ok">Salvar correção</button>`,
  });
  const f = $('#f-ed', m.el);
  const lotes = () => {
    const lista = lotesDaQuadra(f.quadra_id.value);
    if (String(f.quadra_id.value) === String(e.quadra_id) && !lista.some((l) => l.id === e.lote_id)) lista.unshift({ id: e.lote_id, codigo: e.lote });
    mount(f.lote_id, opcoes(lista, String(f.quadra_id.value) === String(e.quadra_id) ? e.lote_id : '', { vazio: 'Selecione…', rotulo: (l) => `Lote ${l.codigo}` }));
  };
  if (!quadrasAtivas().some((q) => q.id === e.quadra_id)) mount(f.quadra_id, html`<option value="${e.quadra_id}">Quadra ${e.quadra}</option>${opcoes(quadrasAtivas(), '', { rotulo: (q) => `Quadra ${q.codigo}` })}`);
  lotes();
  f.quadra_id.addEventListener('change', lotes);
  $('#ed-ok', m.el).addEventListener('click', async () => {
    const d = lerForm(f);
    if (!d.justificativa.trim()) return marcarErro(f, 'Informe a justificativa da correção.');
    if (!d.lote_id) return marcarErro(f, 'Selecione o lote.');
    const corpo = { justificativa: d.justificativa };
    if (d.data !== p.date || d.hora !== p.time) { corpo.data = d.data; corpo.hora = d.hora; }
    for (const k of ['lote_id', 'transportadora_id', 'recebido_por_id']) if (Number(d[k]) !== e[k]) corpo[k] = Number(d[k]);
    for (const k of ['descricao', 'endereco_complementar', 'codigo_rastreio', 'observacoes']) if ((d[k] || '').trim() !== (e[k] || '')) corpo[k] = d[k];
    try { await api.put(`/encomendas/${e.id}`, corpo); m.fechar(); toast('Correção registrada.'); recarregar(); } catch (err) { marcarErro(f, err.message); }
  });
}

function corrigirRetirada(e, ret, recarregar) {
  const outro = ret.tipo === 'OUTRO_PLANTAO';
  const entregadorAtual = ret.entregador_desconhecido ? 'desconhecido' : ret.entregue_por_id ? String(ret.entregue_por_id) : ret.entregue_por_nome ? 'outro' : '';
  const m = abrirModal({
    titulo: `Corrigir retirada – ${e.codigo}`, largo: true,
    corpo: html`<form id="f-cr" class="form-grid" novalidate><div class="form-erro c-12"></div>
      <div class="campo c-3"><label>Data</label><input type="date" name="data" value="${ret.data_local}" max="${agoraSP().date}"></div>
      <div class="campo c-3"><label>Horário</label><input type="time" name="hora" value="${ret.hora_local || ''}"></div>
      <div class="campo c-6"><label>Nome de quem retirou</label><input type="text" name="retirado_por_nome" value="${ret.retirado_por_nome}" maxlength="160"></div>
      <div class="campo c-6"><label>Controlador que entregou</label><select name="entregador">
        ${outro ? html`<option value="desconhecido" ${entregadorAtual === 'desconhecido' ? 'selected' : ''}>Não identificado</option>` : ''}
        ${opcoes(estado.usuarios.filter((u) => u.ativo || String(u.id) === entregadorAtual), entregadorAtual)}
        ${outro ? html`<option value="outro" ${entregadorAtual === 'outro' ? 'selected' : ''}>Outra pessoa (digitar nome)</option>` : ''}</select></div>
      <div class="campo c-6 ${entregadorAtual === 'outro' ? '' : 'hidden'}" id="cr-nome"><label>Nome de quem entregou</label><input type="text" name="entregue_por_nome" value="${ret.entregue_por_nome || ''}" maxlength="120"></div>
      <div class="campo c-6"><label>Documento</label><input type="text" name="documento_retirante" value="${ret.documento_retirante || ''}" maxlength="40"></div>
      ${outro ? html`<div class="campo c-6"><label>Plantão</label><input type="text" name="plantao" value="${ret.plantao || ''}" maxlength="60" list="dl-pl"><datalist id="dl-pl">${(estado.config.plantoes || []).map((x) => html`<option value="${x}">`)}</datalist></div>` : ''}
      <div class="campo c-12"><label>Observações</label><textarea name="observacoes" maxlength="2000">${ret.observacoes || ''}</textarea></div>
      <div class="campo c-12"><label>Justificativa da correção <span class="req">*</span></label><input type="text" name="justificativa" maxlength="1000"></div>
    </form>`,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="cr-ok">Salvar correção</button>`,
  });
  const f = $('#f-cr', m.el);
  f.entregador.addEventListener('change', () => $('#cr-nome', m.el).classList.toggle('hidden', f.entregador.value !== 'outro'));
  $('#cr-ok', m.el).addEventListener('click', async () => {
    const d = lerForm(f);
    if (!d.justificativa.trim()) return marcarErro(f, 'Informe a justificativa da correção.');
    const corpo = { justificativa: d.justificativa };
    if (d.data !== ret.data_local) corpo.data = d.data;
    if ((d.hora || null) !== ret.hora_local) corpo.hora = d.hora;
    for (const k of ['retirado_por_nome', 'documento_retirante', 'observacoes', 'plantao']) if (d[k] !== undefined && d[k].trim() !== (ret[k] || '')) corpo[k] = d[k];
    if (d.entregador !== entregadorAtual || (d.entregador === 'outro' && d.entregue_por_nome !== (ret.entregue_por_nome || ''))) {
      if (d.entregador === 'desconhecido') corpo.entregador_desconhecido = true;
      else if (d.entregador === 'outro') corpo.entregue_por_nome = d.entregue_por_nome;
      else corpo.entregue_por_id = Number(d.entregador);
    }
    try { await api.put(`/retiradas/${ret.id}`, corpo); m.fechar(); toast('Retirada corrigida.'); recarregar(); } catch (err) { marcarErro(f, err.message); }
  });
}
