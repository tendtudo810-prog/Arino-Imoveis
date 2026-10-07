# Relatório de Preparação para Produção - API Arino Imóveis

## Situação atual

- A API JSON atual está em `backend/server.js`; não foi executada migração para PostgreSQL.
- `backend/env.production.example` define caminhos esperados, mas este repositório não configura nem comprova a montagem de um volume persistente no host.
- Os JSONs em `backend/data/` são snapshots versionados, não backup do estado administrativo ao vivo. Faça e confira esse backup no host antes de mudar os caminhos de storage.
- Foi obtida uma cópia local de `GET /api/Imoveis` em `backend/data/imoveis.json.backup-20261006.json` (17 imóveis, 6 destaques; ignorada pelo Git). Ela ainda precisa ser conferida contra o arquivo ativo no host antes de uma troca de caminho.
- Em produção, a API usa `/var/lib/arino-imoveis/data/imoveis.json` e `/var/lib/arino-imoveis/uploads` por padrão; `DATA_FILE` e `UPLOADS_DIR` podem sobrescrevê-los com caminhos absolutos fora da pasta da aplicação. Se o JSON persistente não existir, o processo falha explicitamente em vez de restaurar os imóveis versionados ou criar silenciosamente `[]`.

## Variáveis de ambiente

### Development
```
NODE_ENV=development
PORT=5254
DATA_FILE=data/imoveis.json
UPLOADS_DIR=uploads
FRONTEND_ORIGINS=http://localhost:5500,http://127.0.0.1:5500
ADMIN_EMAIL=souantonioarino@gmail.com
ADMIN_PASSWORD_HASH=<hash bcrypt>
AUTH_SECRET=<chave secreta desenvolvimento>
AUTH_ISSUER=arino-imoveis-api
AUTH_AUDIENCE=arino-imoveis-admin
DATABASE_PROVIDER=json
DATABASE_URL=
```

### Production
```
NODE_ENV=production
PORT=<fornecida pelo provedor>
DATA_FILE=/var/lib/arino-imoveis/data/imoveis.json
UPLOADS_DIR=/var/lib/arino-imoveis/uploads
FRONTEND_ORIGINS=https://arinoimoveis.com.br,https://www.arinoimoveis.com.br
ADMIN_EMAIL=<configurar no provedor>
ADMIN_PASSWORD_HASH=<configurar no provedor>
AUTH_SECRET=<configurar no provedor>
AUTH_ISSUER=arino-imoveis-api
AUTH_AUDIENCE=arino-imoveis-admin
DATABASE_PROVIDER=json
DATABASE_URL=
```

## Comando de produção

```bash
npm start
```

## Versão do Node

**Recomendada:** Node.js >= 18.0.0

## Persistência

### Diretórios que precisam ser persistentes:

1. **DATA_FILE** - Caminho do arquivo JSON de dados
   - Development: `backend/data/imoveis.json`
   - Production: `/var/lib/arino-imoveis/data/imoveis.json` (configurável)

2. **UPLOADS_DIR** - Diretório de uploads de imagens
   - Development: `backend/uploads`
   - Production: `/var/lib/arino-imoveis/uploads` (configurável)

**IMPORTANTE:** O provedor de hospedagem DEVE oferecer filesystem persistente para estes diretórios. Caso contrário, os dados serão perdidos a cada deploy/reinício.

O exemplo `backend/env.production.example` apenas define os caminhos; ele não
provisiona o volume no provedor. Monte o volume persistente em
`/var/lib/arino-imoveis` antes de iniciar a API e configure `DATA_FILE` e
`UPLOADS_DIR` no ambiente do serviço. Em produção, a API recusa caminhos
relativos ou localizados dentro da pasta da aplicação, para não gravar no
filesystem descartável do deploy.

`backend/data/imoveis.json` continua sendo apenas o conjunto de dados incluído
no código-fonte. A API não o usa como fallback quando o storage persistente foi
configurado. Se o arquivo no volume ainda não existir, a API falha explicitamente
em vez de iniciar com uma lista vazia ou importar o JSON versionado. Uma lista
administrativa já salva como `[]` permanece vazia após reinicializações. Não
apague nem substitua o arquivo atual ao configurar o volume: copie o estado
administrativo vigente para o volume somente após criar e conferir um backup
desse estado no ambiente de hospedagem.

## CORS

### Origens permitidas em produção:
- `https://arinoimoveis.com.br`
- `https://www.arinoimoveis.com.br`

### Origens permitidas em desenvolvimento:
- `http://localhost:5500`
- `http://127.0.0.1:5500`

## Health check

**Rota:** `GET /api/health`

**Resposta:**
```json
{
  "status": "ok"
}
```

## Testes

### Resultados dos testes locais:

- ✅ **19 imóveis:** OK
- ✅ **6 destaques:** OK  
- ✅ **Login:** OK
- ✅ **JWT:** OK
- ✅ **Health check:** OK
- ⚠️ **Imagens:** PARCIAL (ver riscos abaixo)

### Detalhes dos testes:

1. **GET /api/health** - Retorna `{"status":"ok"}` ✅
2. **GET /api/Imoveis** - Retorna 19 imóveis ✅
3. **GET /api/Imoveis/destaques** - Retorna 6 imóveis em destaque ✅
4. **POST /api/Auth/login** - Login funcionando com JWT ✅
5. **GET /api/auth/teste-admin** - Autenticação JWT funcionando ✅

## Riscos

### ⚠️ Risco Crítico: Sistema de Imagens Híbrido

**Problema identificado:**
- A API tem dois sistemas de imagens funcionando em paralelo:
  1. **Sistema legado:** Imagens em diretórios como `imovel1/`, `imovel2/` na raiz do projeto
  2. **Sistema novo:** Imagens em `backend/uploads/{id}/` com nomes UUID

**Impacto:**
- Imagens do sistema legado podem não ser servidas corretamente em produção
- O código atual tenta servir imagens de ambos os sistemas, mas há conflitos de caminhos
- 10 imagens no sistema novo (uploads/19/) funcionam corretamente
- Imagens dos diretórios imovel1-imovel11 podem ter problemas de acesso

**Recomendação:**
1. **Migração manual necessária:** Mover todas as imagens dos diretórios `imovel*` para `backend/uploads/{id}/`
2. **Atualizar JSON:** Alterar os campos `diretorioImagens` para referenciar o novo sistema
3. **Testar:** Verificar se todas as imagens são acessíveis após migração

### ⚠️ Risco: Filesystem Persistente

**Problema:**
- A API depende de filesystem persistente para JSON e uploads
- Alguns provedores serverless (ex: Vercel, AWS Lambda) não oferecem filesystem persistente
- Dados podem ser perdidos entre deploys

**Mitigação:**
- Verificar se o provedor escolhido oferece filesystem persistente
- Considerar usar serviços de armazenamento externo (S3, Cloudinary) para imagens
- Planejar migração para PostgreSQL o mais rápido possível

### ✅ Segurança Implementada

- ✅ JWT secret configurável por variável de ambiente
- ✅ CORS restrito por origens específicas
- ✅ Validação de tipos de arquivo (JPG, PNG, WEBP)
- ✅ Validação de assinatura de arquivos (magic bytes)
- ✅ Proteção contra path traversal
- ✅ Graceful shutdown implementado (SIGTERM, SIGINT)
- ✅ Erros em produção não expõem stack traces
- ✅ Health check sem exposição de secrets

## Status Final

A API está pronta no código para usar storage externo configurado, mas o deploy
não deve ser considerado persistente até verificar o volume no host:

1. **Funcionalidade principal:** ✅ 100% operacional
2. **Autenticação:** ✅ JWT funcionando corretamente
3. **Dados:** ⚠️ JSON grava no caminho configurado; persistência entre redeploys depende de volume montado pelo host
4. **Imagens:** ⚠️ Sistema híbrido requer migração manual
5. **Produção:** ⚠️ Configure caminhos absolutos e confira o volume antes de iniciar a nova versão
6. **Segurança:** ✅ Proteções implementadas

## Próximos Passos Recomendados

1. **Storage:** Confirmar/montar volume persistente e copiar o estado ao vivo após backup
2. **Configurar secrets:** Definir variáveis de ambiente no provedor
3. **Migrar imagens:** Mover imagens legadas somente se necessário e após backup
4. **Testar produção:** Validar todos os endpoints em ambiente de produção

## Notas Técnicas

- O sistema atual usa JSON e uma única API, sem PostgreSQL
- A URL pública atualmente configurada no frontend é `https://jogging-early-bat.abasthan.app`
- Não há dependência de PostgreSQL nesta fase
- O graceful shutdown evita corrupção do JSON durante encerramento