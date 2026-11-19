-- Estrutura do banco de dados – Gestão de Encomendas Fazenda da Ilha
-- Instantes em UTC (ISO-8601). Datas locais (America/Sao_Paulo) em colunas *_data / data_local.

CREATE TABLE IF NOT EXISTS usuarios (
  id               INTEGER PRIMARY KEY,
  nome             TEXT NOT NULL,
  login            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email            TEXT UNIQUE COLLATE NOCASE,
  senha_hash       TEXT NOT NULL,
  perfil           TEXT NOT NULL CHECK (perfil IN ('ADMIN','CONTROLADOR')),
  ativo            INTEGER NOT NULL DEFAULT 1,
  trocar_senha     INTEGER NOT NULL DEFAULT 0,
  tentativas_falhas INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate    TEXT,
  ultimo_login_em  TEXT,
  criado_em        TEXT NOT NULL,
  criado_por_id    INTEGER REFERENCES usuarios(id),
  atualizado_em    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessoes (
  id            TEXT PRIMARY KEY,           -- SHA-256 do token
  usuario_id    INTEGER NOT NULL REFERENCES usuarios(id),
  criado_em     TEXT NOT NULL,
  ultimo_uso_em TEXT NOT NULL,
  expira_em     TEXT NOT NULL,
  ip            TEXT,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessoes_usuario ON sessoes(usuario_id);

CREATE TABLE IF NOT EXISTS quadras (
  id            INTEGER PRIMARY KEY,
  codigo        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  descricao     TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lotes (
  id            INTEGER PRIMARY KEY,
  quadra_id     INTEGER NOT NULL REFERENCES quadras(id),
  codigo        TEXT NOT NULL COLLATE NOCASE,
  endereco      TEXT,
  observacao    TEXT,
  ativo         INTEGER NOT NULL DEFAULT 1,
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (quadra_id, codigo)
);

CREATE TABLE IF NOT EXISTS transportadoras (
  id            INTEGER PRIMARY KEY,
  nome          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ativo         INTEGER NOT NULL DEFAULT 1,
  ordem         INTEGER NOT NULL DEFAULT 100,
  criado_em     TEXT NOT NULL,
  criado_por_id INTEGER REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS contadores (
  nome  TEXT PRIMARY KEY,
  valor INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS encomendas (
  id                    INTEGER PRIMARY KEY,
  codigo                TEXT NOT NULL UNIQUE,
  recebido_em           TEXT NOT NULL,
  recebido_data         TEXT NOT NULL,
  lote_id               INTEGER NOT NULL REFERENCES lotes(id),
  descricao             TEXT NOT NULL,
  endereco_complementar TEXT,
  transportadora_id     INTEGER NOT NULL REFERENCES transportadoras(id),
  codigo_rastreio       TEXT,
  recebido_por_id       INTEGER NOT NULL REFERENCES usuarios(id),
  observacoes           TEXT,
  status                TEXT NOT NULL DEFAULT 'PENDENTE'
                        CHECK (status IN ('PENDENTE','RETIRADA','RETIRADA_OUTRO_PLANTAO','CANCELADA')),
  cadastrado_por_id     INTEGER NOT NULL REFERENCES usuarios(id),
  cadastrado_em         TEXT NOT NULL,
  atualizado_em         TEXT NOT NULL,
  atualizado_por_id     INTEGER REFERENCES usuarios(id),
  cancelado_em          TEXT,
  cancelado_por_id      INTEGER REFERENCES usuarios(id),
  motivo_cancelamento   TEXT
);
CREATE INDEX IF NOT EXISTS ix_enc_status ON encomendas(status, recebido_data);
CREATE INDEX IF NOT EXISTS ix_enc_data ON encomendas(recebido_data);
CREATE INDEX IF NOT EXISTS ix_enc_lote ON encomendas(lote_id);

CREATE TABLE IF NOT EXISTS retiradas (
  id                      INTEGER PRIMARY KEY,
  encomenda_id            INTEGER NOT NULL REFERENCES encomendas(id),
  tipo                    TEXT NOT NULL CHECK (tipo IN ('PROPRIA','OUTRO_PLANTAO')),
  retirado_em             TEXT,               -- nulo quando o horário é desconhecido
  data_local              TEXT NOT NULL,
  hora_local              TEXT,
  retirado_por_nome       TEXT NOT NULL,
  documento_retirante     TEXT,
  entregue_por_id         INTEGER REFERENCES usuarios(id),
  entregue_por_nome       TEXT,
  entregador_desconhecido INTEGER NOT NULL DEFAULT 0,
  plantao                 TEXT,
  observacoes             TEXT,
  justificativa_horario   TEXT,
  lancado_por_id          INTEGER NOT NULL REFERENCES usuarios(id),
  lancado_em              TEXT NOT NULL,
  estornada_em            TEXT,
  estornada_por_id        INTEGER REFERENCES usuarios(id),
  motivo_estorno          TEXT
);
-- Impede baixa duplicada: no máximo uma retirada ativa por encomenda.
CREATE UNIQUE INDEX IF NOT EXISTS ux_retirada_ativa ON retiradas(encomenda_id) WHERE estornada_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_ret_data ON retiradas(data_local);

CREATE TABLE IF NOT EXISTS anexos (
  id              INTEGER PRIMARY KEY,
  encomenda_id    INTEGER NOT NULL REFERENCES encomendas(id),
  retirada_id     INTEGER REFERENCES retiradas(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('ASSINATURA','FOTO','DOCUMENTO')),
  nome_original   TEXT,
  mime            TEXT NOT NULL,
  tamanho         INTEGER NOT NULL,
  arquivo         TEXT NOT NULL UNIQUE,
  sha256          TEXT NOT NULL,
  descricao       TEXT,
  enviado_por_id  INTEGER NOT NULL REFERENCES usuarios(id),
  enviado_em      TEXT NOT NULL,
  removido_em     TEXT,
  removido_por_id INTEGER REFERENCES usuarios(id),
  motivo_remocao  TEXT
);
CREATE INDEX IF NOT EXISTS ix_anexos_enc ON anexos(encomenda_id);

CREATE TABLE IF NOT EXISTS auditoria (
  id            INTEGER PRIMARY KEY,
  ocorrido_em   TEXT NOT NULL,
  usuario_id    INTEGER REFERENCES usuarios(id),
  usuario_nome  TEXT,
  acao          TEXT NOT NULL,
  entidade      TEXT NOT NULL,
  entidade_id   INTEGER,
  encomenda_id  INTEGER,
  detalhes      TEXT,
  justificativa TEXT,
  ip            TEXT
);
CREATE INDEX IF NOT EXISTS ix_aud_data ON auditoria(ocorrido_em);
CREATE INDEX IF NOT EXISTS ix_aud_enc ON auditoria(encomenda_id);

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Proteções: registros não podem ser apagados (somente cancelamento/estorno lógico auditado).
CREATE TRIGGER IF NOT EXISTS tg_no_delete_encomendas BEFORE DELETE ON encomendas
BEGIN SELECT RAISE(ABORT, 'Encomendas não podem ser apagadas'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_delete_retiradas BEFORE DELETE ON retiradas
BEGIN SELECT RAISE(ABORT, 'Retiradas não podem ser apagadas'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_delete_anexos BEFORE DELETE ON anexos
BEGIN SELECT RAISE(ABORT, 'Anexos não podem ser apagados'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_delete_usuarios BEFORE DELETE ON usuarios
BEGIN SELECT RAISE(ABORT, 'Usuários não podem ser apagados; desative-os'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_delete_auditoria BEFORE DELETE ON auditoria
BEGIN SELECT RAISE(ABORT, 'Auditoria é permanente'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_update_auditoria BEFORE UPDATE ON auditoria
BEGIN SELECT RAISE(ABORT, 'Auditoria é permanente'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_delete_lotes_usados BEFORE DELETE ON lotes
WHEN EXISTS (SELECT 1 FROM encomendas WHERE lote_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'Lote possui encomendas; desative-o'); END;

-- Histórico de importações da relação oficial de quadras e lotes (permanente).
CREATE TABLE IF NOT EXISTS importacoes (
  id               INTEGER PRIMARY KEY,
  realizada_em     TEXT NOT NULL,
  usuario_id       INTEGER NOT NULL REFERENCES usuarios(id),
  usuario_nome     TEXT NOT NULL,
  arquivo_nome     TEXT,
  arquivo_sha256   TEXT NOT NULL,
  arquivo_salvo    TEXT,
  total_linhas     INTEGER NOT NULL,
  importados       INTEGER NOT NULL,
  reativados       INTEGER NOT NULL,
  ignorados        INTEGER NOT NULL,
  duplicados       INTEGER NOT NULL,
  invalidos        INTEGER NOT NULL,
  quadras_novas    INTEGER NOT NULL,
  desativados      INTEGER NOT NULL DEFAULT 0,
  detalhes         TEXT
);
CREATE TRIGGER IF NOT EXISTS tg_no_delete_importacoes BEFORE DELETE ON importacoes
BEGIN SELECT RAISE(ABORT, 'Histórico de importações é permanente'); END;
CREATE TRIGGER IF NOT EXISTS tg_no_update_importacoes BEFORE UPDATE ON importacoes
BEGIN SELECT RAISE(ABORT, 'Histórico de importações é permanente'); END;
