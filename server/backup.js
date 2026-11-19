'use strict';
const fs = require('fs');
const path = require('path');
const { localParts } = require('./time');
const { getConfig } = require('./db');

function backupsDir(dataDir) {
  const d = path.join(dataDir, 'backups');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Cria cópia consistente do banco (VACUUM INTO funciona com o banco em uso).
function criarBackup(db, dataDir, tipo = 'manual') {
  const p = localParts();
  const nome = `encomendas-${p.date}_${p.time.replace(':', '')}${p.seconds}-${tipo}.db`;
  const destino = path.join(backupsDir(dataDir), nome);
  if (fs.existsSync(destino)) fs.unlinkSync(destino);
  db.prepare('VACUUM INTO ?').run(destino);
  return { nome, tamanho: fs.statSync(destino).size };
}

function listarBackups(dataDir) {
  const dir = backupsDir(dataDir);
  return fs.readdirSync(dir)
    .filter((f) => /^encomendas-.*\.db$/.test(f))
    .map((f) => { const st = fs.statSync(path.join(dir, f)); return { nome: f, tamanho: st.size, criado_em: st.mtime.toISOString() }; })
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

function limparAntigos(dataDir, dias) {
  const limite = Date.now() - dias * 86400000;
  for (const b of listarBackups(dataDir)) {
    if (b.nome.endsWith('-automatico.db') && new Date(b.criado_em).getTime() < limite) {
      fs.unlinkSync(path.join(backupsDir(dataDir), b.nome));
    }
  }
}

// Backup automático diário: verifica a cada hora se já existe o backup do dia.
function agendarBackupAutomatico(db, dataDir, log = console) {
  const tick = () => {
    try {
      const cfg = getConfig(db);
      if (!cfg.backup_automatico) return;
      const hoje = localParts().date;
      const jaFeito = listarBackups(dataDir).some((b) => b.nome.startsWith(`encomendas-${hoje}`) && b.nome.endsWith('-automatico.db'));
      if (!jaFeito) {
        const b = criarBackup(db, dataDir, 'automatico');
        log.log(`[backup] backup automático criado: ${b.nome}`);
      }
      limparAntigos(dataDir, Number(cfg.backup_retencao_dias) || 30);
    } catch (e) {
      log.error('[backup] falha no backup automático:', e.message);
    }
  };
  setTimeout(tick, 5000).unref();
  const h = setInterval(tick, 60 * 60 * 1000);
  h.unref();
  return h;
}

module.exports = { criarBackup, listarBackups, agendarBackupAutomatico, backupsDir };
