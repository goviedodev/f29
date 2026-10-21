# GUARDRAILS.md - Reglas Estrictas y Aprendizajes Técnicos

Este archivo documenta las prohibiciones explícitas ("lo que NO se debe hacer") y los aprendizajes técnicos descubiertos durante la construcción y puesta en marcha del sistema F29.
Antes de modificar infraestructura, integración con WhatsApp o despliegues, revisa esta lista.

## 1. Prohibiciones de Flujo y Ambientes

- **NUNCA levantar un ambiente de desarrollo local**:
  - Solo existen 2 ambientes: **QA (`asus` - `192.168.100.14`)** y **Producción (Cloudflare)**.
  - No ejecutes `npm run dev` en la máquina local ni levantes contenedores locales de Evolution API.
- **NUNCA hacer cambios sin seguir OpenSpec**:
  - Todo cambio debe quedar respaldado en su especificación y lista de tareas dentro de `openspec/`.
- **NUNCA insertar ni simular grupos de WhatsApp ficticios**:
  - Está estrictamente prohibido crear semillas SQL, botones de "grupos demo" o mocks con grupos falsos.
  - Todos los grupos en `grupos_clientes` deben provenir de la sincronización real con el celular vinculado en Evolution API (`POST /api/admin/groups/sync`) o ser creados manualmente con un JID real (`@g.us`).

## 2. Guardrails de WhatsApp y Evolution API

- **NUNCA conectar dos contenedores de Evolution API con la misma sesión de WhatsApp al mismo tiempo**:
  - Baileys (WhatsApp Web) detecta conexiones simultáneas con las mismas llaves criptográficas y cierra la sesión por conflicto (`stream:error`), obligando a escanear el QR de nuevo.
  - La única instancia de Evolution API para pruebas debe ser la que corre en `goviedo@asus` (`http://192.168.100.14:8080`).
- **NUNCA reducir el timeout de `fetchAllGroups` por debajo de 90 segundos**:
  - Una cuenta real de WhatsApp con ~170 grupos y miles de participantes tarda entre 15 y 45 segundos en responder a `GET /group/fetchAllGroups/{instance}?getParticipants=false` en la primera consulta antes de poblar la caché de Redis.
  - En `src/worker/services/evolutionApi.ts`, el timeout de `fetchAllGroups` debe mantenerse en `AbortSignal.timeout(90000)` (90 segundos).
- **NUNCA agregar el contenedor externo `evoapicloud/evolution-manager:latest`**:
  - Esa imagen oficial upstream está rota: su script de entrada escribe `must-revalidate` en la directiva `gzip_proxied` de Nginx y el contenedor entra en crash-loop infinito (`nginx: [emerg] invalid value "must-revalidate"`).
  - Además es innecesaria porque `evoapicloud/evolution-api:latest` ya incluye el Manager integrado en `/manager`, y nuestro propio panel F29 ya muestra el código QR de vinculación directamente en pantalla.

## 3. Guardrails del Servidor QA (`asus` - `192.168.100.14`)

- **NUNCA ejecutar Node/Vite directamente en el sistema operativo host de `asus`**:
  - El host `asus` tiene Node.js `v12.22.9`, incompatible con Vite 7 y Wrangler 4.
  - Todo servicio Node/Cloudflare en `asus` debe correr dentro de Docker.
- **NUNCA usar imágenes Alpine (`node:22-alpine`) para el contenedor de Wrangler / Cloudflare Vite Plugin**:
  - El binario `workerd` (runtime de Cloudflare Workers usado por `@cloudflare/vite-plugin` y Miniflare) requiere `glibc`.
  - Usa siempre `FROM node:22-bookworm-slim` en el `Dockerfile`.
- **NUNCA depender de `docker pull` o `docker compose build` directamente dentro de `asus`**:
  - El daemon Docker en `asus` falla al resolver `registry-1.docker.io` por DNS IPv6 (`dial tcp: lookup registry-1.docker.io on [::1]:53: connection refused`).
  - Construye siempre la imagen en la máquina local y transfiérela a `asus` con `docker save <imagen> | gzip | ssh goviedo@asus "gunzip | docker load"` (automatizado en `./deploy-qa.sh`).
- **NUNCA montar `/tmp` del host al ejecutar contenedores en `asus`**:
  - En `asus`, Docker está instalado vía paquete **Snap** (`snap.docker`), por lo que `/tmp` dentro del daemon Docker está aislado del `/tmp` del host y falla con `No such file or directory`.
  - Si necesitas montar archivos temporales en un contenedor en `asus`, colócalos siempre dentro de `/home/goviedo/proyectos/f29/`.
- **NUNCA exponer en el host de `asus` los puertos `5173`, `5432` o `6379`**:
  - El puerto `5173` pertenece a `reloj-control` y el `5432` a `sernac-skill`.
  - `f29_qa` usa exclusivamente el puerto **`5174`**, `evolution_api` usa el **`8080`**, y tanto `evolution_postgres` como `evolution_redis` usan solo `expose` interno dentro de la red Docker `f29-evolution-net`.
- **NUNCA borrar los volúmenes `f29_wrangler_data` ni `f29_postgres_data` en `asus`**:
  - Nunca ejecutes `docker compose down -v` en `asus`, ya que destruiría la sesión vinculada de WhatsApp y la configuración de grupos activos/días de vencimiento en D1.
