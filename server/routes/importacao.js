'use strict';
// Rotas de importação da relação oficial de quadras e lotes (somente administrador).
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { nowIso, localParts } = require('../time');
const { bad, conflict } = require('../util');
const { audit } = require('../audit');
const I = require('../importacao');
const A = require('../auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

module.exports = function importacaoRoutes({ db, dataDir }) {
  const r = express.Router();

  // 1) Prévia: lê e classifica cada registro, sem gravar nada.
  r.post('/quadras-lotes/importar/previa', A.requireAdmin, upload.single('arquivo'), async (req, res) => {
    if (!req.file) throw bad('Envie o arquivo CSV ou Excel.');
    const { linhas, colunas_ignoradas } = await I.lerArquivo(req.file);
    if (!linhas.length) throw bad('O arquivo não possui registros abaixo do cabeçalho.');
    const { resumo, registros, ausentes, conferencia } = I.analisar(db, linhas);
    res.json({
      arquivo: req.file.originalname,
      hash: I.sha256(req.file.buffer),
      colunas_ignoradas,
      resumo,
      conferencia,
      registros,
      lotes_ausentes: ausentes.slice(0, 500).map((l) => l.id),
      situacoes: I.SITUACOES,
    });
  });

  // 2) Importação definitiva: exige o mesmo arquivo conferido na prévia (hash).
  r.post('/quadras-lotes/importar', A.requireAdmin, upload.single('arquivo'), async (req, res) => {
    if (!req.file) throw bad('Envie o arquivo CSV ou Excel.');
    const hash = I.sha256(req.file.buffer);
    if (!req.body.hash_previa) throw bad('Gere a prévia antes de importar.');
    if (req.body.hash_previa !== hash) throw conflict('O arquivo enviado é diferente do arquivo da prévia. Gere a prévia novamente.');
    const { linhas, colunas_ignoradas } = await I.lerArquivo(req.file);
    const desativarAusentes = req.body.desativar_ausentes === '1' || req.body.desativar_ausentes === 'true';

    // Guarda cópia do arquivo importado para rastreabilidade.
    const p = localParts();
    const dir = path.join(dataDir, 'importacoes');
    fs.mkdirSync(dir, { recursive: true });
    const ext = (req.file.originalname || '').toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv';
    const salvo = `${p.date}_${p.time.replace(':', '')}${p.seconds}_${hash.slice(0, 12)}.${ext}`;
    fs.writeFileSync(path.join(dir, salvo), req.file.buffer, { mode: 0o600 });

    const now = nowIso();
    const resultado = db.transaction(() => {
      const { resumo, registros } = I.aplicar(db, { linhas, desativarAusentes, now });
      const problemas = registros.filter((x) => ['DUPLICADO_ARQUIVO', 'DUPLICADO_EQUIVALENTE', 'INVALIDO'].includes(x.situacao))
        .slice(0, 2000).map(({ linha, quadra, lote, situacao, detalhe }) => ({ linha, quadra, lote, situacao, detalhe }));
      const info = db.prepare(`INSERT INTO importacoes (realizada_em, usuario_id, usuario_nome, arquivo_nome, arquivo_sha256, arquivo_salvo, total_linhas,
                                 importados, reativados, ignorados, duplicados, invalidos, quadras_novas, desativados, detalhes)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(now, req.user.id, req.user.nome, req.file.originalname, hash, salvo, resumo.total_linhas, resumo.importados, resumo.reativados,
          resumo.ignorados, resumo.duplicados, resumo.invalidos, resumo.quadras_novas, resumo.desativados,
          JSON.stringify({ resumo, colunas_ignoradas, problemas }));
      const id = Number(info.lastInsertRowid);
      audit(db, req, { acao: 'QUADRAS_LOTES_IMPORTADOS', entidade: 'importacao', entidadeId: id, detalhes: { arquivo: req.file.originalname, sha256: hash, ...resumo, desativar_ausentes: desativarAusentes } });
      return { id, resumo };
    })();
    res.status(201).json({ importacao_id: resultado.id, realizada_em: now, usuario: req.user.nome, ...resultado.resumo });
  });

  r.get('/quadras-lotes/importacoes', A.requireAdmin, (req, res) => {
    res.json(db.prepare(`SELECT id, realizada_em, usuario_nome, arquivo_nome, arquivo_sha256, total_linhas, importados, reativados, ignorados,
                                duplicados, invalidos, quadras_novas, desativados FROM importacoes ORDER BY id DESC LIMIT 100`).all());
  });

  r.get('/quadras-lotes/importacoes/:id', A.requireAdmin, (req, res) => {
    const row = db.prepare('SELECT * FROM importacoes WHERE id = ?').get(Number(req.params.id));
    if (!row) throw bad('Importação não encontrada.');
    res.json({ ...row, detalhes: row.detalhes ? JSON.parse(row.detalhes) : null });
  });

  return r;
};
