import { api } from '../api.js';
import { html, mount, $, $$, icon, toast, lerForm, marcarErro, agoraSP, opcoes, abrirModal, fmtDataHora } from '../ui.js';
import { estado, quadrasAtivas, lotesDaQuadra, usuariosAtivos, carregarTransportadoras, carregarQuadrasLotes, ehAdmin } from '../estado.js';

const SUGESTOES = ['Caixa pequena', 'Caixa média', 'Caixa grande', 'Envelope', 'Pacote', 'Sacola', 'Documento', 'Volume frágil'];

export async function render(el, { navegar, query }) {
  await carregarQuadrasLotes();
  const manter = render.manter || {};
  render.manter = null;
  desenhar(el, navegar, { ...manter, ...query });
}

function desenhar(el, navegar, pre = {}) {
  const agora = agoraSP();
  const semLotes = !estado.lotes.some((l) => l.ativo);
  mount(el, html`
    <div class="page-head"><div><h1>Nova encomenda</h1><p>Registro de recebimento na portaria. A encomenda inicia como <strong>aguardando retirada</strong>.</p></div></div>
    ${semLotes ? html`<div class="alerta aviso">${icon('alerta')}<div><strong>Nenhum lote da relação oficial cadastrado.</strong>
      ${ehAdmin() ? html`Cadastre ou importe a relação em <a href="#/quadras">Quadras e lotes</a> antes de registrar encomendas.` : 'Solicite ao administrador o cadastro da relação oficial de quadras e lotes.'}</div></div>` : ''}
    <form class="card" id="form-nova" novalidate>
      <div class="card-body">
        <div class="form-grid">
          <div class="form-erro c-12"></div>
          <div class="secao-form">Recebimento</div>
          <div class="campo c-3"><label for="n-data">Data <span class="req">*</span></label><input type="date" id="n-data" name="data" value="${pre.data || agora.date}" max="${agora.date}" required></div>
          <div class="campo c-3"><label for="n-hora">Horário <span class="req">*</span></label><input type="time" id="n-hora" name="hora" value="${agora.time}" required><span class="dica">Preenchidos automaticamente; podem ser ajustados.</span></div>
          <div class="campo c-6"><label for="n-receb">Funcionário que recebeu <span class="req">*</span></label>
            <select id="n-receb" name="recebido_por_id">${opcoes(usuariosAtivos(), pre.recebido_por_id || estado.usuario.id)}</select></div>

          <div class="secao-form">Endereço (relação oficial)</div>
          <div class="campo c-3"><label for="n-quadra">Quadra <span class="req">*</span></label>
            <select id="n-quadra" name="quadra_id" required>${opcoes(quadrasAtivas(), pre.quadra_id, { vazio: 'Selecione…', rotulo: (q) => `Quadra ${q.codigo}` })}</select></div>
          <div class="campo c-3"><label for="n-lote">Lote <span class="req">*</span></label>
            <select id="n-lote" name="lote_id" required><option value="">Selecione a quadra</option></select></div>
          <div class="campo c-6"><label for="n-compl">Endereço complementar</label><input type="text" id="n-compl" name="endereco_complementar" maxlength="300" placeholder="Ex.: casa dos fundos, bloco, referência"></div>
          <div class="c-12 hidden" id="lote-info"></div>

          <div class="secao-form">Encomenda</div>
          <div class="campo c-6"><label for="n-desc">Descrição da encomenda <span class="req">*</span></label>
            <input type="text" id="n-desc" name="descricao" maxlength="300" required placeholder="Ex.: caixa média parda, envelope pardo…">
            <div class="chips" style="margin-top:4px">${SUGESTOES.map((s) => html`<button type="button" class="chip" data-sug="${s}">${s}</button>`)}</div></div>
          <div class="campo c-3"><label for="n-transp">Transportadora <span class="req">*</span></label>
            <div class="input-acao"><select id="n-transp" name="transportadora_id" required>${opcoes(estado.transportadoras, pre.transportadora_id, { vazio: 'Selecione…' })}</select>
            <button type="button" class="btn" id="nova-transp" title="Incluir nova transportadora">${icon('nova')}<span class="sr-only">Nova transportadora</span></button></div></div>
          <div class="campo c-3"><label for="n-rastreio">Código de rastreio</label><input type="text" id="n-rastreio" name="codigo_rastreio" maxlength="80" autocomplete="off"></div>
          <div class="campo c-12"><label for="n-obs">Observações</label><textarea id="n-obs" name="observacoes" maxlength="4000" style="min-height:60px"></textarea></div>
        </div>
      </div>
      <div class="card-body" style="border-top:1px solid var(--border);background:var(--surface-2);border-radius:0 0 10px 10px">
        <div class="form-acoes">
          <button type="button" class="btn" id="limpar">Limpar</button>
          <button type="submit" class="btn" data-outra="1">Salvar e cadastrar outra</button>
          <button type="submit" class="btn primario lg">${icon('check')} Salvar encomenda</button>
        </div>
      </div>
    </form>`);

  const f = $('#form-nova', el);
  const selQ = f.quadra_id; const selL = f.lote_id;
  const preencherLotes = (valor) => {
    const lotes = lotesDaQuadra(selQ.value);
    selL.innerHTML = '';
    mount(selL, selQ.value ? opcoes(lotes, valor, { vazio: lotes.length ? 'Selecione…' : 'Nenhum lote ativo', rotulo: (l) => `Lote ${l.codigo}${l.endereco ? ' – ' + l.endereco : ''}` }) : html`<option value="">Selecione a quadra</option>`);
    infoLote();
  };
  const infoLote = () => {
    const box = $('#lote-info', el);
    const l = estado.lotes.find((x) => String(x.id) === selL.value);
    if (!l) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    mount(box, html`<div class="lote-info ${l.pendentes ? 'tem' : ''}">${l.endereco ? html`<strong>Endereço oficial:</strong> ${l.endereco}. ` : ''}${l.pendentes
      ? html`Este lote já possui <strong>${l.pendentes}</strong> encomenda(s) aguardando retirada — <a href="#/pendentes?lote_id=${l.id}&quadra_id=${l.quadra_id}">ver</a>.` : 'Nenhuma outra encomenda pendente para este lote.'}</div>`);
  };
  selQ.addEventListener('change', () => preencherLotes(''));
  selL.addEventListener('change', infoLote);
  if (pre.quadra_id) preencherLotes(pre.lote_id);

  $$('[data-sug]', el).forEach((b) => b.addEventListener('click', () => { f.descricao.value = b.dataset.sug; f.descricao.focus(); }));
  $('#limpar', el).addEventListener('click', () => desenhar(el, navegar));
  $('#nova-transp', el).addEventListener('click', () => novaTransportadora(f));

  let outra = false;
  $$('button[type=submit]', f).forEach((b) => b.addEventListener('click', () => { outra = !!b.dataset.outra; }));
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = lerForm(f);
    const faltando = [];
    if (!d.lote_id) faltando.push('quadra e lote');
    if (!d.descricao.trim()) faltando.push('descrição');
    if (!d.transportadora_id) faltando.push('transportadora');
    if (faltando.length) {
      marcarErro(f, `Preencha: ${faltando.join(', ')}.`);
      if (!d.lote_id) (d.quadra_id ? selL : selQ).closest('.campo').classList.add('erro');
      if (!d.descricao.trim()) f.descricao.closest('.campo').classList.add('erro');
      if (!d.transportadora_id) f.transportadora_id.closest('.campo').classList.add('erro');
      return;
    }
    const btns = $$('button[type=submit]', f);
    btns.forEach((b) => { b.disabled = true; });
    try {
      const enc = await api.post('/encomendas', d);
      toast(`Encomenda ${enc.codigo} registrada.`);
      await carregarQuadrasLotes();
      if (outra) {
        // mantém data, quadra, lote, transportadora e recebedor para agilizar volumes do mesmo endereço
        desenhar(el, navegar, { data: d.data, quadra_id: d.quadra_id, lote_id: d.lote_id, transportadora_id: d.transportadora_id, recebido_por_id: d.recebido_por_id });
        $('#n-desc', el).focus();
      } else sucesso(el, enc, navegar);
    } catch (err) {
      marcarErro(f, err.message);
      btns.forEach((b) => { b.disabled = false; });
    }
  });
}

function sucesso(el, enc, navegar) {
  mount(el, html`<div class="card"><div class="sucesso-cad">
    <div class="alerta sucesso" style="display:inline-flex">${icon('check')}<div>Encomenda registrada e aguardando retirada.</div></div>
    <div class="muted">Identificador</div>
    <div class="codigo-grande mono">${enc.codigo}</div>
    <p><strong>Quadra ${enc.quadra} · Lote ${enc.lote}</strong> — ${enc.descricao} (${enc.transportadora})<br>
      <span class="muted">Recebida em ${fmtDataHora(enc.recebido_em)} por ${enc.recebido_por}</span></p>
    <div class="btn-grupo" style="justify-content:center">
      <button class="btn primario lg" id="outra">${icon('nova')} Cadastrar outra</button>
      <button class="btn lg" id="mesmo">Outra para o mesmo lote</button>
      <a class="btn lg" href="#/encomenda/${enc.id}">Ver ficha</a>
    </div></div></div>`);
  $('#outra', el).addEventListener('click', () => desenhar(el, navegar));
  $('#mesmo', el).addEventListener('click', () => desenhar(el, navegar, { quadra_id: enc.quadra_id, lote_id: enc.lote_id, transportadora_id: enc.transportadora_id }));
  $('#outra', el).focus();
}

function novaTransportadora(f) {
  const m = abrirModal({
    titulo: 'Nova transportadora',
    corpo: html`<form id="f-transp" novalidate><div class="form-erro"></div><div class="campo"><label>Nome</label><input type="text" name="nome" maxlength="80" required></div></form>`,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn primario" id="t-ok">Incluir</button>`,
  });
  const enviar = async () => {
    const ff = $('#f-transp', m.el);
    try {
      const t = await api.post('/transportadoras', lerForm(ff));
      await carregarTransportadoras();
      mount(f.transportadora_id, opcoes(estado.transportadoras, t.id, { vazio: 'Selecione…' }));
      m.fechar();
      toast(`Transportadora "${t.nome}" incluída.`);
    } catch (err) { marcarErro(ff, err.message); }
  };
  $('#t-ok', m.el).addEventListener('click', enviar);
  $('#f-transp', m.el).addEventListener('submit', (e) => { e.preventDefault(); enviar(); });
}
