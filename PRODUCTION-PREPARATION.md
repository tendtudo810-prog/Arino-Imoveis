# Preparação para produção

## Estado atual

A API em execução continua sendo Node.js (`backend/server.js`) com JSON e filesystem. Esta etapa não troca o leitor JSON por PostgreSQL e não executa migrations automaticamente.

O frontend resolve a URL da API em `js/config.js`:

- host local: `http://localhost:5254`;
- qualquer host publicado: `https://api.arinoimoveis.com.br`.

A URL é pública e não contém credenciais.

## Artefatos preparados

- `backend/postgres/schema.sql`: schema aditivo para administradores, imóveis, fotos e seis slots de destaque.
- `backend/postgres/README.md`: mapeamento do JSON para o schema.
- `backend/migrations/export-json.js`: exportação somente leitura.
- `backend/migrations/README.md`: procedimento reversível da futura carga.
- `backend/data/imoveis.pre-producao-20260919-142624.json`: backup pré-produção do JSON original.

A exportação validada nesta etapa encontrou 19 imóveis e 6 destaques. O hash SHA-256 do JSON original permaneceu `C6C905D66F141779EEDACCA75305F933E8EAD813F258F6B0A1C8F0B049E66DBF` após a preparação.

## Variáveis da API

Desenvolvimento:

```text
PORT=5254
FRONTEND_ORIGINS=null,http://localhost:5500,http://127.0.0.1:5500
DATABASE_PROVIDER=json
DATA_FILE=backend/data/imoveis.json
UPLOADS_DIR=backend/uploads
```

Produção, antes da troca definitiva:

```text
FRONTEND_ORIGINS=https://arinoimoveis.com.br
DATABASE_PROVIDER=json
DATA_FILE=/var/lib/arino-imoveis/data/imoveis.json
UPLOADS_DIR=/var/lib/arino-imoveis/uploads
```

A futura troca PostgreSQL deverá acrescentar `DATABASE_PROVIDER=postgres` e `DATABASE_URL` somente depois da migration revisada. `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_PASSWORD_HASH` e demais credenciais devem ser configurados no ambiente da API, nunca no frontend ou no Git.

## Próximos passos manuais

1. Escolher o provedor da API Node e confirmar volume persistente para JSON/uploads durante o rollback.
2. Criar `api.arinoimoveis.com.br` e configurar HTTPS.
3. Configurar no provedor da API os secrets e `FRONTEND_ORIGINS` exatos.
4. Configurar no Vercel o domínio `https://arinoimoveis.com.br`.
5. Executar novamente o exportador e guardar seus artefatos fora do deploy.
6. Provisionar PostgreSQL e executar o schema após revisão.
7. Carregar os exports em transação, validar 19 imóveis, IDs, imagens e 6 destaques.
8. Testar login, CRUD, destaques, upload, listagem pública e detalhes.
9. Só então preparar a troca do leitor JSON para PostgreSQL, mantendo rollback até a validação.

Nenhum deploy, criação de conta externa, conexão PostgreSQL ou troca de banco foi realizado nesta etapa.
