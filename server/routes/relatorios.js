'use strict';
const express = require('express');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { fmtDateTime, fmtDate, isDate, localParts } = require('../time');
const { bad, int } = require('../util');
const { audit } = require('../audit');
const { buscar } = require('../consulta');
const A = require('../auth');

const STATUS_LABEL = {
  PENDENTE: 'Aguardando retirada',
  RETIRADA: 'Retirada',
  RETIRADA_OUTRO_PLANTAO: 'Retirada realizada por outro plantão',
  CANCELADA: 'Cancelada',
};

const COLUNAS = [
  { key: 'codigo', titulo: 'Identificador', w: 62 },
  { key: 'recebido', titulo: 'Recebido em', w: 62 },
  { key: 'endereco', titulo: 'Quadra/Lote', w: 50 },
  { key: 'descricao', titulo: 'Descrição', w: 110 },
  { key: 'transportadora', titulo: 'Transportadora', w: 62 },
  { key: 'recebido_por', titulo: 'Recebido por', w: 62 },
  { key: 'status', titulo: 'Situação', w: 62 },
  { key: 'retirada', titulo: 'Retirada em', w: 62 },
  { key: 'retirado_por_nome', titulo: 'Retirado por', w: 70 },
  { key: 'entregue_por', titulo: 'Entregue por', w: 62 },
  { key: 'lancado_por', titulo: 'Lançado por', w: 58 },
  { key: 'plantao', titulo: 'Plantão', w: 40 },
];

function linha(e) {
  return {
    codigo: e.codigo,
    recebido: fmtDateTime(e.recebido_em),
    endereco: `Q ${e.quadra} / L ${e.lote}`,
    descricao: e.descricao,
    transportadora: e.transportadora,
    recebido_por: e.recebido_por,
    status: STATUS_LABEL[e.status] || e.status,
    retirada: e.retirada_data ? `${fmtDate(e.retirada_data)}${e.retirada_hora ? ' ' + e.retirada_hora : ' (horário n/inf.)'}` : '',
    retirado_por_nome: e.retirado_por_nome || '',
    entregue_por: e.retirada_id ? (e.entregue_por || (e.entregador_desconhecido ? 'Não identificado' : '')) : '',
    lancado_por: e.lancado_por || '',
    plantao: e.plantao || '',
    dias_espera: e.dias_espera,
    endereco_complementar: e.endereco_complementar || '',
    observacoes: e.observacoes || '',
    retirada_observacoes: e.retirada_observacoes || '',
  };
}

function descreverFiltros(f, nomes) {
  const out = [];
  if (f.data_ini || f.data_fim) out.push(`Recebimento: ${f.data_ini ? fmtDate(f.data_ini) : '...'} a ${f.data_fim ? fmtDate(f.data_fim) : '...'}`);
  if (f.retirada_ini || f.retirada_fim) out.push(`Retirada: ${f.retirada_ini ? fmtDate(f.retirada_ini) : '...'} a ${f.retirada_fim ? fmtDate(f.retirada_fim) : '...'}`);
  if (f.status) out.push(`Situação: ${String(f.status).split(',').map((s) => STATUS_LABEL[s] || s).join(', ')}`);
  if (nomes.quadra) out.push(`Quadra: ${nomes.quadra}`);
  if (nomes.lote) out.push(`Lote: ${nomes.lote}`);
  if (nomes.transportadora) out.push(`Transportadora: ${nomes.transportadora}`);
  if (nomes.controlador) out.push(`Controlador: ${nomes.controlador}`);
  if (f.tipo_retirada === 'OUTRO_PLANTAO') out.push('Somente retiradas por outro plantão');
  if (f.tipo_retirada === 'PROPRIA') out.push('Somente retiradas próprias');
  return out.length ? out.join(' · ') : 'Sem filtros (todas as encomendas)';
}

module.exports = function relatoriosRoutes({ db }) {
  const r = express.Router();
  r.use(A.requireAuth);

  function nomesFiltros(f) {
    const n = {};
    if (int(f.quadra_id)) n.quadra = db.prepare('SELECT codigo FROM quadras WHERE id = ?').get(int(f.quadra_id))?.codigo;
    if (int(f.lote_id)) n.lote = db.prepare('SELECT codigo FROM lotes WHERE id = ?').get(int(f.lote_id))?.codigo;
    if (int(f.transportadora_id)) n.transportadora = db.prepare('SELECT nome FROM transportadoras WHERE id = ?').get(int(f.transportadora_id))?.nome;
    if (int(f.controlador_id)) n.controlador = db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(int(f.controlador_id))?.nome;
    return n;
  }

  function resumo(itens) {
    const porStatus = {};
    const porTransp = {};
    for (const e of itens) {
      porStatus[e.status] = (porStatus[e.status] || 0) + 1;
      porTransp[e.transportadora] = (porTransp[e.transportadora] || 0) + 1;
    }
    return {
      total: itens.length,
      por_status: Object.entries(porStatus).map(([status, n]) => ({ status, rotulo: STATUS_LABEL[status], n })),
      por_transportadora: Object.entries(porTransp).map(([nome, n]) => ({ nome, n })).sort((a, b) => b.n - a.n),
    };
  }

  // ---------- Relatório de encomendas ----------
  r.get('/relatorios', async (req, res) => {
    const f = req.query;
    const formato = String(f.formato || 'json');
    const { itens } = buscar(db, { ...f, ordem: f.ordem || 'recebido_asc' }, { paginar: false });
    if (itens.length > 20000) throw bad('Resultado muito grande. Restrinja o período.');
    const sumario = resumo(itens);
    const filtrosTxt = descreverFiltros(f, nomesFiltros(f));
    const gerado = `${fmtDateTime(new Date().toISOString())} por ${req.user.nome}`;

    if (formato === 'json') return res.json({ filtros: filtrosTxt, resumo: sumario, itens: itens.slice(0, 1000), total: itens.length });

    audit(db, req, { acao: 'RELATORIO_EXPORTADO', entidade: 'relatorio', detalhes: { formato, filtros: filtrosTxt, total: itens.length } });
    const p = localParts();
    const base = `relatorio-encomendas-${p.date}`;

    if (formato === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Gestão de Encomendas – Fazenda da Ilha';
      const ws = wb.addWorksheet('Encomendas', { views: [{ state: 'frozen', ySplit: 4 }] });
      ws.mergeCells('A1:P1');
      ws.getCell('A1').value = 'Fazenda da Ilha – Relatório de Encomendas';
      ws.getCell('A1').font = { bold: true, size: 14 };
      ws.getCell('A2').value = `Filtros: ${filtrosTxt}`;
      ws.getCell('A3').value = `Gerado em ${gerado} (horário de Brasília) · ${itens.length} encomenda(s)`;
      const cols = [...COLUNAS.map((c) => ({ key: c.key, titulo: c.titulo })),
        { key: 'dias_espera', titulo: 'Dias aguardando/aguardou' }, { key: 'endereco_complementar', titulo: 'Endereço complementar' },
        { key: 'observacoes', titulo: 'Observações do recebimento' }, { key: 'retirada_observacoes', titulo: 'Observações da retirada' }];
      ws.getRow(4).values = cols.map((c) => c.titulo);
      ws.getRow(4).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E3D' } };
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(12, Math.min(40, c.titulo.length + 6)); ws.getColumn(i + 1).key = c.key; });
      ws.getColumn(4).width = 40;
      ws.getColumn(15).width = 40; ws.getColumn(16).width = 40;
      for (const e of itens) { const l = linha(e); ws.addRow(cols.map((c) => l[c.key] ?? '')); }
      ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
      const rs = wb.addWorksheet('Resumo');
      rs.columns = [{ header: 'Indicador', key: 'k', width: 45 }, { header: 'Quantidade', key: 'v', width: 14 }];
      rs.getRow(1).font = { bold: true };
      rs.addRow({ k: 'Total de encomendas', v: sumario.total });
      sumario.por_status.forEach((s) => rs.addRow({ k: s.rotulo, v: s.n }));
      rs.addRow({});
      rs.addRow({ k: 'Por transportadora', v: '' }).font = { bold: true };
      sumario.por_transportadora.forEach((t) => rs.addRow({ k: t.nome, v: t.n }));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    if (formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, info: { Title: 'Relatório de Encomendas – Fazenda da Ilha' } });
      doc.pipe(res);
      gerarPdfTabela(doc, {
        titulo: 'Relatório de Encomendas', subtitulo: filtrosTxt, gerado,
        resumoTxt: `Total: ${sumario.total}  ·  ` + sumario.por_status.map((s) => `${s.rotulo}: ${s.n}`).join('  ·  '),
        colunas: COLUNAS, linhas: itens.map(linha),
      });
      doc.end();
      return undefined;
    }
    throw bad('Formato inválido.');
  });

  // ---------- Relatório por funcionário ----------
  r.get('/relatorios/funcionarios', async (req, res) => {
    const f = req.query;
    const ini = isDate(f.data_ini) ? f.data_ini : '0000-01-01';
    const fim = isDate(f.data_fim) ? f.data_fim : '9999-12-31';
    const linhas = db.prepare(`
      SELECT u.id, u.nome, u.perfil, u.ativo,
        (SELECT COUNT(*) FROM encomendas e WHERE e.recebido_por_id = u.id AND e.status <> 'CANCELADA' AND e.recebido_data BETWEEN @ini AND @fim) recebidas,
        (SELECT COUNT(*) FROM encomendas e WHERE e.cadastrado_por_id = u.id AND e.status <> 'CANCELADA' AND e.recebido_data BETWEEN @ini AND @fim) cadastradas,
        (SELECT COUNT(*) FROM retiradas r WHERE r.estornada_em IS NULL AND r.tipo = 'PROPRIA' AND r.entregue_por_id = u.id AND r.data_local BETWEEN @ini AND @fim) entregas,
        (SELECT COUNT(*) FROM retiradas r WHERE r.estornada_em IS NULL AND r.tipo = 'OUTRO_PLANTAO' AND r.entregue_por_id = u.id AND r.data_local BETWEEN @ini AND @fim) entregas_informadas_outro_plantao,
        (SELECT COUNT(*) FROM retiradas r WHERE r.estornada_em IS NULL AND r.tipo = 'OUTRO_PLANTAO' AND r.lancado_por_id = u.id AND r.data_local BETWEEN @ini AND @fim) lancamentos_outro_plantao
      FROM usuarios u ORDER BY u.nome`).all({ ini, fim })
      .filter((l) => l.ativo || l.recebidas || l.cadastradas || l.entregas || l.entregas_informadas_outro_plantao || l.lancamentos_outro_plantao);
    const formato = String(f.formato || 'json');
    const periodo = `${f.data_ini ? fmtDate(f.data_ini) : 'início'} a ${f.data_fim ? fmtDate(f.data_fim) : 'hoje'}`;
    if (formato === 'json') return res.json({ periodo, linhas });
    audit(db, req, { acao: 'RELATORIO_EXPORTADO', entidade: 'relatorio', detalhes: { formato, tipo: 'funcionarios', periodo } });
    const cols = [
      { key: 'nome', titulo: 'Funcionário', w: 200 },
      { key: 'perfil', titulo: 'Perfil', w: 80 },
      { key: 'recebidas', titulo: 'Encomendas recebidas', w: 90 },
      { key: 'cadastradas', titulo: 'Cadastros realizados', w: 90 },
      { key: 'entregas', titulo: 'Entregas (baixas próprias)', w: 100 },
      { key: 'entregas_informadas_outro_plantao', titulo: 'Entregas informadas por outro plantão', w: 120 },
      { key: 'lancamentos_outro_plantao', titulo: 'Lançamentos de retirada de outro plantão', w: 120 },
    ];
    const dados = linhas.map((l) => ({ ...l, perfil: l.perfil === 'ADMIN' ? 'Administrador' : 'Controlador' }));
    const p = localParts();
    if (formato === 'xlsx') {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Por funcionário');
      ws.addRow(['Fazenda da Ilha – Relatório por funcionário']).font = { bold: true, size: 14 };
      ws.addRow([`Período: ${periodo} · Gerado em ${fmtDateTime(new Date().toISOString())} por ${req.user.nome}`]);
      const h = ws.addRow(cols.map((c) => c.titulo));
      h.font = { bold: true };
      dados.forEach((d) => ws.addRow(cols.map((c) => d[c.key])));
      cols.forEach((c, i) => { ws.getColumn(i + 1).width = i === 0 ? 35 : 22; });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="relatorio-funcionarios-${p.date}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }
    if (formato === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="relatorio-funcionarios-${p.date}.pdf"`);
      const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
      doc.pipe(res);
      gerarPdfTabela(doc, { titulo: 'Relatório por funcionário', subtitulo: `Período: ${periodo}`, gerado: `${fmtDateTime(new Date().toISOString())} por ${req.user.nome}`, colunas: cols, linhas: dados });
      doc.end();
      return undefined;
    }
    throw bad('Formato inválido.');
  });

  return r;
};

// Tabela simples paginada para PDF (pdfkit)
function gerarPdfTabela(doc, { titulo, subtitulo, gerado, resumoTxt, colunas, linhas }) {
  const left = doc.page.margins.left;
  const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const soma = colunas.reduce((s, c) => s + c.w, 0);
  const cols = colunas.map((c) => ({ ...c, w: (c.w / soma) * largura }));
  const verde = '#1f4e3d';

  const cabecalho = () => {
    doc.fillColor(verde).font('Helvetica-Bold').fontSize(14).text('Fazenda da Ilha – Gestão de Encomendas', left, doc.page.margins.top);
    doc.fillColor('#111').fontSize(11).text(titulo);
    doc.font('Helvetica').fontSize(8).fillColor('#444').text(subtitulo, { width: largura });
    doc.text(`Gerado em ${gerado} (horário de Brasília)`);
    if (resumoTxt) doc.text(resumoTxt, { width: largura });
    doc.moveDown(0.4);
    let x = left;
    const y = doc.y;
    doc.rect(left, y, largura, 16).fill(verde);
    doc.fillColor('#fff').font('Helvetica-Bold').fontSize(7);
    for (const c of cols) { doc.text(c.titulo, x + 2, y + 4, { width: c.w - 4, height: 10, ellipsis: true, lineBreak: false }); x += c.w; }
    doc.y = y + 18;
  };

  const rodape = (n) => {
    doc.font('Helvetica').fontSize(7).fillColor('#666')
      .text(`Página ${n}`, left, doc.page.height - doc.page.margins.bottom - 8, { width: largura, align: 'right', lineBreak: false });
  };

  let pagina = 1;
  cabecalho();
  doc.font('Helvetica').fontSize(7);
  linhas.forEach((l, i) => {
    const alturas = cols.map((c) => doc.heightOfString(String(l[c.key] ?? ''), { width: c.w - 4 }));
    const h = Math.min(Math.max(...alturas, 8) + 5, 40);
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 14) {
      rodape(pagina++);
      doc.addPage();
      cabecalho();
      doc.font('Helvetica').fontSize(7);
    }
    const y = doc.y;
    if (i % 2 === 0) doc.rect(left, y, largura, h).fill('#f1f5f3');
    doc.fillColor('#111');
    let x = left;
    for (const c of cols) {
      doc.text(String(l[c.key] ?? ''), x + 2, y + 3, { width: c.w - 4, height: h - 4, ellipsis: true });
      x += c.w;
    }
    doc.y = y + h;
  });
  if (!linhas.length) doc.fillColor('#444').fontSize(9).text('Nenhum registro encontrado para os filtros informados.', left, doc.y + 6);
  rodape(pagina);
}
