'use strict';
// Importação da relação oficial de quadras e lotes (CSV ou Excel).
// Regras: importa somente Quadra e Lote; preserva o texto exatamente como no arquivo (zeros à esquerda);
// nunca cria endereços; nunca apaga; evita duplicidades (inclusive "1" × "01"); prévia antes de gravar.
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { bad } = require('./util');

const MAX_LINHAS = 20000;
const MAX_TAM_CODIGO = 30;

const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Chave de equivalência: "01" ≡ "1", "A-01" ≡ "a-1". Usada só para detectar duplicidade, nunca para gravar.
function chaveEquivalente(codigo) {
  return String(codigo).toUpperCase().replace(/\s+/g, '').replace(/(^|[^0-9])0+(?=\d)/g, '$1');
}

function parseCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const primeira = txt.split(/\r?\n/, 1)[0];
  const sep = (primeira.match(/;/g) || []).length > (primeira.match(/,/g) || []).length ? ';'
    : (primeira.match(/\t/g) || []).length > (primeira.match(/,/g) || []).length ? '\t' : ',';
  const linhas = [];
  let campo = ''; let linha = []; let aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"' && txt[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') aspas = false; else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && txt[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

// Texto da célula do Excel como o usuário vê (respeita formatos como "00" que exibem zeros à esquerda).
function textoCelula(cell, avisos, ref) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    const fmt = cell.numFmt || '';
    if (/^0+$/.test(fmt)) return String(v).padStart(fmt.length, '0');
    avisos.add(ref);
    return String(v);
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return String(v.result ?? '');
    if ('text' in v) return String(v.text);
  }
  return String(v);
}

async function lerArquivo(file) {
  const nome = (file.originalname || '').toLowerCase();
  const avisosNumericos = new Set();
  let linhas;
  if (nome.endsWith('.csv') || nome.endsWith('.txt') || file.mimetype === 'text/csv') {
    linhas = parseCsv(file.buffer.toString('utf8'));
  } else if (nome.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer); } catch { throw bad('Não foi possível ler a planilha Excel. Verifique se o arquivo é .xlsx válido.'); }
    const ws = wb.worksheets[0];
    if (!ws) throw bad('A planilha não possui abas.');
    linhas = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = [];
      for (let c = 1; c <= Math.max(row.cellCount, 2); c++) vals.push(textoCelula(row.getCell(c), avisosNumericos, n));
      linhas[n - 1] = vals;
    });
  } else {
    throw bad('Formato não suportado. Envie um arquivo .csv ou .xlsx.');
  }
  const cabIdx = linhas.findIndex((l) => l && l.some((v) => semAcento(v) === 'quadra'));
  if (cabIdx < 0) throw bad('Cabeçalho não encontrado. O arquivo deve ter as colunas "Quadra" e "Lote".');
  const cab = linhas[cabIdx].map(semAcento);
  const iQ = cab.indexOf('quadra');
  const iL = cab.indexOf('lote');
  if (iL < 0) throw bad('Coluna "Lote" não encontrada.');
  const ignoradas = linhas[cabIdx].filter((c, i) => i !== iQ && i !== iL && String(c ?? '').trim()).map((c) => String(c).trim());
  const out = [];
  for (let i = cabIdx + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l || l.every((v) => String(v ?? '').trim() === '')) continue;
    out.push({
      linha: i + 1,
      quadra: String(l[iQ] ?? '').replace(/\s+/g, ' ').trim(),
      lote: String(l[iL] ?? '').replace(/\s+/g, ' ').trim(),
      numerico_excel: avisosNumericos.has(i + 1),
    });
  }
  if (out.length > MAX_LINHAS) throw bad(`Arquivo com mais de ${MAX_LINHAS} linhas.`);
  return { linhas: out, colunas_ignoradas: ignoradas };
}

const SITUACOES = {
  NOVO: 'Novo – será importado',
  REATIVAR: 'Existente inativo – será reativado',
  EXISTENTE: 'Já cadastrado – ignorado',
  DUPLICADO_ARQUIVO: 'Duplicado no próprio arquivo – ignorado',
  DUPLICADO_EQUIVALENTE: 'Duplicado de registro existente com grafia diferente – ignorado',
  INVALIDO: 'Inválido – ignorado',
};

// Classifica cada linha em relação ao banco. Não grava nada.
function analisar(db, linhas) {
  const quadras = db.prepare('SELECT id, codigo, ativo FROM quadras').all();
  const lotes = db.prepare('SELECT l.id, l.codigo, l.ativo, l.quadra_id FROM lotes l').all();
  const qExata = new Map(quadras.map((q) => [q.codigo, q]));
  const qEquiv = new Map(quadras.map((q) => [chaveEquivalente(q.codigo), q]));
  const lExato = new Map(lotes.map((l) => [`${l.quadra_id}|${l.codigo}`, l]));
  const lEquiv = new Map(lotes.map((l) => [`${l.quadra_id}|${chaveEquivalente(l.codigo)}`, l]));
  const vistos = new Map();
  const registros = [];
  const novasQuadras = new Set();
  const lotesNoArquivo = new Set();

  for (const r of linhas) {
    const reg = { linha: r.linha, quadra: r.quadra, lote: r.lote, situacao: null, detalhe: null };
    registros.push(reg);
    if (!r.quadra || !r.lote) { reg.situacao = 'INVALIDO'; reg.detalhe = !r.quadra ? 'Quadra vazia' : 'Lote vazio'; continue; }
    if (r.quadra.length > MAX_TAM_CODIGO || r.lote.length > MAX_TAM_CODIGO) { reg.situacao = 'INVALIDO'; reg.detalhe = 'Identificação muito longa'; continue; }
    if (/[\u0000-\u001f]/.test(r.quadra + r.lote)) { reg.situacao = 'INVALIDO'; reg.detalhe = 'Caracteres inválidos'; continue; }
    const chave = `${chaveEquivalente(r.quadra)}|${chaveEquivalente(r.lote)}`;
    if (vistos.has(chave)) {
      reg.situacao = 'DUPLICADO_ARQUIVO';
      const o = vistos.get(chave);
      reg.detalhe = `Mesmo registro da linha ${o.linha} (Quadra ${o.quadra}, Lote ${o.lote})`;
      continue;
    }
    vistos.set(chave, r);
    if (r.numerico_excel) reg.aviso = 'Célula numérica no Excel: confira se há zeros à esquerda';

    let quadra = qExata.get(r.quadra);
    if (!quadra) {
      const eq = qEquiv.get(chaveEquivalente(r.quadra));
      if (eq) {
        reg.situacao = 'DUPLICADO_EQUIVALENTE';
        reg.detalhe = `Já existe a quadra "${eq.codigo}" (equivalente a "${r.quadra}")`;
        continue;
      }
      novasQuadras.add(r.quadra);
      reg.situacao = 'NOVO';
      reg.quadra_nova = true;
      continue;
    }
    const lote = lExato.get(`${quadra.id}|${r.lote}`);
    if (lote) {
      lotesNoArquivo.add(lote.id);
      if (lote.ativo && quadra.ativo) { reg.situacao = 'EXISTENTE'; continue; }
      reg.situacao = 'REATIVAR';
      reg.detalhe = !quadra.ativo ? 'Quadra e lote serão reativados' : 'Lote será reativado';
      continue;
    }
    const eqL = lEquiv.get(`${quadra.id}|${chaveEquivalente(r.lote)}`);
    if (eqL) {
      lotesNoArquivo.add(eqL.id);
      reg.situacao = 'DUPLICADO_EQUIVALENTE';
      reg.detalhe = `Já existe o lote "${eqL.codigo}" na quadra ${quadra.codigo} (equivalente a "${r.lote}")`;
      continue;
    }
    reg.situacao = 'NOVO';
  }

  const ausentes = lotes.filter((l) => l.ativo && !lotesNoArquivo.has(l.id));
  const conta = (s) => registros.filter((r) => r.situacao === s).length;
  const resumo = {
    total_linhas: registros.length,
    novos: conta('NOVO'),
    reativados: conta('REATIVAR'),
    ja_existentes: conta('EXISTENTE'),
    duplicados_arquivo: conta('DUPLICADO_ARQUIVO'),
    duplicados_equivalentes: conta('DUPLICADO_EQUIVALENTE'),
    invalidos: conta('INVALIDO'),
    quadras_novas: novasQuadras.size,
    lotes_ausentes_no_arquivo: ausentes.length,
  };
  // Conferência das quadras do arquivo: faixa numérica e lacunas na sequência.
  const quadrasArquivo = [...new Set(registros.filter((r) => r.situacao !== 'INVALIDO').map((r) => r.quadra))];
  const numericas = quadrasArquivo.filter((q) => /^\d+$/.test(q)).map(Number);
  const conferencia = { total_quadras: quadrasArquivo.length, quadras_nao_numericas: quadrasArquivo.filter((q) => !/^\d+$/.test(q)) };
  if (numericas.length) {
    const min = Math.min(...numericas); const max = Math.max(...numericas);
    const presentes = new Set(numericas);
    const largura = Math.max(...quadrasArquivo.filter((q) => /^\d+$/.test(q)).map((q) => q.length));
    const faltantes = [];
    for (let i = min; i <= max && faltantes.length < 500; i++) if (!presentes.has(i)) faltantes.push(String(i).padStart(Math.min(largura, 2), '0'));
    Object.assign(conferencia, { primeira: String(min).padStart(Math.min(largura, 2), '0'), ultima: String(max), faltantes_na_sequencia: faltantes });
  }
  const existentesQ = new Set(quadras.map((q) => q.codigo));
  conferencia.quadras_novas_lista = quadrasArquivo.filter((q) => !existentesQ.has(q) && !qEquiv.has(chaveEquivalente(q)));
  conferencia.lotes_por_quadra_nova = Object.fromEntries(conferencia.quadras_novas_lista.map((q) => [q, registros.filter((r) => r.quadra === q && r.situacao === 'NOVO').length]));
  conferencia.base_atual = { quadras: quadras.length, lotes: lotes.length, lotes_ativos: lotes.filter((l) => l.ativo).length };
  conferencia.base_apos = { lotes: lotes.length + conta('NOVO') };
  conferencia.quadras_com_novos_lotes = [...new Set(registros.filter((r) => r.situacao === 'NOVO').map((r) => r.quadra))];
  resumo.importados = resumo.novos + resumo.reativados;
  resumo.ignorados = resumo.ja_existentes + resumo.invalidos;
  resumo.duplicados = resumo.duplicados_arquivo + resumo.duplicados_equivalentes;
  return { resumo, registros, ausentes, conferencia };
}

// Grava a importação (transação única). Retorna o resumo efetivo.
function aplicar(db, { linhas, desativarAusentes, now }) {
  const { resumo, registros, ausentes } = analisar(db, linhas);
  const qPorCodigo = new Map(db.prepare('SELECT id, codigo, ativo FROM quadras').all().map((q) => [q.codigo, q]));
  const insQ = db.prepare('INSERT INTO quadras (codigo, ativo, criado_em, atualizado_em) VALUES (?, 1, ?, ?)');
  const insL = db.prepare('INSERT INTO lotes (quadra_id, codigo, ativo, criado_em, atualizado_em) VALUES (?, ?, 1, ?, ?)');
  const reatQ = db.prepare('UPDATE quadras SET ativo = 1, atualizado_em = ? WHERE id = ?');
  const reatL = db.prepare('UPDATE lotes SET ativo = 1, atualizado_em = ? WHERE quadra_id = ? AND codigo = ?');
  for (const r of registros) {
    if (r.situacao !== 'NOVO' && r.situacao !== 'REATIVAR') continue;
    let q = qPorCodigo.get(r.quadra);
    if (!q) {
      q = { id: Number(insQ.run(r.quadra, now, now).lastInsertRowid), codigo: r.quadra, ativo: 1 };
      qPorCodigo.set(r.quadra, q);
    } else if (!q.ativo) { reatQ.run(now, q.id); q.ativo = 1; }
    if (r.situacao === 'NOVO') insL.run(q.id, r.lote, now, now);
    else reatL.run(now, q.id, r.lote);
  }
  let desativados = 0;
  if (desativarAusentes && ausentes.length) {
    const des = db.prepare('UPDATE lotes SET ativo = 0, atualizado_em = ? WHERE id = ?');
    for (const l of ausentes) { des.run(now, l.id); desativados++; }
  }
  return { resumo: { ...resumo, desativados }, registros };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

module.exports = { lerArquivo, analisar, aplicar, chaveEquivalente, parseCsv, sha256, SITUACOES };
