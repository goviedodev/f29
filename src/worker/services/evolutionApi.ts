import type { EstadoEnvio } from "../db/queries";

export interface EvolutionGroupSummary {
	id: string;
	subject: string;
	size?: number;
}

export interface SendMessageResult {
	estado: EstadoEnvio;
	httpStatus: number | null;
	responsePayload: string;
}

export interface EvolutionConfig {
	baseUrl: string;
	apiKey: string;
	instance: string;
}

export interface EvolutionConnectionInfo {
	state: "open" | "close" | "connecting" | "unknown";
	qrBase64: string | null;
	pairingCode: string | null;
}

export function getEvolutionConfig(env: Env): EvolutionConfig {
	return {
		baseUrl: (env.EVOLUTION_API_URL || "").replace(/\/+$/, ""),
		apiKey: env.EVOLUTION_API_KEY || "",
		instance: env.EVOLUTION_INSTANCE || "",
	};
}

/**
 * Asegura que la instancia exista en Evolution API y devuelve su estado ('open' | 'close' | 'connecting')
 * junto con el QR en base64 si aún no está vinculada a un WhatsApp real.
 */
export async function getWhatsappConnectionInfo(
	config: EvolutionConfig,
	includeQr = false,
): Promise<EvolutionConnectionInfo> {
	if (!config.baseUrl || !config.apiKey || !config.instance) {
		return { state: "unknown", qrBase64: null, pairingCode: null };
	}

	const stateUrl = `${config.baseUrl}/instance/connectionState/${encodeURIComponent(config.instance)}`;
	let stateRes = await fetch(stateUrl, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			apikey: config.apiKey,
		},
		signal: AbortSignal.timeout(10000),
	});

	if (stateRes.status === 404) {
		await fetch(`${config.baseUrl}/instance/create`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				apikey: config.apiKey,
			},
			body: JSON.stringify({
				instanceName: config.instance,
				integration: "WHATSAPP-BAILEYS",
				qrcode: true,
			}),
			signal: AbortSignal.timeout(10000),
		});

		stateRes = await fetch(stateUrl, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				apikey: config.apiKey,
			},
			signal: AbortSignal.timeout(10000),
		});
	}

	let currentState: "open" | "close" | "connecting" | "unknown" = "unknown";
	if (stateRes.ok) {
		const data = (await stateRes.json().catch(() => ({}))) as {
			instance?: { state?: string };
		};
		const rawState = data?.instance?.state;
		if (
			rawState === "open" ||
			rawState === "close" ||
			rawState === "connecting"
		) {
			currentState = rawState;
		}
	}

	if (currentState === "open" || !includeQr) {
		return { state: currentState, qrBase64: null, pairingCode: null };
	}

	const connectUrl = `${config.baseUrl}/instance/connect/${encodeURIComponent(config.instance)}`;
	const connectRes = await fetch(connectUrl, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			apikey: config.apiKey,
		},
		signal: AbortSignal.timeout(15000),
	});

	if (!connectRes.ok) {
		return { state: currentState, qrBase64: null, pairingCode: null };
	}

	const connectData = (await connectRes.json().catch(() => ({}))) as {
		base64?: string | null;
		pairingCode?: string | null;
		instance?: { state?: string };
	};

	if (connectData?.instance?.state === "open") {
		return { state: "open", qrBase64: null, pairingCode: null };
	}

	return {
		state: currentState === "unknown" ? "connecting" : currentState,
		qrBase64: typeof connectData.base64 === "string" ? connectData.base64 : null,
		pairingCode:
			typeof connectData.pairingCode === "string"
				? connectData.pairingCode
				: null,
	};
}

export async function fetchAllGroups(
	config: EvolutionConfig,
): Promise<EvolutionGroupSummary[]> {
	if (!config.baseUrl || !config.apiKey || !config.instance) {
		throw new Error(
			"Faltan variables de configuración de Evolution API (EVOLUTION_API_URL, EVOLUTION_API_KEY o EVOLUTION_INSTANCE).",
		);
	}

	const info = await getWhatsappConnectionInfo(config, false);
	if (info.state !== "open") {
		throw new Error(
			`Tu instancia de WhatsApp ('${config.instance}') aún no está vinculada (estado: ${info.state}). Escanea primero el código QR con tu celular para obtener tus grupos reales.`,
		);
	}

	const url = `${config.baseUrl}/group/fetchAllGroups/${encodeURIComponent(config.instance)}?getParticipants=false`;
	const response = await fetch(url, {
		method: "GET",
		headers: {
			"Content-Type": "application/json",
			apikey: config.apiKey,
		},
		signal: AbortSignal.timeout(90000),
	});

	const rawText = await response.text();
	if (!response.ok) {
		throw new Error(
			`Evolution API respondió HTTP ${response.status}: ${rawText.slice(0, 300)}`,
		);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		throw new Error("La respuesta de Evolution API no es un JSON válido.");
	}

	const list = Array.isArray(parsed)
		? parsed
		: parsed && typeof parsed === "object" && Array.isArray((parsed as { data?: unknown[] }).data)
			? (parsed as { data: unknown[] }).data
			: [];

	const groups: EvolutionGroupSummary[] = [];
	for (const item of list) {
		if (item && typeof item === "object") {
			const record = item as Record<string, unknown>;
			const id = typeof record.id === "string" ? record.id : "";
			const subject =
				typeof record.subject === "string"
					? record.subject
					: typeof record.name === "string"
						? record.name
						: id;
			const size = typeof record.size === "number" ? record.size : undefined;
			if (id.endsWith("@g.us")) {
				groups.push({ id, subject, size });
			}
		}
	}

	return groups;
}

export async function sendGroupText(
	config: EvolutionConfig,
	groupJid: string,
	text: string,
): Promise<SendMessageResult> {
	if (!groupJid.endsWith("@g.us")) {
		return {
			estado: "FAILED",
			httpStatus: null,
			responsePayload: JSON.stringify({
				error: `El identificador '${groupJid}' no tiene formato de Group JID (@g.us).`,
			}),
		};
	}

	if (!config.baseUrl || !config.apiKey || !config.instance) {
		return {
			estado: "FAILED",
			httpStatus: null,
			responsePayload: JSON.stringify({
				error: "Configuración de Evolution API incompleta (EVOLUTION_API_URL, EVOLUTION_API_KEY o EVOLUTION_INSTANCE).",
			}),
		};
	}

	const url = `${config.baseUrl}/message/sendText/${encodeURIComponent(config.instance)}`;

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				apikey: config.apiKey,
			},
			body: JSON.stringify({
				number: groupJid,
				text,
			}),
			signal: AbortSignal.timeout(15000),
		});

		const responseText = await response.text();
		if (response.ok) {
			return {
				estado: "SUCCESS",
				httpStatus: response.status,
				responsePayload: responseText || JSON.stringify({ ok: true }),
			};
		}

		return {
			estado: "FAILED",
			httpStatus: response.status,
			responsePayload:
				responseText ||
				JSON.stringify({
					error: `HTTP ${response.status} ${response.statusText}`,
				}),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			estado: "FAILED",
			httpStatus: null,
			responsePayload: JSON.stringify({
				error: "Error de red o timeout al contactar Evolution API",
				detail: message,
			}),
		};
	}
}
