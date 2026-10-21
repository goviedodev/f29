import {
	ensureSchema,
	hasSuccessfulEnvio,
	insertHistorialEnvio,
	listGruposClientes,
	listPlantillasMensajes,
	type GrupoCliente,
	type PlantillaMensaje,
} from "../db/queries";
import { getEvolutionConfig, sendGroupText } from "../services/evolutionApi";

export interface SantiagoDateParts {
	fecha: string; // YYYY-MM-DD
	periodo: string; // YYYY-MM
	year: number;
	month: number;
	day: number;
}

export interface ReminderExecutionDetail {
	grupo_id: string;
	nombre_empresa: string;
	group_jid: string;
	plantilla_codigo: string;
	accion: "SENT_SUCCESS" | "SENT_FAILED" | "SKIPPED_IDEMPOTENT" | "OUT_OF_WINDOW";
	detalle?: string;
}

export interface ReminderRunSummary {
	fecha_santiago: string;
	periodo: string;
	dia_actual: number;
	grupos_activos: number;
	enviados_exito: number;
	enviados_fallo: number;
	omitidos_idempotencia: number;
	fuera_de_ventana: number;
	detalles: ReminderExecutionDetail[];
}

export function getSantiagoDateParts(now: Date = new Date()): SantiagoDateParts {
	const formatter = new Intl.DateTimeFormat("en-CA", {
		timeZone: "America/Santiago",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});

	const parts = formatter.formatToParts(now);
	const yearStr = parts.find((p) => p.type === "year")?.value ?? "2026";
	const monthStr = parts.find((p) => p.type === "month")?.value ?? "01";
	const dayStr = parts.find((p) => p.type === "day")?.value ?? "01";

	return {
		fecha: `${yearStr}-${monthStr}-${dayStr}`,
		periodo: `${yearStr}-${monthStr}`,
		year: Number(yearStr),
		month: Number(monthStr),
		day: Number(dayStr),
	};
}

export function parseCustomDateParts(dateStr: string): SantiagoDateParts {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
	if (!match) {
		throw new Error("Formato de fecha inválido. Use YYYY-MM-DD.");
	}
	const [, yearStr, monthStr, dayStr] = match;
	return {
		fecha: `${yearStr}-${monthStr}-${dayStr}`,
		periodo: `${yearStr}-${monthStr}`,
		year: Number(yearStr),
		month: Number(monthStr),
		day: Number(dayStr),
	};
}

export function renderTemplateContent(
	template: string,
	vars: {
		nombre_empresa: string;
		dia_vencimiento: number;
		periodo: string;
	},
): string {
	return template
		.replace(/\{\{\s*nombre_empresa\s*\}\}/g, vars.nombre_empresa)
		.replace(/\{\{\s*dia_vencimiento\s*\}\}/g, String(vars.dia_vencimiento))
		.replace(/\{\{\s*periodo\s*\}\}/g, vars.periodo);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runF29Reminders(
	env: Env,
	options?: {
		overrideDate?: string;
		delayMs?: number;
	},
): Promise<ReminderRunSummary> {
	await ensureSchema(env.DB);

	const dateParts = options?.overrideDate
		? parseCustomDateParts(options.overrideDate)
		: getSantiagoDateParts();

	const activeGroups: GrupoCliente[] = await listGruposClientes(env.DB, {
		onlyActive: true,
	});
	const templates: PlantillaMensaje[] = await listPlantillasMensajes(env.DB);
	const activeTemplatesByDays = new Map<number, PlantillaMensaje>();

	for (const tpl of templates) {
		if (tpl.activa) {
			activeTemplatesByDays.set(tpl.dias_anticipacion, tpl);
		}
	}

	const evolutionConfig = getEvolutionConfig(env);
	const delayMs = options?.delayMs ?? 1500;

	const summary: ReminderRunSummary = {
		fecha_santiago: dateParts.fecha,
		periodo: dateParts.periodo,
		dia_actual: dateParts.day,
		grupos_activos: activeGroups.length,
		enviados_exito: 0,
		enviados_fallo: 0,
		omitidos_idempotencia: 0,
		fuera_de_ventana: 0,
		detalles: [],
	};

	let sendCount = 0;

	for (const grupo of activeGroups) {
		const diasRestantes = grupo.dia_vencimiento_f29 - dateParts.day;
		const matchingTemplate = activeTemplatesByDays.get(diasRestantes);

		if (!matchingTemplate) {
			summary.fuera_de_ventana += 1;
			summary.detalles.push({
				grupo_id: grupo.id,
				nombre_empresa: grupo.nombre_empresa,
				group_jid: grupo.group_jid,
				plantilla_codigo: "-",
				accion: "OUT_OF_WINDOW",
				detalle: `dias_restantes=${diasRestantes} (vence día ${grupo.dia_vencimiento_f29})`,
			});
			continue;
		}

		const alreadySent = await hasSuccessfulEnvio(
			env.DB,
			grupo.id,
			dateParts.periodo,
			matchingTemplate.codigo,
		);

		if (alreadySent) {
			summary.omitidos_idempotencia += 1;
			summary.detalles.push({
				grupo_id: grupo.id,
				nombre_empresa: grupo.nombre_empresa,
				group_jid: grupo.group_jid,
				plantilla_codigo: matchingTemplate.codigo,
				accion: "SKIPPED_IDEMPOTENT",
				detalle: `Ya existe envío SUCCESS en ${dateParts.periodo} para ${matchingTemplate.codigo}`,
			});
			continue;
		}

		if (sendCount > 0 && delayMs > 0) {
			await sleep(delayMs);
		}

		const renderedText = renderTemplateContent(matchingTemplate.contenido, {
			nombre_empresa: grupo.nombre_empresa,
			dia_vencimiento: grupo.dia_vencimiento_f29,
			periodo: dateParts.periodo,
		});

		const sendResult = await sendGroupText(
			evolutionConfig,
			grupo.group_jid,
			renderedText,
		);
		sendCount += 1;

		await insertHistorialEnvio(env.DB, {
			grupo_id: grupo.id,
			plantilla_codigo: matchingTemplate.codigo,
			periodo: dateParts.periodo,
			estado: sendResult.estado,
			mensaje_enviado: renderedText,
			response_payload: sendResult.responsePayload,
		});

		if (sendResult.estado === "SUCCESS") {
			summary.enviados_exito += 1;
			summary.detalles.push({
				grupo_id: grupo.id,
				nombre_empresa: grupo.nombre_empresa,
				group_jid: grupo.group_jid,
				plantilla_codigo: matchingTemplate.codigo,
				accion: "SENT_SUCCESS",
			});
		} else {
			summary.enviados_fallo += 1;
			summary.detalles.push({
				grupo_id: grupo.id,
				nombre_empresa: grupo.nombre_empresa,
				group_jid: grupo.group_jid,
				plantilla_codigo: matchingTemplate.codigo,
				accion: "SENT_FAILED",
				detalle: sendResult.responsePayload,
			});
		}
	}

	return summary;
}
