# Backend Arino Imóveis

Backend local da API de imóveis, com `bcryptjs` para verificação segura de senhas.

## Executar

Configure primeiro as variáveis server-side do único administrador. A senha deve ser armazenada apenas como hash bcrypt em `ADMIN_PASSWORD_HASH`; nunca coloque a senha original no repositório, no frontend ou no JSON de imóveis.

No PowerShell, gere o hash sem registrá-lo no código:

```powershell
Push-Location backend
node -e "require('bcryptjs').hash(process.argv[1], 12).then(console.log)" "SUA_SENHA"
Pop-Location
```

Depois defina as variáveis no ambiente do processo:

```powershell
$env:ADMIN_EMAIL = "souantonioarino@gmail.com"
$env:ADMIN_PASSWORD_HASH = "hash-bcrypt-gerado-acima"
$env:AUTH_SECRET = "defina-uma-chave-secreta-longa"
$env:AUTH_ISSUER = "arino-imoveis-api"
$env:AUTH_AUDIENCE = "arino-imoveis-admin"
$env:FRONTEND_ORIGIN = "null"
$env:FRONTEND_ORIGINS = "http://localhost:5500,http://127.0.0.1:5500"
$env:NODE_ENV = "development"
$env:DATABASE_PROVIDER = "json"
$env:DATA_FILE = "backend/data/imoveis.json"
$env:UPLOADS_DIR = "backend/uploads"
```

Na raiz do projeto, execute:

```powershell
node backend/server.js
```

A API ficará disponível em `http://localhost:5254` no desenvolvimento. Em produção, `PORT` deve ser fornecida pelo provedor.

Se o login mostrar que não foi possível conectar à API, confirme que o processo
`node backend/server.js` está em execução e que a porta `5254` está livre. A
senha administrativa e o segredo de assinatura devem ser definidos no ambiente;
eles não são armazenados no frontend.

## Endpoints

- `GET /api/Imoveis`
- `GET /api/Imoveis/{id}`
- `GET /api/Imovel/{id}`
- `GET /api/Imoveis/destaques` (retorna a vitrine pública)
- `POST /api/Auth/login`
- `GET /api/Auth/teste-admin`
- `GET /api/Admin/destaques` (requer JWT administrativo)
- `POST /api/Imoveis` (requer JWT administrativo)
- `PUT /api/Imoveis/{id}` (requer JWT administrativo)
- `DELETE /api/Imoveis/{id}` (requer JWT administrativo)
- `POST /api/Imoveis/{id}/destaque` e `DELETE /api/Imoveis/{id}/destaque` (requer JWT)
- `POST /api/Imoveis/destaques/trocar` (troca atômica, requer JWT)
- `POST /api/Imoveis/{id}/fotos` (multipart, requer JWT)
- `DELETE /api/Imoveis/{id}/fotos` (requer JWT)
- `PUT /api/Imoveis/{id}/imagem-principal` (requer JWT)
- `POST /api/Auth/logout`

O login verifica o e-mail e o hash bcrypt definidos no ambiente e retorna um JWT assinado. O frontend mantém o token apenas na `sessionStorage` durante a sessão, e o backend valida assinatura, `Issuer`, `Audience`, `jti` e validade de oito horas em cada operação protegida. Sem a configuração completa, nenhuma credencial é aceita.

As imagens são descobertas automaticamente nas pastas existentes do frontend. O arquivo `backend/data/imoveis.json` contém os dados dos anúncios que já estavam nas páginas atuais.

Para a preparação PostgreSQL, consulte `backend/postgres/schema.sql`, `backend/postgres/README.md` e `backend/migrations/README.md`. O backend atual continua usando JSON; nenhuma migration é executada no start.
