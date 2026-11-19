// Adaptador: expõe um banco SQLite local (better-sqlite3) com a mesma interface do Cloudflare D1.
// Assim o mesmo código de rotas roda no Cloudflare Workers (D1) e no Node.js (servidor próprio e testes).
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const conv = (v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  if (ArrayBuffer.isView(v) && !Buffer.isBuffer(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  return v;
};
const normLinha = (r) => {
  if (!r) return r;
  for (const k of Object.keys(r)) if (Buffer.isBuffer(r[k])) r[k] = [...r[k]];
  return r;
};

class Comando {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Comando(this.db, this.sql, p.map(conv)); }
  _executar() {
    const st = this.db.prepare(this.sql);
    if (st.reader) {
      const results = st.all(...this.params).map(normLinha);
      return { results, success: true, meta: { changes: results.length, last_row_id: 0 } };
    }
    const info = st.run(...this.params);
    return { results: [], success: true, meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) } };
  }
  async first(col) {
    const st = this.db.prepare(this.sql);
    const row = st.reader ? normLinha(st.get(...this.params)) : (st.run(...this.params), null);
    if (row === undefined || row === null) return null;
    return col ? row[col] : row;
  }
  async all() { return this._executar(); }
  async run() { return this._executar(); }
  async raw() { return this.db.prepare(this.sql).raw().all(...this.params); }
}

export class SqliteD1 {
  constructor(arquivo) {
    fs.mkdirSync(path.dirname(arquivo), { recursive: true });
    this.sqlite = new Database(arquivo);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = NORMAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.sqlite.pragma('busy_timeout = 5000');
  }
  prepare(sql) { return new Comando(this.sqlite, sql); }
  // Atômico: tudo ou nada, como o db.batch() do D1.
  async batch(cmds) { return this.sqlite.transaction(() => cmds.map((c) => c._executar()))(); }
  async exec(sql) { this.sqlite.exec(sql); return { count: 1 }; }
  close() { this.sqlite.close(); }
  backup(destino) { this.sqlite.prepare('VACUUM INTO ?').run(destino); }

  // Aplica as migrações SQL pendentes (mesma tabela de controle usada pelo wrangler: d1_migrations).
  migrar(pasta) {
    this.sqlite.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE,
                      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)`);
    const feitas = new Set(this.sqlite.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
    const arquivos = fs.readdirSync(pasta).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    for (const f of arquivos) {
      if (feitas.has(f)) continue;
      const sql = fs.readFileSync(path.join(pasta, f), 'utf8');
      this.sqlite.transaction(() => {
        this.sqlite.exec(sql);
        this.sqlite.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
      })();
    }
  }
}
