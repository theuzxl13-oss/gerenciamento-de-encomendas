'use strict';
process.env.TZ = 'America/Sao_Paulo';
const path = require('path');
const { createApp } = require('./app');
const { agendarBackupAutomatico } = require('./backup');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const SECURE = process.env.COOKIE_SECURE === '1';
const TRUST_PROXY = process.env.TRUST_PROXY || false;

const app = createApp({ dataDir: DATA_DIR, secureCookies: SECURE, trustProxy: TRUST_PROXY === '1' ? 1 : TRUST_PROXY });
agendarBackupAutomatico(app.locals.db, DATA_DIR);

const server = app.listen(PORT, HOST, () => {
  console.log(`Gestão de Encomendas – Fazenda da Ilha rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Dados em: ${DATA_DIR}`);
});

function encerrar() {
  server.close(() => {
    try { app.locals.db.close(); } catch { /* já fechado */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
