import { Hono } from "hono";
import {
	createOrUpdateGrupoCliente,
	deleteGrupoCliente,
	ensureSchema,
	getGrupoClienteById,
	getPlantillaByCodigo,
	insertHistorialEnvio,
	listGruposClientes,
	listHistorialEnvios,
	listPlantillasMensajes,
	syncGruposFromEvolution,
	updateGrupoCliente,
	updatePlantillaMensaje,
} from "./db/queries";
import {
	fetchAllGroups,
	getEvolutionConfig,
	getWhatsappConnectionInfo,
	sendGroupText,
} from "./services/evolutionApi";
import {
	getSantiagoDateParts,
	renderTemplateContent,
	runF29Reminders,
} from "./cron/f29Reminder";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => {
	const dateParts = getSantiagoDateParts();
	return c.json({
		ok: true,
		service: "f29-whatsapp-daemon",
		fecha_santiago: dateParts.fecha,
		periodo: dateParts.periodo,
	});
});

// Middleware de autenticación para /api/admin/*
app.use("/api/admin/*", async (c, next) => {
	const configuredPassword = c.env.ADMIN_PASSWORD;
	if (!configuredPassword) {
		return c.json(
			{ error: "ADMIN_PASSWORD no está configurado en el Worker." },
			500,
		);
	}

	const authHeader = c.req.header("Authorization") ?? "";
	const bearerToken = authHeader.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: "";
	const customHeader = (c.req.header("x-admin-password") ?? "").trim();
	const providedPassword = bearerToken || customHeader;

	if (!providedPassword || providedPassword !== configuredPassword) {
		return c.json({ error: "No autorizado. Clave de administrador inválida." }, 401);
	}

	await ensureSchema(c.env.DB);
	await next();
});

// Estado general y verificación de sesión admin
app.get("/api/admin/status", async (c) => {
	const dateParts = getSantiagoDateParts();
	const grupos = await listGruposClientes(c.env.DB);
	const plantillas = await listPlantillasMensajes(c.env.DB);
	const historialMes = await listHistorialEnvios(c.env.DB, {
		periodo: dateParts.periodo,
		limit: 500,
	});

	const evolutionConfig = getEvolutionConfig(c.env);
	const connectionInfo = await getWhatsappConnectionInfo(
		evolutionConfig,
		false,
	).catch(() => ({
		state: "unknown" as const,
		qrBase64: null,
		pairingCode: null,
	}));

	return c.json({
		authenticated: true,
		fecha_santiago: dateParts.fecha,
		periodo: dateParts.periodo,
		dia_actual: dateParts.day,
		evolution: {
			baseUrl: evolutionConfig.baseUrl,
			instance: evolutionConfig.instance,
			hasApiKey: Boolean(evolutionConfig.apiKey),
			connectionState: connectionInfo.state,
		},
		stats: {
			total_grupos: grupos.length,
			grupos_activos: grupos.filter((g) => g.activo).length,
			plantillas_activas: plantillas.filter((t) => t.activa).length,
			envios_exitosos_mes: historialMes.filter((h) => h.estado === "SUCCESS").length,
			envios_fallidos_mes: historialMes.filter((h) => h.estado === "FAILED").length,
		},
	});
});

// Obtener código QR de vinculación de WhatsApp real desde Evolution API
app.get("/api/admin/whatsapp/qr", async (c) => {
	const evolutionConfig = getEvolutionConfig(c.env);
	const info = await getWhatsappConnectionInfo(evolutionConfig, true);
	return c.json(info);
});

// 1. Endpoints de Grupos de Clientes
app.get("/api/admin/groups", async (c) => {
	const groups = await listGruposClientes(c.env.DB);
	return c.json({ groups });
});

app.post("/api/admin/groups", async (c) => {
	const body = await c.req.json<{
		nombre_empresa?: string;
		group_jid?: string;
		activo?: boolean;
		dia_vencimiento_f29?: number;
	}>();

	if (!body.nombre_empresa || !body.group_jid) {
		return c.json(
			{ error: "nombre_empresa y group_jid son obligatorios." },
			400,
		);
	}
	if (!body.group_jid.trim().endsWith("@g.us")) {
		return c.json(
			{ error: "El group_jid debe terminar en @g.us" },
			400,
		);
	}

	const group = await createOrUpdateGrupoCliente(c.env.DB, {
		nombre_empresa: body.nombre_empresa,
		group_jid: body.group_jid,
		activo: body.activo ?? false,
		dia_vencimiento_f29: body.dia_vencimiento_f29 ?? 20,
	});

	return c.json({ group }, 201);
});

app.post("/api/admin/groups/sync", async (c) => {
	try {
		const config = getEvolutionConfig(c.env);
		const remoteGroups = await fetchAllGroups(config);
		const syncResult = await syncGruposFromEvolution(c.env.DB, remoteGroups);
		const groups = await listGruposClientes(c.env.DB);

		return c.json({
			ok: true,
			inserted: syncResult.inserted,
			total_remote: syncResult.totalRemote,
			groups,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json(
			{
				ok: false,
				error: `No fue posible sincronizar desde Evolution API: ${message}`,
			},
			502,
		);
	}
});

app.patch("/api/admin/groups/:id", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json<{
		nombre_empresa?: string;
		group_jid?: string;
		activo?: boolean;
		dia_vencimiento_f29?: number;
	}>();

	if (
		body.dia_vencimiento_f29 !== undefined &&
		(body.dia_vencimiento_f29 < 1 || body.dia_vencimiento_f29 > 31)
	) {
		return c.json(
			{ error: "dia_vencimiento_f29 debe estar entre 1 y 31." },
			400,
		);
	}

	const updated = await updateGrupoCliente(c.env.DB, id, body);
	if (!updated) {
		return c.json({ error: "Grupo no encontrado." }, 404);
	}
	return c.json({ group: updated });
});

app.delete("/api/admin/groups/:id", async (c) => {
	const id = c.req.param("id");
	const deleted = await deleteGrupoCliente(c.env.DB, id);
	if (!deleted) {
		return c.json({ error: "Grupo no encontrado." }, 404);
	}
	return c.json({ ok: true });
});

app.post("/api/admin/groups/:id/send-test", async (c) => {
	const id = c.req.param("id");
	const grupo = await getGrupoClienteById(c.env.DB, id);
	if (!grupo) {
		return c.json({ error: "Grupo no encontrado." }, 404);
	}

	let body: { plantilla_codigo?: string; custom_text?: string } = {};
	try {
		body = await c.req.json();
	} catch {
		// body opcional
	}

	const codigo = body.plantilla_codigo || "T-0";
	const plantilla = await getPlantillaByCodigo(c.env.DB, codigo);
	const dateParts = getSantiagoDateParts();

	const rawTemplate =
		body.custom_text ??
		plantilla?.contenido ??
		"Recordatorio de prueba F29 para {{nombre_empresa}}";

	const renderedText = renderTemplateContent(rawTemplate, {
		nombre_empresa: grupo.nombre_empresa,
		dia_vencimiento: grupo.dia_vencimiento_f29,
		periodo: dateParts.periodo,
	});

	const config = getEvolutionConfig(c.env);
	const result = await sendGroupText(config, grupo.group_jid, renderedText);

	const historyEntry = await insertHistorialEnvio(c.env.DB, {
		grupo_id: grupo.id,
		plantilla_codigo: body.plantilla_codigo ? `${codigo}` : "T-0",
		periodo: dateParts.periodo,
		estado: result.estado,
		mensaje_enviado: renderedText,
		response_payload: result.responsePayload,
	});

	return c.json({
		ok: result.estado === "SUCCESS",
		estado: result.estado,
		httpStatus: result.httpStatus,
		history: historyEntry,
	});
});

// 2. Endpoints de Plantillas de Mensajes
app.get("/api/admin/templates", async (c) => {
	const templates = await listPlantillasMensajes(c.env.DB);
	return c.json({ templates });
});

app.put("/api/admin/templates/:codigo", async (c) => {
	const codigo = c.req.param("codigo");
	const body = await c.req.json<{
		nombre?: string;
		dias_anticipacion?: number;
		contenido?: string;
		activa?: boolean;
	}>();

	if (body.contenido !== undefined && !body.contenido.trim()) {
		return c.json({ error: "El contenido de la plantilla no puede estar vacío." }, 400);
	}

	const updated = await updatePlantillaMensaje(c.env.DB, codigo, body);
	if (!updated) {
		return c.json({ error: `Plantilla '${codigo}' no encontrada.` }, 404);
	}
	return c.json({ template: updated });
});

// 3. Endpoints de Historial y Ejecución Manual del Daemon Cron
app.get("/api/admin/history", async (c) => {
	const periodo = c.req.query("periodo");
	const estado = c.req.query("estado");
	const history = await listHistorialEnvios(c.env.DB, {
		periodo: periodo || undefined,
		estado: estado || undefined,
	});
	return c.json({ history });
});

app.post("/api/admin/cron/run", async (c) => {
	let body: { overrideDate?: string } = {};
	try {
		body = await c.req.json();
	} catch {
		// sin body
	}

	try {
		const summary = await runF29Reminders(c.env, {
			overrideDate: body.overrideDate,
			delayMs: 500,
		});
		return c.json({ ok: true, summary });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return c.json({ ok: false, error: message }, 400);
	}
});

export default {
	fetch: app.fetch,
	async scheduled(
		_controller: ScheduledController,
		env: Env,
		ctx: ExecutionContext,
	): Promise<void> {
		ctx.waitUntil(runF29Reminders(env));
	},
};
