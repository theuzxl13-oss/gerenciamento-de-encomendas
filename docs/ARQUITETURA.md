# Gestão de Encomendas – Fazenda da Ilha
## Planejamento técnico, arquitetura e estrutura do banco de dados

Este documento foi escrito **antes** da implementação (item 17 do escopo) e é mantido
atualizado junto com o código.

---

## 1. Objetivo

Livro digital da portaria: acompanhar cada encomenda desde o recebimento até a retirada,
com histórico permanente, auditável e consultável de qualquer dispositivo da rede.

## 2. Decisões de arquitetura

| Camada | Escolha | Motivo |
|---|---|---|
| Servidor | **Node.js 22 + Express 5** | Simples de hospedar (um único processo), sem build, ampla documentação. |
| Banco | **SQLite (better-sqlite3) em modo WAL** | Banco relacional transacional, persistente em disco, sem servidor separado para administrar. Suporta com folga o volume de uma portaria (milhares de encomendas/ano). Todas as operações são feitas no servidor — qualquer computador/celular da rede vê os mesmos dados. O SQL é padrão e pode migrar para PostgreSQL se um dia for necessário. |
| Front-end | **SPA em JavaScript puro (ES modules) + CSS próprio** | Sem etapa de build, carregamento rápido no computador da portaria, responsivo para celular. |
| Autenticação | Sessão no servidor (token aleatório de 256 bits em cookie `HttpOnly`, `SameSite=Strict`; apenas o hash SHA-256 fica no banco) | Permite encerrar sessões, expira por inatividade, não expõe token a JavaScript. |
| Senhas | `scrypt` (módulo `crypto` nativo) com salt individual | Algoritmo resistente a força bruta, sem dependências nativas. |
| Proteções | Bloqueio após 5 tentativas de login, cabeçalho anti-CSRF obrigatório em operações de escrita, Helmet (cabeçalhos de segurança), validação no servidor | |
| Comprovantes | Arquivos em `data/uploads/` com nome aleatório, servidos **somente** por rota autenticada; hash SHA-256 registrado | Assinatura (desenhada na tela), fotos e documentos. |
| Relatórios | PDF (pdfkit) e Excel (exceljs) gerados no servidor | |
| Importação | Planilha `.xlsx` ou `.csv` de quadras e lotes, com simulação antes de gravar | Relação oficial ainda será fornecida — **nenhum endereço é inventado**. |
| Backup | Cópia consistente do banco (`VACUUM INTO`) automática diária + manual pelo administrador, com retenção configurável | Recomendado copiar a pasta `data/` para outro local/nuvem. |
| Fuso horário | **America/Sao_Paulo** em todas as datas exibidas, filtros e "hoje" | Instantes gravados em UTC (ISO-8601) + data local gravada separadamente para filtros. |

### Diagrama

```
 Navegador (portaria / celular / administração)
        │  HTTPS (proxy reverso recomendado)
        ▼
 Express ── /api/*  (JSON, autenticação, permissões, auditoria)
   │  └── /         (arquivos estáticos da SPA)
   ├── better-sqlite3 ──► data/encomendas.db   (WAL, triggers de proteção)
   ├── data/uploads/   (comprovantes — acesso apenas autenticado)
   └── data/backups/   (backups automáticos e manuais)
```

## 3. Perfis e permissões

| Ação | Administrador | Controlador de acesso |
|---|:-:|:-:|
| Dashboard, nova encomenda, pendentes, histórico, ficha | ✔ | ✔ |
| Registrar retirada / retirada por outro plantão | ✔ | ✔ |
| Anexar comprovantes (assinatura, foto, documento) e visualizá-los | ✔ | ✔ |
| Incluir nova transportadora | ✔ | ✔ |
| Editar dados de encomenda pendente (com justificativa) | ✔ qualquer | ✔ somente as que cadastrou, nas primeiras 24 h |
| Corrigir retirada, estornar baixa, cancelar encomenda (com justificativa) | ✔ | ✘ |
| Relatórios e exportação PDF/Excel | ✔ | ✔ |
| Quadras e lotes (cadastro / importação) | ✔ | consulta |
| Usuários, configurações, backup, auditoria geral | ✔ | ✘ |

## 4. Regras de negócio (item 16)

1. Toda encomenda nasce `PENDENTE` (aguardando retirada) com identificador único `FI-AAAA-NNNNN`.
2. A baixa muda o status na **mesma transação** em que grava a retirada; a atualização só
   ocorre se a encomenda ainda está `PENDENTE` **e** um índice único parcial impede duas
   retiradas ativas para a mesma encomenda → **baixa duplicada é impossível**, mesmo com
   dois computadores clicando ao mesmo tempo.
3. Retirada própria → status `RETIRADA`; retirada lançada por outro plantão → status
   `RETIRADA_OUTRO_PLANTAO` (exibido como **RETIRADA REALIZADA POR OUTRO PLANTÃO**).
4. Na retirada por outro plantão, *quem lançou* (`lancado_por_id`, sempre o usuário logado)
   é gravado separadamente de *quem entregou* (`entregue_por_id`/`entregue_por_nome`,
   que pode ficar "não sabe"). O sistema **nunca** preenche o entregador com o usuário logado
   nesse fluxo. Observação e plantão são obrigatórios.
5. Data/horário da retirada própria são preenchidos automaticamente; se o horário informado
   difere do horário do servidor em mais de 15 minutos, uma justificativa é obrigatória.
6. Nada é apagado: triggers no banco abortam `DELETE` em encomendas, retiradas, anexos,
   usuários e auditoria, e `UPDATE` na auditoria. Cancelamentos, estornos e remoção de
   anexos são lógicos, exigem justificativa e geram auditoria.
7. Toda operação registra usuário, data e horário (America/Sao_Paulo) e, em edições, os
   valores antes/depois.
8. Encomendas só podem ser cadastradas para quadras/lotes **ativos da relação oficial**.
9. Dados de moradores (nome de quem retirou, documento, comprovantes) só são acessíveis a
   usuários autenticados; arquivos nunca ficam públicos.

## 5. Estrutura do banco de dados

```
usuarios ─┬─< sessoes
          ├─< encomendas (recebido_por_id, cadastrado_por_id)
          ├─< retiradas  (lancado_por_id, entregue_por_id)
          └─< auditoria
quadras ──< lotes ──< encomendas >── transportadoras
encomendas ──< retiradas   (no máximo 1 ativa — índice único parcial)
encomendas ──< anexos
configuracoes (chave/valor)   contadores (sequência dos identificadores)
```

### Tabelas

**usuarios** — `id`, `nome`, `login` (único), `email` (único, opcional), `senha_hash`,
`perfil` (`ADMIN`|`CONTROLADOR`), `ativo`, `trocar_senha`, `tentativas_falhas`,
`bloqueado_ate`, `ultimo_login_em`, `criado_em`, `criado_por_id`, `atualizado_em`.

**sessoes** — `id` (hash do token), `usuario_id`, `criado_em`, `ultimo_uso_em`,
`expira_em`, `ip`, `user_agent`.

**quadras** — `id`, `codigo` (único), `descricao`, `ativo`, `criado_em`, `atualizado_em`.

**lotes** — `id`, `quadra_id`, `codigo` (único por quadra), `endereco`, `observacao`,
`ativo`, `criado_em`, `atualizado_em`.

**transportadoras** — `id`, `nome` (único), `ativo`, `ordem`, `criado_em`, `criado_por_id`.
Iniciais: Correios, Mercado Livre, Shopee, Amazon, Magazine Luiza, Transportadora,
Entrega particular, Outros.

**encomendas** — `id`, `codigo` (único, `FI-AAAA-NNNNN`), `recebido_em` (UTC),
`recebido_data` (data local), `lote_id`, `descricao`, `endereco_complementar`,
`transportadora_id`, `codigo_rastreio`, `recebido_por_id`, `observacoes`, `status`
(`PENDENTE`|`RETIRADA`|`RETIRADA_OUTRO_PLANTAO`|`CANCELADA`), `cadastrado_por_id`,
`cadastrado_em`, `atualizado_em`, `atualizado_por_id`, `cancelado_em`,
`cancelado_por_id`, `motivo_cancelamento`.

**retiradas** — `id`, `encomenda_id`, `tipo` (`PROPRIA`|`OUTRO_PLANTAO`), `retirado_em`
(UTC, nulo se horário desconhecido), `data_local`, `hora_local` (nula se desconhecida),
`retirado_por_nome`, `documento_retirante`, `entregue_por_id`, `entregue_por_nome`,
`entregador_desconhecido`, `plantao`, `observacoes`, `justificativa_horario`,
`lancado_por_id`, `lancado_em`, `estornada_em`, `estornada_por_id`, `motivo_estorno`.
Índice único parcial: `(encomenda_id) WHERE estornada_em IS NULL`.

**anexos** — `id`, `encomenda_id`, `retirada_id`, `tipo` (`ASSINATURA`|`FOTO`|`DOCUMENTO`),
`nome_original`, `mime`, `tamanho`, `arquivo`, `sha256`, `enviado_por_id`, `enviado_em`,
`removido_em`, `removido_por_id`, `motivo_remocao`.

**auditoria** (somente inserção) — `id`, `ocorrido_em`, `usuario_id`, `usuario_nome`,
`acao`, `entidade`, `entidade_id`, `encomenda_id`, `detalhes` (JSON antes/depois),
`justificativa`, `ip`.

**configuracoes** — `chave`, `valor` (JSON): plantões, dias de alerta/crítico,
tolerância de horário, backup automático e retenção.

**contadores** — `nome`, `valor` (sequência anual do identificador).

**importacoes** (permanente; triggers impedem alteração e exclusão) — `id`, `realizada_em`, `usuario_id`,
`usuario_nome`, `arquivo_nome`, `arquivo_sha256`, `arquivo_salvo`, `total_linhas`, `importados`,
`reativados`, `ignorados`, `duplicados`, `invalidos`, `quadras_novas`, `desativados`, `detalhes`
(JSON com o resumo e as linhas com problema).

### Importação da relação oficial de quadras e lotes

Módulo `server/importacao.js`, isolado do cadastro manual. Fluxo: **arquivo → prévia → confirmação**.

1. **Leitura**: CSV (vírgula, ponto e vírgula ou tabulação; BOM tolerado) ou XLSX. Só as colunas
   *Quadra* e *Lote* são usadas e as demais aparecem na prévia como ignoradas. O valor é gravado como
   **texto exatamente igual ao arquivo** (zeros à esquerda preservados). No Excel, usa-se o texto exibido
   da célula, e células numéricas sem formato geram aviso.
2. **Classificação** de cada linha: `NOVO`, `REATIVAR` (existia inativo), `EXISTENTE` (ignorado),
   `DUPLICADO_ARQUIVO`, `DUPLICADO_EQUIVALENTE` (ex.: `1` no arquivo e `01` no banco) ou `INVALIDO`.
   A equivalência remove zeros à esquerda só para *comparar*, nunca para gravar. O cadastro manual usa a
   mesma regra.
3. **Prévia** (`POST /api/quadras-lotes/importar/previa`): retorna os totais, a lista registro a registro,
   a conferência da sequência de quadras (primeira, última, faltantes, quadras novas) e o hash SHA-256
   do arquivo. Nada é gravado.
4. **Confirmação** (`POST /api/quadras-lotes/importar`): exige `hash_previa` igual ao hash do arquivo
   enviado. Grava tudo numa única transação, registra a importação em `importacoes` e na auditoria e
   guarda a cópia do arquivo em `data/importacoes/`. Opcionalmente **desativa** (nunca apaga) os lotes
   ausentes do arquivo.
5. **Histórico**: `GET /api/quadras-lotes/importacoes`.

## 6. API (resumo)

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/api/setup` | Status e criação do primeiro administrador (só funciona com banco vazio) |
| POST | `/api/auth/login`, `/api/auth/logout`, `/api/auth/senha` | Sessão e troca de senha |
| GET | `/api/auth/me` | Usuário logado |
| GET | `/api/dashboard` | Indicadores e recentes |
| GET/POST | `/api/encomendas` | Pesquisa (filtros + paginação) / cadastro |
| GET/PUT | `/api/encomendas/:id` | Ficha completa / edição justificada |
| POST | `/api/encomendas/:id/cancelar` | Cancelamento lógico (admin) |
| POST | `/api/retiradas` | Baixa (uma ou várias encomendas; própria ou outro plantão) |
| PUT | `/api/retiradas/:id` | Correção justificada (admin) |
| POST | `/api/retiradas/:id/estornar` | Estorno justificado (admin) |
| POST/GET | `/api/encomendas/:id/anexos`, `/api/anexos/:id/arquivo` | Comprovantes |
| CRUD | `/api/quadras`, `/api/lotes` | Relação oficial (cadastro manual) |
| POST/GET | `/api/quadras-lotes/importar/previa`, `/api/quadras-lotes/importar`, `/api/quadras-lotes/importacoes` | Importação com prévia e histórico (admin) |
| CRUD | `/api/transportadoras`, `/api/usuarios`, `/api/configuracoes` | Cadastros |
| GET | `/api/relatorios?formato=json\|pdf\|xlsx`, `/api/relatorios/funcionarios` | Relatórios |
| GET | `/api/auditoria` | Trilhas de auditoria (admin) |
| GET/POST | `/api/backups` | Backups (admin) |

## 7. Plano de testes

* **Testes de API** (`node --test`): autenticação e bloqueio, permissões por perfil,
  cadastro com identificador único, validação de quadra/lote oficial, pesquisa por todos
  os filtros, baixa própria, baixa duplicada (incluindo concorrência), retirada por outro
  plantão (sem atribuir ao usuário logado), correções justificadas com auditoria, estorno,
  cancelamento, impossibilidade de apagar registros, importação de planilha, relatórios
  PDF/Excel, anexos com acesso restrito, persistência após reinício do servidor, backup.
* **Teste ponta a ponta** (Playwright, navegador real): primeiro acesso, login, cadastro,
  pesquisa, retirada, retirada por outro plantão, histórico/ficha, relatórios.
