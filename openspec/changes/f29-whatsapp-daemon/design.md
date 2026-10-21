## Context

El proyecto parte del repositorio `https://github.com/goviedodev/f29`, generado con el template oficial de Cloudflare (`vite-react-template`: React 19 + Vite + Hono + Cloudflare Workers + Wrangler 4). Ver `proposal.md` para la motivación del negocio.

El sistema combina dos modos de operación dentro del mismo Worker:
1. **Daemon Headless (`scheduled`)**: Ejecución automática vía Cron Trigger de Cloudflare que consulta Cloudflare D1 y despacha mensajes por WhatsApp mediante Evolution API (`POST /message/sendText/{instancia}`).
2. **Panel de Administración (`fetch` -> React SPA + Hono API)**: Interfaz para que la única usuaria administradora (Contidep) sincronice los grupos de WhatsApp (`GET /group/fetchAllGroups/{instancia}`), active clientes, edite plantillas guardables y revise el historial de envíos.

## Goals / Non-Goals

**Goals:**
- Garantizar idempotencia estricta a nivel de base de datos D1 y aplicación para nunca enviar dos veces el mismo recordatorio (`grupo_id + periodo + plantilla_codigo`) dentro del mismo mes.
- Proveer un motor de plantillas persistido en D1 (`plantillas_mensajes`) precargado con el mensaje real de Contidep (`T-0`) y soporte para avisos previos (`T-1`, `T-3`).
- Asegurar que la sincronización de grupos desde WhatsApp sea segura por defecto (`activo = 0` para grupos nuevos) evitando envíos accidentales a grupos personales.
- Proteger el panel y la API mediante una clave de administración simple (`ADMIN_PASSWORD`) sin requerir infraestructura externa de autenticación.

**Non-Goals:**
- Gestión multi-tenant (múltiples estudios contables o múltiples instancias de WhatsApp).
- Recepción o procesamiento de webhooks entrantes desde WhatsApp (respuestas de clientes).
- Integración directa con el portal del SII.

## Decisions

### 1. Arquitectura Monolítica en un único Cloudflare Worker (Hono + React SPA + Cron)
- **Decisión**: Mantener el frontend React (`src/react-app`) servido por Cloudflare Workers Assets y el backend Hono + handler `scheduled` en `src/worker/index.ts`.
- **Racional**: Simplifica el despliegue a un solo comando (`npm run deploy`), evita problemas de CORS entre frontend y backend, y aprovecha el template existente en `goviedodev/f29`.
- **Alternativas consideradas**: Separar el daemon en un Worker independiente del panel web. Descartado por añadir complejidad innecesaria para un único estudio contable.

### 2. Esquema de Base de Datos en Cloudflare D1 (SQLite)
- **Decisión**: Estructurar 3 tablas en una migración SQL (`migrations/0001_init.sql`):
  - `grupos_clientes`:
    - `id` (`TEXT PRIMARY KEY`, UUID)
    - `nombre_empresa` (`TEXT NOT NULL`)
    - `group_jid` (`TEXT NOT NULL UNIQUE`, ej. `12036302...@g.us`)
    - `activo` (`INTEGER NOT NULL DEFAULT 0`)
    - `dia_vencimiento_f29` (`INTEGER NOT NULL DEFAULT 20`)
    - `created_at` / `updated_at` (`TEXT`)
  - `plantillas_mensajes`:
    - `id` (`TEXT PRIMARY KEY`)
    - `codigo` (`TEXT NOT NULL UNIQUE`, ej. `'T-0'`, `'T-1'`, `'T-3'`)
    - `nombre` (`TEXT NOT NULL`)
    - `dias_anticipacion` (`INTEGER NOT NULL UNIQUE`)
    - `contenido` (`TEXT NOT NULL`)
    - `activa` (`INTEGER NOT NULL DEFAULT 1`)
    - `updated_at` (`TEXT`)
  - `historial_envios`:
    - `id` (`TEXT PRIMARY KEY`, UUID)
    - `grupo_id` (`TEXT NOT NULL REFERENCES grupos_clientes(id)`)
    - `plantilla_codigo` (`TEXT NOT NULL`)
    - `periodo` (`TEXT NOT NULL`, formato `YYYY-MM`)
    - `fecha_envio` (`TEXT NOT NULL`, ISO 8601)
    - `estado` (`TEXT NOT NULL`, `'SUCCESS'` | `'FAILED'`)
    - `mensaje_enviado` (`TEXT`)
    - `response_payload` (`TEXT`)
    - Índice compuesto `idx_historial_idempotencia` sobre `(grupo_id, periodo, plantilla_codigo, estado)`.

### 3. Zona Horaria y Programación del Cron Trigger
- **Decisión**: Configurar el Cron Trigger en `wrangler.json` como `["15 12 * * *"]` (que corresponde a las **09:15 AM en Chile UTC-3**, coincidiendo con la hora habitual de envío observada en la captura de Contidep) y calcular la fecha local en el Worker usando `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' })`.
- **Racional**: Los Workers corren en UTC. Usar `Intl.DateTimeFormat` con `America/Santiago` resuelve automáticamente los cambios de horario de verano/invierno en Chile sin librerías pesadas.

### 4. Autenticación Admin (Opción A)
- **Decisión**: Middleware en Hono que valida el header `Authorization: Bearer <ADMIN_PASSWORD>` (o `x-admin-password`) contra `env.ADMIN_PASSWORD`. En el panel React, la usuaria ingresa la clave en una pantalla de login y se almacena en `localStorage` para adjuntarla en las llamadas `/api/admin/*`.

### 5. Mitigación de Rate Limiting hacia Evolution API
- **Decisión**: Durante la ejecución del Cron (y en envíos masivos), iterar secuencialmente los grupos que requieren alerta aplicando una pequeña pausa (`await new Promise(r => setTimeout(r, 1500))`) entre peticiones `POST /message/sendText/{instancia}`.
- **Racional**: Evita saturar la instancia de Baileys/Evolution API y reduce riesgos de bloqueo en WhatsApp sin exceder el límite de tiempo del Cron Worker para la escala de un estudio contable.

## Risks / Trade-offs

- **[Riesgo] Instancia de Evolution API desconectada o caída a las 09:15 AM** → **Mitigación**: Todo fallo se registra con `estado = 'FAILED'` en `historial_envios`. Como la idempotencia solo bloquea si existe un registro `SUCCESS`, la usuaria puede ver los fallos en el panel y presionar "Reintentar / Ejecutar recordatorios del día" manualmente (o se puede añadir un segundo cron de respaldo en la mañana).
- **[Riesgo] Envío accidental a grupos privados al sincronizar** → **Mitigación**: `POST /api/admin/groups/sync` inserta todos los grupos nuevos con `activo = 0`. Además, el panel incluirá un filtro rápido para identificar grupos con la convención `©️` o `💲`.

## Migration Plan

1. Clonar/sincronizar el repositorio base `https://github.com/goviedodev/f29` en el workspace manteniendo `.agents` y `openspec`.
2. Crear la base de datos D1 en Cloudflare (`wrangler d1 create f29-db`) y asociar su `database_id` en `wrangler.json`.
3. Ejecutar la migración `0001_init.sql` (local y remota) que crea las 3 tablas e inserta las plantillas iniciales (`T-0` activa con el texto de Contidep, y `T-1`/`T-3` preconfiguradas).
4. Configurar los secretos en Cloudflare (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `ADMIN_PASSWORD`).
5. Desplegar con `npm run deploy`.
