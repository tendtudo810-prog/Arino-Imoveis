# Migrations preparatórias

Esta pasta não contém uma migration executada automaticamente.

`export-json.js` é somente leitura: ele lê `backend/data/imoveis.json` e as pastas de imagens legadas e cria novos arquivos em `backend/migrations/exports/`. Ele não altera, move, renomeia ou remove a fonte original.

Execute na raiz do projeto:

```powershell
node backend/migrations/export-json.js
```

Antes da futura carga no PostgreSQL:

1. Faça backup do JSON, das imagens legadas e do export gerado.
2. Crie o schema com revisão humana de `backend/postgres/schema.sql`.
3. Carregue `properties.json`, `property_images.json` e `featured_properties.json` em uma transação controlada.
4. Confirme contagens, IDs, preços, textos, imagens e os seis destaques.
5. Faça um backup PostgreSQL antes de mudar o leitor da API.
6. Mantenha o adaptador JSON disponível para rollback até a validação pública terminar.

Nenhum comando desta pasta deve ser executado automaticamente durante o start da API.
