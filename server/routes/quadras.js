'use strict';
const express = require('express');
const ExcelJS = require('exceljs');
const { nowIso } = require('../time');
const { bad, notFound, conflict, str, text, int } = require('../util');
const { audit, diff } = require('../audit');
const A = require('../auth');
const { chaveEquivalente } = require('../importacao');

const natural = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true, sensitivity: 'base' });

module.exports = function quadrasRoutes({ db }) {
  const r = express.Router();

  // Impede duplicidade por grafia equivalente ("1" × "01").
  const quadraEquivalente = (codigo, id = 0) => db.prepare('SELECT id, codigo FROM quadras WHERE id <> ?').all(id)
    .find((q) => chaveEquivalente(q.codigo) === chaveEquivalente(codigo));
  const loteEquivalente = (quadraId, codigo, id = 0) => db.prepare('SELECT id, codigo FROM lotes WHERE quadra_id = ? AND id <> ?').all(quadraId, id)
    .find((l) => chaveEquivalente(l.codigo) === chaveEquivalente(codigo));

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
    const eqQ = quadraEquivalente(codigo);
    if (eqQ) throw conflict(`Quadra já cadastrada como "${eqQ.codigo}".`);
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
    const eqQ = quadraEquivalente(depois.codigo, id);
    if (eqQ) throw conflict(`Quadra já cadastrada como "${eqQ.codigo}".`);
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
    const eqL = loteEquivalente(quadraId, codigo);
    if (eqL) throw conflict(`Este lote já existe nesta quadra como "${eqL.codigo}".`);
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
    const eqL = loteEquivalente(depois.quadra_id, depois.codigo, id);
    if (eqL) throw conflict(`Este lote já existe nesta quadra como "${eqL.codigo}".`);
    db.prepare('UPDATE lotes SET quadra_id = ?, codigo = ?, endereco = ?, observacao = ?, ativo = ?, atualizado_em = ? WHERE id = ?')
      .run(depois.quadra_id, depois.codigo, depois.endereco, depois.observacao, depois.ativo, nowIso(), id);
    audit(db, req, { acao: 'LOTE_EDITADO', entidade: 'lote', entidadeId: id, detalhes: diff(antes, depois, ['quadra_id', 'codigo', 'endereco', 'observacao', 'ativo']) });
    res.json(db.prepare('SELECT * FROM lotes WHERE id = ?').get(id));
  });

  r.get('/quadras-lotes/modelo.xlsx', A.requireAdmin, async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Quadras e lotes');
    ws.columns = [
      { header: 'Quadra', key: 'quadra', width: 12, style: { numFmt: '@' } },
      { header: 'Lote', key: 'lote', width: 12, style: { numFmt: '@' } },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getCell('D1').value = 'Preencha Quadra e Lote como texto (ex.: 01, 02) para preservar zeros à esquerda.';
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

module.exports.natural = natural;
