## 1. Inicialización del Repositorio y Configuración de Cloudflare

- [x] 1.1 Sincronizar el repositorio base `https://github.com/goviedodev/f29` en el directorio de trabajo conservando `.agents/` y `openspec/`, e instalar dependencias (`npm install`).
- [x] 1.2 Configurar `wrangler.json` agregando el binding D1 (`DB`), el Cron Trigger diario (`"15 12 * * *"` para las 09:15 AM en `America/Santiago`) y las definiciones de variables/secretos (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `ADMIN_PASSWORD`), regenerando tipos en `worker-configuration.d.ts`.

## 2. Base de Datos D1 y Modelo de Datos

- [x] 2.1 Crear la migración SQL `migrations/0001_init.sql` con las tablas `grupos_clientes`, `plantillas_mensajes` e `historial_envios` y sus índices de unicidad/idempotencia.
- [x] 2.2 Incluir en la migración el seed inicial de `plantillas_mensajes` con la plantilla activa `T-0` (`dias_anticipacion = 0`) que contiene el texto exacto de Contidep extraído por OCR, además de plantillas base para `T-1` y `T-3`.
- [x] 2.3 Implementar la capa de acceso a datos tipada en `src/worker/db/queries.ts` para CRUD de grupos, lectura/actualización de plantillas y verificación/registro en `historial_envios`.

## 3. Cliente de Integración con Evolution API

- [x] 3.1 Implementar `src/worker/services/evolutionApi.ts` con `fetchAllGroups()` (`GET /group/fetchAllGroups/{instancia}?getParticipants=false`) y `sendGroupText(groupJid, text)` (`POST /message/sendText/{instancia}`).
- [x] 3.2 Manejar errores HTTP y timeouts capturando el cuerpo de respuesta (`response_payload`) y retornando estados estructurados (`SUCCESS` / `FAILED`) sin interrumpir lotes de envío.

## 4. Daemon Programado de Recordatorios F29 (Cron)

- [x] 4.1 Implementar `src/worker/cron/f29Reminder.ts` con cálculo de fecha y período (`YYYY-MM`) en zona horaria `America/Santiago`, evaluación de `dias_restantes = dia_vencimiento_f29 - dia_actual` e interpolación de variables (`{{nombre_empresa}}`, `{{dia_vencimiento}}`, `{{periodo}}`).
- [x] 4.2 Incorporar la verificación de idempotencia sobre `historial_envios` por `(grupo_id, periodo, plantilla_codigo)` con estado `SUCCESS`, pausa entre envíos y registro del resultado en D1.
- [x] 4.3 Exponer el handler `scheduled` junto a `fetch: app.fetch` en `src/worker/index.ts`.

## 5. API de Administración en Hono

- [x] 5.1 Implementar middleware de autenticación por clave (`ADMIN_PASSWORD`) para proteger `/api/admin/*`.
- [x] 5.2 Crear endpoints para grupos: `GET /api/admin/groups`, `POST /api/admin/groups/sync` (importa nuevos grupos desde Evolution API con `activo = false` y `dia_vencimiento_f29 = 20`), `PATCH /api/admin/groups/:id` y `POST /api/admin/groups/:id/send-test`.
- [x] 5.3 Crear endpoints para plantillas e historial: `GET /api/admin/templates`, `PUT /api/admin/templates/:codigo`, `GET /api/admin/history` y `POST /api/admin/cron/run` (disparo manual de recordatorios del día).

## 6. Panel de Administración en React (`src/react-app`)

- [x] 6.1 Construir pantalla de acceso por clave de administrador y cliente HTTP autenticado en el frontend.
- [x] 6.2 Implementar vista de **Grupos de Clientes** con botón "Sincronizar con WhatsApp", buscador/filtro rápido (incluyendo filtro para grupos con `©️` o `💲`), switch de activación (`activo`), edición de nombre/día de vencimiento y botón de envío de prueba.
- [x] 6.3 Implementar vista de **Plantillas de Mensajes** con editor del texto de recordatorio, selector de variables dinámicas, vista previa estilo burbuja de WhatsApp y guardado en D1.
- [x] 6.4 Implementar vista de **Historial de Envíos** con filtro por período (`YYYY-MM`) y estado (`SUCCESS` / `FAILED`), y verificar que `npm run check` compile y valide el Worker sin errores.
