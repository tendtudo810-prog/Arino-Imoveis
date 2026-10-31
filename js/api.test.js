"use strict";

const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const { createApp } = require("../src/app");
const { openDatabase } = require("../src/db");
const { loadConfig } = require("../src/config");
const { hashPassword } = require("../src/auth");
const { seedDatabase } = require("../scripts/seed");

const ADMIN_EMAIL = "admin@teste.com";
const ADMIN_PASSWORD = "senha-forte-teste-123";
const ORIGIN = "http://localhost:8080";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 1)]);

let tmp;
let db;
let config;
let server;
let base;
let token;

function multipart(files) {
  const boundary = `----arinoTest${Date.now()}`;
  const chunks = [];
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`
      ),
      file.data,
      Buffer.from("\r\n")
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function api(method, route, { body, auth = token, raw, contentType, origin } = {}) {
  const headers = {};
  if (auth) headers.Authorization = `Bearer ${auth}`;
  if (origin) headers.Origin = origin;
  let payload;
  if (raw) {
    payload = raw;
    headers["Content-Type"] = contentType;
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  const response = await fetch(`${base}${route}`, { method, headers, body: payload });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: response.status, json, text, headers: response.headers };
}

async function login(senha = ADMIN_PASSWORD) {
  return api("POST", "/api/auth/login", { body: { email: ADMIN_EMAIL, senha }, auth: null });
}

function listFeaturedIds() {
  return db.prepare("SELECT id FROM properties WHERE destaque = 1 ORDER BY id").all().map((r) => r.id);
}

function nonFeaturedId() {
  return db.prepare("SELECT id FROM properties WHERE destaque = 0 ORDER BY id LIMIT 1").get().id;
}

function baseProperty(overrides = {}) {
  return {
    titulo: "Casa de teste",
    tipo: "Casa",
    preco: "R$ 350.000,00",
    cidade: "Valparaíso de Goiás",
    estado: "go",
    localizacao: "Setor de teste",
    descricao: "Imóvel criado pelos testes automatizados.",
    area: 120,
    quartos: 3,
    banheiros: 2,
    vagas: 2,
    status: "Disponível",
    destaque: false,
    ...overrides,
  };
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "arino-api-test-"));
  config = loadConfig({
    AUTH_SECRET: "x".repeat(48),
    DB_FILE: path.join(tmp, "test.sqlite"),
    UPLOADS_DIR: path.join(tmp, "uploads"),
    FRONTEND_ORIGINS: ORIGIN,
    RATE_PUBLIC_PER_MINUTE: "100000",
    RATE_ADMIN_PER_MINUTE: "100000",
    RATE_UPLOAD_PER_10_MIN: "100000",
  });
  db = openDatabase(config.dbFile);
  seedDatabase(db, config);
  db.prepare("INSERT INTO admins (email, password_hash, role) VALUES (?, ?, 'Admin')").run(
    ADMIN_EMAIL,
    hashPassword(ADMIN_PASSWORD)
  );
  server = http.createServer(createApp({ db, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  token = (await login()).json.token;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("saúde e leitura pública", () => {
  test("health responde ok", async () => {
    const r = await api("GET", "/api/health", { auth: null });
    assert.equal(r.status, 200);
    assert.equal(r.json.status, "ok");
  });

  test("lista os 19 imóveis do seed no formato esperado pelo frontend", async () => {
    const r = await api("GET", "/api/imoveis", { auth: null });
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 19);
    const first = r.json[0];
    for (const key of ["id", "titulo", "tipo", "preco", "cidade", "estado", "fotos", "imagemPrincipal", "destaque", "status", "vendido"]) {
      assert.ok(key in first, `campo ausente: ${key}`);
    }
  });

  test("rotas são case-insensitive, como antes", async () => {
    const r = await api("GET", "/API/IMOVEIS", { auth: null });
    assert.equal(r.status, 200);
  });

  test("filtra por tipo e cidade", async () => {
    const casas = await api("GET", "/api/imoveis?tipo=casa", { auth: null });
    assert.ok(casas.json.length > 0);
    assert.ok(casas.json.every((p) => p.tipo.toLowerCase() === "casa"));

    const porCidade = await api("GET", "/api/imoveis?cidade=valpar", { auth: null });
    assert.ok(porCidade.json.length > 0);
    assert.ok(porCidade.json.every((p) => /valpar/i.test(p.cidade)));
  });

  test("busca livre com caracteres especiais não quebra a consulta", async () => {
    const r = await api("GET", "/api/imoveis?q=%25_%27", { auth: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, []);
  });

  test("vitrine pública tem exatamente 6 destaques", async () => {
    const r = await api("GET", "/api/imoveis/destaques", { auth: null });
    assert.equal(r.status, 200);
    assert.equal(r.json.length, 6);
    assert.ok(r.json.every((p) => p.destaque === true));
  });

  test("imóvel por id: existente e inexistente", async () => {
    const ok = await api("GET", "/api/imoveis/1", { auth: null });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.id, 1);
    const alias = await api("GET", "/api/imovel/1", { auth: null });
    assert.equal(alias.status, 200);
    const missing = await api("GET", "/api/imoveis/999999", { auth: null });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.mensagem, "Imóvel não encontrado.");
  });

  test("seed é idempotente", () => {
    const again = seedDatabase(db, config);
    assert.equal(again.imported, 0);
    assert.equal(again.skipped, 19);
  });
});

describe("autenticação", () => {
  test("senha errada é recusada sem revelar qual campo falhou", async () => {
    const r = await login("senha-errada");
    assert.equal(r.status, 401);
    assert.equal(r.json.mensagem, "E-mail ou senha inválidos.");
  });

  test("campos vazios retornam 400", async () => {
    const r = await api("POST", "/api/auth/login", { body: { email: "", senha: "" }, auth: null });
    assert.equal(r.status, 400);
  });

  test("login correto devolve token e dados do admin", async () => {
    const r = await login();
    assert.equal(r.status, 200);
    assert.equal(r.json.autenticado, true);
    assert.equal(r.json.usuario.role, "Admin");
    assert.equal(r.json.email, ADMIN_EMAIL);
    assert.equal(r.json.token.split(".").length, 3);
  });

  test("teste-admin exige token válido", async () => {
    assert.equal((await api("GET", "/api/auth/teste-admin", { auth: null })).status, 401);
    assert.equal((await api("GET", "/api/auth/teste-admin", { auth: "abc.def.ghi" })).status, 401);
    const ok = await api("GET", "/api/auth/teste-admin");
    assert.equal(ok.status, 200);
    assert.equal(ok.json.email, ADMIN_EMAIL);
  });

  test("token adulterado é recusado", async () => {
    const [header, payload, signature] = token.split(".");
    const forged = `${header}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url")), email: "outro@x.com" })).toString("base64url")}.${signature}`;
    assert.equal((await api("GET", "/api/auth/teste-admin", { auth: forged })).status, 401);
  });

  test("rotas de escrita exigem autenticação", async () => {
    const r = await api("POST", "/api/imoveis", { body: baseProperty(), auth: null });
    assert.equal(r.status, 401);
    assert.equal((await api("DELETE", "/api/imoveis/1", { auth: null })).status, 401);
    assert.equal((await api("GET", "/api/admin/destaques", { auth: null })).status, 401);
  });

  test("logout revoga o token", async () => {
    const { json } = await login();
    const sessionToken = json.token;
    assert.equal((await api("GET", "/api/auth/teste-admin", { auth: sessionToken })).status, 200);
    const out = await api("POST", "/api/auth/logout", { auth: sessionToken });
    assert.equal(out.status, 200);
    assert.equal((await api("GET", "/api/auth/teste-admin", { auth: sessionToken })).status, 401);
  });
});

describe("CRUD de imóveis", () => {
  let createdId;

  test("cria imóvel com preço em formato brasileiro e estado normalizado", async () => {
    const r = await api("POST", "/api/imoveis", { body: baseProperty() });
    assert.equal(r.status, 201);
    assert.equal(r.json.preco, 350000);
    assert.equal(r.json.estado, "GO");
    assert.equal(r.json.fotos.length, 0);
    createdId = r.json.id;
  });

  test("validação devolve mensagens claras", async () => {
    const semTitulo = await api("POST", "/api/imoveis", { body: baseProperty({ titulo: "" }) });
    assert.equal(semTitulo.status, 400);
    assert.equal(semTitulo.json.mensagem, "Informe o título do imóvel.");

    const estadoInvalido = await api("POST", "/api/imoveis", { body: baseProperty({ estado: "G1" }) });
    assert.equal(estadoInvalido.status, 400);

    const precoInvalido = await api("POST", "/api/imoveis", { body: baseProperty({ preco: "abc" }) });
    assert.equal(precoInvalido.status, 400);
    assert.equal(precoInvalido.json.mensagem, "Informe um preço válido.");

    const areaNegativa = await api("POST", "/api/imoveis", { body: baseProperty({ area: -5 }) });
    assert.equal(areaNegativa.status, 400);
  });

  test("JSON malformado retorna 400", async () => {
    const r = await api("POST", "/api/imoveis", { raw: "{nao-e-json", contentType: "application/json" });
    assert.equal(r.status, 400);
    assert.equal(r.json.mensagem, "JSON inválido.");
  });

  test("atualiza imóvel e mantém o id", async () => {
    const r = await api("PUT", `/api/imoveis/${createdId}`, { body: baseProperty({ titulo: "Casa atualizada", status: "Vendido" }) });
    assert.equal(r.status, 200);
    assert.equal(r.json.id, createdId);
    assert.equal(r.json.titulo, "Casa atualizada");
    assert.equal(r.json.vendido, true);
  });

  test("exclui imóvel e depois ele não existe mais", async () => {
    const r = await api("DELETE", `/api/imoveis/${createdId}`);
    assert.equal(r.status, 200);
    assert.equal((await api("GET", `/api/imoveis/${createdId}`, { auth: null })).status, 404);
    assert.equal((await api("DELETE", `/api/imoveis/${createdId}`)).status, 404);
  });
});

describe("vitrine de destaques", () => {
  test("painel administrativo lista destaques e disponíveis", async () => {
    const r = await api("GET", "/api/admin/destaques");
    assert.equal(r.status, 200);
    assert.equal(r.json.quantidade, 6);
    assert.equal(r.json.destaques.length, 6);
    assert.ok(r.json.disponiveis.every((p) => p.destaque === false));
  });

  test("não cria 7º destaque por criação nem por adição", async () => {
    const criar = await api("POST", "/api/imoveis", { body: baseProperty({ destaque: true }) });
    assert.equal(criar.status, 409);
    assert.match(criar.json.mensagem, /Use 'Trocar imóvel'/);

    const adicionar = await api("POST", `/api/imoveis/${nonFeaturedId()}/destaque`, { body: {} });
    assert.equal(adicionar.status, 409);
  });

  test("não exclui nem remove um dos 6 destaques", async () => {
    const featured = listFeaturedIds()[0];
    assert.equal((await api("DELETE", `/api/imoveis/${featured}`)).status, 409);
    assert.equal((await api("DELETE", `/api/imoveis/${featured}/destaque`)).status, 409);
  });

  test("troca atômica de destaque mantém exatamente 6", async () => {
    const [oldId] = listFeaturedIds();
    const newId = nonFeaturedId();
    const r = await api("POST", "/api/imoveis/destaques/trocar", { body: { antigoId: oldId, novoId: newId } });
    assert.equal(r.status, 200);
    assert.equal(r.json.quantidade, 6);
    const ids = listFeaturedIds();
    assert.equal(ids.length, 6);
    assert.ok(ids.includes(newId));
    assert.ok(!ids.includes(oldId));
  });

  test("troca recusa casos inválidos", async () => {
    const [current] = listFeaturedIds();
    const notFeatured = nonFeaturedId();
    assert.equal((await api("POST", "/api/imoveis/destaques/trocar", { body: { antigoId: current, novoId: current } })).status, 409);
    assert.equal((await api("POST", "/api/imoveis/destaques/trocar", { body: { antigoId: notFeatured, novoId: notFeatured } })).status, 409);
    assert.equal((await api("POST", "/api/imoveis/destaques/trocar", { body: { antigoId: current, novoId: 999999 } })).status, 404);
  });

  test("adiciona destaque quando a vitrine tem exatamente 5", async () => {
    const [victim] = listFeaturedIds();
    db.prepare("UPDATE properties SET destaque = 0 WHERE id = ?").run(victim);
    const r = await api("POST", `/api/imoveis/${victim}/destaque`, { body: {} });
    assert.equal(r.status, 200);
    assert.equal(r.json.quantidade, 6);
    assert.equal(listFeaturedIds().length, 6);
  });

  test("o banco impede o 7º destaque mesmo fora da API", () => {
    assert.throws(
      () => db.prepare("UPDATE properties SET destaque = 1 WHERE destaque = 0").run(),
      /máximo 6 imóveis em destaque/
    );
    assert.equal(listFeaturedIds().length, 6);
  });
});

describe("fotos", () => {
  let propertyId;

  before(async () => {
    propertyId = (await api("POST", "/api/imoveis", { body: baseProperty({ titulo: "Imóvel com fotos" }) })).json.id;
  });

  test("envia JPEG e PNG válidos, define a principal e serve os arquivos", async () => {
    const form = multipart([
      { field: "fotos", filename: "sala.jpg", type: "image/jpeg", data: JPEG },
      { field: "fotos", filename: "cozinha.png", type: "image/png", data: PNG },
    ]);
    const r = await api("POST", `/api/imoveis/${propertyId}/fotos`, { raw: form.body, contentType: form.contentType });
    assert.equal(r.status, 201);
    assert.equal(r.json.fotos.length, 2);
    assert.equal(r.json.imagemPrincipal, r.json.fotos[0]);

    const served = await fetch(`${base}${r.json.fotos[0]}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), JPEG);

    const png = await fetch(`${base}${r.json.fotos[1]}`);
    assert.equal(png.headers.get("content-type"), "image/png");
  });

  test("recusa arquivo que não é imagem mesmo com tipo declarado", async () => {
    const form = multipart([{ field: "fotos", filename: "falso.jpg", type: "image/jpeg", data: Buffer.from("texto puro") }]);
    const r = await api("POST", `/api/imoveis/${propertyId}/fotos`, { raw: form.body, contentType: form.contentType });
    assert.equal(r.status, 400);
    assert.match(r.json.mensagem, /Arquivo de imagem inválido/);
  });

  test("recusa extensão incompatível com o conteúdo", async () => {
    const form = multipart([{ field: "fotos", filename: "foto.exe", type: "image/jpeg", data: JPEG }]);
    const r = await api("POST", `/api/imoveis/${propertyId}/fotos`, { raw: form.body, contentType: form.contentType });
    assert.equal(r.status, 400);
  });

  test("exige multipart e imóvel existente", async () => {
    const semMultipart = await api("POST", `/api/imoveis/${propertyId}/fotos`, { body: {} });
    assert.equal(semMultipart.status, 400);
    const form = multipart([{ field: "fotos", filename: "a.jpg", type: "image/jpeg", data: JPEG }]);
    const naoExiste = await api("POST", "/api/imoveis/999999/fotos", { raw: form.body, contentType: form.contentType });
    assert.equal(naoExiste.status, 404);
  });

  test("troca a imagem principal e rejeita foto de outro imóvel", async () => {
    const current = (await api("GET", `/api/imoveis/${propertyId}`, { auth: null })).json;
    const second = current.fotos[1];
    const ok = await api("PUT", `/api/imoveis/${propertyId}/imagem-principal`, { body: { foto: second } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.imagemPrincipal, second);

    const outra = (await api("GET", "/api/imoveis/1", { auth: null })).json.fotos[0] || "/media/1/inexistente.jpg";
    const invalida = await api("PUT", `/api/imoveis/${propertyId}/imagem-principal`, { body: { foto: outra } });
    assert.equal(invalida.status, 400);
  });

  test("remove foto, apaga o arquivo e reatribui a principal", async () => {
    const before = (await api("GET", `/api/imoveis/${propertyId}`, { auth: null })).json;
    const removed = before.imagemPrincipal;
    const r = await api("DELETE", `/api/imoveis/${propertyId}/fotos`, { body: { foto: removed } });
    assert.equal(r.status, 200);
    assert.equal(r.json.fotos.length, before.fotos.length - 1);
    assert.notEqual(r.json.imagemPrincipal, removed);
    assert.equal((await fetch(`${base}${removed}`)).status, 404);
  });

  test("foto legada sem arquivo no disco responde 404 sem derrubar o servidor", async () => {
    const r = await fetch(`${base}/media/1/nao-existe-no-disco.jpeg`);
    assert.equal(r.status, 404);
    assert.equal((await api("GET", "/api/health", { auth: null })).status, 200);
  });

  test("caminhos de mídia fora do padrão são bloqueados", async () => {
    assert.equal((await fetch(`${base}/media/../../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/media/1/..%2F..%2Fsecret.jpg`)).status, 404);
  });
});

describe("CORS", () => {
  test("permite a origem configurada", async () => {
    const r = await api("OPTIONS", "/api/imoveis", { auth: null, origin: ORIGIN });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(r.headers.get("access-control-allow-credentials"), "true");
  });

  test("não libera origens desconhecidas", async () => {
    const r = await api("GET", "/api/imoveis", { auth: null, origin: "https://site-malicioso.exemplo" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), null);
  });
});

describe("limite de tentativas de login", () => {
  let limitedServer;
  let limitedBase;

  before(async () => {
    limitedServer = http.createServer(createApp({ db, config }));
    await new Promise((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
    limitedBase = `http://127.0.0.1:${limitedServer.address().port}`;
  });

  after(async () => {
    limitedServer.closeAllConnections();
    await new Promise((resolve) => limitedServer.close(resolve));
  });

  test("bloqueia após 10 falhas e libera com a senha correta depois do bloqueio", async () => {
    const attempt = (senha) =>
      fetch(`${limitedBase}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: ADMIN_EMAIL, senha }),
      });
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await attempt("errada")).status, 401);
    }
    assert.equal((await attempt(ADMIN_PASSWORD)).status, 429);
  });
});

describe("origens padrão do Live Server (VS Code)", () => {
  test("aceita as portas 5500 e 5502 do Live Server por padrão", () => {
    const defaults = loadConfig({ AUTH_SECRET: "x".repeat(48) });
    assert.ok(defaults.frontendOrigins.includes("http://localhost:5502"));
    assert.ok(defaults.frontendOrigins.includes("http://127.0.0.1:5500"));
  });

  test("exige AUTH_SECRET e, em produção, chave com pelo menos 32 caracteres", () => {
    assert.throws(() => loadConfig({}), /AUTH_SECRET é obrigatório/);
    assert.throws(() => loadConfig({ NODE_ENV: "production", AUTH_SECRET: "curta" }), /32 caracteres/);
    assert.doesNotThrow(() => loadConfig({ NODE_ENV: "production", AUTH_SECRET: "y".repeat(40) }));
  });
});

describe("erros padronizados e cabeçalhos de segurança", () => {
  test("erro traz código, mensagem, detalhes e traceId; X-Request-Id é repetido", async () => {
    const r = await api("GET", "/api/imoveis/999999", { auth: null });
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, "NOT_FOUND");
    assert.equal(r.json.error.message, "Imóvel não encontrado.");
    assert.equal(r.json.mensagem, "Imóvel não encontrado.");
    assert.ok(r.json.error.traceId);
    assert.equal(r.headers.get("x-request-id"), r.json.error.traceId);
  });

  test("X-Request-Id do cliente é reaproveitado quando seguro", async () => {
    const r = await fetch(`${base}/api/health`, { headers: { "X-Request-Id": "req-teste-12345" } });
    assert.equal(r.headers.get("x-request-id"), "req-teste-12345");
  });

  test("X-Request-Id inseguro é substituído", async () => {
    const r = await fetch(`${base}/api/health`, { headers: { "X-Request-Id": "<script>x</script>" } });
    assert.notEqual(r.headers.get("x-request-id"), "<script>x</script>");
  });

  test("cabeçalhos de segurança estão presentes", async () => {
    const r = await api("GET", "/api/imoveis", { auth: null });
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  });
});

describe("contrato administrativo /api/admin/imoveis e /api/auth/me", () => {
  let draftId;

  test("/api/auth/me exige sessão e devolve só dados não sensíveis", async () => {
    assert.equal((await api("GET", "/api/auth/me", { auth: null })).status, 401);
    const r = await api("GET", "/api/auth/me");
    assert.equal(r.status, 200);
    assert.equal(r.json.email, ADMIN_EMAIL);
    assert.equal(r.json.role, "Admin");
    assert.equal(r.json.password_hash, undefined);
  });

  test("rascunho aparece no painel, mas não na API pública", async () => {
    const created = await api("POST", "/api/admin/imoveis", { body: baseProperty({ titulo: "Rascunho oculto", status: "Rascunho" }) });
    assert.equal(created.status, 201);
    draftId = created.json.id;

    const admin = await api("GET", "/api/admin/imoveis");
    assert.ok(admin.json.some((p) => p.id === draftId));

    const publicList = await api("GET", "/api/imoveis", { auth: null });
    assert.ok(!publicList.json.some((p) => p.id === draftId));
    assert.equal((await api("GET", `/api/imoveis/${draftId}`, { auth: null })).status, 404);
    assert.equal((await api("GET", `/api/admin/imoveis/${draftId}`)).status, 200);
  });

  test("rascunho não pode ser destacado", async () => {
    const r = await api("POST", "/api/admin/imoveis/destaques", { body: { imovelId: draftId } });
    assert.equal(r.status, 409);
    assert.match(r.json.error.message, /Rascunhos não podem ser destacados/);
  });

  test("PATCH status valida o valor e impede rascunho em destaque", async () => {
    const invalid = await api("PATCH", `/api/admin/imoveis/${draftId}/status`, { body: { status: "Inventado" } });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error.code, "VALIDATION_ERROR");

    const ok = await api("PATCH", `/api/admin/imoveis/${draftId}/status`, { body: { status: "Disponível" } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.status, "Disponível");
    assert.equal((await api("GET", `/api/imoveis/${draftId}`, { auth: null })).status, 200);

    const featured = listFeaturedIds()[0];
    const blocked = await api("PATCH", `/api/admin/imoveis/${featured}/status`, { body: { status: "Rascunho" } });
    assert.equal(blocked.status, 409);
  });

  test("destaques pelo contrato novo: listar, trocar e manter 6", async () => {
    const list = await api("GET", "/api/admin/imoveis/destaques");
    assert.equal(list.status, 200);
    assert.equal(list.json.quantidade, 6);

    const [oldId] = listFeaturedIds();
    const newId = nonFeaturedId();
    const swap = await api("PUT", "/api/admin/imoveis/destaques/trocar", { body: { antigoId: oldId, novoId: newId } });
    assert.equal(swap.status, 200);
    assert.equal(listFeaturedIds().length, 6);
    assert.ok(listFeaturedIds().includes(newId));
  });

  test("imagens: upload, listagem com id, principal por id e exclusão por id", async () => {
    const pid = (await api("POST", "/api/admin/imoveis", { body: baseProperty({ titulo: "Com imagens" }) })).json.id;
    const form = multipart([
      { field: "fotos", filename: "a.jpg", type: "image/jpeg", data: JPEG },
      { field: "fotos", filename: "b.png", type: "image/png", data: PNG },
    ]);
    const up = await api("POST", `/api/admin/imoveis/${pid}/imagens`, { raw: form.body, contentType: form.contentType });
    assert.equal(up.status, 201);

    const list = await api("GET", `/api/admin/imoveis/${pid}/imagens`);
    assert.equal(list.status, 200);
    assert.equal(list.json.length, 2);
    const [first, second] = list.json;
    assert.ok(first.id && first.url && typeof first.principal === "boolean");

    const main = await api("PATCH", `/api/admin/imoveis/${pid}/imagens/${second.id}/principal`);
    assert.equal(main.status, 200);
    assert.equal(main.json.imagemPrincipal, second.url);

    const foreign = await api("PATCH", `/api/admin/imoveis/${pid}/imagens/999999/principal`);
    assert.equal(foreign.status, 404);

    const del = await api("DELETE", `/api/admin/imoveis/${pid}/imagens/${first.id}`);
    assert.equal(del.status, 200);
    assert.equal(del.json.fotos.length, 1);
    assert.equal((await fetch(`${base}${first.url}`)).status, 404);

    const publicImgs = await api("GET", `/api/imoveis/${pid}/imagens`, { auth: null });
    assert.equal(publicImgs.status, 200);
    assert.equal(publicImgs.json.length, 1);
  });

  test("tentativa sem sessão em rotas administrativas novas é bloqueada", async () => {
    assert.equal((await api("GET", "/api/admin/imoveis", { auth: null })).status, 401);
    assert.equal((await api("PATCH", "/api/admin/imoveis/1/status", { body: { status: "Vendido" }, auth: null })).status, 401);
    assert.equal((await api("DELETE", "/api/admin/imoveis/1/imagens/1", { auth: null })).status, 401);
  });

  test("health/ready informa apenas o estado geral, sem detalhes internos", async () => {
    const r = await api("GET", "/api/health/ready", { auth: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { status: "ready" });
    assert.ok(!/arino|sqlite|\//i.test(r.text));
  });
});

describe("limite de requisições por IP", () => {
  let tinyServer;
  let tinyBase;

  before(async () => {
    const tinyConfig = loadConfig({
      AUTH_SECRET: "y".repeat(48),
      DB_FILE: path.join(tmp, "test.sqlite"),
      UPLOADS_DIR: path.join(tmp, "uploads"),
      FRONTEND_ORIGINS: ORIGIN,
      RATE_PUBLIC_PER_MINUTE: "3",
      RATE_ADMIN_PER_MINUTE: "100000",
    });
    tinyServer = http.createServer(createApp({ db, config: tinyConfig }));
    await new Promise((resolve) => tinyServer.listen(0, "127.0.0.1", resolve));
    tinyBase = `http://127.0.0.1:${tinyServer.address().port}`;
  });

  after(async () => {
    tinyServer.closeAllConnections();
    await new Promise((resolve) => tinyServer.close(resolve));
  });

  test("bloqueia com 429, Retry-After e código RATE_LIMITED; health não é limitado", async () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await fetch(`${tinyBase}/api/imoveis`)).status, 200);
    }
    const blocked = await fetch(`${tinyBase}/api/imoveis`);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
    const body = await blocked.json();
    assert.equal(body.error.code, "RATE_LIMITED");

    assert.equal((await fetch(`${tinyBase}/api/health`)).status, 200);
  });
});