-- Arino Imóveis production schema preparation.
-- This file is intentionally additive and is NOT executed by the application yet.
-- It does not alter backend/data/imoveis.json or existing image directories.

CREATE TABLE IF NOT EXISTS admins (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Admin',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS properties (
    id BIGINT PRIMARY KEY,
    titulo TEXT NOT NULL,
    tipo TEXT NOT NULL,
    preco NUMERIC(14, 2) NOT NULL CHECK (preco > 0),
    cidade TEXT NOT NULL,
    estado CHAR(2) NOT NULL CHECK (estado ~ '^[A-Za-z]{2}$'),
    localizacao TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    area NUMERIC(12, 2),
    quartos INTEGER CHECK (quartos IS NULL OR quartos >= 0),
    banheiros INTEGER CHECK (banheiros IS NULL OR banheiros >= 0),
    vagas INTEGER CHECK (vagas IS NULL OR vagas >= 0),
    status TEXT NOT NULL DEFAULT 'Disponível' CHECK (status IN ('Disponível', 'Vendido', 'Rascunho')),
    vendido BOOLEAN NOT NULL DEFAULT FALSE,
    imagem_principal TEXT NOT NULL DEFAULT '',
    diretorio_imagens_legado TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS property_images (
    id BIGSERIAL PRIMARY KEY,
    property_id BIGINT NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
    storage_path TEXT NOT NULL,
    original_filename TEXT,
    mime_type TEXT CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    size_bytes BIGINT CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= 8388608)),
    is_legacy BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (property_id, storage_path)
);

-- The current JSON stores destaque as a boolean. The normalized relation keeps
-- the six public slots explicit and preserves the original property IDs.
CREATE TABLE IF NOT EXISTS featured_properties (
    position SMALLINT PRIMARY KEY CHECK (position BETWEEN 1 AND 6),
    property_id BIGINT NOT NULL UNIQUE REFERENCES properties(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_properties_status ON properties(status);
CREATE INDEX IF NOT EXISTS idx_property_images_property_id ON property_images(property_id);
CREATE INDEX IF NOT EXISTS idx_featured_properties_property_id ON featured_properties(property_id);

-- PostgreSQL cannot enforce the cross-row rule "exactly six" with a normal
-- CHECK constraint. The application must use a transaction for add/remove/
-- swap operations; this trigger prevents a seventh slot at database level.
CREATE OR REPLACE FUNCTION prevent_seventh_featured_property()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM featured_properties) >= 6 THEN
        RAISE EXCEPTION 'A vitrine pode ter no máximo 6 imóveis em destaque';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS featured_properties_max_six ON featured_properties;
CREATE TRIGGER featured_properties_max_six
BEFORE INSERT ON featured_properties
FOR EACH ROW
EXECUTE FUNCTION prevent_seventh_featured_property();
