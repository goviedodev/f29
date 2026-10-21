# PROD.md - Guía de Despliegue a Producción (Cloudflare Workers + D1)

Este documento describe la arquitectura productiva y el procedimiento exacto para promover cambios desde **QA (`asus`)** hacia **Producción**.

## Regla de Promoción

1. Ningún cambio va a Producción sin haber sido desplegado (`./deploy-qa.sh`) y probado primero en **QA (`http://192.168.100.14:5174`)**.
2. Una vez aprobado en QA, el despliegue a Producción es directo sobre Cloudflare Workers y Cloudflare D1.

## Arquitectura de Producción

| Componente | Tecnología en Producción | Detalle |
| :--- | :--- | :--- |
| Frontend + API + Cron | Cloudflare Workers | Servido desde un único Worker (`f29`) con Static Assets (`./dist/client`) y rutas `/api/admin/*`. |
| Planificador Diario | Cloudflare Cron Triggers | Definido en `wrangler.json` como `"crons": ["15 12 * * *"]` (12:15 UTC = 09:15 AM Chile). |
| Base de Datos | Cloudflare D1 (`f29-db`) | Base de datos SQLite distribuida en el borde de Cloudflare (`binding = "DB"`). |
| Motor WhatsApp | Evolution API v2 (`contidep`) | Instancia productiva de Evolution API accesible vía HTTPS desde Cloudflare Workers. |

## 1. Configuración Inicial (Solo la Primera Vez)

Si aún no se ha aprovisionado la base de datos D1 remota en la cuenta de Cloudflare:

1. **Autenticar Wrangler en Cloudflare**:
   ```bash
   npx wrangler login
   ```
2. **Crear la base de datos D1 en Producción**:
   ```bash
   npx wrangler d1 create f29-db
   ```
3. **Actualizar `database_id` en `wrangler.json`**:
   Copia el `database_id` (UUID real) entregado por el comando anterior y reemplaza `"00000000-0000-0000-0000-000000000000"` en `wrangler.json`.
4. **Configurar la URL pública de Evolution API en `wrangler.json`**:
   En la sección `"vars"` de `wrangler.json`, asegúrate de que `EVOLUTION_API_URL` apunte al endpoint HTTPS accesible por el Worker de Cloudflare (por ejemplo, un Cloudflare Tunnel hacia `evolution_api:8080` en `asus` o el dominio productivo de Evolution API) y que `EVOLUTION_INSTANCE` sea `"contidep"`.
5. **Cargar Secretos en Cloudflare Workers**:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put EVOLUTION_API_KEY
   ```

## 2. Procedimiento Estándar de Despliegue a Producción

Cada vez que se apruebe una versión en QA y se desee subir a Producción:

### Paso 1: Verificación de Calidad y Build Dry-Run

Ejecuta la validación completa de tipos, linter, empaquetado de cliente/worker y simulación de despliegue:

```bash
npm run lint && npm run check
```

### Paso 2: Aplicar Migraciones en Cloudflare D1 Remoto

Aplica cualquier migración pendiente en la base de datos productiva:

```bash
npx wrangler d1 migrations apply f29-db --remote
```

### Paso 3: Publicar el Worker y Assets en Cloudflare

```bash
npm run deploy
```

## 3. Verificación Post-Despliegue en Producción

1. **Verificar Estado de la API y Conexión con Evolution API**:
   ```bash
   curl -s -H "Authorization: Bearer <ADMIN_PASSWORD_PROD>" https://<tu-dominio-worker>.workers.dev/api/admin/status
   ```
   Confirma que devuelva:
   - `"authenticated": true`
   - `"connectionState": "open"`
   - `"plantillas_activas": 2`
2. **Sincronizar / Verificar Grupos**:
   Ingresa al Panel de Administración en la URL productiva, verifica que los grupos reales aparezcan listados y activa únicamente los grupos de clientes que deban recibir recordatorios automáticos.
3. **Prueba Controlada de Envío**:
   Usa el botón **"Probar envío"** sobre un grupo de prueba antes de dejar activos los grupos de clientes definitivos.
4. **Monitoreo de Logs en Tiempo Real**:
   ```bash
   npx wrangler tail
   ```
