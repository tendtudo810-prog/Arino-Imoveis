const fs = require("node:fs");
const path = require("node:path");

const backendDirectory = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendDirectory, "..");
const sourceFile = path.join(backendDirectory, "data", "imoveis.json");
const outputDirectory = path.join(__dirname, "exports", `json-${new Date().toISOString().replace(/[:.]/g, "-")}`);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function readProperties() {
    const properties = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
    if (!Array.isArray(properties)) throw new Error("backend/data/imoveis.json não contém uma lista válida.");
    return properties;
}

function writeJson(fileName, data) {
    fs.writeFileSync(path.join(outputDirectory, fileName), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function getLegacyImages(property) {
    if (!property.diretorioImagens) return [];
    const directory = path.join(projectRoot, property.diretorioImagens);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
        .filter((file) => imageExtensions.has(path.extname(file).toLowerCase()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((file) => ({
            property_id: property.id,
            storage_path: `${property.diretorioImagens}/${file}`,
            original_filename: file,
            mime_type: path.extname(file).toLowerCase() === ".png" ? "image/png" : path.extname(file).toLowerCase() === ".webp" ? "image/webp" : "image/jpeg",
            size_bytes: fs.statSync(path.join(directory, file)).size,
            is_legacy: true
        }));
}

function main() {
    const properties = readProperties();
    fs.mkdirSync(outputDirectory, { recursive: true });

    writeJson("properties.json", properties.map((property) => ({
        id: property.id,
        titulo: property.titulo,
        tipo: property.tipo,
        preco: property.preco,
        cidade: property.cidade,
        estado: property.estado,
        localizacao: property.localizacao || "",
        descricao: property.descricao || "",
        area: property.area ?? null,
        quartos: property.quartos ?? null,
        banheiros: property.banheiros ?? null,
        vagas: property.vagas ?? null,
        status: property.status || (property.vendido ? "Vendido" : "Disponível"),
        vendido: property.vendido === true,
        imagem_principal: property.imagemPrincipal || "",
        diretorio_imagens_legado: property.diretorioImagens || null
    })));

    writeJson("featured_properties.json", properties
        .filter((property) => property.destaque === true)
        .map((property, index) => ({ position: index + 1, property_id: property.id })));

    writeJson("property_images.json", properties.flatMap((property) => [
        ...getLegacyImages(property),
        ...(Array.isArray(property.fotos) ? property.fotos : []).map((storagePath) => ({
            property_id: property.id,
            storage_path: storagePath,
            original_filename: null,
            mime_type: null,
            size_bytes: null,
            is_legacy: false
        }))
    ]));

    fs.writeFileSync(path.join(outputDirectory, "MANIFEST.txt"), [
        "Exportação somente leitura para preparação PostgreSQL.",
        `Fonte: ${sourceFile}`,
        `Imóveis: ${properties.length}`,
        `Destaques: ${properties.filter((property) => property.destaque === true).length}`,
        "Nenhum arquivo de origem foi alterado.",
        "Não contém senha, hash de senha, JWT secret ou connection string."
    ].join("\n") + "\n", "utf8");

    console.log(`Exportação criada em ${outputDirectory}`);
}

try {
    main();
} catch (error) {
    console.error(`Exportação interrompida: ${error.message}`);
    process.exitCode = 1;
}
