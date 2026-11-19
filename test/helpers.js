'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server/app');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fi-enc-test-'));
}

async function iniciar(dataDir = tmpDir()) {
  const app = createApp({ dataDir, log: { log() {}, error: console.error } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base, dataDir, app, db: app.locals.db,
    async parar() { await new Promise((r) => server.close(r)); app.locals.db.close(); },
  };
}

// Cliente HTTP com cookie de sessão
function cliente(base) {
  let cookie = '';
  async function req(method, url, body, { raw = false, headers = {} } = {}) {
    const h = { 'X-Requested-With': 'FazendaDaIlha', ...headers };
    if (cookie) h.Cookie = cookie;
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    if (raw) return res;
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  return {
    get: (u, o) => req('GET', u, undefined, o),
    post: (u, b, o) => req('POST', u, b, o),
    put: (u, b, o) => req('PUT', u, b, o),
    req,
    get cookie() { return cookie; },
  };
}

module.exports = { iniciar, cliente, tmpDir };
