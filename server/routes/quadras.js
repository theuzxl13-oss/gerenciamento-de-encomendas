'use strict';
const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { nowIso } = require('../time');
const { bad, notFound, conflict, str, text, int } = require('../util');
const { audit, diff } = require('../audit');
const A = require('../auth');

const natural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Lê planilha (xlsx ou csv) e retorna linhas {linha, quadra, lote, endereco, observacao}
async function lerPlanilha(file) {
  const nome = (file.originalname || '').toLowerCase();
  let linhas = [];
  if (nome.endsWith('.csv') || file.mimetype === 'text/csv') {
    let txt = file.buffer.toString('utf8').replace(/^﻿/, '');
    const sep = (txt.split('\n')[0].match(/;/g) || []).length >= (txt.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    linhas = txt.split(/\r?\n/).map((l) => parseCsvLine(l, sep));
  } else if (nome.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw bad('Planilha vazia.');
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = [];
      for (let c = 1; c <= Math.max(row.cellCount, 4); c++) {
        const v = row.getCell(c).value;
        vals.push(v && typeof v === 'object' ? (v.text ?? v.result ?? (v.richText ? v.richText.map((t) => t.text).join('') : '')) : v);
      }
      linhas[n - 1] = vals;
    });
  } else {
    throw bad('Formato não suportado. Envie um arquivo .xlsx ou .csv.');
  }
  // Cabeçalho
  const cabIdx = linhas.findIndex((l) => l && l.some((v) => semAcento(v) === 'quadra'));
  if (cabIdx < 0) throw bad('Cabeçalho não encontrado. A planilha deve ter as colunas "Quadra" e "Lote".');
  const cab = linhas[cabIdx].map(semAcento);
  const col = (...nomes) => cab.findIndex((c) => nomes.includes(c));
  const iQ = col('quadra');
  const iL = col('lote');
  const iE = col('endereco', 'endereco complementar', 'complemento', 'logradouro');
  const iO = col('observacao', 'observacoes', 'obs');
  if (iL < 0) throw bad('Coluna "Lote" não encontrada.');
  const out = [];
  for (let i = cabIdx + 1; i < linhas.length; i++) {
    const l = linhas[i];
    if (!l || l.every((v) => v === null || v === undefined || String(v).trim() === '')) continue;
    out.push({
      linha: i + 1,
      quadra: str(l[iQ], 30),
      lote: str(l[iL], 30),
      endereco: iE >= 0 ? str(l[iE], 300) : null,
      observacao: iO >= 0 ? str(l[iO], 500) : null,
    });
  }
  return out;
}

function parseCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}

module.exports = function quadrasRoutes({ db }) {
  const r = express.Router();

  r.get('/quadras', A.requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT q.*, (SELECT COUNT(*) FROM lotes l WHERE l.quadra_id = q.id) total_lotes,
                                    (SELECT COUNT(*) FROM lotes l WHERE l.quadra_id = q.id AND l.ativo = 1) lotes_ativos
                             FROM quadras q ${req.query.ativos === '1' ? 'WHERE q.ativo = 1' : ''}`).all();
    rows.sort((a, b) => natural(a.codigo, b.codigo));
    res.json(rows);
  });

  r.post('/quadras', A.requireAdmin, (req, res) => {
    const codigo = str(req.body.codigo, 30);
    if (!codigo) throw bad('Informe a identificação da quadra.');
    if (db.prepare('SELECT 1 FROM quadras WHERE codigo = ?').get(codigo)) throw conflict('Quadra já cadastrada.');
    const now = nowIso();
    const info = db.prepare('INSERT INTO quadras (codigo, descricao, ativo, criado_em, atualizado_em) VALUES (?, ?, 1, ?, ?)')
      .run(codigo, str(req.body.descricao, 200), now, now);
    audit(db, req, { acao: 'QUADRA_CRIADA', entidade: 'quadra', entidadeId: Number(info.lastInsertRowid), detalhes: { codigo } });
    res.status(201).json(db.prepare('SELECT * FROM quadras WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/quadras/:id', A.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const antes = db.prepare('SELECT * FROM quadras WHERE id = ?').get(id);
    if (!antes) throw notFound();
    const depois = {
      codigo: req.body.codigo !== undefined ? str(req.body.codigo, 30) : antes.codigo,
      descricao: req.body.descricao !== undefined ? str(req.body.descricao, 200) : antes.descricao,
      ativo: req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : antes.ativo,
    };
    if (!depois.codigo) throw bad('Informe a identificação da quadra.');
    if (db.prepare('SELECT 1 FROM quadras WHERE codigo = ? AND id <> ?').get(depois.codigo, id)) throw conflict('Quadra já cadastrada.');
    db.prepare('UPDATE quadras SET codigo = ?, descricao = ?, ativo = ?, atualizado_em = ? WHERE id = ?')
      .run(depois.codigo, depois.descricao, depois.ativo, nowIso(), id);
    audit(db, req, { acao: 'QUADRA_EDITADA', entidade: 'quadra', entidadeId: id, detalhes: diff(antes, depois, ['codigo', 'descricao', 'ativo']) });
    res.json(db.prepare('SELECT * FROM quadras WHERE id = ?').get(id));
  });

  r.get('/lotes', A.requireAuth, (req, res) => {
    const where = [];
    const params = [];
    if (req.query.quadra_id) { where.push('l.quadra_id = ?'); params.push(int(req.query.quadra_id)); }
    if (req.query.ativos === '1') where.push('l.ativo = 1 AND q.ativo = 1');
    if (req.query.q) {
      where.push('(l.codigo LIKE ? OR l.endereco LIKE ? OR q.codigo LIKE ?)');
      const like = `%${req.query.q}%`;
      params.push(like, like, like);
    }
    const rows = db.prepare(`SELECT l.*, q.codigo quadra_codigo, q.ativo quadra_ativa,
                               (SELECT COUNT(*) FROM encomendas e WHERE e.lote_id = l.id AND e.status = 'PENDENTE') pendentes
                             FROM lotes l JOIN quadras q ON q.id = l.quadra_id
                             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`).all(...params);
    rows.sort((a, b) => natural(a.quadra_codigo, b.quadra_codigo) || natural(a.codigo, b.codigo));
    res.json(rows);
  });

  r.post('/lotes', A.requireAdmin, (req, res) => {
    const quadraId = int(req.body.quadra_id);
    if (!quadraId || !db.prepare('SELECT 1 FROM quadras WHERE id = ?').get(quadraId)) throw bad('Selecione a quadra.');
    const codigo = str(req.body.codigo, 30);
    if (!codigo) throw bad('Informe a identificação do lote.');
    if (db.prepare('SELECT 1 FROM lotes WHERE quadra_id = ? AND codigo = ?').get(quadraId, codigo)) throw conflict('Este lote já existe nesta quadra.');
    const now = nowIso();
    const info = db.prepare('INSERT INTO lotes (quadra_id, codigo, endereco, observacao, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 1, ?, ?)')
      .run(quadraId, codigo, str(req.body.endereco, 300), text(req.body.observacao, 500), now, now);
    audit(db, req, { acao: 'LOTE_CRIADO', entidade: 'lote', entidadeId: Number(info.lastInsertRowid), detalhes: { quadra_id: quadraId, codigo, endereco: str(req.body.endereco, 300) } });
    res.status(201).json(db.prepare('SELECT * FROM lotes WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/lotes/:id', A.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const antes = db.prepare('SELECT * FROM lotes WHERE id = ?').get(id);
    if (!antes) throw notFound();
    const pick = (k, fn) => (req.body[k] !== undefined ? fn(req.body[k]) : antes[k]);
    const depois = {
      quadra_id: pick('quadra_id', int),
      codigo: pick('codigo', (v) => str(v, 30)),
      endereco: pick('endereco', (v) => str(v, 300)),
      observacao: pick('observacao', (v) => text(v, 500)),
      ativo: pick('ativo', (v) => (v ? 1 : 0)),
    };
    if (!depois.codigo) throw bad('Informe a identificação do lote.');
    if (!db.prepare('SELECT 1 FROM quadras WHERE id = ?').get(depois.quadra_id)) throw bad('Quadra inválida.');
    if (db.prepare('SELECT 1 FROM lotes WHERE quadra_id = ? AND codigo = ? AND id <> ?').get(depois.quadra_id, depois.codigo, id)) throw conflict('Este lote já existe nesta quadra.');
    db.prepare('UPDATE lotes SET quadra_id = ?, codigo = ?, endereco = ?, observacao = ?, ativo = ?, atualizado_em = ? WHERE id = ?')
      .run(depois.quadra_id, depois.codigo, depois.endereco, depois.observacao, depois.ativo, nowIso(), id);
    audit(db, req, { acao: 'LOTE_EDITADO', entidade: 'lote', entidadeId: id, detalhes: diff(antes, depois, ['quadra_id', 'codigo', 'endereco', 'observacao', 'ativo']) });
    res.json(db.prepare('SELECT * FROM lotes WHERE id = ?').get(id));
  });

  // Importação da relação oficial. ?simular=1 apenas analisa sem gravar.
  r.post('/quadras-lotes/importar', A.requireAdmin, upload.single('arquivo'), async (req, res) => {
    if (!req.file) throw bad('Envie o arquivo da planilha.');
    const linhas = await lerPlanilha(req.file);
    const simular = req.query.simular === '1';
    const erros = [];
    const resultado = { quadras_novas: 0, lotes_novos: 0, lotes_atualizados: 0, lotes_inalterados: 0 };
    const vistos = new Set();
    const validas = [];
    for (const l of linhas) {
      if (!l.quadra) { erros.push({ linha: l.linha, erro: 'Quadra vazia' }); continue; }
      if (!l.lote) { erros.push({ linha: l.linha, erro: 'Lote vazio' }); continue; }
      const chave = semAcento(l.quadra) + '|' + semAcento(l.lote);
      if (vistos.has(chave)) { erros.push({ linha: l.linha, erro: `Lote ${l.lote} da quadra ${l.quadra} repetido na planilha` }); continue; }
      vistos.add(chave);
      validas.push(l);
    }
    const aplicar = db.transaction(() => {
      const now = nowIso();
      const quadrasCache = new Map(db.prepare('SELECT id, codigo FROM quadras').all().map((q) => [q.codigo.toLowerCase(), q.id]));
      for (const l of validas) {
        let qid = quadrasCache.get(l.quadra.toLowerCase());
        if (!qid) {
          resultado.quadras_novas++;
          if (simular) { qid = -resultado.quadras_novas; } else {
            qid = Number(db.prepare('INSERT INTO quadras (codigo, ativo, criado_em, atualizado_em) VALUES (?, 1, ?, ?)').run(l.quadra, now, now).lastInsertRowid);
          }
          quadrasCache.set(l.quadra.toLowerCase(), qid);
        }
        const existente = qid > 0 ? db.prepare('SELECT * FROM lotes WHERE quadra_id = ? AND codigo = ?').get(qid, l.lote) : null;
        if (!existente) {
          resultado.lotes_novos++;
          if (!simular) db.prepare('INSERT INTO lotes (quadra_id, codigo, endereco, observacao, ativo, criado_em, atualizado_em) VALUES (?, ?, ?, ?, 1, ?, ?)').run(qid, l.lote, l.endereco, l.observacao, now, now);
        } else if ((l.endereco && l.endereco !== existente.endereco) || (l.observacao && l.observacao !== existente.observacao) || !existente.ativo) {
          resultado.lotes_atualizados++;
          if (!simular) {
            db.prepare('UPDATE lotes SET endereco = COALESCE(?, endereco), observacao = COALESCE(?, observacao), ativo = 1, atualizado_em = ? WHERE id = ?')
              .run(l.endereco, l.observacao, now, existente.id);
          }
        } else resultado.lotes_inalterados++;
      }
      if (!simular) {
        audit(db, req, { acao: 'QUADRAS_LOTES_IMPORTADOS', entidade: 'lote', detalhes: { arquivo: req.file.originalname, ...resultado, linhas_com_erro: erros.length } });
      }
    });
    aplicar();
    res.json({ simulacao: simular, total_linhas: linhas.length, ...resultado, erros });
  });

  r.get('/quadras-lotes/modelo.xlsx', A.requireAdmin, async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quadras e lotes');
    ws.columns = [
      { header: 'Quadra', key: 'quadra', width: 12 },
      { header: 'Lote', key: 'lote', width: 12 },
      { header: 'Endereço', key: 'endereco', width: 45 },
      { header: 'Observação', key: 'observacao', width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-quadras-lotes.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  });

  r.get('/quadras-lotes/exportar.xlsx', A.requireAdmin, async (req, res) => {
    const rows = db.prepare('SELECT q.codigo quadra, l.codigo lote, l.endereco, l.observacao, l.ativo FROM lotes l JOIN quadras q ON q.id = l.quadra_id').all();
    rows.sort((a, b) => natural(a.quadra, b.quadra) || natural(a.lote, b.lote));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quadras e lotes');
    ws.columns = [
      { header: 'Quadra', key: 'quadra', width: 12 }, { header: 'Lote', key: 'lote', width: 12 },
      { header: 'Endereço', key: 'endereco', width: 45 }, { header: 'Observação', key: 'observacao', width: 40 },
      { header: 'Situação', key: 'situacao', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r2) => ws.addRow({ ...r2, situacao: r2.ativo ? 'Ativo' : 'Inativo' }));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="quadras-lotes.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  });

  return r;
};

module.exports.lerPlanilha = lerPlanilha;
module.exports.natural = natural;
