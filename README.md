# Gestão de Encomendas – Fazenda da Ilha

Livro digital da portaria: controla recebimento, armazenamento, localização e retirada das
encomendas dos moradores, com histórico permanente, auditoria e relatórios.

* **Planejamento técnico e estrutura do banco:** [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
* **Pilha:** Node.js 22 · Express 5 · SQLite (better-sqlite3, modo WAL) · front-end em JavaScript puro
* **Fuso horário:** America/Sao_Paulo em toda a aplicação

## Funcionalidades

| Módulo | Destaques |
|---|---|
| Login e perfis | Usuários individuais; perfis **Administrador** e **Controlador de acesso**; bloqueio após 5 tentativas; troca de senha obrigatória no primeiro acesso |
| Dashboard | Total recebido, pendentes, recebidas hoje, retiradas hoje, retiradas por outros plantões, alertas de espera, recentes, atalhos |
| Nova encomenda | Data/hora automáticas e editáveis, quadra/lote da relação oficial, transportadoras (com inclusão de novas), identificador único `FI-AAAA-NNNNN`, "salvar e cadastrar outra" |
| Pendentes | Busca por endereço/descrição, tempo de espera com destaque, **baixa individual ou de várias encomendas de uma vez** |
| Retirada | Data/hora automáticas; correção exige justificativa; assinatura na tela e foto opcionais |
| Retirada por outro plantão | Plantão e observação obrigatórios; **quem lançou ≠ quem entregou**; o usuário logado nunca é registrado como entregador |
| Histórico | Arquivo permanente com todos os filtros; ficha completa com linha do tempo de alterações |
| Comprovantes | Assinatura, fotos e PDFs vinculados à encomenda, acessíveis só com login |
| Quadras e lotes | Cadastro, pesquisa e **importação CSV/Excel com prévia** e histórico de importações |
| Relatórios | Filtros por período, quadra, lote, transportadora, controlador e situação; **PDF e Excel**; relatório por funcionário |
| Auditoria | Toda operação registrada com usuário, data/hora, valores antes/depois e justificativa |
| Backup | Automático diário + manual pelo painel, com retenção configurável |

## Instalação

Requisitos: Node.js 20 ou superior.

```bash
npm install
```

```bash
npm start
```

Acesse `http://IP-DO-SERVIDOR:3000` de qualquer computador ou celular da rede. No primeiro acesso,
o sistema pede a criação do **administrador**. Não existe usuário ou senha padrão.

Variáveis de ambiente:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Pasta do banco, comprovantes, importações e backups |
| `COOKIE_SECURE` | – | `1` quando servido por HTTPS (recomendado) |
| `TRUST_PROXY` | – | `1` quando atrás de proxy reverso (nginx, Caddy…) |

### Docker

```bash
docker compose up -d --build
```

Os dados ficam no volume `./data` do host.

## Primeiros passos

1. Crie o administrador na tela de configuração inicial.
2. **Quadras e lotes → Importar planilha**: envie o CSV/Excel oficial (veja abaixo).
3. **Usuários**: cadastre cada controlador de acesso com login próprio.
4. **Configurações**: informe os plantões da portaria e os dias de alerta de espera.

## Importação da relação oficial de quadras e lotes

Painel: **Quadras e lotes → Importar planilha** (somente administrador).

* Formatos: `.csv` (vírgula, ponto e vírgula ou tabulação; UTF-8, com ou sem BOM) ou `.xlsx`.
* Colunas obrigatórias: **Quadra** e **Lote**. Outras colunas são ignoradas, e nenhum endereço é importado.
* Os códigos são gravados **exatamente como no arquivo**: `01` continua `01`, inclusive o lote `00`.
  No Excel, formate as colunas como Texto. Células numéricas sem formato geram um aviso na prévia.
* **Prévia obrigatória**: lista cada registro como *novo*, *já existente*, *duplicado* ou *inválido*.
  Mostra também a conferência da sequência de quadras (primeira, última e faltantes) e a comparação
  com a base atual. Nada é gravado nesta etapa.
* **Duplicidades** são bloqueadas inclusive por grafia equivalente (`1` × `01`), tanto na importação quanto no cadastro manual.
* A confirmação só aceita **o mesmo arquivo** da prévia (conferência por SHA-256).
* Reimportar ou importar uma versão atualizada é seguro: registros existentes são mantidos, e encomendas e histórico não mudam.
  Lotes ausentes do novo arquivo só são **desativados** se o administrador marcar essa opção. Nunca são apagados.
* Cada importação fica registrada permanentemente com data, horário, responsável, nome e hash do arquivo, e os totais
  de importados, ignorados e duplicados. Uma cópia do arquivo é guardada em `data/importacoes/`.

## Testes

```bash
npm test
```

```bash
npm run test:e2e
```

* `test/api.test.js`: 24 testes de integração contra servidor e banco reais. Cobrem autenticação, permissões,
  cadastro, pesquisa, baixa, baixa duplicada (inclusive concorrente), retirada por outro plantão, correções,
  estorno, cancelamento, proteção contra exclusão, comprovantes, relatórios PDF/Excel, auditoria, importação,
  backup e persistência após reinício.
* `test/e2e.test.js`: fluxo completo no navegador (Chromium/Playwright), inclusive celular.
  Use `OFFICIAL_CSV=/caminho/arquivo.csv` para rodar a importação com o arquivo oficial e
  `SCREENSHOTS=/pasta` para salvar capturas de tela.

## Backup e restauração

* Automático: um backup por dia em `data/backups/` (retenção configurável). Manual: **Configurações → Criar backup agora**
  ou `npm run backup`.
* **Copie periodicamente a pasta `data/` inteira** (banco, `uploads/` com os comprovantes e `importacoes/`) para outro local.
* Restaurar: pare o sistema, substitua `data/encomendas.db` pelo arquivo de backup
  (remova `encomendas.db-wal` e `encomendas.db-shm`, se existirem) e inicie novamente.

## Administração por linha de comando

```bash
SENHA='NovaSenha123' node scripts/admin.js redefinir-senha admin
```

```bash
SENHA='SenhaForte123' node scripts/admin.js criar-admin joao João da Silva
```

## Segurança

Senhas com scrypt; sessão em cookie `HttpOnly`/`SameSite=Strict`; proteção CSRF; cabeçalhos de segurança (CSP);
comprovantes servidos só com login e verificados pelo conteúdo do arquivo. Registros não podem ser apagados:
triggers no banco bloqueiam exclusões, e cancelamentos e estornos são lógicos e auditados. Para uso fora da rede
local, publique atrás de HTTPS com `COOKIE_SECURE=1`.

O emblema em `public/img/emblema.svg` é provisório. Substitua pelo logotipo oficial da Fazenda da Ilha.
