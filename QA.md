# QA.md - Ambiente de QA en Servidor `asus`

Este documento detalla la arquitectura, rutas, puertos y operación del ambiente de **QA**, que es el primer y único entorno de pruebas antes de salir a Producción.

## Datos de Conexión y Ubicación

- **Servidor**: `asus` (`192.168.100.14`)
- **Acceso SSH / SCP**: `ssh goviedo@asus` (acceso directo por llave SSH ya configurado)
- **Directorio del Servicio en `asus`**: `/home/goviedo/proyectos/f29`
- **URL Panel de Administración F29 (QA)**: `http://192.168.100.14:5174`
- **URL Evolution API (QA)**: `http://192.168.100.14:8080`
- **Contraseña Admin QA**: `admin123` (el panel inicia sesión automáticamente al entrar desde `192.168.100.14` o `asus`)
- **Instancia de WhatsApp**: `contidep`

## Arquitectura de Contenedores en QA (`docker-compose.yml`)

El stack en `goviedo@asus:/home/goviedo/proyectos/f29` corre sobre Docker Compose en la red aislada `f29-evolution-net`:

| Contenedor | Imagen | Puerto Host | Puerto Interno | Propósito |
| :--- | :--- | :--- | :--- | :--- |
| `f29_qa` | `f29-qa:latest` (`node:22-bookworm-slim`) | `5174` | `5174` | Panel React + Worker Hono + D1 local + Cron diario (`09:15 America/Santiago`). |
| `evolution_api` | `evoapicloud/evolution-api:latest` (v2.3.7) | `8080` | `8080` | Motor WhatsApp Baileys que mantiene vinculada la cuenta de WhatsApp real. |
| `evolution_postgres` | `postgres:15-alpine` | *(sin puerto host)* | `5432` | Base de datos de Evolution API donde persisten las llaves criptográficas de la sesión de WhatsApp y los chats. |
| `evolution_redis` | `redis:7-alpine` | *(sin puerto host)* | `6379` | Caché de sesión y grupos de Evolution API. |

### Volúmenes Persistentes en `asus`

- `f29_wrangler_data`: Montado en `/app/.wrangler` dentro de `f29_qa`. Contiene la base de datos SQLite de Cloudflare D1 con los grupos de clientes sincronizados, las plantillas y el historial de envíos.
- `f29_postgres_data`: Contiene la base de datos `evolution_db` con la sesión vinculada de WhatsApp (`contidep`).
- `f29_evolution_instances`: Instancias de Evolution API.
- `f29_evolution_redis`: Datos persistentes de Redis (`appendonly yes`).

## Automatización en Python y Skills de QA

Toda la operación de despliegue, control de contenedores, sincronización Git y diagnóstico de WhatsApp en QA está automatizada con programas en Python 3 (sin dependencias externas) dentro de `.agents/skills/`:

| Skill | Programa Python | Propósito |
| :--- | :--- | :--- |
| `deploy-qa-f29` | `.agents/skills/deploy-qa-f29/scripts/deploy_qa.py` | Compila, transfiere imágenes Docker por SSH, sincroniza archivos/Git, levanta contenedores y verifica salud HTTP en `asus`. |
| `qa-whatsapp-diagnostics` | `.agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py` | Verifica sesión de WhatsApp (`contidep`), sincroniza grupos reales, busca grupos en D1 y ejecuta pruebas del cron diario. |

## Iniciar / Administrar el Proyecto en `asus` (`./iniciar-qa.sh` / `deploy_qa.py`)

El script `iniciar-qa.sh` funciona tanto si lo ejecutas conectado dentro de `asus` (`/home/goviedo/proyectos/f29/iniciar-qa.sh`) como desde tu máquina local:

- **Iniciar todos los contenedores QA y verificar puertos**:
  ```bash
  ./iniciar-qa.sh
  ```
- **Ver estado de contenedores y salud de la API**:
  ```bash
  ./iniciar-qa.sh status
  ```
- **Reiniciar servicios**:
  ```bash
  ./iniciar-qa.sh restart
  ```
- **Detener servicios (conservando bases de datos y sesión WhatsApp)**:
  ```bash
  ./iniciar-qa.sh stop
  ```
- **Ver logs en vivo**:
  ```bash
  ./iniciar-qa.sh logs
  ```

## Flujo de Despliegue a QA (`./deploy-qa.sh`)

Cada vez que se realiza un cambio en el código, se despliega directamente a QA ejecutando desde la raíz del repositorio:

```bash
./deploy-qa.sh
```

### ¿Qué hace `./deploy-qa.sh` internamente?

1. Construye la imagen `f29-qa:latest` en la máquina local usando `Dockerfile`.
2. Verifica si las imágenes base (`evoapicloud/evolution-api:latest`, `redis:7-alpine`, `postgres:15-alpine`) existen en `asus`; si falta alguna, la transfiere por SSH.
3. Transfiere `f29-qa:latest` comprimida por streaming (`docker save f29-qa:latest | gzip | ssh goviedo@asus "gunzip | docker load"`).
4. Sincroniza los archivos de configuración (`docker-compose.yml`, `.env`, etc.) hacia `goviedo@asus:/home/goviedo/proyectos/f29/` con `rsync` (sin tocar los volúmenes Docker).
5. Ajusta `SERVER_URL=http://192.168.100.14:8080` en `.env` remoto.
6. Ejecuta `docker compose up -d --no-build` en `asus` y muestra el estado de los contenedores.

## Comportamiento al Inicio del Contenedor `f29_qa` (`docker-entrypoint.sh`)

Al arrancar `f29_qa`:

1. Genera `/app/.dev.vars` apuntando `EVOLUTION_API_URL=http://evolution_api:8080` (comunicación directa por la red interna Docker `f29-evolution-net`).
2. Ejecuta `npm run db:migrate:local` (`wrangler d1 migrations apply f29-db --local`) de forma idempotente.
3. Verifica que la instancia `contidep` exista en `evolution_api`.
4. Inicia en segundo plano un bucle ligero que comprueba cada 30 segundos la hora en `America/Santiago` y dispara `POST http://127.0.0.1:5174/api/admin/cron/run` a las **09:15 AM** una vez por día.
5. Levanta el servidor en `0.0.0.0:5174`.

## Operaciones de Diagnóstico y Mantenimiento en QA

- **Verificar estado de salud vía API**:
  ```bash
  curl -s -H "Authorization: Bearer admin123" http://192.168.100.14:5174/api/admin/status
  ```
- **Revisar logs de la aplicación F29 en QA**:
  ```bash
  ssh goviedo@asus "docker logs -f --tail 100 f29_qa"
  ```
- **Revisar logs de Evolution API en QA**:
  ```bash
  ssh goviedo@asus "docker logs -f --tail 100 evolution_api"
  ```
- **Reiniciar el servicio F29 QA sin afectar WhatsApp**:
  ```bash
  ssh goviedo@asus "cd /home/goviedo/proyectos/f29 && docker compose restart f29-qa"
  ```
