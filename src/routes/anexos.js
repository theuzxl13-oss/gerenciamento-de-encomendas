import { nowIso } from '../lib/time.js';
import { bad, notFound, text, str, int } from '../lib/util.js';
import { auditoria } from '../lib/auditoria.js';
import { sha256Hex, tokenAleatorio } from '../lib/seguranca.js';
import { requireAuth, requireAdmin, corpo } from '../app.js';

const TIPOS = ['ASSINATURA', 'FOTO', 'DOCUMENTO'];
const ascii = (u, ini, fim) => String.fromCharCode(...u.subarray(ini, fim));

// Tipo identificado pela assinatura binária do arquivo (não pela extensão).
export function detectarMime(u) {
  if (u.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => u[i] === b)) return { mime: 'image/png', ext: 'png' };
  if (u.length >= 3 && u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (u.length >= 12 && ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (u.length >= 5 && ascii(u, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  return null;
}

export default function rotasAnexos(app) {
  app.get('/anexos/limite', requireAuth, (c) => c.json({ limite_bytes: c.get('arq').limiteBytes, armazenamento: c.get('arq').tipo }));

  app.post('/encomendas/:id/anexos', requireAuth, async (c) => {
    const db = c.get('db');
    const arq = c.get('arq');
    const encId = Number(c.req.param('id'));
    if (!await db.prepare('SELECT id FROM encomendas WHERE id = ?').bind(encId).first()) throw notFound('Encomenda não encontrada.');
    const form = await c.req.parseBody();
    const f = form.arquivo;
    if (!f || typeof f !== 'object' || typeof f.arrayBuffer !== 'function') throw bad('Envie o arquivo.');
    const tipo = String(form.tipo || '').toUpperCase();
    if (!TIPOS.includes(tipo)) throw bad('Tipo de comprovante inválido.');
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.byteLength > arq.limiteBytes) throw bad(`Arquivo muito grande (máximo ${Math.floor(arq.limiteBytes / 1024)} KB).`);
    const det = detectarMime(bytes);
    if (!det) throw bad('Formato não aceito. Envie imagem (PNG, JPG, WEBP) ou PDF.');
    let retiradaId = int(form.retirada_id);
    if (retiradaId && !await db.prepare('SELECT 1 x FROM retiradas WHERE id = ? AND encomenda_id = ?').bind(retiradaId, encId).first()) retiradaId = null;
    const agora = new Date();
    const chave = `comprovantes/${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, '0')}/${tokenAleatorio(16)}.${det.ext}`;
    const sha = await sha256Hex(bytes);
    await arq.put(chave, bytes, det.mime);
    const nome = str(f.name, 200);
    await db.batch([
      db.prepare(`INSERT INTO anexos (encomenda_id, retirada_id, tipo, nome_original, mime, tamanho, arquivo, sha256, descricao, enviado_por_id, enviado_em)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(encId, retiradaId, tipo, nome, det.mime, bytes.byteLength, chave, sha, str(form.descricao, 200), c.get('user').id, nowIso()),
      auditoria(db, c, { acao: 'ANEXO_ADICIONADO', entidade: 'anexo', entidadeIdSql: ['(SELECT id FROM anexos WHERE arquivo = ?)', [chave]], encomendaId: encId,
        detalhes: { tipo, nome, tamanho: bytes.byteLength, sha256: sha } }),
    ]);
    const { id } = await db.prepare('SELECT id FROM anexos WHERE arquivo = ?').bind(chave).first();
    return c.json({ id, tipo, mime: det.mime }, 201);
  });

  app.get('/anexos/:id/arquivo', requireAuth, async (c) => {
    const a = await c.get('db').prepare('SELECT * FROM anexos WHERE id = ?').bind(Number(c.req.param('id'))).first();
    if (!a) throw notFound();
    if (a.removido_em && c.get('user').perfil !== 'ADMIN') throw notFound();
    const o = await c.get('arq').get(a.arquivo);
    if (!o) throw notFound('Arquivo não encontrado no armazenamento.');
    const nome = (a.nome_original || `anexo-${a.id}`).replace(/[^\w.\- ]/g, '_');
    return new Response(o.corpo, {
      headers: {
        'Content-Type': a.mime,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        'Content-Disposition': `${c.req.query('download') ? 'attachment' : 'inline'}; filename="${nome}"`,
      },
    });
  });

  // Remoção lógica (admin, justificada). O arquivo é mantido para fins de auditoria.
  app.post('/anexos/:id/remover', requireAdmin, async (c) => {
    const db = c.get('db');
    const id = Number(c.req.param('id'));
    const motivo = text((await corpo(c)).motivo, 1000);
    if (!motivo) throw bad('Informe o motivo da remoção.');
    const a = await db.prepare('SELECT * FROM anexos WHERE id = ? AND removido_em IS NULL').bind(id).first();
    if (!a) throw notFound();
    await db.batch([
      db.prepare('UPDATE anexos SET removido_em = ?, removido_por_id = ?, motivo_remocao = ? WHERE id = ?').bind(nowIso(), c.get('user').id, motivo, id),
      auditoria(db, c, { acao: 'ANEXO_REMOVIDO', entidade: 'anexo', entidadeId: id, encomendaId: a.encomenda_id, justificativa: motivo, detalhes: { tipo: a.tipo, nome: a.nome_original } }),
    ]);
    return c.json({ ok: true });
  });
}
