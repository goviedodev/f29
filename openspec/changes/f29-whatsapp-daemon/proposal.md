## Why

Los estudios contables en Chile (como Contidep) invierten mucho tiempo cada mes enviando recordatorios manuales por WhatsApp a los grupos de sus clientes para el pago oportuno del Formulario 29 (F29 del SII), cuyo atraso genera multas e intereses. Automatizar este envío mediante un daemon serverless en Cloudflare Workers conectado a Evolution API y respaldado por un panel de administración permite asegurar notificaciones puntuales, idempotentes y sin intervención manual diaria.

## What Changes

- **Base de Datos Cloudflare D1 (`grupos_clientes`, `plantillas_mensajes`, `historial_envios`)**: Creación del esquema relacional para gestionar grupos de WhatsApp por cliente, plantillas configurables por hito de vencimiento (`T-3`, `T-1`, `T-0`) con texto precargado de Contidep y registro de auditoría/idempotencia por período tributario (`YYYY-MM`).
- **Integración con Evolution API**: Cliente HTTP para descubrir grupos de la instancia (`GET /group/fetchAllGroups/{instancia}`) y despachar mensajes de texto a grupos (`POST /message/sendText/{instancia}`) usando `group_jid` (`@g.us`).
- **Daemon Programado (Cloudflare Cron Trigger)**: Job diario (`scheduled`) en zona horaria `America/Santiago` que evalúa los días restantes para el `dia_vencimiento_f29` de cada grupo activo, selecciona la plantilla activa correspondiente (`T-3`, `T-1`, `T-0`), verifica idempotencia en `historial_envios` y ejecuta el envío.
- **API Backend en Hono + Autenticación Admin**: Endpoints REST bajo `/api/*` protegidos por contraseña de administrador (`ADMIN_PASSWORD`) para sincronizar grupos desde Evolution API, administrar clientes, editar plantillas, disparar envíos de prueba y consultar el historial.
- **Panel de Administración en React (`src/react-app`)**: Interfaz web para que la contadora inicie sesión con su clave, sincronice y filtre sus grupos de WhatsApp (ej. grupos con `©️ 💲`), active/desactive recordatorios, ajuste el día de vencimiento por cliente, edite/guarde plantillas de mensajes con vista previa y revise el estado de envíos del mes (`SUCCESS` / `FAILED`).

## Capabilities

### New Capabilities
- `whatsapp-evolution-integration`: Integración con Evolution API para descubrimiento de grupos (`fetchAllGroups`) y envío de mensajes a Group JIDs (`@g.us`).
- `f29-reminder-scheduler`: Motor de planificación diaria (Cron), evaluación de ventanas de vencimiento F29 (`T-3`, `T-1`, `T-0`), interpolación de plantillas y control de idempotencia en Cloudflare D1.
- `admin-panel`: API Hono autenticada por clave y aplicación React para gestión de grupos de clientes, editor de plantillas de mensajes guardables y monitoreo de historial de envíos.

### Modified Capabilities
<!-- No existing capabilities -->

## Impact

- **Repositorio Base (`goviedodev/f29`)**: Basado en `vite-react-template` (React 19 + Vite + Hono + Cloudflare Workers).
- **Configuración Cloudflare (`wrangler.json`)**: Se agregan bindings de base de datos D1 (`DB`), Cron Triggers (`triggers.crons`) y variables/secretos (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `ADMIN_PASSWORD`).
- **Backend (`src/worker/`)**: Se extiende el entrypoint de Hono para exportar tanto `fetch` como `scheduled`, incorporando migraciones D1, servicios de Evolution API y rutas de administración.
- **Frontend (`src/react-app/`)**: Se reemplaza la página de demostración del template por el Panel de Administración de Recordatorios F29.
