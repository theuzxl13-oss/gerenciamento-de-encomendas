'use strict';
// Dashboard, transportadoras, configurações, auditoria e backups.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { nowIso, todayLocal, addDays, localToUtc, isDate } = require('../time');
const { bad, notFound, conflict, str, int, likeEscape } = require('../util');
const { audit, diff } = require('../audit');
const { getConfig, CONFIG_PADRAO } = require('../db');
const { buscar } = require('../consulta');
const B = require('../backup');
const A = require('../auth');

module.exports = function geralRoutes({ db, dataDir }) {
  const r = express.Router();

  // ---------- Dashboard ----------
  r.get('/dashboard', A.requireAuth, (req, res) => {
    const hoje = todayLocal();
    const cfg = getConfig(db);
    const ini = localToUtc(hoje, '00:00').toISOString();
    const fim = localToUtc(addDays(hoje, 1), '00:00').toISOString();
    const um = (sql, ...p) => db.prepare(sql).get(...p).n;
    const ind = {
      total_recebido: um("SELECT COUNT(*) n FROM encomendas WHERE status <> 'CANCELADA'"),
      pendentes: um("SELECT COUNT(*) n FROM encomendas WHERE status = 'PENDENTE'"),
      recebidas_hoje: um("SELECT COUNT(*) n FROM encomendas WHERE recebido_data = ? AND status <> 'CANCELADA'", hoje),
      retiradas_hoje: um("SELECT COUNT(*) n FROM retiradas WHERE estornada_em IS NULL AND tipo = 'PROPRIA' AND data_local = ?", hoje),
      outro_plantao_hoje: um("SELECT COUNT(*) n FROM retiradas WHERE estornada_em IS NULL AND tipo = 'OUTRO_PLANTAO' AND lancado_em >= ? AND lancado_em < ?", ini, fim),
      outro_plantao_total: um("SELECT COUNT(*) n FROM retiradas WHERE estornada_em IS NULL AND tipo = 'OUTRO_PLANTAO'"),
      pendentes_alerta: um("SELECT COUNT(*) n FROM encomendas WHERE status = 'PENDENTE' AND recebido_data <= ?", addDays(hoje, -cfg.dias_alerta)),
      pendentes_criticas: um("SELECT COUNT(*) n FROM encomendas WHERE status = 'PENDENTE' AND recebido_data <= ?", addDays(hoje, -cfg.dias_critico)),
      lotes_cadastrados: um('SELECT COUNT(*) n FROM lotes WHERE ativo = 1'),
    };
    const recentes = buscar(db, { por_pagina: 10, incluir_canceladas: '1' }).itens;
    const antigas = buscar(db, { status: 'PENDENTE', ordem: 'recebido_asc', por_pagina: 5 }).itens;
    res.json({ hoje, indicadores: ind, recentes, antigas, config: { dias_alerta: cfg.dias_alerta, dias_critico: cfg.dias_critico } });
  });

  // ---------- Transportadoras ----------
  r.get('/transportadoras', A.requireAuth, (req, res) => {
    res.json(db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM encomendas e WHERE e.transportadora_id = t.id) uso
                         FROM transportadoras t ${req.query.todas === '1' ? '' : 'WHERE ativo = 1'} ORDER BY ordem, nome`).all());
  });
  r.post('/transportadoras', A.requireAuth, (req, res) => {
    const nome = str(req.body.nome, 80);
    if (!nome) throw bad('Informe o nome da transportadora.');
    const ex = db.prepare('SELECT * FROM transportadoras WHERE nome = ?').get(nome);
    if (ex) {
      if (ex.ativo) throw conflict('Transportadora já cadastrada.');
      db.prepare('UPDATE transportadoras SET ativo = 1 WHERE id = ?').run(ex.id);
      audit(db, req, { acao: 'TRANSPORTADORA_REATIVADA', entidade: 'transportadora', entidadeId: ex.id, detalhes: { nome } });
      return res.status(201).json({ ...ex, ativo: 1 });
    }
    const info = db.prepare('INSERT INTO transportadoras (nome, ativo, ordem, criado_em, criado_por_id) VALUES (?, 1, 100, ?, ?)').run(nome, nowIso(), req.user.id);
    audit(db, req, { acao: 'TRANSPORTADORA_CRIADA', entidade: 'transportadora', entidadeId: Number(info.lastInsertRowid), detalhes: { nome } });
    res.status(201).json(db.prepare('SELECT * FROM transportadoras WHERE id = ?').get(info.lastInsertRowid));
  });
  r.put('/transportadoras/:id', A.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const antes = db.prepare('SELECT * FROM transportadoras WHERE id = ?').get(id);
    if (!antes) throw notFound();
    const depois = {
      nome: req.body.nome !== undefined ? str(req.body.nome, 80) : antes.nome,
      ativo: req.body.ativo !== undefined ? (req.body.ativo ? 1 : 0) : antes.ativo,
      ordem: req.body.ordem !== undefined ? (int(req.body.ordem) ?? antes.ordem) : antes.ordem,
    };
    if (!depois.nome) throw bad('Informe o nome.');
    if (db.prepare('SELECT 1 FROM transportadoras WHERE nome = ? AND id <> ?').get(depois.nome, id)) throw conflict('Nome já utilizado.');
    db.prepare('UPDATE transportadoras SET nome = ?, ativo = ?, ordem = ? WHERE id = ?').run(depois.nome, depois.ativo, depois.ordem, id);
    audit(db, req, { acao: 'TRANSPORTADORA_EDITADA', entidade: 'transportadora', entidadeId: id, detalhes: diff(antes, depois, ['nome', 'ativo', 'ordem']) });
    res.json(db.prepare('SELECT * FROM transportadoras WHERE id = ?').get(id));
  });

  // ---------- Configurações ----------
  r.get('/configuracoes', A.requireAuth, (req, res) => res.json(getConfig(db)));
  r.put('/configuracoes', A.requireAdmin, (req, res) => {
    const antes = getConfig(db);
    const b = req.body;
    const novo = { ...antes };
    if (b.plantoes !== undefined) {
      if (!Array.isArray(b.plantoes)) throw bad('Plantões inválidos.');
      novo.plantoes = [...new Set(b.plantoes.map((p) => str(p, 60)).filter(Boolean))];
    }
    for (const k of ['dias_alerta', 'dias_critico', 'backup_retencao_dias', 'minutos_tolerancia_horario']) {
      if (b[k] !== undefined) {
        const n = int(b[k]);
        if (n === null || n < 1 || n > 3650) throw bad(`Valor inválido para ${k}.`);
        novo[k] = n;
      }
    }
    if (b.backup_automatico !== undefined) novo.backup_automatico = !!b.backup_automatico;
    if (novo.dias_critico < novo.dias_alerta) throw bad('Os dias para "crítico" devem ser maiores ou iguais aos de "alerta".');
    const up = db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
    db.transaction(() => {
      for (const k of Object.keys(CONFIG_PADRAO)) up.run(k, JSON.stringify(novo[k]));
      const mud = {};
      for (const k of Object.keys(CONFIG_PADRAO)) if (JSON.stringify(antes[k]) !== JSON.stringify(novo[k])) mud[k] = { antes: antes[k], depois: novo[k] };
      if (Object.keys(mud).length) audit(db, req, { acao: 'CONFIGURACOES_ALTERADAS', entidade: 'configuracao', detalhes: mud });
    })();
    res.json(getConfig(db));
  });

  // ---------- Auditoria (admin) ----------
  r.get('/auditoria', A.requireAdmin, (req, res) => {
    const where = [];
    const p = [];
    const f = req.query;
    if (isDate(f.data_ini)) { where.push('a.ocorrido_em >= ?'); p.push(localToUtc(f.data_ini, '00:00').toISOString()); }
    if (isDate(f.data_fim)) { where.push('a.ocorrido_em < ?'); p.push(localToUtc(addDays(f.data_fim, 1), '00:00').toISOString()); }
    if (int(f.usuario_id)) { where.push('a.usuario_id = ?'); p.push(int(f.usuario_id)); }
    if (f.acao) { where.push('a.acao = ?'); p.push(String(f.acao)); }
    if (f.entidade) { where.push('a.entidade = ?'); p.push(String(f.entidade)); }
    if (int(f.encomenda_id)) { where.push('a.encomenda_id = ?'); p.push(int(f.encomenda_id)); }
    if (f.q) { where.push("(a.detalhes LIKE ? ESCAPE '\\' OR a.justificativa LIKE ? ESCAPE '\\' OR e.codigo LIKE ? ESCAPE '\\')"); const v = likeEscape(f.q); p.push(v, v, v); }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const por = Math.min(int(f.por_pagina) || 50, 200);
    const pagina = Math.max(int(f.pagina) || 1, 1);
    const total = db.prepare(`SELECT COUNT(*) n FROM auditoria a LEFT JOIN encomendas e ON e.id = a.encomenda_id ${w}`).get(...p).n;
    const itens = db.prepare(`SELECT a.*, e.codigo encomenda_codigo FROM auditoria a LEFT JOIN encomendas e ON e.id = a.encomenda_id ${w}
                              ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...p, por, (pagina - 1) * por)
      .map((a) => ({ ...a, detalhes: a.detalhes ? JSON.parse(a.detalhes) : null }));
    const acoes = db.prepare('SELECT DISTINCT acao FROM auditoria ORDER BY acao').all().map((x) => x.acao);
    res.json({ total, pagina, por_pagina: por, itens, acoes });
  });

  // ---------- Backups (admin) ----------
  r.get('/backups', A.requireAdmin, (req, res) => res.json(B.listarBackups(dataDir)));
  r.post('/backups', A.requireAdmin, (req, res) => {
    const b = B.criarBackup(db, dataDir, 'manual');
    audit(db, req, { acao: 'BACKUP_CRIADO', entidade: 'backup', detalhes: b });
    res.status(201).json(b);
  });
  r.get('/backups/:nome', A.requireAdmin, (req, res) => {
    const nome = path.basename(req.params.nome);
    const full = path.join(B.backupsDir(dataDir), nome);
    if (!/^encomendas-.*\.db$/.test(nome) || !fs.existsSync(full)) throw notFound();
    audit(db, req, { acao: 'BACKUP_BAIXADO', entidade: 'backup', detalhes: { nome } });
    res.download(full, nome);
  });

  return r;
};
