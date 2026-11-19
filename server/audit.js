'use strict';
const { nowIso } = require('./time');

// Registra uma entrada permanente na auditoria.
function audit(db, req, { acao, entidade, entidadeId = null, encomendaId = null, detalhes = null, justificativa = null, usuario = null }) {
  const u = usuario || (req && req.user) || null;
  db.prepare(`INSERT INTO auditoria (ocorrido_em, usuario_id, usuario_nome, acao, entidade, entidade_id, encomenda_id, detalhes, justificativa, ip)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(nowIso(), u ? u.id : null, u ? u.nome : null, acao, entidade, entidadeId, encomendaId,
      detalhes ? JSON.stringify(detalhes) : null, justificativa, req ? req.ip : null);
}

// Calcula diferenças entre dois objetos, apenas nas chaves informadas.
function diff(antes, depois, chaves) {
  const out = {};
  for (const k of chaves) {
    const a = antes[k] ?? null;
    const d = depois[k] ?? null;
    if (String(a) !== String(d)) out[k] = { antes: a, depois: d };
  }
  return out;
}

module.exports = { audit, diff };
