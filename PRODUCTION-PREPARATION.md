# Preparação para produção

## Estado atual

A API em execução continua sendo Node.js (`backend/server.js`) com JSON e filesystem. Esta etapa não troca o leitor JSON por PostgreSQL e não executa migrations automaticamente.

O frontend resolve a URL da API em `js/config.js`:

- host local: `http://localhost:5254`;
- host publicado atualmente configurado: `https://jogging-early-bat.abasthan.app`.

A URL é pública e não contém credenciais.

## Artefatos preparados

- `backend/postgres/schema.sql`: schema aditivo para administradores, imóveis, fotos e seis slots de destaque.
- `backend/postgres/README.md`: mapeamento do JSON para o schema.
- `backend/migrations/export-json.js`: exportação somente leitura.
- `backend/migrations/README.md`: procedimento reversível da futura carga.
- `backend/data/imoveis.json` e `backend/data/imoveis.json.pre-update.json`: snapshots versionados (19 imóveis, 6 destaques; SHA-256 `F0D69FA4CE2C63BBEE3A6B4E7A9ABA8983EB7F30CFEDD657EAF96F1E730A957E`).
- `backend/data/imoveis.json.pre-migration.json`: outro snapshot versionado (19 imóveis, 6 destaques; SHA-256 `0B23F3B9F761AF35237A86A93B3A59C0833C7328B40DC3D2DDEDBC613BB6B9C7`).
- `backend/data/imoveis.json.backup-20261006.json`: cópia local recém-lida da API publicada (17 imóveis, 6 destaques; SHA-256 `70BF0ACCFE8643945E97D96BD99DAE1CA70A57CC852E4036B84B0D0B5125EE44`). O arquivo é ignorado pelo Git.

Os snapshots versionados não representam o estado da API publicada: a cópia
local obtida da API tem 17 imóveis, enquanto os arquivos do repositório têm 19.
Nenhum JSON versionado foi alterado. Antes de migrar ou trocar o caminho em
produção, confira se o arquivo no host corresponde à cópia de backup atual e
preserve também os arquivos de fotos.

## Variáveis da API

Desenvolvimento:

```text
PORT=5254
FRONTEND_ORIGINS=null,http://localhost:5500,http://127.0.0.1:5500
DATABASE_PROVIDER=json
DATA_FILE=backend/data/imoveis.json
UPLOADS_DIR=backend/uploads
```

Produção:

```text
FRONTEND_ORIGINS=https://arinoimoveis.com.br
DATABASE_PROVIDER=json
DATA_FILE=/var/lib/arino-imoveis/data/imoveis.json
UPLOADS_DIR=/var/lib/arino-imoveis/uploads
```

O diretório `/var/lib/arino-imoveis` precisa ser montado como volume persistente
no serviço que executa a API. As variáveis de ambiente, sozinhas, não tornam o
filesystem persistente. Este repositório não contém um manifesto do provedor
nem a configuração do volume; confirme a montagem no painel do serviço antes
de publicar. Em produção, `backend/server.js` agora exige caminhos absolutos
fora da pasta da aplicação e não inicializa usando o JSON versionado como
fallback.

A futura troca PostgreSQL deverá acrescentar `DATABASE_PROVIDER=postgres` e `DATABASE_URL` somente depois da migration revisada. `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_PASSWORD_HASH` e demais credenciais devem ser configurados no ambiente da API, nunca no frontend ou no Git.

## Próximos passos manuais

1. Confirmar ou montar um volume persistente no serviço atual para JSON/uploads, em `/var/lib/arino-imoveis`.
2. Fazer backup do estado atual da API e copiar esse estado para o volume antes de apontar `DATA_FILE` para ele.
3. Configurar no provedor da API os secrets e `FRONTEND_ORIGINS` exatos.
4. Configurar no Vercel o domínio `https://arinoimoveis.com.br`.
5. Executar novamente o exportador e guardar seus artefatos fora do deploy.
6. Provisionar PostgreSQL e executar o schema após revisão.
7. Carregar os exports em transação, validar 19 imóveis, IDs, imagens e 6 destaques.
8. Testar login, CRUD, destaques, upload, listagem pública e detalhes.
9. Só então preparar a troca do leitor JSON para PostgreSQL, mantendo rollback até a validação.

Nenhum deploy, criação de conta externa, conexão PostgreSQL ou troca de banco foi realizado nesta etapa.
