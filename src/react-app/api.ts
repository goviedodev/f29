export interface GrupoCliente {
	id: string;
	nombre_empresa: string;
	group_jid: string;
	activo: boolean;
	dia_vencimiento_f29: number;
	created_at: string;
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

export interface HistorialEnvio {
	id: string;
	grupo_id: string;
	nombre_empresa?: string;
	group_jid?: string;
	plantilla_codigo: string;
	periodo: string;
	fecha_envio: string;
	estado: "SUCCESS" | "FAILED";
	mensaje_enviado: string | null;
	response_payload: string | null;
}

export interface AdminStatus {
	authenticated: boolean;
	fecha_santiago: string;
	periodo: string;
	dia_actual: number;
	evolution: {
		baseUrl: string;
		instance: string;
		hasApiKey: boolean;
		connectionState?: "open" | "close" | "connecting" | "unknown";
	};
	stats: {
		total_grupos: number;
		grupos_activos: number;
		plantillas_activas: number;
		envios_exitosos_mes: number;
		envios_fallidos_mes: number;
	};
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
	detalles: Array<{
		grupo_id: string;
		nombre_empresa: string;
		group_jid: string;
		plantilla_codigo: string;
		accion: string;
		detalle?: string;
	}>;
}

const STORAGE_KEY = "f29_admin_password";
const LOGOUT_FLAG_KEY = "f29_admin_logged_out";

export function getSavedPassword(): string {
	const saved = localStorage.getItem(STORAGE_KEY);
	if (saved) return saved;

	const isLocal =
		typeof window !== "undefined" &&
		(window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1" ||
			window.location.hostname === "192.168.100.14" ||
			window.location.hostname === "asus");
	if (isLocal && localStorage.getItem(LOGOUT_FLAG_KEY) !== "true") {
		localStorage.setItem(STORAGE_KEY, "admin123");
		return "admin123";
	}

	return "";
}

export function savePassword(password: string): void {
	localStorage.removeItem(LOGOUT_FLAG_KEY);
	localStorage.setItem(STORAGE_KEY, password);
}

export function clearPassword(): void {
	localStorage.setItem(LOGOUT_FLAG_KEY, "true");
	localStorage.removeItem(STORAGE_KEY);
}

async function apiFetch<T>(
	path: string,
	options: RequestInit = {},
	passwordOverride?: string,
): Promise<T> {
	const password = passwordOverride ?? getSavedPassword();
	const headers = new Headers(options.headers || {});
	headers.set("Content-Type", "application/json");
	if (password) {
		headers.set("Authorization", `Bearer ${password}`);
	}

	const response = await fetch(path, {
		...options,
		headers,
	});

	const data = (await response.json().catch(() => ({}))) as Record<
		string,
		unknown
	>;

	if (!response.ok) {
		const errorMsg =
			typeof data.error === "string"
				? data.error
				: `Error HTTP ${response.status}`;
		throw new Error(errorMsg);
	}

	return data as T;
}

export const adminApi = {
	verifyAndGetStatus(password?: string): Promise<AdminStatus> {
		return apiFetch<AdminStatus>("/api/admin/status", { method: "GET" }, password);
	},

	getWhatsappQr(): Promise<{
		state: "open" | "close" | "connecting" | "unknown";
		qrBase64: string | null;
		pairingCode: string | null;
	}> {
		return apiFetch("/api/admin/whatsapp/qr", { method: "GET" });
	},

	getGroups(): Promise<{ groups: GrupoCliente[] }> {
		return apiFetch<{ groups: GrupoCliente[] }>("/api/admin/groups");
	},

	createGroup(payload: {
		nombre_empresa: string;
		group_jid: string;
		activo?: boolean;
		dia_vencimiento_f29?: number;
	}): Promise<{ group: GrupoCliente }> {
		return apiFetch<{ group: GrupoCliente }>("/api/admin/groups", {
			method: "POST",
			body: JSON.stringify(payload),
		});
	},

	syncGroups(): Promise<{
		ok: boolean;
		inserted: number;
		total_remote: number;
		groups: GrupoCliente[];
	}> {
		return apiFetch("/api/admin/groups/sync", { method: "POST" });
	},

	updateGroup(
		id: string,
		patch: Partial<
			Pick<
				GrupoCliente,
				"nombre_empresa" | "group_jid" | "activo" | "dia_vencimiento_f29"
			>
		>,
	): Promise<{ group: GrupoCliente }> {
		return apiFetch<{ group: GrupoCliente }>(`/api/admin/groups/${id}`, {
			method: "PATCH",
			body: JSON.stringify(patch),
		});
	},

	deleteGroup(id: string): Promise<{ ok: boolean }> {
		return apiFetch<{ ok: boolean }>(`/api/admin/groups/${id}`, {
			method: "DELETE",
		});
	},

	sendTestMessage(
		id: string,
		plantilla_codigo?: string,
	): Promise<{
		ok: boolean;
		estado: "SUCCESS" | "FAILED";
		httpStatus: number | null;
		history: HistorialEnvio;
	}> {
		return apiFetch(`/api/admin/groups/${id}/send-test`, {
			method: "POST",
			body: JSON.stringify({ plantilla_codigo }),
		});
	},

	getTemplates(): Promise<{ templates: PlantillaMensaje[] }> {
		return apiFetch<{ templates: PlantillaMensaje[] }>("/api/admin/templates");
	},

	updateTemplate(
		codigo: string,
		patch: Partial<
			Pick<
				PlantillaMensaje,
				"nombre" | "dias_anticipacion" | "contenido" | "activa"
			>
		>,
	): Promise<{ template: PlantillaMensaje }> {
		return apiFetch<{ template: PlantillaMensaje }>(
			`/api/admin/templates/${encodeURIComponent(codigo)}`,
			{
				method: "PUT",
				body: JSON.stringify(patch),
			},
		);
	},

	getHistory(filters?: {
		periodo?: string;
		estado?: string;
	}): Promise<{ history: HistorialEnvio[] }> {
		const params = new URLSearchParams();
		if (filters?.periodo) params.set("periodo", filters.periodo);
		if (filters?.estado) params.set("estado", filters.estado);
		const qs = params.toString();
		return apiFetch<{ history: HistorialEnvio[] }>(
			`/api/admin/history${qs ? `?${qs}` : ""}`,
		);
	},

	runCronNow(overrideDate?: string): Promise<{
		ok: boolean;
		summary: ReminderRunSummary;
	}> {
		return apiFetch("/api/admin/cron/run", {
			method: "POST",
			body: JSON.stringify(overrideDate ? { overrideDate } : {}),
		});
	},
};
