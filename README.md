# Gestão de Encomendas – Fazenda da Ilha

Livro digital da portaria: controla recebimento, armazenamento, localização e retirada das
encomendas dos moradores, com histórico permanente, auditoria e relatórios.

* **Planejamento técnico e estrutura do banco:** [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md)
* **Publicação gratuita:** Cloudflare Workers + D1 (banco) — passo a passo abaixo
* **Alternativa:** servidor próprio com Node.js (mesmo código, mesmas regras)
* **Fuso horário:** America/Sao_Paulo em toda a aplicação

## Funcionalidades

| Módulo | Destaques |
|---|---|
| Login e perfis | Usuários individuais; **Administrador** e **Controlador de acesso**; bloqueio após 5 tentativas; troca de senha no primeiro acesso |
| Dashboard | Total recebido, pendentes, recebidas hoje, retiradas hoje, retiradas por outros plantões, alertas de espera, atalhos |
| Nova encomenda | Data/hora automáticas e editáveis, quadra/lote da relação oficial, transportadoras (com inclusão), identificador `FI-AAAA-NNNNN` |
| Pendentes | Busca por endereço, tempo de espera com destaque, **baixa individual ou de várias encomendas de uma vez** |
| Retirada / outro plantão | Correção de horário justificada; assinatura e foto; **quem lançou ≠ quem entregou** |
| Histórico | Arquivo permanente com todos os filtros; ficha completa com linha do tempo |
| **Gerenciar quadras e lotes** | Cadastro, edição, pesquisa (`68/00`), consulta com histórico, desativação, exclusão controlada, importação CSV/Excel com prévia |
| Relatórios | Filtros por período, quadra, lote, transportadora, controlador e situação; **PDF e Excel**; por funcionário |
| Auditoria | Toda operação com usuário, data/hora, valores antes/depois e justificativa |

## Publicação na Cloudflare (gratuita)

Requisitos: conta gratuita na Cloudflare e um computador com Node.js 20+ (apenas para publicar).

```bash
npm install
```

```bash
npx wrangler login
```

Crie o banco D1 e copie o `database_id` exibido para o arquivo `wrangler.toml`:

```bash
npx wrangler d1 create encomendas-fazenda-da-ilha
```

Crie as tabelas no banco publicado e publique o sistema:

```bash
npm run cf:migrar
```

```bash
npm run cf:publicar
```

O endereço aparece ao final (ex.: `https://encomendas-fazenda-da-ilha.SUA-CONTA.workers.dev`).
Um domínio próprio pode ser ligado depois no painel da Cloudflare.

**Primeiro acesso:** abra o endereço, crie o administrador e, em **Gerenciar quadras e lotes →
Importar planilha**, envie o CSV oficial. Confira a prévia e confirme.

**Atualizações futuras do sistema:**

```bash
git pull && npm install && npm run cf:migrar && npm run cf:publicar
```

### Limites do plano gratuito (confira os valores atuais no site da Cloudflare)

* Workers: cerca de 100 mil requisições/dia e ~10 ms de CPU por requisição. O sistema foi preparado para isso:
  PDF/Excel e leitura de planilhas são feitos no navegador, e o servidor só executa consultas leves.
* D1: alguns GB de armazenamento e milhões de leituras/dia — muito acima do uso de uma portaria.
* Comprovantes ficam no próprio D1 (até ~1,8 MB por arquivo; fotos são reduzidas automaticamente no navegador).
  Opcional: ativar o R2 no `wrangler.toml` para arquivos maiores.
* Senhas usam PBKDF2 com 100 mil iterações. Se o login retornar *Error 1102* (CPU excedida), reduza
  `PBKDF2_ITERACOES` para `50000` no `wrangler.toml` e publique de novo — as senhas existentes continuam valendo.

### Backup na Cloudflare

* O D1 guarda automaticamente o histórico do banco e permite restaurar um ponto anterior (*Time Travel*):

```bash
npx wrangler d1 time-travel info encomendas-fazenda-da-ilha
```

* Cópia completa para um arquivo `.sql` local (guarde fora do computador):

```bash
npm run backup:cloudflare
```

## Gerenciar quadras e lotes

Área administrativa (menu **Gerenciar quadras e lotes**); controladores apenas consultam.

* **Cadastrar/editar** quadra e lote como campos separados, exatamente como na relação oficial
  (zeros à esquerda preservados; quadras acima de 114 permitidas). Vale na hora, sem republicar o sistema.
* **Duplicidades bloqueadas:** quadra repetida, lote repetido na mesma quadra, inclusive por grafia
  equivalente (`1` × `01`). O mesmo número de lote em quadras diferentes é permitido.
* **Pesquisa:** `68/00`, `68 0`, `Q68 L00`, trecho do endereço; filtro por situação.
* **Consultar:** encomendas do lote, quem cadastrou/alterou e quando, histórico de alterações.
* **Excluir** só é possível para lote/quadra que **nunca teve encomendas** (cadastro feito por engano),
  com justificativa registrada na auditoria. Com encomendas, use **Desativar**: o lote some do cadastro
  de novas encomendas e todo o histórico é preservado. A identificação de lote com encomendas não pode ser
  alterada. Essas regras são garantidas também por *triggers* no banco.
* **Importação CSV/Excel:** somente as colunas Quadra e Lote; prévia registro a registro (novos, já
  existentes, duplicados, inválidos, conferência da sequência de quadras); confirmação vinculada à prévia;
  histórico permanente com data, horário, responsável e totais. Reimportar a relação é seguro: registros
  existentes e cadastros manuais são mantidos; lotes ausentes do arquivo só são desativados se o
  administrador marcar a opção.

## Alternativa: servidor próprio (Node.js)

```bash
npm install
```

```bash
npm start
```

Acesse `http://IP-DO-SERVIDOR:3000`. Dados em `./data` (banco, comprovantes, backups automáticos diários).
Também pode rodar com Docker: `docker compose up -d --build`.

## Testes

A mesma bateria roda contra o Node.js e contra a Cloudflare local (workerd + D1, via `wrangler dev`):

```bash
npm test
```

```bash
npm run test:cloudflare
```

```bash
npm run test:e2e
```

```bash
npm run test:e2e:cloudflare
```

* `test/api.test.js` — 26 testes de integração: autenticação, permissões, cadastro, pesquisa, baixa e baixa
  duplicada concorrente, outro plantão, correções, estorno, cancelamento, proteções do banco, comprovantes,
  relatórios, auditoria, **gerenciamento de quadras e lotes**, **importação**, **compatibilidade com registros
  antigos**, backup e persistência após reinício.
* `test/e2e.test.js` — 14 testes no navegador (Chromium), inclusive celular e geração de PDF/Excel.
  `OFFICIAL_CSV=/caminho/arquivo.csv` usa o arquivo oficial na importação; `SCREENSHOTS=/pasta` salva capturas.

## Segurança

Senhas com PBKDF2-SHA256; sessão em cookie `HttpOnly`/`SameSite=Strict`; proteção CSRF; CSP e cabeçalhos
de segurança; comprovantes só com login e verificados pelo conteúdo. Registros não podem ser apagados:
*triggers* no banco bloqueiam exclusões; cancelamentos, estornos e desativações são lógicos e auditados.

Logotipo oficial em `public/img/logo.png` (tela de entrada); símbolo em `public/img/simbolo.png` (menu) e `public/img/icone.png` (ícone da aba).
Bibliotecas de terceiros do navegador (ExcelJS, jsPDF): `public/vendor/LICENCAS.txt`.
