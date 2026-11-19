'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { openDatabase } = require('./db');
const { HttpError } = require('./util');
const A = require('./auth');

function createApp({ dataDir, secureCookies = false, trustProxy = false, log = console } = {}) {
  process.env.TZ = 'America/Sao_Paulo';
  const db = openDatabase(dataDir);
  const ctx = { db, dataDir, secureCookies };
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    hsts: secureCookies,
    crossOriginEmbedderPolicy: false,
  }));

  const api = express.Router();
  api.use(express.json({ limit: '1mb' }));
  api.use(A.csrfGuard);
  api.use(A.sessionMiddleware(db));
  api.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  api.get('/saude', (req, res) => res.json({ ok: true, hora: new Date().toISOString() }));
  api.use(require('./routes/auth')(ctx));
  api.use(require('./routes/usuarios')(ctx));
  api.use(require('./routes/quadras')(ctx));
  api.use(require('./routes/geral')(ctx));
  api.use(require('./routes/anexos')(ctx));
  api.use(require('./routes/relatorios')(ctx));
  api.use(require('./routes/encomendas')(ctx));
  api.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ erro: err.message, ...(err.extra || {}) });
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ erro: 'Arquivo muito grande (máximo 10 MB).' });
    if (err && err.name === 'MulterError') return res.status(400).json({ erro: 'Envio de arquivo inválido.' });
    log.error('[erro]', req.method, req.originalUrl, err);
    res.status(500).json({ erro: 'Erro interno. A operação não foi concluída.' });
  });
  app.use('/api', api);

  const pub = path.join(__dirname, '..', 'public');
  app.use(express.static(pub, { index: 'index.html', maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
