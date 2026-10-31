"use strict";

/**
 * Acesso ao banco para imóveis, fotos e vitrine de destaques.
 * Todas as funções recebem a conexão `db` explicitamente.
 */

const { mimeFromStorageName } = require("./media");

const SELECT_PROPERTY = `
  SELECT id, titulo, tipo, preco, cidade, estado, localizacao, descricao,
         area, quartos, banheiros, vagas, status, destaque, imagem_principal_id
  FROM properties`;

function photoUrl(photo) {
  return `/media/${photo.property_id}/${photo.storage_name}`;
}

/** Converte linhas do banco no formato JSON que o frontend já consome. */
function toApi(row, photos) {
  const fotos = photos.map(photoUrl);
  const main = row.imagem_principal_id ? photos.find((p) => p.id === row.imagem_principal_id) : null;
  return {
    id: row.id,
    titulo: row.titulo,
    tipo: row.tipo,
    preco: row.preco,
    cidade: row.cidade,
    estado: row.estado,
    localizacao: row.localizacao,
    descricao: row.descricao,
    area: row.area,
    quartos: row.quartos,
    banheiros: row.banheiros,
    vagas: row.vagas,
    destaque: row.destaque === 1,
    fotos,
    imagens: photos.map((photo) => ({
      id: photo.id,
      url: photoUrl(photo),
      principal: main ? photo.id === main.id : false,
    })),
    imagemPrincipal: main ? photoUrl(main) : fotos[0] || "",
    status: row.status,
    vendido: row.status === "Vendido",
  };
}

function photosByProperty(db, propertyIds) {
  const map = new Map();
  if (!propertyIds.length) return map;
  const placeholders = propertyIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, property_id, storage_name, position FROM property_photos
       WHERE property_id IN (${placeholders}) ORDER BY property_id, position, id`
    )
    .all(...propertyIds);
  for (const photo of rows) {
    if (!map.has(photo.property_id)) map.set(photo.property_id, []);
    map.get(photo.property_id).push(photo);
  }
  return map;
}

function hydrate(db, rows) {
  const photos = photosByProperty(db, rows.map((row) => row.id));
  return rows.map((row) => toApi(row, photos.get(row.id) || []));
}

function escapeLike(term) {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Lista com filtros opcionais: tipo (exato), cidade (contém), q (texto livre). */
function listProperties(db, filters = {}, opts = { publicOnly: true }) {
  const where = [];
  const params = [];
  // Rascunhos só aparecem para o painel administrativo.
  if (opts.publicOnly !== false) where.push("status <> 'Rascunho'");
  if (filters.tipo) {
    where.push("tipo = ? COLLATE NOCASE");
    params.push(filters.tipo);
  }
  if (filters.cidade) {
    where.push("cidade LIKE ? ESCAPE '\\' COLLATE NOCASE");
    params.push(`%${escapeLike(filters.cidade)}%`);
  }
  if (filters.q) {
    const like = `%${escapeLike(filters.q)}%`;
    where.push(
      "(titulo LIKE ? ESCAPE '\\' OR localizacao LIKE ? ESCAPE '\\' OR descricao LIKE ? ESCAPE '\\' OR cidade LIKE ? ESCAPE '\\')"
    );
    params.push(like, like, like, like);
  }
  const sql = `${SELECT_PROPERTY}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id`;
  return hydrate(db, db.prepare(sql).all(...params));
}

function getPropertyRow(db, id) {
  return db.prepare(`${SELECT_PROPERTY} WHERE id = ?`).get(Number(id)) || null;
}

function getProperty(db, id, opts = { publicOnly: false }) {
  const row = getPropertyRow(db, id);
  if (!row) return null;
  if (opts.publicOnly && row.status === "Rascunho") return null;
  return hydrate(db, [row])[0];
}

function listFeatured(db, opts = { publicOnly: false }) {
  const publicFilter = opts.publicOnly ? " AND status <> 'Rascunho'" : "";
  return hydrate(db, db.prepare(`${SELECT_PROPERTY} WHERE destaque = 1${publicFilter} ORDER BY id`).all());
}

function setStatus(db, id, status) {
  db.prepare("UPDATE properties SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    new Date().toISOString(),
    Number(id)
  );
}

function listNotFeatured(db) {
  return hydrate(db, db.prepare(`${SELECT_PROPERTY} WHERE destaque = 0 ORDER BY id`).all());
}

function featuredCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM properties WHERE destaque = 1").get().n;
}

function insertProperty(db, value) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO properties (titulo, tipo, preco, cidade, estado, localizacao, descricao,
         area, quartos, banheiros, vagas, status, destaque, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      value.titulo,
      value.tipo,
      value.preco,
      value.cidade,
      value.estado,
      value.localizacao,
      value.descricao,
      value.area,
      value.quartos,
      value.banheiros,
      value.vagas,
      value.status,
      value.destaque ? 1 : 0,
      now,
      now
    );
  return Number(result.lastInsertRowid);
}

function updatePropertyRow(db, id, value) {
  db.prepare(
    `UPDATE properties SET titulo = ?, tipo = ?, preco = ?, cidade = ?, estado = ?, localizacao = ?,
       descricao = ?, area = ?, quartos = ?, banheiros = ?, vagas = ?, status = ?, destaque = ?,
       updated_at = ?
     WHERE id = ?`
  ).run(
    value.titulo,
    value.tipo,
    value.preco,
    value.cidade,
    value.estado,
    value.localizacao,
    value.descricao,
    value.area,
    value.quartos,
    value.banheiros,
    value.vagas,
    value.status,
    value.destaque ? 1 : 0,
    new Date().toISOString(),
    Number(id)
  );
}

function setFeatured(db, id, featured) {
  db.prepare("UPDATE properties SET destaque = ?, updated_at = ? WHERE id = ?").run(
    featured ? 1 : 0,
    new Date().toISOString(),
    Number(id)
  );
}

/** Remove o imóvel. As fotos somem por CASCADE; devolve os nomes dos arquivos para apagar do disco. */
function deleteProperty(db, id) {
  const files = db
    .prepare("SELECT storage_name FROM property_photos WHERE property_id = ?")
    .all(Number(id))
    .map((row) => row.storage_name);
  db.prepare("DELETE FROM properties WHERE id = ?").run(Number(id));
  return files;
}

function photoRowsFor(db, propertyId) {
  return db
    .prepare("SELECT id, storage_name FROM property_photos WHERE property_id = ? ORDER BY position, id")
    .all(Number(propertyId));
}

function insertPhoto(db, propertyId, photo, position) {
  const result = db
    .prepare(
      `INSERT INTO property_photos (property_id, storage_name, mime_type, size_bytes, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      Number(propertyId),
      photo.storageName,
      photo.mime,
      photo.sizeBytes,
      position,
      new Date().toISOString()
    );
  return Number(result.lastInsertRowid);
}

/** Localiza a foto de um imóvel pelo caminho público (/media/{id}/{arquivo}). */
function findPhotoByUrl(db, propertyId, url) {
  const match = String(url || "").match(/\/media\/(\d+)\/([^/?#]+)$/);
  if (!match || Number(match[1]) !== Number(propertyId)) return null;
  return (
    db
      .prepare("SELECT id, storage_name FROM property_photos WHERE property_id = ? AND storage_name = ?")
      .get(Number(propertyId), decodeURIComponent(match[2])) || null
  );
}

function setMainPhoto(db, propertyId, photoId) {
  db.prepare("UPDATE properties SET imagem_principal_id = ?, updated_at = ? WHERE id = ?").run(
    photoId,
    new Date().toISOString(),
    Number(propertyId)
  );
}

function deletePhoto(db, propertyId, photoId) {
  const photo = db
    .prepare("SELECT id, storage_name FROM property_photos WHERE id = ? AND property_id = ?")
    .get(photoId, Number(propertyId));
  if (!photo) return null;
  db.prepare("DELETE FROM property_photos WHERE id = ?").run(photoId);
  const property = getPropertyRow(db, propertyId);
  if (property && property.imagem_principal_id === photoId) {
    const next = photoRowsFor(db, propertyId)[0];
    setMainPhoto(db, propertyId, next ? next.id : null);
  }
  return photo;
}

module.exports = {
  toApi,
  mimeFromStorageName,
  listProperties,
  getProperty,
  getPropertyRow,
  listFeatured,
  listNotFeatured,
  featuredCount,
  insertProperty,
  updatePropertyRow,
  setFeatured,
  deleteProperty,
  photoRowsFor,
  insertPhoto,
  findPhotoByUrl,
  setMainPhoto,
  deletePhoto,
  setStatus,
};