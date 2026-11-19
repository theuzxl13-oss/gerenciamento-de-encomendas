'use strict';
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { nowIso } = require('../time');
const { bad, notFound, text, str, int } = require('../util');
const { audit } = require('../audit');
const A = require('../auth');

const TIPOS = ['ASSINATURA', 'FOTO', 'DOCUMENTO'];
// Tipos aceitos, identificados pela assinatura binária do arquivo (não pela extensão).
function detectarMime(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

module.exports = function anexosRoutes({ db, dataDir }) {
  const r = express.Router();
  r.use(A.requireAuth);
  const uploadsDir = path.join(dataDir, 'uploads');
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  r.post('/encomendas/:id/anexos', upload.single('arquivo'), (req, res) => {
    const encId = Number(req.params.id);
    const enc = db.prepare('SELECT id, codigo FROM encomendas WHERE id = ?').get(encId);
    if (!enc) throw notFound('Encomenda não encontrada.');
    if (!req.file) throw bad('Envie o arquivo.');
    const tipo = String(req.body.tipo || '').toUpperCase();
    if (!TIPOS.includes(tipo)) throw bad('Tipo de comprovante inválido.');
    const det = detectarMime(req.file.buffer);
    if (!det) throw bad('Formato não aceito. Envie imagem (PNG, JPG, WEBP) ou PDF.');
    let retiradaId = int(req.body.retirada_id);
    if (retiradaId && !db.prepare('SELECT 1 FROM retiradas WHERE id = ? AND encomenda_id = ?').get(retiradaId, encId)) retiradaId = null;

    const agora = new Date();
    const sub = path.join(String(agora.getUTCFullYear()), String(agora.getUTCMonth() + 1).padStart(2, '0'));
    fs.mkdirSync(path.join(uploadsDir, sub), { recursive: true });
    const nomeArq = path.join(sub, `${crypto.randomBytes(16).toString('hex')}.${det.ext}`);
    fs.writeFileSync(path.join(uploadsDir, nomeArq), req.file.buffer, { mode: 0o600 });
    const sha = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
    const info = db.prepare(`INSERT INTO anexos (encomenda_id, retirada_id, tipo, nome_original, mime, tamanho, arquivo, sha256, descricao, enviado_por_id, enviado_em)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(encId, retiradaId, tipo, str(req.file.originalname, 200), det.mime, req.file.size, nomeArq, sha, str(req.body.descricao, 200), req.user.id, nowIso());
    const id = Number(info.lastInsertRowid);
    audit(db, req, { acao: 'ANEXO_ADICIONADO', entidade: 'anexo', entidadeId: id, encomendaId: encId, detalhes: { tipo, nome: req.file.originalname, tamanho: req.file.size, sha256: sha } });
    res.status(201).json({ id, tipo, mime: det.mime });
  });

  r.get('/anexos/:id/arquivo', (req, res) => {
    const a = db.prepare('SELECT * FROM anexos WHERE id = ?').get(Number(req.params.id));
    if (!a) throw notFound();
    if (a.removido_em && req.user.perfil !== 'ADMIN') throw notFound();
    const full = path.join(uploadsDir, a.arquivo);
    if (!full.startsWith(uploadsDir + path.sep) || !fs.existsSync(full)) throw notFound('Arquivo não encontrado no armazenamento.');
    res.setHeader('Content-Type', a.mime);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const nome = (a.nome_original || `anexo-${a.id}`).replace(/[^\w.\- ]/g, '_');
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${nome}"`);
    fs.createReadStream(full).pipe(res);
  });

  // Remoção lógica (admin, justificada). O arquivo é mantido para fins de auditoria.
  r.post('/anexos/:id/remover', A.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const motivo = text(req.body.motivo, 1000);
    if (!motivo) throw bad('Informe o motivo da remoção.');
    const a = db.prepare('SELECT * FROM anexos WHERE id = ? AND removido_em IS NULL').get(id);
    if (!a) throw notFound();
    db.prepare('UPDATE anexos SET removido_em = ?, removido_por_id = ?, motivo_remocao = ? WHERE id = ?').run(nowIso(), req.user.id, motivo, id);
    audit(db, req, { acao: 'ANEXO_REMOVIDO', entidade: 'anexo', entidadeId: id, encomendaId: a.encomenda_id, justificativa: motivo, detalhes: { tipo: a.tipo, nome: a.nome_original } });
    res.json({ ok: true });
  });

  return r;
};
