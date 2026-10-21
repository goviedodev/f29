export interface GrupoClienteRow {
	id: string;
	nombre_empresa: string;
	group_jid: string;
	activo: number;
	dia_vencimiento_f29: number;
	created_at: string;
	updated_at: string;
}

export interface GrupoCliente {
	id: string;
	nombre_empresa: string;
	group_jid: string;
	activo: boolean;
	dia_vencimiento_f29: number;
	created_at: string;
	updated_at: string;
}

export interface PlantillaMensajeRow {
	id: string;
	codigo: string;
	nombre: string;
	dias_anticipacion: number;
	contenido: string;
	activa: number;
	updated_at: string;
}

export interface PlantillaMensaje {
	id: string;
	codigo: string;
	nombre: string;
	dias_anticipacion: number;
	contenido: string;
	activa: boolean;
	updated_at: string;
}

export type EstadoEnvio = "SUCCESS" | "FAILED";

export interface HistorialEnvio {
	id: string;
	grupo_id: string;
	nombre_empresa?: string;
	group_jid?: string;
	plantilla_codigo: string;
	periodo: string;
	fecha_envio: string;
	estado: EstadoEnvio;
	mensaje_enviado: string | null;
	response_payload: string | null;
}

export const CONTIDEP_T0_TEMPLATE = `⏰ ¡Recordatorio importante!🛑

Hoy vence el plazo para pagar tu Formulario 29 en www.sii.cl. Tienes hasta las 23:45 hrs ⏳
Recuerda que pagar fuera de plazo genera multas e intereses
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep`;

export const CONTIDEP_T1_TEMPLATE = `⏰ ¡Recordatorio importante!🛑

Mañana (día {{dia_vencimiento}}) vence el plazo para declarar y pagar tu Formulario 29 en www.sii.cl ⏳
Recuerda que pagar fuera de plazo genera multas e intereses.
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep`;

export const CONTIDEP_T3_TEMPLATE = `⏰ ¡Recordatorio F29! 📋

Hola {{nombre_empresa}}, te recordamos que en 3 días (el día {{dia_vencimiento}}) vence el plazo para pagar tu Formulario 29 en www.sii.cl ⏳
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep`;

function mapGrupo(row: GrupoClienteRow): GrupoCliente {
	return {
		...row,
		activo: Boolean(row.activo),
	};
}

function mapPlantilla(row: PlantillaMensajeRow): PlantillaMensaje {
	return {
		...row,
		activa: Boolean(row.activa),
	};
}

export async function ensureSchema(db: D1Database): Promise<void> {
	await db.batch([
		db.prepare(`
			CREATE TABLE IF NOT EXISTS grupos_clientes (
				id TEXT PRIMARY KEY,
				nombre_empresa TEXT NOT NULL,
				group_jid TEXT NOT NULL UNIQUE,
				activo INTEGER NOT NULL DEFAULT 0,
				dia_vencimiento_f29 INTEGER NOT NULL DEFAULT 20,
				created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
			)
		`),
		db.prepare(`
			CREATE INDEX IF NOT EXISTS idx_grupos_clientes_activo
			ON grupos_clientes (activo, dia_vencimiento_f29)
		`),
		db.prepare(`
			CREATE TABLE IF NOT EXISTS plantillas_mensajes (
				id TEXT PRIMARY KEY,
				codigo TEXT NOT NULL UNIQUE,
				nombre TEXT NOT NULL,
				dias_anticipacion INTEGER NOT NULL UNIQUE,
				contenido TEXT NOT NULL,
				activa INTEGER NOT NULL DEFAULT 1,
				updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
			)
		`),
		db.prepare(`
			CREATE TABLE IF NOT EXISTS historial_envios (
				id TEXT PRIMARY KEY,
				grupo_id TEXT NOT NULL,
				plantilla_codigo TEXT NOT NULL,
				periodo TEXT NOT NULL,
				fecha_envio TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
				estado TEXT NOT NULL CHECK (estado IN ('SUCCESS', 'FAILED')),
				mensaje_enviado TEXT,
				response_payload TEXT,
				FOREIGN KEY (grupo_id) REFERENCES grupos_clientes (id) ON DELETE CASCADE
			)
		`),
		db.prepare(`
			CREATE INDEX IF NOT EXISTS idx_historial_idempotencia
			ON historial_envios (grupo_id, periodo, plantilla_codigo, estado)
		`),
		db.prepare(`
			CREATE INDEX IF NOT EXISTS idx_historial_periodo
			ON historial_envios (periodo, fecha_envio DESC)
		`),
		db
			.prepare(`
				INSERT OR IGNORE INTO plantillas_mensajes (id, codigo, nombre, dias_anticipacion, contenido, activa)
				VALUES (?, ?, ?, ?, ?, ?)
			`)
			.bind("tpl-t0", "T-0", "Día de Vencimiento (Hoy vence)", 0, CONTIDEP_T0_TEMPLATE, 1),
		db
			.prepare(`
				INSERT OR IGNORE INTO plantillas_mensajes (id, codigo, nombre, dias_anticipacion, contenido, activa)
				VALUES (?, ?, ?, ?, ?, ?)
			`)
			.bind("tpl-t1", "T-1", "Aviso 1 día antes (Mañana vence)", 1, CONTIDEP_T1_TEMPLATE, 1),
		db
			.prepare(`
				INSERT OR IGNORE INTO plantillas_mensajes (id, codigo, nombre, dias_anticipacion, contenido, activa)
				VALUES (?, ?, ?, ?, ?, ?)
			`)
			.bind("tpl-t3", "T-3", "Aviso 3 días antes (Próximo a vencer)", 3, CONTIDEP_T3_TEMPLATE, 0),
	]);
}

export async function listGruposClientes(
	db: D1Database,
	options?: { onlyActive?: boolean },
): Promise<GrupoCliente[]> {
	const query = options?.onlyActive
		? "SELECT * FROM grupos_clientes WHERE activo = 1 ORDER BY nombre_empresa ASC"
		: "SELECT * FROM grupos_clientes ORDER BY activo DESC, nombre_empresa ASC";
	const { results } = await db.prepare(query).all<GrupoClienteRow>();
	return results.map(mapGrupo);
}

export async function getGrupoClienteById(
	db: D1Database,
	id: string,
): Promise<GrupoCliente | null> {
	const row = await db
		.prepare("SELECT * FROM grupos_clientes WHERE id = ?")
		.bind(id)
		.first<GrupoClienteRow>();
	return row ? mapGrupo(row) : null;
}

export async function syncGruposFromEvolution(
	db: D1Database,
	remoteGroups: Array<{ id: string; subject: string }>,
): Promise<{ inserted: number; totalRemote: number }> {
	let inserted = 0;
	const now = new Date().toISOString();

	for (const group of remoteGroups) {
		if (!group.id || !group.id.endsWith("@g.us")) {
			continue;
		}
		const nombre = (group.subject || group.id).trim();
		const res = await db
			.prepare(`
				INSERT OR IGNORE INTO grupos_clientes (id, nombre_empresa, group_jid, activo, dia_vencimiento_f29, created_at, updated_at)
				VALUES (?, ?, ?, 0, 20, ?, ?)
			`)
			.bind(crypto.randomUUID(), nombre, group.id, now, now)
			.run();

		if (res.meta.changes && res.meta.changes > 0) {
			inserted += 1;
		}
	}

	return {
		inserted,
		totalRemote: remoteGroups.length,
	};
}

export async function createOrUpdateGrupoCliente(
	db: D1Database,
	input: {
		nombre_empresa: string;
		group_jid: string;
		activo?: boolean;
		dia_vencimiento_f29?: number;
	},
): Promise<GrupoCliente> {
	const now = new Date().toISOString();
	const id = crypto.randomUUID();
	const activoInt = input.activo ? 1 : 0;
	const dia = input.dia_vencimiento_f29 ?? 20;

	await db
		.prepare(`
			INSERT INTO grupos_clientes (id, nombre_empresa, group_jid, activo, dia_vencimiento_f29, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(group_jid) DO UPDATE SET
				nombre_empresa = excluded.nombre_empresa,
				activo = excluded.activo,
				dia_vencimiento_f29 = excluded.dia_vencimiento_f29,
				updated_at = excluded.updated_at
		`)
		.bind(id, input.nombre_empresa.trim(), input.group_jid.trim(), activoInt, dia, now, now)
		.run();

	const row = await db
		.prepare("SELECT * FROM grupos_clientes WHERE group_jid = ?")
		.bind(input.group_jid.trim())
		.first<GrupoClienteRow>();

	if (!row) {
		throw new Error("No fue posible recuperar el grupo tras guardar.");
	}
	return mapGrupo(row);
}

export async function updateGrupoCliente(
	db: D1Database,
	id: string,
	patch: {
		nombre_empresa?: string;
		group_jid?: string;
		activo?: boolean;
		dia_vencimiento_f29?: number;
	},
): Promise<GrupoCliente | null> {
	const existing = await getGrupoClienteById(db, id);
	if (!existing) {
		return null;
	}

	const nombre = patch.nombre_empresa !== undefined ? patch.nombre_empresa.trim() : existing.nombre_empresa;
	const jid = patch.group_jid !== undefined ? patch.group_jid.trim() : existing.group_jid;
	const activo = patch.activo !== undefined ? (patch.activo ? 1 : 0) : existing.activo ? 1 : 0;
	const dia = patch.dia_vencimiento_f29 !== undefined ? patch.dia_vencimiento_f29 : existing.dia_vencimiento_f29;
	const now = new Date().toISOString();

	await db
		.prepare(`
			UPDATE grupos_clientes
			SET nombre_empresa = ?, group_jid = ?, activo = ?, dia_vencimiento_f29 = ?, updated_at = ?
			WHERE id = ?
		`)
		.bind(nombre, jid, activo, dia, now, id)
		.run();

	return getGrupoClienteById(db, id);
}

export async function deleteGrupoCliente(db: D1Database, id: string): Promise<boolean> {
	const res = await db.prepare("DELETE FROM grupos_clientes WHERE id = ?").bind(id).run();
	return Boolean(res.meta.changes && res.meta.changes > 0);
}

export async function listPlantillasMensajes(db: D1Database): Promise<PlantillaMensaje[]> {
	const { results } = await db
		.prepare("SELECT * FROM plantillas_mensajes ORDER BY dias_anticipacion ASC")
		.all<PlantillaMensajeRow>();
	return results.map(mapPlantilla);
}

export async function getPlantillaByCodigo(
	db: D1Database,
	codigo: string,
): Promise<PlantillaMensaje | null> {
	const row = await db
		.prepare("SELECT * FROM plantillas_mensajes WHERE codigo = ?")
		.bind(codigo)
		.first<PlantillaMensajeRow>();
	return row ? mapPlantilla(row) : null;
}

export async function updatePlantillaMensaje(
	db: D1Database,
	codigo: string,
	patch: {
		nombre?: string;
		dias_anticipacion?: number;
		contenido?: string;
		activa?: boolean;
	},
): Promise<PlantillaMensaje | null> {
	const existing = await getPlantillaByCodigo(db, codigo);
	if (!existing) {
		return null;
	}

	const nombre = patch.nombre !== undefined ? patch.nombre.trim() : existing.nombre;
	const dias = patch.dias_anticipacion !== undefined ? patch.dias_anticipacion : existing.dias_anticipacion;
	const contenido = patch.contenido !== undefined ? patch.contenido : existing.contenido;
	const activa = patch.activa !== undefined ? (patch.activa ? 1 : 0) : existing.activa ? 1 : 0;
	const now = new Date().toISOString();

	await db
		.prepare(`
			UPDATE plantillas_mensajes
			SET nombre = ?, dias_anticipacion = ?, contenido = ?, activa = ?, updated_at = ?
			WHERE codigo = ?
		`)
		.bind(nombre, dias, contenido, activa, now, codigo)
		.run();

	return getPlantillaByCodigo(db, codigo);
}

export async function hasSuccessfulEnvio(
	db: D1Database,
	grupoId: string,
	periodo: string,
	plantillaCodigo: string,
): Promise<boolean> {
	const row = await db
		.prepare(`
			SELECT id FROM historial_envios
			WHERE grupo_id = ? AND periodo = ? AND plantilla_codigo = ? AND estado = 'SUCCESS'
			LIMIT 1
		`)
		.bind(grupoId, periodo, plantillaCodigo)
		.first<{ id: string }>();

	return Boolean(row);
}

export async function insertHistorialEnvio(
	db: D1Database,
	entry: {
		grupo_id: string;
		plantilla_codigo: string;
		periodo: string;
		estado: EstadoEnvio;
		mensaje_enviado: string;
		response_payload: string;
	},
): Promise<HistorialEnvio> {
	const id = crypto.randomUUID();
	const fecha_envio = new Date().toISOString();

	await db
		.prepare(`
			INSERT INTO historial_envios (id, grupo_id, plantilla_codigo, periodo, fecha_envio, estado, mensaje_enviado, response_payload)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`)
		.bind(
			id,
			entry.grupo_id,
			entry.plantilla_codigo,
			entry.periodo,
			fecha_envio,
			entry.estado,
			entry.mensaje_enviado,
			entry.response_payload,
		)
		.run();

	return {
		id,
		grupo_id: entry.grupo_id,
		plantilla_codigo: entry.plantilla_codigo,
		periodo: entry.periodo,
		fecha_envio,
		estado: entry.estado,
		mensaje_enviado: entry.mensaje_enviado,
		response_payload: entry.response_payload,
	};
}

export async function listHistorialEnvios(
	db: D1Database,
	filters?: { periodo?: string; estado?: string; limit?: number },
): Promise<HistorialEnvio[]> {
	const conditions: string[] = [];
	const params: unknown[] = [];

	if (filters?.periodo) {
		conditions.push("h.periodo = ?");
		params.push(filters.periodo);
	}
	if (filters?.estado && (filters.estado === "SUCCESS" || filters.estado === "FAILED")) {
		conditions.push("h.estado = ?");
		params.push(filters.estado);
	}

	const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
	const limit = filters?.limit ?? 200;

	const sql = `
		SELECT
			h.id,
			h.grupo_id,
			g.nombre_empresa,
			g.group_jid,
			h.plantilla_codigo,
			h.periodo,
			h.fecha_envio,
			h.estado,
			h.mensaje_enviado,
			h.response_payload
		FROM historial_envios h
		LEFT JOIN grupos_clientes g ON g.id = h.grupo_id
		${whereClause}
		ORDER BY h.fecha_envio DESC
		LIMIT ?
	`;

	const { results } = await db
		.prepare(sql)
		.bind(...params, limit)
		.all<HistorialEnvio>();
	return results;
}
