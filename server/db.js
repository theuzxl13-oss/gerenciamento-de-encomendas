'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { nowIso } = require('./time');

const TRANSPORTADORAS_INICIAIS = [
  'Correios', 'Mercado Livre', 'Shopee', 'Amazon', 'Magazine Luiza',
  'Transportadora', 'Entrega particular', 'Outros',
];

const CONFIG_PADRAO = {
  plantoes: [], // definidos pelo administrador em Configurações
  dias_alerta: 7,
  dias_critico: 15,
  backup_retencao_dias: 30,
  backup_automatico: true,
  minutos_tolerancia_horario: 15,
};

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'encomendas.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

  const now = nowIso();
  const countT = db.prepare('SELECT COUNT(*) n FROM transportadoras').get().n;
  if (countT === 0) {
    const ins = db.prepare('INSERT INTO transportadoras (nome, ordem, criado_em) VALUES (?, ?, ?)');
    db.transaction(() => TRANSPORTADORAS_INICIAIS.forEach((n, i) => ins.run(n, i + 1, now)))();
  }
  const insCfg = db.prepare('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)');
  for (const [k, v] of Object.entries(CONFIG_PADRAO)) insCfg.run(k, JSON.stringify(v));
  return db;
}

function getConfig(db) {
  const cfg = { ...CONFIG_PADRAO };
  for (const r of db.prepare('SELECT chave, valor FROM configuracoes').all()) {
    try { cfg[r.chave] = JSON.parse(r.valor); } catch { /* ignora valor inválido */ }
  }
  return cfg;
}

module.exports = { openDatabase, getConfig, CONFIG_PADRAO, TRANSPORTADORAS_INICIAIS };
