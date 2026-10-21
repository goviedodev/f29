-- Migration: 0001_init.sql
-- Esquema inicial para Daemon de Recordatorios F29 vía WhatsApp (Contidep)

CREATE TABLE IF NOT EXISTS grupos_clientes (
    id TEXT PRIMARY KEY,
    nombre_empresa TEXT NOT NULL,
    group_jid TEXT NOT NULL UNIQUE,
    activo INTEGER NOT NULL DEFAULT 0,
    dia_vencimiento_f29 INTEGER NOT NULL DEFAULT 20,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_grupos_clientes_activo
    ON grupos_clientes (activo, dia_vencimiento_f29);

CREATE TABLE IF NOT EXISTS plantillas_mensajes (
    id TEXT PRIMARY KEY,
    codigo TEXT NOT NULL UNIQUE,
    nombre TEXT NOT NULL,
    dias_anticipacion INTEGER NOT NULL UNIQUE,
    contenido TEXT NOT NULL,
    activa INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS historial_envios (
    id TEXT PRIMARY KEY,
    grupo_id TEXT NOT NULL,
    plantilla_codigo TEXT NOT NULL,
    periodo TEXT NOT NULL,
    fecha_envio TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    estado TEXT NOT NULL CHECK (estado IN ('SUCCESS', 'FAILED')),
    mensaje_enviado TEXT,
    response_payload TEXT,
    FOREIGN KEY (grupo_id) REFERENCES grupos_clientes (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_historial_idempotencia
    ON historial_envios (grupo_id, periodo, plantilla_codigo, estado);

CREATE INDEX IF NOT EXISTS idx_historial_periodo
    ON historial_envios (periodo, fecha_envio DESC);

-- Seed inicial de plantillas de mensajes (incluyendo texto oficial de Contidep en T-0)
INSERT OR IGNORE INTO plantillas_mensajes (id, codigo, nombre, dias_anticipacion, contenido, activa)
VALUES (
    'tpl-t0',
    'T-0',
    'Día de Vencimiento (Hoy vence)',
    0,
    '⏰ ¡Recordatorio importante!🛑

Hoy vence el plazo para pagar tu Formulario 29 en www.sii.cl. Tienes hasta las 23:45 hrs ⏳
Recuerda que pagar fuera de plazo genera multas e intereses
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep',
    1
);

INSERT OR IGNORE INTO plantillas_mensajes (id, codigo, nombre, dias_anticipacion, contenido, activa)
VALUES (
    'tpl-t1',
    'T-1',
    'Aviso 1 día antes (Mañana vence)',
    1,
    '⏰ ¡Recordatorio importante!🛑

Mañana (día {{dia_vencimiento}}) vence el plazo para declarar y pagar tu Formulario 29 en www.sii.cl ⏳
Recuerda que pagar fuera de plazo genera multas e intereses.
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep',
    1
);

INSERT OR IGNORE INTO plantillas_mensajes (id, codigo, nombre, dias_anticipacion, contenido, activa)
VALUES (
    'tpl-t3',
    'T-3',
    'Aviso 3 días antes (Próximo a vencer)',
    3,
    '⏰ ¡Recordatorio F29! 📋

Hola {{nombre_empresa}}, te recordamos que en 3 días (el día {{dia_vencimiento}}) vence el plazo para pagar tu Formulario 29 en www.sii.cl ⏳
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep',
    0
);
