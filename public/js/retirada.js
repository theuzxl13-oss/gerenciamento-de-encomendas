// Modal de baixa: "Registrar retirada" (própria) e "Retirada realizada por outro plantão".
import { api } from './api.js';
import { html, $, icon, toast, abrirModal, lerForm, marcarErro, agoraSP, fmtData, fmtDataHora, opcoes, endereco } from './ui.js';
import { estado, usuariosAtivos } from './estado.js';

function minutosDiferenca(data, hora) {
  const p = agoraSP();
  const a = Date.parse(`${data}T${hora}:00Z`);
  const b = Date.parse(`${p.date}T${p.time}:00Z`);
  return Math.abs(a - b) / 60000;
}

// Bloco de assinatura desenhada na tela (mouse, caneta ou dedo)
export function padAssinatura(container) {
  container.innerHTML = '<div class="assinatura-wrap"><canvas></canvas><div class="linha"></div><div class="rot-ass">Assinatura de quem retirou (opcional)</div></div>';
  const cv = container.querySelector('canvas');
  const ctx = cv.getContext('2d');
  let desenhou = false; let ativo = false;
  const ajustar = () => {
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * devicePixelRatio));
    cv.height = Math.round(150 * devicePixelRatio);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  };
  requestAnimationFrame(ajustar);
  const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.addEventListener('pointerdown', (e) => { ativo = true; cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
  cv.addEventListener('pointermove', (e) => { if (!ativo) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); desenhou = true; });
  const fim = () => { ativo = false; };
  cv.addEventListener('pointerup', fim); cv.addEventListener('pointercancel', fim);
  return {
    limpar() { desenhou = false; ctx.setTransform(1, 0, 0, 1, 0, 0); ajustar(); },
    vazio: () => !desenhou,
    blob: () => new Promise((res) => cv.toBlob(res, 'image/png')),
  };
}

// Fotos grandes (câmera do celular) são reduzidas no navegador antes do envio:
// economiza espaço e respeita o limite por arquivo do armazenamento gratuito.
async function reduzirImagem(arquivo, ladoMax = 1600, qualidade = 0.82) {
  if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type) || arquivo.size < 400 * 1024) return arquivo;
  try {
    const bmp = await createImageBitmap(arquivo);
    const esc = Math.min(1, ladoMax / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(bmp.width * esc);
    cv.height = Math.round(bmp.height * esc);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', qualidade));
    return blob && blob.size < arquivo.size ? new File([blob], (arquivo.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : arquivo;
  } catch {
    return arquivo;
  }
}

export async function enviarAnexo(encomendaId, tipo, arquivo, nome, retiradaId) {
  if (tipo === 'FOTO') { arquivo = await reduzirImagem(arquivo); nome = arquivo.name || nome; }
  const fd = new FormData();
  fd.append('tipo', tipo);
  if (retiradaId) fd.append('retirada_id', retiradaId);
  fd.append('arquivo', arquivo, nome || arquivo.name || 'arquivo');
  return api.post(`/encomendas/${encomendaId}/anexos`, fd);
}

// encomendas: linhas da pesquisa (precisam de id, codigo, quadra, lote, descricao, recebido_em, recebido_data)
export function abrirRetirada({ encomendas, tipo = 'PROPRIA', aoConcluir }) {
  const outro = tipo === 'OUTRO_PLANTAO';
  const eu = estado.usuario;
  const agora = agoraSP();
  const plural = encomendas.length > 1;
  const resumo = html`<div class="resumo-encs">${encomendas.map((e) => html`<div><strong class="mono">${e.codigo}</strong> · ${endereco(e)} · ${e.descricao} <span class="muted small">(recebida ${fmtDataHora(e.recebido_em)})</span></div>`)}</div>`;
  const tol = estado.config.minutos_tolerancia_horario || 15;
  const outros = usuariosAtivos().filter((u) => u.id !== eu.id);
  const plantoes = estado.config.plantoes || [];

  const corpo = outro ? html`
    <div class="alerta roxo">${icon('troca')}<div><strong>Retirada realizada por outro plantão</strong>
      Use quando a encomenda já foi entregue enquanto você estava de folga. Você ficará registrado(a) como <strong>quem fez o lançamento</strong>, nunca como quem entregou.</div></div>
    ${resumo}
    <form id="form-ret" class="form-grid" novalidate>
      <div class="form-erro c-12"></div>
      <div class="campo c-6"><label>Data da retirada <span class="req">*</span></label><input type="date" name="data" max="${agora.date}" required></div>
      <div class="campo c-6"><label>Horário conhecido</label><input type="time" name="hora"><span class="dica">Deixe em branco se não souber.</span></div>
      <div class="campo c-12"><label>Nome de quem retirou <span class="req">*</span></label><input type="text" name="retirado_por_nome" maxlength="160" required></div>
      <div class="campo c-6"><label>Controlador que entregou <span class="req">*</span></label>
        <select name="entregador" required>
          <option value="">Selecione…</option>
          <option value="desconhecido">Não sei quem entregou</option>
          ${outros.length ? html`<optgroup label="Funcionários">${opcoes(outros, '')}</optgroup>` : ''}
          <option value="outro">Outra pessoa (digitar nome)</option>
        </select></div>
      <div class="campo c-6 hidden" id="campo-entregador-nome"><label>Nome de quem entregou <span class="req">*</span></label><input type="text" name="entregue_por_nome" maxlength="120"></div>
      <div class="campo c-6"><label>Plantão <span class="req">*</span></label>
        ${plantoes.length ? html`<select name="plantao" required>${opcoes(plantoes, '', { vazio: 'Selecione…', rotulo: (p) => p, valorDe: (p) => p })}</select>`
          : html`<input type="text" name="plantao" maxlength="60" required placeholder="Ex.: plantão em que ocorreu a entrega">`}</div>
      <div class="campo c-6"><label>Documento de quem retirou</label><input type="text" name="documento_retirante" maxlength="40"></div>
      <div class="campo c-12"><label>Observação <span class="req">*</span></label><textarea name="observacoes" maxlength="2000" required placeholder="Como você soube da retirada (livro do plantão, informação do colega, do morador…)"></textarea></div>
      <div class="c-12 small muted">Lançamento feito por: <strong>${eu.nome}</strong> em ${fmtData(agora.date)} ${agora.time}</div>
    </form>` : html`
    ${resumo}
    <form id="form-ret" class="form-grid" novalidate>
      <div class="form-erro c-12"></div>
      <div class="campo c-4"><label>Data <span class="req">*</span></label><input type="date" name="data" value="${agora.date}" max="${agora.date}" required></div>
      <div class="campo c-4"><label>Horário <span class="req">*</span></label><input type="time" name="hora" value="${agora.time}" required></div>
      <div class="campo c-4"><label>Controlador que entregou <span class="req">*</span></label><select name="entregue_por_id">${opcoes(usuariosAtivos(), eu.id)}</select></div>
      <div class="campo c-12 hidden" id="campo-just"><label>Justificativa da correção de data/horário <span class="req">*</span></label>
        <input type="text" name="justificativa_horario" maxlength="1000" placeholder="Ex.: retirada ocorreu às 14h, lançada depois por falta de energia">
        <span class="dica">Obrigatória quando o horário difere mais de ${tol} minutos do horário atual.</span></div>
      <div class="campo c-8"><label>Nome de quem retirou <span class="req">*</span></label><input type="text" name="retirado_por_nome" maxlength="160" required autocomplete="off"></div>
      <div class="campo c-4"><label>Documento</label><input type="text" name="documento_retirante" maxlength="40" autocomplete="off"></div>
      <div class="campo c-12"><label>Observações</label><textarea name="observacoes" maxlength="2000" style="min-height:56px"></textarea></div>
      <div class="secao-form">Comprovante (opcional)</div>
      <div class="c-12" id="pad"></div>
      <div class="c-12 btn-grupo"><button type="button" class="btn sm" id="limpar-ass">Limpar assinatura</button>
        <label class="btn sm">${icon('anexo')} Foto / documento<input type="file" id="foto-ret" accept="image/*,application/pdf" capture="environment" hidden></label>
        <span class="small muted" id="foto-nome"></span></div>
    </form>`;

  const m = abrirModal({
    titulo: outro ? (plural ? `Retirada por outro plantão (${encomendas.length} encomendas)` : 'Retirada por outro plantão') : (plural ? `Registrar retirada de ${encomendas.length} encomendas` : 'Registrar retirada'),
    classeHead: outro ? 'roxo' : '',
    largo: true,
    corpo,
    rodape: html`<button class="btn" data-fechar>Cancelar</button><button class="btn ${outro ? 'roxo' : 'primario'} lg" id="ret-ok">${icon('check')} ${outro ? 'Registrar retirada de outro plantão' : 'Confirmar retirada'}</button>`,
  });
  const f = $('#form-ret', m.el);
  let pad = null;
  if (!outro) {
    pad = padAssinatura($('#pad', m.el));
    $('#limpar-ass', m.el).addEventListener('click', () => pad.limpar());
    $('#foto-ret', m.el).addEventListener('change', (e) => { $('#foto-nome', m.el).textContent = e.target.files[0] ? e.target.files[0].name : ''; });
    const checar = () => {
      const d = lerForm(f);
      const diverge = d.data && d.hora && minutosDiferenca(d.data, d.hora) > tol;
      $('#campo-just', m.el).classList.toggle('hidden', !diverge);
    };
    f.data.addEventListener('change', checar);
    f.hora.addEventListener('change', checar);
    f.retirado_por_nome.focus();
  } else {
    f.entregador.addEventListener('change', () => {
      $('#campo-entregador-nome', m.el).classList.toggle('hidden', f.entregador.value !== 'outro');
    });
  }

  const btn = $('#ret-ok', m.el);
  btn.addEventListener('click', async () => {
    const d = lerForm(f);
    const corpoReq = {
      encomenda_ids: encomendas.map((e) => e.id), tipo,
      data: d.data, hora: d.hora || null, retirado_por_nome: d.retirado_por_nome,
      documento_retirante: d.documento_retirante, observacoes: d.observacoes, plantao: d.plantao,
    };
    if (outro) {
      if (!d.data) return marcarErro(f, 'Informe a data da retirada.');
      if (!d.retirado_por_nome.trim()) return marcarErro(f, 'Informe o nome de quem retirou.');
      if (!d.entregador) return marcarErro(f, 'Informe o controlador que entregou ou selecione "Não sei quem entregou".');
      if (d.entregador === 'desconhecido') corpoReq.entregador_desconhecido = true;
      else if (d.entregador === 'outro') {
        if (!d.entregue_por_nome.trim()) return marcarErro(f, 'Digite o nome de quem entregou.');
        corpoReq.entregue_por_nome = d.entregue_por_nome;
      } else corpoReq.entregue_por_id = Number(d.entregador);
      if (!d.plantao) return marcarErro(f, 'Informe o plantão.');
      if (!d.observacoes.trim()) return marcarErro(f, 'A observação é obrigatória.');
    } else {
      if (!d.retirado_por_nome.trim()) { marcarErro(f, 'Informe o nome de quem retirou.'); f.retirado_por_nome.focus(); return; }
      corpoReq.entregue_por_id = Number(d.entregue_por_id);
      corpoReq.justificativa_horario = d.justificativa_horario;
      if (!$('#campo-just', m.el).classList.contains('hidden') && !d.justificativa_horario.trim()) {
        return marcarErro(f, 'Informe a justificativa da correção de data/horário.');
      }
    }
    btn.disabled = true;
    try {
      const r = await api.post('/retiradas', corpoReq);
      // Comprovantes (assinatura/foto) vinculados a cada encomenda baixada
      let falhaAnexo = false;
      if (pad && !pad.vazio()) {
        const blob = await pad.blob();
        for (const x of r.retiradas) {
          try { await enviarAnexo(x.encomenda_id, 'ASSINATURA', blob, `assinatura-${x.codigo}.png`, x.retirada_id); } catch { falhaAnexo = true; }
        }
      }
      const foto = !outro && $('#foto-ret', m.el).files[0];
      if (foto) {
        for (const x of r.retiradas) {
          try { await enviarAnexo(x.encomenda_id, foto.type === 'application/pdf' ? 'DOCUMENTO' : 'FOTO', foto, foto.name, x.retirada_id); } catch { falhaAnexo = true; }
        }
      }
      m.fechar();
      toast(outro ? `Retirada por outro plantão registrada (${r.retiradas.length}).` : `Retirada registrada (${r.retiradas.length}).`);
      if (falhaAnexo) toast('A retirada foi gravada, mas um comprovante não pôde ser enviado. Anexe-o pela ficha da encomenda.', 'erro', 8000);
      if (aoConcluir) aoConcluir(r);
    } catch (err) {
      btn.disabled = false;
      marcarErro(f, err.message);
      if (err.dados && err.dados.campo === 'justificativa_horario') $('#campo-just', m.el).classList.remove('hidden');
      m.el.querySelector('.modal-fundo, .modal')?.scrollIntoView?.({ block: 'start' });
    }
  });
  return m;
}

