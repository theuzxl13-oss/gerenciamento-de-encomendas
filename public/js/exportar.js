// Geração de PDF e Excel no navegador (bibliotecas em /vendor, carregadas somente quando usadas).
import { api, qs } from './api.js';
import { STATUS, fmtDataHora, fmtData, agoraSP, toast } from './ui.js';
import { estado } from './estado.js';

const carregados = {};
function carregarScript(src) {
  if (!carregados[src]) {
    carregados[src] = new Promise((ok, erro) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => { delete carregados[src]; erro(new Error('Não foi possível carregar o gerador de arquivos. Verifique a conexão.')); };
      document.head.appendChild(s);
    });
  }
  return carregados[src];
}
export async function excelJS() { await carregarScript('/vendor/exceljs.min.js'); return window.ExcelJS; }
async function jsPDF() {
  await carregarScript('/vendor/jspdf.umd.min.js');
  await carregarScript('/vendor/jspdf.plugin.autotable.min.js');
  return window.jspdf.jsPDF;
}

export function salvarArquivo(conteudo, nome, mime) {
  const blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const STATUS_LONGO = { ...STATUS, RETIRADA_OUTRO_PLANTAO: 'Retirada realizada por outro plantão' };
const COLUNAS = [
  ['codigo', 'Identificador', 62], ['recebido', 'Recebido em', 62], ['endereco', 'Quadra/Lote', 50], ['descricao', 'Descrição', 110],
  ['transportadora', 'Transportadora', 62], ['recebido_por', 'Recebido por', 62], ['status', 'Situação', 62], ['retirada', 'Retirada em', 62],
  ['retirado_por_nome', 'Retirado por', 70], ['entregue_por', 'Entregue por', 62], ['lancado_por', 'Lançado por', 58], ['plantao', 'Plantão', 40],
];
const EXTRAS = [['dias_espera', 'Dias aguardando/aguardou'], ['endereco_complementar', 'Endereço complementar'], ['observacoes', 'Observações do recebimento'], ['retirada_observacoes', 'Observações da retirada']];

function linha(e) {
  return {
    codigo: e.codigo, recebido: fmtDataHora(e.recebido_em), endereco: `Q ${e.quadra} / L ${e.lote}`, descricao: e.descricao,
    transportadora: e.transportadora, recebido_por: e.recebido_por, status: STATUS_LONGO[e.status] || e.status,
    retirada: e.retirada_data ? `${fmtData(e.retirada_data)} ${e.retirada_hora || '(horário n/inf.)'}` : '',
    retirado_por_nome: e.retirado_por_nome || '',
    entregue_por: e.retirada_id ? (e.entregue_por || (e.entregador_desconhecido ? 'Não identificado' : '')) : '',
    lancado_por: e.lancado_por || '', plantao: e.plantao || '', dias_espera: e.dias_espera ?? '',
    endereco_complementar: e.endereco_complementar || '', observacoes: e.observacoes || '', retirada_observacoes: e.retirada_observacoes || '',
  };
}

// Busca todas as páginas de resultado (500 por requisição).
async function buscarTodas(filtros, aoProgredir) {
  const itens = [];
  for (let pagina = 1; ; pagina++) {
    const r = await api.get('/encomendas' + qs({ ...filtros, por_pagina: 500, pagina }));
    itens.push(...r.itens);
    if (aoProgredir) aoProgredir(itens.length, r.total);
    if (itens.length >= r.total || !r.itens.length) break;
    if (itens.length > 50000) throw new Error('Resultado muito grande. Restrinja o período.');
  }
  return itens;
}

const geradoEm = () => { const p = agoraSP(); return `${fmtData(p.date)} ${p.time} por ${estado.usuario.nome}`; };

function tabelaPdf(Doc, { titulo, subtitulo, resumo, cabecalho, corpo, larguras }) {
  const doc = new Doc({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const verde = [31, 78, 61];
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...verde);
  doc.text('Fazenda da Ilha – Gestão de Encomendas', 28, 34);
  doc.setFontSize(11); doc.setTextColor(17); doc.text(titulo, 28, 50);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(68);
  const linhas = doc.splitTextToSize([subtitulo, `Gerado em ${geradoEm()} (horário de Brasília)`, resumo].filter(Boolean).join('\n'), 780);
  doc.text(linhas, 28, 64);
  const soma = larguras.reduce((s, w) => s + w, 0);
  doc.autoTable({
    startY: 64 + linhas.length * 10 + 6,
    head: [cabecalho], body: corpo,
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 3, overflow: 'linebreak' },
    headStyles: { fillColor: verde, textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [241, 245, 243] },
    columnStyles: Object.fromEntries(larguras.map((w, i) => [i, { cellWidth: (w / soma) * 786 }])),
    margin: { left: 28, right: 28 },
    didDrawPage: () => {
      doc.setFontSize(7); doc.setTextColor(110);
      doc.text(`Página ${doc.internal.getNumberOfPages()}`, doc.internal.pageSize.getWidth() - 28, doc.internal.pageSize.getHeight() - 14, { align: 'right' });
    },
  });
  if (!corpo.length) { doc.setFontSize(9); doc.text('Nenhum registro encontrado para os filtros informados.', 28, doc.lastAutoTable.finalY + 16); }
  return doc;
}

// ---------- Relatório de encomendas ----------
export async function exportarEncomendas(filtros, formato) {
  toast('Gerando arquivo…');
  const rel = await api.get('/relatorios' + qs({ ...filtros, por_pagina: 1 }));
  const itens = (await buscarTodas({ ...filtros, ordem: filtros.ordem || 'recebido_asc' })).map(linha);
  const p = agoraSP();
  const resumo = `Total: ${rel.resumo.total}  ·  ` + rel.resumo.por_status.map((s) => `${s.rotulo}: ${s.n}`).join('  ·  ');
  if (formato === 'pdf') {
    const doc = tabelaPdf(await jsPDF(), {
      titulo: 'Relatório de Encomendas', subtitulo: rel.filtros, resumo,
      cabecalho: COLUNAS.map((c) => c[1]), corpo: itens.map((l) => COLUNAS.map((c) => String(l[c[0]] ?? ''))), larguras: COLUNAS.map((c) => c[2]),
    });
    salvarArquivo(doc.output('blob'), `relatorio-encomendas-${p.date}.pdf`);
  } else {
    const E = await excelJS();
    const wb = new E.Workbook();
    wb.creator = 'Gestão de Encomendas – Fazenda da Ilha';
    const ws = wb.addWorksheet('Encomendas', { views: [{ state: 'frozen', ySplit: 4 }] });
    const cols = [...COLUNAS, ...EXTRAS];
    ws.getCell('A1').value = 'Fazenda da Ilha – Relatório de Encomendas';
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A2').value = `Filtros: ${rel.filtros}`;
    ws.getCell('A3').value = `Gerado em ${geradoEm()} (horário de Brasília) · ${itens.length} encomenda(s)`;
    const cab = ws.getRow(4);
    cab.values = cols.map((c) => c[1]);
    cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E3D' } };
    cols.forEach((c, i) => { ws.getColumn(i + 1).width = ['descricao', 'observacoes', 'retirada_observacoes'].includes(c[0]) ? 40 : Math.max(12, Math.min(30, c[1].length + 6)); });
    for (const l of itens) ws.addRow(cols.map((c) => l[c[0]] ?? ''));
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: cols.length } };
    const rs = wb.addWorksheet('Resumo');
    rs.columns = [{ header: 'Indicador', key: 'k', width: 45 }, { header: 'Quantidade', key: 'v', width: 14 }];
    rs.getRow(1).font = { bold: true };
    rs.addRow({ k: 'Total de encomendas', v: rel.resumo.total });
    rel.resumo.por_status.forEach((s) => rs.addRow({ k: s.rotulo, v: s.n }));
    rs.addRow({});
    rs.addRow({ k: 'Por transportadora' }).font = { bold: true };
    rel.resumo.por_transportadora.forEach((t) => rs.addRow({ k: t.nome, v: t.n }));
    salvarArquivo(await wb.xlsx.writeBuffer(), `relatorio-encomendas-${p.date}.xlsx`, XLSX_MIME);
  }
  api.post('/relatorios/exportacao', { formato, tipo: 'encomendas', filtros: rel.filtros, total: itens.length }).catch(() => {});
}

// ---------- Relatório por funcionário ----------
const COLS_FUNC = [['nome', 'Funcionário', 200], ['perfil', 'Perfil', 80], ['recebidas', 'Encomendas recebidas', 90], ['cadastradas', 'Cadastros realizados', 90],
  ['entregas', 'Entregas (baixas próprias)', 100], ['entregas_informadas_outro_plantao', 'Entregas informadas por outro plantão', 120],
  ['lancamentos_outro_plantao', 'Lançamentos de retirada de outro plantão', 120]];

export async function exportarFuncionarios(filtros, formato) {
  const r = await api.get('/relatorios/funcionarios' + qs(filtros));
  const dados = r.linhas.map((l) => ({ ...l, perfil: l.perfil === 'ADMIN' ? 'Administrador' : 'Controlador' }));
  const p = agoraSP();
  if (formato === 'pdf') {
    const doc = tabelaPdf(await jsPDF(), { titulo: 'Relatório por funcionário', subtitulo: `Período: ${r.periodo}`,
      cabecalho: COLS_FUNC.map((c) => c[1]), corpo: dados.map((d) => COLS_FUNC.map((c) => String(d[c[0]] ?? ''))), larguras: COLS_FUNC.map((c) => c[2]) });
    salvarArquivo(doc.output('blob'), `relatorio-funcionarios-${p.date}.pdf`);
  } else {
    const E = await excelJS();
    const wb = new E.Workbook();
    const ws = wb.addWorksheet('Por funcionário');
    ws.addRow(['Fazenda da Ilha – Relatório por funcionário']).font = { bold: true, size: 14 };
    ws.addRow([`Período: ${r.periodo} · Gerado em ${geradoEm()}`]);
    ws.addRow(COLS_FUNC.map((c) => c[1])).font = { bold: true };
    dados.forEach((d) => ws.addRow(COLS_FUNC.map((c) => d[c[0]])));
    COLS_FUNC.forEach((c, i) => { ws.getColumn(i + 1).width = i === 0 ? 35 : 22; });
    salvarArquivo(await wb.xlsx.writeBuffer(), `relatorio-funcionarios-${p.date}.xlsx`, XLSX_MIME);
  }
  api.post('/relatorios/exportacao', { formato, tipo: 'funcionarios', filtros: r.periodo, total: dados.length }).catch(() => {});
}

// ---------- Quadras e lotes ----------
export async function modeloQuadrasLotes() {
  const E = await excelJS();
  const wb = new E.Workbook();
  const ws = wb.addWorksheet('Quadras e lotes');
  ws.columns = [
    { header: 'Quadra', key: 'quadra', width: 12, style: { numFmt: '@' } },
    { header: 'Lote', key: 'lote', width: 12, style: { numFmt: '@' } },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getCell('D1').value = 'Preencha Quadra e Lote como texto (ex.: 01, 02) para preservar zeros à esquerda.';
  salvarArquivo(await wb.xlsx.writeBuffer(), 'modelo-quadras-lotes.xlsx', XLSX_MIME);
}

export async function exportarQuadrasLotes(lotes) {
  const E = await excelJS();
  const wb = new E.Workbook();
  const ws = wb.addWorksheet('Quadras e lotes');
  ws.columns = [
    { header: 'Quadra', key: 'quadra_codigo', width: 12, style: { numFmt: '@' } }, { header: 'Lote', key: 'codigo', width: 12, style: { numFmt: '@' } },
    { header: 'Situação', key: 'situacao', width: 12 }, { header: 'Endereço', key: 'endereco', width: 40 }, { header: 'Observação', key: 'observacao', width: 40 },
    { header: 'Encomendas', key: 'total_encomendas', width: 12 }, { header: 'Pendentes', key: 'pendentes', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  lotes.forEach((l) => ws.addRow({ ...l, situacao: l.ativo && l.quadra_ativa ? 'Ativo' : 'Inativo' }));
  salvarArquivo(await wb.xlsx.writeBuffer(), `quadras-lotes-${agoraSP().date}.xlsx`, XLSX_MIME);
  api.post('/relatorios/exportacao', { formato: 'xlsx', tipo: 'quadras_lotes', total: lotes.length }).catch(() => {});
}
