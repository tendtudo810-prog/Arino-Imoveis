const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const test = require("node:test");
const bcrypt = require("bcryptjs");

const serverFile = path.join(__dirname, "..", "server.js");
const adminEmail = "integration-test@arino.invalid";
const adminPassword = "integration-test-password";
const authSecret = "integration-test-secret";
const authIssuer = "arino-imoveis-api";
const authAudience = "arino-imoveis-admin";
const passwordHash = bcrypt.hashSync(adminPassword, 4);

test("produção recusa caminhos relativos para o storage", () => {
    const result = spawnSync(process.execPath, [serverFile], {
        cwd: path.join(__dirname, "..", ".."),
        env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: "5254",
            DATA_FILE: path.join("backend", "data", "imoveis.json"),
            UPLOADS_DIR: path.join("backend", "uploads")
        },
        encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATA_FILE deve apontar para um caminho absoluto/);
});

test("produção não recria o JSON versionado quando o arquivo persistente falta", (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arino-missing-storage-test-"));
    const dataFile = path.join(directory, "data", "imoveis.json");
    const result = spawnSync(process.execPath, [serverFile], {
        cwd: path.join(__dirname, "..", ".."),
        env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: "5254",
            DATA_FILE: dataFile,
            UPLOADS_DIR: path.join(directory, "uploads")
        },
        encoding: "utf8"
    });

    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DATA_FILE não existe no armazenamento persistente/);
    assert.equal(fs.existsSync(dataFile), false);
});

async function findFreePort() {
    const listener = net.createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const { port } = listener.address();
    await new Promise((resolve, reject) => {
        listener.close((error) => error ? reject(error) : resolve());
    });
    return port;
}

async function startApi(directory, port) {
    const storageDirectory = path.join(directory, "persistent-storage");
    const dataFile = path.join(storageDirectory, "data", "imoveis.json");
    const uploadsDirectory = path.join(storageDirectory, "uploads");
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });

    const child = spawn(process.execPath, [serverFile], {
        cwd: directory,
        env: {
            ...process.env,
            NODE_ENV: "production",
            PORT: String(port),
            DATA_FILE: dataFile,
            UPLOADS_DIR: uploadsDirectory,
            ADMIN_EMAIL: adminEmail,
            ADMIN_PASSWORD_HASH: passwordHash,
            AUTH_SECRET: authSecret,
            AUTH_ISSUER: authIssuer,
            AUTH_AUDIENCE: authAudience
        },
        stdio: ["ignore", "pipe", "pipe"]
    });

    let output = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (child.exitCode !== null) {
            throw new Error(`API encerrou ao iniciar:\n${output}`);
        }

        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
                headers: { Connection: "close" }
            });
            if (response.ok) {
                return { child, dataFile, output: () => output };
            }
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    child.kill();
    throw new Error(`API não iniciou:\n${output}`);
}

async function stopApi(child) {
    if (child.exitCode !== null) return;

    child.kill("SIGTERM");
    const stopped = await waitForExit(child, 5000);

    if (!stopped) {
        child.kill("SIGKILL");
        if (!await waitForExit(child, 5000)) {
            throw new Error("Não foi possível encerrar o processo da API de teste.");
        }
    }
}

function waitForExit(child, timeoutMs) {
    if (child.exitCode !== null) return Promise.resolve(true);

    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            child.removeListener("exit", onExit);
            resolve(false);
        }, timeoutMs);

        function onExit() {
            clearTimeout(timeout);
            resolve(true);
        }

        child.once("exit", onExit);
    });
}

async function apiRequest(port, endpoint, options = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
        ...options,
        headers: {
            Connection: "close",
            ...(typeof options.body === "string"
                ? { "Content-Type": "application/json" }
                : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
            ...options.headers
        }
    });
    const data = await response.json();
    return { status: response.status, data };
}

async function login(port) {
    const response = await apiRequest(port, "/api/Auth/login", {
        method: "POST",
        body: JSON.stringify({
            email: adminEmail,
            senha: adminPassword
        })
    });
    assert.equal(response.status, 200);
    assert.equal(response.data.autenticado, true);
    return response.data.token;
}

function property(id, featured = false) {
    return {
        id,
        titulo: `Imóvel de teste ${id}`,
        tipo: "Casa",
        preco: 100000,
        cidade: "Valparaíso",
        estado: "GO",
        localizacao: "Valparaíso - GO",
        descricao: "Imóvel de teste de integração.",
        area: 80,
        quartos: 2,
        banheiros: 1,
        vagas: 1,
        destaque: featured,
        fotos: [],
        imagemPrincipal: "",
        status: "Disponível"
    };
}

test("criação e exclusão persistem como lista vazia após reiniciar a API", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arino-persistence-test-"));
    const port = await findFreePort();
    const dataFile = path.join(directory, "persistent-storage", "data", "imoveis.json");
    let api;

    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "[]\n", "utf8");

    t.after(async () => {
        if (api) await stopApi(api.child);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    api = await startApi(directory, port);
    const token = await login(port);
    const created = await apiRequest(port, "/api/Imoveis", {
        method: "POST",
        token,
        body: JSON.stringify(property(0))
    });

    assert.equal(created.status, 201);
    const createdId = created.data.id;
    let list = await apiRequest(port, "/api/Imoveis");
    assert.equal(list.status, 200);
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].id, createdId);

    const deleted = await apiRequest(port, `/api/Imoveis/${createdId}`, {
        method: "DELETE",
        token
    });
    assert.equal(deleted.status, 200);

    list = await apiRequest(port, "/api/Imoveis");
    assert.deepEqual(list.data, []);
    assert.deepEqual(JSON.parse(fs.readFileSync(api.dataFile, "utf8")), []);

    await stopApi(api.child);
    api = await startApi(directory, port);
    list = await apiRequest(port, "/api/Imoveis");
    assert.equal(list.status, 200);
    assert.deepEqual(list.data, []);
});

test("fotos enviadas permanecem acessíveis após reiniciar a API", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arino-uploads-test-"));
    const port = await findFreePort();
    const dataFile = path.join(directory, "persistent-storage", "data", "imoveis.json");
    const uploadsDirectory = path.join(directory, "persistent-storage", "uploads");
    let api;

    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile, "[]\n", "utf8");

    t.after(async () => {
        if (api) await stopApi(api.child);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    api = await startApi(directory, port);
    const token = await login(port);
    const created = await apiRequest(port, "/api/Imoveis", {
        method: "POST",
        token,
        body: JSON.stringify(property(0))
    });
    assert.equal(created.status, 201);

    const photoBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const form = new FormData();
    form.append("fotos", new Blob([photoBytes], { type: "image/jpeg" }), "teste.jpg");

    const uploaded = await apiRequest(
        port,
        `/api/Imoveis/${created.data.id}/fotos`,
        {
            method: "POST",
            token,
            body: form
        }
    );
    assert.equal(uploaded.status, 201);
    const photoUrl = uploaded.data.fotos[0];
    assert.match(photoUrl, /^\/media\//);

    const relativePhotoPath = photoUrl
        .slice("/media/".length)
        .split("/")
        .map(decodeURIComponent);
    const storedPhotoPath = path.join(uploadsDirectory, ...relativePhotoPath);
    assert.deepEqual(fs.readFileSync(storedPhotoPath), photoBytes);

    await stopApi(api.child);
    api = await startApi(directory, port);

    const propertyAfterRestart = await apiRequest(
        port,
        `/api/Imoveis/${created.data.id}`
    );
    assert.equal(propertyAfterRestart.status, 200);
    assert.equal(propertyAfterRestart.data.fotos[0], photoUrl);

    const servedPhoto = await fetch(
        `http://127.0.0.1:${port}${photoUrl}`,
        { headers: { Connection: "close" } }
    );
    assert.equal(servedPhoto.status, 200);
    assert.deepEqual(
        Buffer.from(await servedPhoto.arrayBuffer()),
        photoBytes
    );
});

test("troca autenticada é atômica, limita a seis destaques e sobrevive ao reinício", async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "arino-featured-test-"));
    const port = await findFreePort();
    const storageDirectory = path.join(directory, "persistent-storage");
    const dataFile = path.join(storageDirectory, "data", "imoveis.json");
    let api;

    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(
        dataFile,
        `${JSON.stringify([
            ...Array.from({ length: 5 }, (_, index) => property(index + 1, true)),
            property(6),
            property(7)
        ], null, 2)}\n`,
        "utf8"
    );

    t.after(async () => {
        if (api) await stopApi(api.child);
        fs.rmSync(directory, { recursive: true, force: true });
    });

    api = await startApi(directory, port);
    const token = await login(port);

    const unauthorizedAdd = await apiRequest(
        port,
        "/api/Imoveis/6/destaque",
        { method: "POST" }
    );
    assert.equal(unauthorizedAdd.status, 401);

    const addedSixthHighlight = await apiRequest(
        port,
        "/api/Imoveis/6/destaque",
        { method: "POST", token }
    );
    assert.equal(addedSixthHighlight.status, 200);
    assert.equal(addedSixthHighlight.data.quantidade, 6);

    const unauthorizedSwap = await apiRequest(
        port,
        "/api/Imoveis/destaques/trocar",
        {
            method: "POST",
            body: JSON.stringify({ antigoId: 1, novoId: 7 })
        }
    );
    assert.equal(unauthorizedSwap.status, 401);

    const seventhHighlight = await apiRequest(
        port,
        "/api/Imoveis/7/destaque",
        { method: "POST", token }
    );
    assert.equal(seventhHighlight.status, 409);

    const unauthorizedRemove = await apiRequest(
        port,
        "/api/Imoveis/1/destaque",
        { method: "DELETE" }
    );
    assert.equal(unauthorizedRemove.status, 401);

    const removalThatWouldLeaveFive = await apiRequest(
        port,
        "/api/Imoveis/1/destaque",
        { method: "DELETE", token }
    );
    assert.equal(removalThatWouldLeaveFive.status, 409);

    const invalidSwap = await apiRequest(
        port,
        "/api/Imoveis/destaques/trocar",
        {
            method: "POST",
            token,
            body: JSON.stringify({ antigoId: 99, novoId: 7 })
        }
    );
    assert.equal(invalidSwap.status, 404);

    const swapped = await apiRequest(
        port,
        "/api/Imoveis/destaques/trocar",
        {
            method: "POST",
            token,
            body: JSON.stringify({ antigoId: 1, novoId: 7 })
        }
    );
    assert.equal(swapped.status, 200);
    assert.equal(swapped.data.quantidade, 6);
    assert.equal(swapped.data.destaques.length, 6);
    assert.equal(swapped.data.destaques.some((item) => item.id === 1), false);
    assert.equal(swapped.data.destaques.some((item) => item.id === 7), true);

    const allProperties = await apiRequest(port, "/api/Imoveis");
    assert.equal(allProperties.data.filter((item) => item.destaque).length, 6);
    assert.equal(allProperties.data.find((item) => item.id === 1).destaque, false);
    assert.equal(allProperties.data.find((item) => item.id === 7).destaque, true);

    const publicHighlights = await apiRequest(port, "/api/Imoveis/destaques");
    assert.equal(publicHighlights.data.length, 6);
    assert.equal(publicHighlights.data.some((item) => item.id === 7), true);

    await stopApi(api.child);
    api = await startApi(directory, port);

    const persistedHighlights = await apiRequest(port, "/api/Imoveis/destaques");
    assert.equal(persistedHighlights.status, 200);
    assert.equal(persistedHighlights.data.length, 6);
    assert.equal(persistedHighlights.data.some((item) => item.id === 1), false);
    assert.equal(persistedHighlights.data.some((item) => item.id === 7), true);
});
