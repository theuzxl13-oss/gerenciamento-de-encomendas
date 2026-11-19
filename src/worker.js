// Ponto de entrada no Cloudflare Workers.
// Requisições /api/* chegam aqui (run_worker_first); o restante é servido como arquivo estático (pasta public/).
import { criarApp } from './app.js';

const app = criarApp();

export default {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
};
