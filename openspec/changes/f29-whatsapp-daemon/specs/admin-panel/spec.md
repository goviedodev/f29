## Purpose

Define el comportamiento del Panel de Administración web y su API protegida para que la usuaria gestione los grupos de clientes de WhatsApp, edite y guarde las plantillas de recordatorio F29, ejecute pruebas y audite el historial de envíos.

## ADDED Requirements

### Requirement: Autenticación por clave de administrador
El sistema MUST proteger todos los endpoints de administración (`/api/admin/*`) y el acceso al panel mediante una clave configurada en `ADMIN_PASSWORD`.

#### Scenario: Acceso con clave válida
- **WHEN** la usuaria ingresa la clave correcta en el panel de administración
- **THEN** el sistema permite acceder a la gestión de grupos, plantillas e historial de envíos

#### Scenario: Petición sin clave o con clave inválida
- **WHEN** se realiza una petición a `/api/admin/*` sin el encabezado de autorización válido
- **THEN** el sistema rechaza la petición con código HTTP `401 Unauthorized`

### Requirement: Sincronización y gestión de grupos de clientes
El sistema SHALL permitir sincronizar los grupos existentes desde Evolution API hacia la tabla `grupos_clientes` en D1 y editar su configuración (`nombre_empresa`, `activo`, `dia_vencimiento_f29`).

#### Scenario: Sincronización de grupos nuevos desde WhatsApp
- **WHEN** la usuaria acciona "Sincronizar con WhatsApp" en el panel
- **THEN** el sistema obtiene los grupos de Evolution API, inserta en `grupos_clientes` aquellos cuyo `group_jid` no exista aún con `activo = false` y `dia_vencimiento_f29 = 20` por defecto, y conserva intacta la configuración de los grupos ya registrados

#### Scenario: Activación y configuración de día de vencimiento de un cliente
- **WHEN** la usuaria activa el switch `activo` de un grupo (por ejemplo filtrando los grupos con `©️ 💲`) o modifica su `dia_vencimiento_f29`
- **THEN** el sistema persiste los cambios en D1 inmediatamente

### Requirement: Gestión de plantillas de mensajes guardables y envío de prueba
El sistema SHALL permitir visualizar, editar y guardar en D1 las plantillas de recordatorio (`T-0`, `T-1`, `T-3`), incluyendo como semilla inicial (`T-0`) el mensaje oficial de Contidep, así como disparar un envío manual/de prueba a un grupo seleccionado.

#### Scenario: Semilla inicial del mensaje oficial de Contidep en T-0
- **WHEN** se inicializa la base de datos D1
- **THEN** existe la plantilla `T-0` (`dias_anticipacion = 0`, `activa = true`) con el texto:
  `⏰ ¡Recordatorio importante!🛑\n\nHoy vence el plazo para pagar tu Formulario 29 en www.sii.cl. Tienes hasta las 23:45 hrs ⏳\nRecuerda que pagar fuera de plazo genera multas e intereses\n📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.\n\n¡Gracias! 😊\nContidep`

#### Scenario: Actualización de plantilla desde el panel
- **WHEN** la usuaria modifica el texto, los días de anticipación o el estado activo de una plantilla y presiona "Guardar"
- **THEN** el sistema actualiza la plantilla en `plantillas_mensajes` en D1 para los próximos envíos programados

### Requirement: Visualización de historial de envíos por período
El sistema SHALL mostrar en el panel el listado de ejecuciones registradas en `historial_envios` filtrable por período (`YYYY-MM`) y estado (`SUCCESS` / `FAILED`).

#### Scenario: Consulta del historial del mes en curso
- **WHEN** la usuaria abre la sección de Historial en el panel de administración
- **THEN** el sistema muestra cada envío con nombre de la empresa, código de plantilla, fecha/hora de envío, estado (`SUCCESS` o `FAILED`) y detalle de respuesta
