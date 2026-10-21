## Purpose

Define el contrato de integración HTTP con Evolution API para descubrir grupos de WhatsApp vinculados a la instancia del estudio contable y despachar mensajes de texto automatizados a Group JIDs (`@g.us`).

## ADDED Requirements

### Requirement: Envío de mensaje de texto a grupo de WhatsApp
El sistema SHALL enviar mensajes de texto a grupos de WhatsApp invocando el endpoint `POST /message/sendText/{instancia}` de Evolution API con los encabezados `Content-Type: application/json` y `apikey`, y un payload JSON con `number` (en formato `[ID_DEL_GRUPO]@g.us`) y `text`.

#### Scenario: Envío exitoso a un Group JID válido
- **WHEN** el sistema solicita enviar un recordatorio a un grupo con `group_jid` válido (terminado en `@g.us`) y Evolution API responde con código HTTP 2xx
- **THEN** el sistema retorna un resultado de estado `SUCCESS` junto con el payload de respuesta de Evolution API serializado

#### Scenario: Error HTTP o de red al contactar Evolution API
- **WHEN** Evolution API responde con un código HTTP 4xx/5xx o ocurre un error de conexión/timeout durante el envío
- **THEN** el sistema captura el fallo sin abortar el proceso global y retorna estado `FAILED` junto con el detalle del error o cuerpo de respuesta para auditoría

### Requirement: Descubrimiento de grupos de la instancia
El sistema SHALL consultar la lista de grupos de WhatsApp disponibles en la instancia mediante `GET /group/fetchAllGroups/{instancia}?getParticipants=false` autenticándose con el header `apikey`.

#### Scenario: Listado de grupos exitoso
- **WHEN** se solicita la lista de grupos a Evolution API y la instancia está conectada
- **THEN** el sistema retorna la colección de grupos conteniendo al menos el identificador `id` (`@g.us`) y el nombre o asunto del grupo (`subject`)
