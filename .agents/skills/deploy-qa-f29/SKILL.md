---
name: deploy-qa-f29
description: >-
  Automatiza el despliegue, inicio, detención, reinicio, sincronización Git y
  verificación de salud del proyecto F29 en el servidor QA asus (192.168.100.14)
  usando el programa Python scripts/deploy_qa.py. Úsalo siempre que debas
  desplegar cambios a QA, iniciar o reiniciar el entorno en asus, revisar logs
  o sincronizar el repositorio Git entre el host local y asus.
---

# Skill: Despliegue y Operación Automatizada en QA (`deploy-qa-f29`)

Esta skill provee la automatización en Python para construir, transferir imágenes Docker, sincronizar código/Git y administrar los contenedores del sistema **F29** en el servidor **QA `asus` (`192.168.100.14`)** dentro de `/home/goviedo/proyectos/f29`.

## Cuándo Usar Esta Skill

- Cuando necesites desplegar cualquier cambio de código al ambiente QA (`asus`).
- Cuando necesites iniciar (`start`), detener (`stop`), reiniciar (`restart`) o consultar el estado (`status`) o `logs` de los contenedores en `asus`.
- Cuando necesites hacer `git commit`, `git push` y dejar exactamente el mismo estado Git en `goviedo@asus:/home/goviedo/proyectos/f29`.

## Script Principal en Python

El programa de automatización está en:
`.agents/skills/deploy-qa-f29/scripts/deploy_qa.py`

También está enlazado desde la raíz del proyecto mediante los wrappers `./deploy-qa.sh` y `./iniciar-qa.sh`.
No requiere paquetes externos de `pip` (utiliza exclusivamente la librería estándar de Python 3).

## Comandos Disponibles

### 1. Despliegue Completo a QA (`deploy`)
Valida linter y build (`npm run lint && npm run build`), construye la imagen Docker `f29-qa:latest` en local, transfiere la imagen comprimida por SSH (`docker save | gzip | ssh goviedo@asus "gunzip | docker load"`), sincroniza archivos y `.git` con `rsync`, levanta los contenedores con `docker compose up -d --no-build` y verifica que `http://192.168.100.14:5174/api/admin/status` responda `200 OK`:

```bash
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py deploy
```

Opciones rápidas si solo cambiaron archivos de configuración/documentación y no se requiere reconstruir la imagen Docker:
```bash
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py deploy --skip-checks --skip-build
```

### 2. Iniciar / Verificar Estado / Reiniciar / Detener en `asus`

Funciona tanto ejecutándolo desde la máquina local como dentro de `goviedo@asus`:

```bash
# Iniciar servicios y verificar salud HTTP
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py start

# Ver estado de contenedores, commit de Git y métricas en vivo de /api/admin/status
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py status

# Reiniciar contenedores
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py restart

# Detener contenedores (preservando volúmenes D1 y sesión de WhatsApp)
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py stop
```

### 3. Consultar Logs de QA (`logs`)

```bash
# Últimas 50 líneas de todos los contenedores
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py logs

# Logs solo del contenedor f29-qa o de Evolution API
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py logs --service f29-qa --tail 100
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py logs --service api --tail 100
```

### 4. Sincronizar Git entre Host Local, GitHub y `asus` (`sync-git`)

```bash
python3 .agents/skills/deploy-qa-f29/scripts/deploy_qa.py sync-git -m "feat: descripción del cambio"
```

## Reglas de Seguridad (Guardrails)

- El script **nunca** ejecuta `docker compose down -v`, protegiendo los volúmenes `f29_wrangler_data` (base de datos D1 con los 170 grupos) y `f29_postgres_data` (sesión vinculada de WhatsApp en Evolution API).
- Nunca ejecuta `docker pull` ni `docker build` dentro de `asus` para evitar el bloqueo DNS IPv6 del daemon Docker de `asus`.
