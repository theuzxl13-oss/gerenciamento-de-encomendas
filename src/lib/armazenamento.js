// Armazenamento de comprovantes e arquivos importados.
// - D1 (padrão no Cloudflare, gratuito): conteúdo na tabela "arquivos" (limite ~1,8 MB por arquivo)
// - R2 (opcional no Cloudflare): bucket ligado como ARQUIVOS no wrangler.toml
// - Disco (Node.js): pasta data/uploads
import { nowIso } from './time.js';

export function armazenamentoD1(db) {
  return {
    tipo: 'd1',
    limiteBytes: 1800 * 1024,
    async put(chave, bytes, mime) {
      await db.prepare('INSERT INTO arquivos (chave, mime, tamanho, conteudo, criado_em) VALUES (?, ?, ?, ?, ?)')
        .bind(chave, mime, bytes.byteLength, bytes, nowIso()).run();
    },
    async get(chave) {
      const r = await db.prepare('SELECT mime, conteudo FROM arquivos WHERE chave = ?').bind(chave).first();
      if (!r) return null;
      return { corpo: new Uint8Array(r.conteudo), mime: r.mime };
    },
  };
}

export function armazenamentoR2(bucket) {
  return {
    tipo: 'r2',
    limiteBytes: 10 * 1024 * 1024,
    async put(chave, bytes, mime) { await bucket.put(chave, bytes, { httpMetadata: { contentType: mime } }); },
    async get(chave) {
      const o = await bucket.get(chave);
      if (!o) return null;
      return { corpo: o.body, mime: (o.httpMetadata && o.httpMetadata.contentType) || 'application/octet-stream' };
    },
  };
}
