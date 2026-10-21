## Purpose

Especifica el comportamiento del daemon programado (Cron) que calcula las fechas de vencimiento del Formulario 29 (F29), interpola las plantillas de mensaje configuradas y garantiza el envío idempotente mensual a cada grupo de cliente activo.

## ADDED Requirements

### Requirement: Ejecución diaria programada en zona horaria de Chile
El sistema SHALL ejecutar automáticamente el proceso de evaluación de recordatorios F29 mediante un Cron Trigger diario calculando la fecha actual (`YYYY-MM-DD`) y el período tributario (`YYYY-MM`) bajo la zona horaria `America/Santiago`.

#### Scenario: Cálculo de días restantes para el vencimiento del grupo
- **WHEN** el daemon se ejecuta en un día determinado del mes en curso
- **THEN** para cada registro en `grupos_clientes` con `activo = true`, el sistema calcula `dias_restantes = dia_vencimiento_f29 - dia_actual_santiago`

### Requirement: Selección e interpolación de plantillas por ventana de alerta
El sistema SHALL buscar en `plantillas_mensajes` una plantilla con `activa = true` cuyo campo `dias_anticipacion` coincida exactamente con `dias_restantes` (por ejemplo `0` para `T-0` hoy vence, `1` para `T-1`, `3` para `T-3`) y reemplazar las variables dinámicas disponibles (`{{nombre_empresa}}`, `{{dia_vencimiento}}`, `{{periodo}}`).

#### Scenario: Coincidencia en el día de vencimiento (T-0)
- **WHEN** `dias_restantes` es `0` y la plantilla `T-0` está activa con el mensaje oficial de Contidep
- **THEN** el sistema selecciona dicha plantilla y genera el texto final listo para enviar al `group_jid` del cliente

#### Scenario: Día fuera de ventana de alerta o plantilla inactiva
- **WHEN** no existe ninguna plantilla activa cuyo `dias_anticipacion` coincida con `dias_restantes` para un grupo
- **THEN** el sistema omite el envío para ese grupo sin generar llamadas a Evolution API

### Requirement: Control de idempotencia mensual por grupo y plantilla
El sistema MUST consultar `historial_envios` antes de despachar cualquier mensaje a Evolution API para verificar si ya existe un envío con estado `SUCCESS` para la combinación `(grupo_id, periodo, plantilla_codigo)`.

#### Scenario: Alerta ya enviada exitosamente en el mismo período
- **WHEN** ya existe un registro en `historial_envios` con `estado = 'SUCCESS'` para el mismo `grupo_id`, `periodo` (`YYYY-MM`) y `plantilla_codigo`
- **THEN** el sistema MUST omitir la petición HTTP hacia Evolution API para evitar duplicados

#### Scenario: Alerta previa fallida o inexistente en el período
- **WHEN** no existe registro `SUCCESS` para `(grupo_id, periodo, plantilla_codigo)` (o solo existen intentos previos con `estado = 'FAILED'`)
- **THEN** el sistema realiza el envío a Evolution API y registra el resultado (`SUCCESS` o `FAILED`), timestamp y `response_payload` en `historial_envios`
