# AGENTS.md - Sistema de Recordatorios F29 (Contidep)

Este archivo es el mapa principal de conocimiento, rutas y reglas operativas del proyecto `f29`.
Cualquier agente de IA que trabaje en este repositorio debe leer este documento antes de proponer o ejecutar cambios.

## Mapa de Documentación del Proyecto

| Archivo | Propósito |
| :--- | :--- |
| `AGENTS.md` | Mapa general del proyecto, arquitectura, flujo OpenSpec obligatorio y política de 2 ambientes. |
| `QA.md` | Documentación operativa del ambiente QA en el servidor `asus` (`192.168.100.14`). |
| `GUARDRAILS.md` | Reglas estrictas de lo que nunca se debe hacer, antipatrones y aprendizajes técnicos. |
| `PROD.md` | Guía paso a paso y checklist para el despliegue a Producción en Cloudflare Workers + D1. |
| `openspec/` | Especificaciones, propuestas, diseños y tareas gestionadas con OpenSpec. |

## Regla 1: Uso Obligatorio de OpenSpec

Todo requerimiento, funcionalidad nueva, cambio de arquitectura o corrección relevante debe gestionarse mediante **OpenSpec**.
Si un proyecto o entorno nuevo no tiene OpenSpec inicializado, siempre se debe comenzar con `openspec init`.
El ciclo de trabajo estándar es:

1. Explorar o proponer el cambio en `openspec/changes/<nombre-del-cambio>/` (`proposal.md`, `design.md`, `specs/`, `tasks.md`).
2. Implementar las tareas verificando tipos y linter (`npm run lint && npm run build`).
3. Desplegar y validar directamente en el ambiente **QA (`asus`)**.
4. Sincronizar y archivar las especificaciones en `openspec/specs/` una vez validado.

## Regla 2: Política Estricta de 2 Ambientes (Solo QA y Producción)

En este proyecto **NO existe ambiente de desarrollo local (`localhost`)**.
Únicamente operamos con dos ambientes:

1. **Ambiente QA (`asus` - `192.168.100.14`)**:
   - Todo cambio de código se compila y se despliega directamente en `goviedo@asus:/home/goviedo/proyectos/f29` usando `./deploy-qa.sh`.
   - Todas las pruebas funcionales, sincronización de grupos reales de WhatsApp y validaciones de interfaz se ejecutan en `http://192.168.100.14:5174`.
2. **Ambiente Producción (Cloudflare Workers + D1)**:
   - Una vez que el cambio fue validado exitosamente en QA, se promueve directamente a Producción siguiendo `PROD.md`.

Nunca levantes servidores `vite` en `localhost` ni contenedores de Evolution API en la máquina local de trabajo.

## Arquitectura y Mapa del Código Fuente

El sistema es un monolito serverless full-stack sobre **Cloudflare Workers + Hono + Cloudflare D1 (SQLite) + React 19 (Vite 7)** integrado con **Evolution API v2 (WhatsApp Baileys)**.

| Ruta | Descripción |
| :--- | :--- |
| `wrangler.json` | Configuración del Worker, binding D1 (`DB` -> `f29-db`), variables y Cron Trigger (`15 12 * * *`). |
| `migrations/0001_init.sql` | Esquema relacional D1 (`grupos_clientes`, `plantillas_mensajes`, `historial_envios`) y semillas de plantillas. |
| `src/worker/index.ts` | Punto de entrada del Worker: endpoints REST `/api/admin/*`, autenticación Bearer y handler `scheduled()`. |
| `src/worker/db/queries.ts` | Capa de acceso a datos tipada sobre D1 e inserción idempotente de historial. |
| `src/worker/services/evolutionApi.ts` | Cliente HTTP hacia Evolution API: estado/QR (`getWhatsappConnectionInfo`), grupos (`fetchAllGroups`) y envío (`sendGroupText`). |
| `src/worker/cron/f29Reminder.ts` | Motor diario de recordatorios F29 con zona horaria `America/Santiago` e idempotencia mensual. |
| `src/react-app/App.tsx` | Panel de administración React: vinculación QR de WhatsApp, gestión de grupos, editor de plantillas e historial. |
| `src/react-app/api.ts` | Cliente HTTP del frontend con auto-autenticación en QA (`192.168.100.14` / `asus`). |
| `Dockerfile` | Imagen `node:22-bookworm-slim` para ejecutar el servicio en el servidor QA `asus`. |
| `docker-entrypoint.sh` | Script de inicio en QA: migraciones D1, creación de instancia en Evolution API y cron diario interno (`09:15 America/Santiago`). |
| `docker-compose.yml` | Orquestación en QA de `f29_qa` (`5174`), `evolution_api` (`8080`), `evolution_postgres` y `evolution_redis`. |
| `deploy-qa.sh` | Wrapper hacia el automatizador Python de despliegue QA (`deploy_qa.py deploy`). |
| `iniciar-qa.sh` | Wrapper hacia el automatizador Python para iniciar/detener/ver estado en `asus` (`deploy_qa.py`). |
| `.agents/skills/deploy-qa-f29/` | Skill y programa Python (`scripts/deploy_qa.py`) para automatizar el deploy, operación y sync Git en QA. |
| `.agents/skills/qa-whatsapp-diagnostics/` | Skill y programa Python (`scripts/qa_whatsapp.py`) para diagnosticar WhatsApp, sincronizar grupos y probar el cron en QA. |

## Comandos Frecuentes

- **Validar código antes de desplegar a QA**:
  ```bash
  npm run lint && npm run build
  ```
- **Desplegar cambios directamente a QA (`asus`)**:
  ```bash
  ./deploy-qa.sh
  ```
- **Ver estado y logs en QA (`asus`)**:
  ```bash
  ssh goviedo@asus "cd /home/goviedo/proyectos/f29 && docker compose ps && docker logs --tail 50 f29_qa"
  ```
