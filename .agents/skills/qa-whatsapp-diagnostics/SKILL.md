---
name: qa-whatsapp-diagnostics
description: >-
  Verifica el estado de vinculación de WhatsApp (instancia contidep), sincroniza
  grupos reales desde Evolution API, busca grupos en D1 y ejecuta pruebas del
  planificador diario F29 en el ambiente QA (http://192.168.100.14:5174) usando
  el script Python scripts/qa_whatsapp.py.
---

# Skill: Diagnóstico de WhatsApp y Motor F29 en QA (`qa-whatsapp-diagnostics`)

Esta skill permite inspeccionar y operar vía CLI en Python la integración entre el Worker F29 QA (`http://192.168.100.14:5174`) y Evolution API (`http://192.168.100.14:8080`).

## Script en Python

Ruta: `.agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py`
No requiere librerías externas (100% Python 3 estándar).

## Comandos Principales

### 1. Verificar Estado de WhatsApp y del Sistema en QA (`check`)
Devuelve el JSON de `/api/admin/status` y `/api/admin/whatsapp/qr` indicando si la instancia `contidep` está en estado `open` y cuántos grupos reales están registrados:

```bash
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py check
```

### 2. Sincronizar Grupos Reales desde WhatsApp (`sync-groups`)
Dispara `POST /api/admin/groups/sync` con timeout extendido de 120 segundos para importar todos los grupos reales de la cuenta vinculada:

```bash
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py sync-groups
```

### 3. Buscar y Listar Grupos en QA (`list-groups`)

```bash
# Listar los primeros 50 grupos
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py list-groups

# Buscar un grupo específico por nombre
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py list-groups --search "Contidep"

# Listar únicamente los grupos activos para recordatorios F29
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py list-groups --active-only
```

### 4. Ejecutar el Planificador Diario F29 en QA (`run-cron`)

```bash
# Ejecutar para la fecha actual en America/Santiago
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py run-cron

# Ejecutar simulando una fecha específica (ej. día 15 o día 19 del mes)
python3 .agents/skills/qa-whatsapp-diagnostics/scripts/qa_whatsapp.py run-cron --date 2026-10-15
```
