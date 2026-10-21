import { useEffect, useMemo, useState } from "react";
import {
	adminApi,
	clearPassword,
	getSavedPassword,
	savePassword,
	type AdminStatus,
	type GrupoCliente,
	type HistorialEnvio,
	type PlantillaMensaje,
} from "./api";
import "./App.css";

const CONTIDEP_OFFICIAL_T0 = `⏰ ¡Recordatorio importante!🛑

Hoy vence el plazo para pagar tu Formulario 29 en www.sii.cl. Tienes hasta las 23:45 hrs ⏳
Recuerda que pagar fuera de plazo genera multas e intereses
📩 Este es un mensaje automático. Si ya pagaste o declaraste sin movimiento, no te preocupes y omite este aviso.

¡Gracias! 😊
Contidep`;

type ActiveTab = "groups" | "templates" | "history";

function interpolatePreview(
	content: string,
	sampleName = "El Pache SPA ©️ 💲",
	sampleDay = 20,
	samplePeriod = "2026-10",
): string {
	return content
		.replace(/\{\{\s*nombre_empresa\s*\}\}/g, sampleName)
		.replace(/\{\{\s*dia_vencimiento\s*\}\}/g, String(sampleDay))
		.replace(/\{\{\s*periodo\s*\}\}/g, samplePeriod);
}

export function App() {
	const [isAuthenticated, setIsAuthenticated] = useState(false);
	const [passwordInput, setPasswordInput] = useState("");
	const [authLoading, setAuthLoading] = useState(true);
	const [authError, setAuthError] = useState<string | null>(null);

	const [activeTab, setActiveTab] = useState<ActiveTab>("groups");
	const [status, setStatus] = useState<AdminStatus | null>(null);
	const [groups, setGroups] = useState<GrupoCliente[]>([]);
	const [templates, setTemplates] = useState<PlantillaMensaje[]>([]);
	const [history, setHistory] = useState<HistorialEnvio[]>([]);

	const [banner, setBanner] = useState<{
		type: "success" | "error";
		text: string;
	} | null>(null);

	// Estados de filtro de grupos
	const [searchQuery, setSearchQuery] = useState("");
	const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">(
		"ALL",
	);
	const [onlyClientEmoji, setOnlyClientEmoji] = useState(false);
	const [syncingGroups, setSyncingGroups] = useState(false);
	const [sendingTestId, setSendingTestId] = useState<string | null>(null);

	// Formulario manual para agregar grupo
	const [newGroupName, setNewGroupName] = useState("");
	const [newGroupJid, setNewGroupJid] = useState("");
	const [newGroupDay, setNewGroupDay] = useState(20);

	// Estados del editor de plantillas
	const [selectedTemplateCode, setSelectedTemplateCode] = useState<string>("T-0");
	const [tplNombre, setTplNombre] = useState("");
	const [tplDias, setTplDias] = useState(0);
	const [tplActiva, setTplActiva] = useState(true);
	const [tplContenido, setTplContenido] = useState(CONTIDEP_OFFICIAL_T0);
	const [savingTemplate, setSavingTemplate] = useState(false);

	// Estados de filtro de historial y ejecución manual del cron
	const [historyPeriod, setHistoryPeriod] = useState("");
	const [historyStatus, setHistoryStatus] = useState("");
	const [runningCron, setRunningCron] = useState(false);

	// Estado de vinculación QR de WhatsApp real
	const [qrBase64, setQrBase64] = useState<string | null>(null);
	const [loadingQr, setLoadingQr] = useState(false);

	async function fetchWhatsappQrSafe(): Promise<{
		state: "open" | "close" | "connecting" | "unknown";
		qrBase64: string | null;
		pairingCode: string | null;
	}> {
		if (typeof adminApi.getWhatsappQr === "function") {
			return adminApi.getWhatsappQr();
		}
		const res = await fetch("/api/admin/whatsapp/qr", {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${getSavedPassword()}`,
			},
		});
		if (!res.ok) {
			throw new Error(`Error HTTP ${res.status} al obtener QR`);
		}
		return res.json();
	}

	async function handleLoadWhatsappQr() {
		setLoadingQr(true);
		setBanner(null);
		try {
			const qrInfo = await fetchWhatsappQrSafe();
			setQrBase64(qrInfo.qrBase64);
			const updatedStatus = await adminApi.verifyAndGetStatus();
			setStatus(updatedStatus);
			if (qrInfo.state === "open") {
				setQrBase64(null);
				setBanner({
					type: "success",
					text: "¡WhatsApp real conectado! Ahora pulsa 'Sincronizar con WhatsApp' para traer tus grupos reales.",
				});
			}
		} catch (err) {
			setBanner({
				type: "error",
				text:
					err instanceof Error
						? err.message
						: "No se pudo obtener el código QR desde Evolution API.",
			});
		} finally {
			setLoadingQr(false);
		}
	}

	async function loadAllData() {
		const [statusRes, groupsRes, templatesRes] = await Promise.all([
			adminApi.verifyAndGetStatus(),
			adminApi.getGroups(),
			adminApi.getTemplates(),
		]);
		setStatus(statusRes);
		setGroups(groupsRes.groups);
		setTemplates(templatesRes.templates);

		if (statusRes.evolution.connectionState !== "open") {
			fetchWhatsappQrSafe()
				.then((qrInfo) => {
					if (qrInfo.qrBase64) {
						setQrBase64(qrInfo.qrBase64);
					}
				})
				.catch(() => {
					// ignorar error inicial de QR
				});
		} else {
			setQrBase64(null);
		}

		const defaultPeriod = historyPeriod || statusRes.periodo;
		if (!historyPeriod) {
			setHistoryPeriod(statusRes.periodo);
		}
		const historyRes = await adminApi.getHistory({
			periodo: defaultPeriod,
			estado: historyStatus || undefined,
		});
		setHistory(historyRes.history);
	}

	// Polling automático cada 4s mientras el QR esté visible esperando ser escaneado
	useEffect(() => {
		if (!isAuthenticated || status?.evolution.connectionState === "open") {
			return;
		}
		const timer = setInterval(async () => {
			try {
				const qrInfo = await fetchWhatsappQrSafe();
				if (qrInfo.state === "open") {
					setQrBase64(null);
					const syncRes = await adminApi.syncGroups();
					setGroups(syncRes.groups);
					const updatedStatus = await adminApi.verifyAndGetStatus();
					setStatus(updatedStatus);
					setBanner({
						type: "success",
						text: `¡WhatsApp vinculado con éxito! Se sincronizaron automáticamente ${syncRes.total_remote} grupos reales desde tu celular.`,
					});
				} else if (qrInfo.qrBase64) {
					setQrBase64(qrInfo.qrBase64);
				}
			} catch {
				// continuar esperando escaneo
			}
		}, 4000);
		return () => clearInterval(timer);
	}, [isAuthenticated, status?.evolution.connectionState]);

	useEffect(() => {
		const saved = getSavedPassword();
		if (!saved) {
			setAuthLoading(false);
			return;
		}
		adminApi
			.verifyAndGetStatus(saved)
			.then(async (statusRes) => {
				setStatus(statusRes);
				setIsAuthenticated(true);
				await loadAllData();
			})
			.catch(() => {
				clearPassword();
				setIsAuthenticated(false);
			})
			.finally(() => {
				setAuthLoading(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Sincronizar campos del editor cuando cambia la plantilla seleccionada
	useEffect(() => {
		const current = templates.find((t) => t.codigo === selectedTemplateCode);
		if (current) {
			setTplNombre(current.nombre);
			setTplDias(current.dias_anticipacion);
			setTplActiva(current.activa);
			setTplContenido(current.contenido);
		}
	}, [selectedTemplateCode, templates]);

	async function handleLogin(e: React.FormEvent) {
		e.preventDefault();
		setAuthError(null);
		setAuthLoading(true);
		try {
			const statusRes = await adminApi.verifyAndGetStatus(passwordInput.trim());
			savePassword(passwordInput.trim());
			setStatus(statusRes);
			setIsAuthenticated(true);
			await loadAllData();
		} catch (err) {
			setAuthError(
				err instanceof Error ? err.message : "No fue posible iniciar sesión.",
			);
		} finally {
			setAuthLoading(false);
		}
	}

	function handleLogout() {
		clearPassword();
		setIsAuthenticated(false);
		setPasswordInput("");
		setStatus(null);
	}

	async function handleSyncWhatsApp() {
		setSyncingGroups(true);
		setBanner(null);
		try {
			const res = await adminApi.syncGroups();
			setGroups(res.groups);
			const updatedStatus = await adminApi.verifyAndGetStatus();
			setStatus(updatedStatus);
			setBanner({
				type: "success",
				text: `Sincronización exitosa: ${res.total_remote} grupos leídos desde WhatsApp (${res.inserted} nuevos importados en modo inactivo).`,
			});
		} catch (err) {
			await handleLoadWhatsappQr();
			setBanner({
				type: "error",
				text:
					err instanceof Error
						? err.message
						: "Error al sincronizar con Evolution API.",
			});
		} finally {
			setSyncingGroups(false);
		}
	}

	async function handleUpdateGroup(
		group: GrupoCliente,
		patch: Partial<
			Pick<GrupoCliente, "activo" | "nombre_empresa" | "dia_vencimiento_f29">
		>,
	) {
		try {
			const res = await adminApi.updateGroup(group.id, patch);
			setGroups((prev) =>
				prev.map((item) => (item.id === group.id ? res.group : item)),
			);
			const updatedStatus = await adminApi.verifyAndGetStatus();
			setStatus(updatedStatus);
		} catch (err) {
			setBanner({
				type: "error",
				text:
					err instanceof Error ? err.message : "No se pudo actualizar el grupo.",
			});
		}
	}

	async function handleCreateManualGroup(e: React.FormEvent) {
		e.preventDefault();
		if (!newGroupName.trim() || !newGroupJid.trim()) return;
		setBanner(null);
		try {
			await adminApi.createGroup({
				nombre_empresa: newGroupName.trim(),
				group_jid: newGroupJid.trim(),
				activo: true,
				dia_vencimiento_f29: newGroupDay,
			});
			setNewGroupName("");
			setNewGroupJid("");
			setNewGroupDay(20);
			await loadAllData();
			setBanner({
				type: "success",
				text: "Grupo agregado/actualizado correctamente.",
			});
		} catch (err) {
			setBanner({
				type: "error",
				text: err instanceof Error ? err.message : "Error al crear grupo.",
			});
		}
	}

	async function handleSendTest(group: GrupoCliente) {
		setSendingTestId(group.id);
		setBanner(null);
		try {
			const res = await adminApi.sendTestMessage(
				group.id,
				selectedTemplateCode || "T-0",
			);
			await loadAllData();
			if (res.ok) {
				setBanner({
					type: "success",
					text: `Mensaje enviado con éxito a "${group.nombre_empresa}".`,
				});
			} else {
				setBanner({
					type: "error",
					text: `El envío a "${group.nombre_empresa}" quedó en estado FAILED. Revisa la pestaña Historial para ver el detalle.`,
				});
			}
		} catch (err) {
			setBanner({
				type: "error",
				text: err instanceof Error ? err.message : "Error en envío de prueba.",
			});
		} finally {
			setSendingTestId(null);
		}
	}

	async function handleSaveTemplate(e: React.FormEvent) {
		e.preventDefault();
		setSavingTemplate(true);
		setBanner(null);
		try {
			const res = await adminApi.updateTemplate(selectedTemplateCode, {
				nombre: tplNombre,
				dias_anticipacion: tplDias,
				activa: tplActiva,
				contenido: tplContenido,
			});
			setTemplates((prev) =>
				prev.map((t) =>
					t.codigo === selectedTemplateCode ? res.template : t,
				),
			);
			const updatedStatus = await adminApi.verifyAndGetStatus();
			setStatus(updatedStatus);
			setBanner({
				type: "success",
				text: `Plantilla ${selectedTemplateCode} guardada en Cloudflare D1.`,
			});
		} catch (err) {
			setBanner({
				type: "error",
				text:
					err instanceof Error
						? err.message
						: "Error al guardar la plantilla.",
			});
		} finally {
			setSavingTemplate(false);
		}
	}

	async function handleFilterHistory(periodo: string, estado: string) {
		setHistoryPeriod(periodo);
		setHistoryStatus(estado);
		try {
			const res = await adminApi.getHistory({
				periodo: periodo || undefined,
				estado: estado || undefined,
			});
			setHistory(res.history);
		} catch (err) {
			setBanner({
				type: "error",
				text:
					err instanceof Error
						? err.message
						: "Error al consultar el historial.",
			});
		}
	}

	async function handleRunDaemonNow() {
		setRunningCron(true);
		setBanner(null);
		try {
			const res = await adminApi.runCronNow();
			await loadAllData();
			const s = res.summary;
			setBanner({
				type: "success",
				text: `Daemon ejecutado (${s.fecha_santiago}): ${s.enviados_exito} enviados OK, ${s.enviados_fallo} fallidos, ${s.omitidos_idempotencia} omitidos por idempotencia, ${s.fuera_de_ventana} fuera de ventana.`,
			});
		} catch (err) {
			setBanner({
				type: "error",
				text:
					err instanceof Error
						? err.message
						: "Error al ejecutar el daemon manualmente.",
			});
		} finally {
			setRunningCron(false);
		}
	}

	const filteredGroups = useMemo(() => {
		return groups.filter((g) => {
			if (statusFilter === "ACTIVE" && !g.activo) return false;
			if (statusFilter === "INACTIVE" && g.activo) return false;
			if (
				onlyClientEmoji &&
				!g.nombre_empresa.includes("©") &&
				!g.nombre_empresa.includes("💲") &&
				!g.nombre_empresa.includes("$")
			) {
				return false;
			}
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase();
				return (
					g.nombre_empresa.toLowerCase().includes(q) ||
					g.group_jid.toLowerCase().includes(q)
				);
			}
			return true;
		});
	}, [groups, statusFilter, onlyClientEmoji, searchQuery]);

	function insertVariableInTemplate(variableToken: string) {
		setTplContenido((prev) => `${prev}${variableToken}`);
	}

	if (!isAuthenticated) {
		return (
			<div className="login-wrapper">
				<div className="login-card">
					<span className="login-badge">Contidep · Automatización F29</span>
					<h1>Panel de Recordatorios F29</h1>
					<p>
						Ingresa la clave de administrador para gestionar los grupos de
						WhatsApp, editar plantillas y revisar los envíos del mes.
					</p>
					{authError && (
						<div className="alert-banner alert-error">{authError}</div>
					)}
					<form onSubmit={handleLogin}>
						<div style={{ marginBottom: "1rem" }}>
							<label
								htmlFor="admin-password"
								style={{
									display: "block",
									fontSize: "0.85rem",
									fontWeight: 600,
									marginBottom: "0.4rem",
								}}
							>
								Clave de Administrador
							</label>
							<input
								id="admin-password"
								type="password"
								className="input"
								style={{ width: "100%" }}
								placeholder="Ingresa tu ADMIN_PASSWORD..."
								value={passwordInput}
								onChange={(e) => setPasswordInput(e.target.value)}
								required
							/>
						</div>
						<button
							type="submit"
							className="btn btn-primary"
							style={{ width: "100%" }}
							disabled={authLoading}
						>
							{authLoading ? "Verificando..." : "Ingresar al Panel"}
						</button>
					</form>
				</div>
			</div>
		);
	}

	return (
		<div className="app-shell">
			<header className="top-bar">
				<div className="brand-title">
					<div className="brand-icon">F29</div>
					<div>
						<h1>Contidep — Daemon Recordatorios F29 WhatsApp</h1>
						<p className="brand-subtitle">
							Fecha Santiago: <strong>{status?.fecha_santiago}</strong> · Período
							Activo: <strong>{status?.periodo}</strong> · Instancia Evolution:{" "}
							<strong>{status?.evolution.instance || "No configurada"}</strong>
						</p>
					</div>
				</div>
				<div className="top-actions">
					<button
						type="button"
						className="btn btn-primary"
						onClick={handleRunDaemonNow}
						disabled={runningCron}
					>
						{runningCron
							? "Ejecutando..."
							: "▶ Ejecutar Recordatorios de Hoy"}
					</button>
					<button
						type="button"
						className="btn btn-secondary"
						onClick={handleLogout}
					>
						Cerrar Sesión
					</button>
				</div>
			</header>

			{banner && (
				<div
					className={`alert-banner ${
						banner.type === "success" ? "alert-success" : "alert-error"
					}`}
				>
					<span>{banner.text}</span>
					<button
						type="button"
						className="btn btn-sm btn-secondary"
						onClick={() => setBanner(null)}
					>
						✕
					</button>
				</div>
			)}

			{status?.evolution.connectionState !== "open" && (
				<section
					className="panel-card"
					style={{
						marginBottom: "1.25rem",
						border: "1px solid #f59e0b",
						background: "#fffbeb",
					}}
				>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							alignItems: "center",
							flexWrap: "wrap",
							gap: "1rem",
						}}
					>
						<div>
							<h2 style={{ margin: 0, fontSize: "1.05rem", color: "#92400e" }}>
								📱 Conecta tu WhatsApp Real para importar tus grupos
							</h2>
							<p
								style={{
									margin: "0.35rem 0 0",
									fontSize: "0.88rem",
									color: "#78350f",
								}}
							>
								Estado actual de la instancia{" "}
								<strong>{status?.evolution.instance}</strong>:{" "}
								<code>{status?.evolution.connectionState || "close"}</code>. Haz
								clic en <strong>Mostrar Código QR</strong> y escanéalo desde tu
								celular (<em>WhatsApp → Dispositivos vinculados</em>).
							</p>
						</div>
						<div style={{ display: "flex", gap: "0.5rem" }}>
							<button
								type="button"
								className="btn btn-primary"
								onClick={handleLoadWhatsappQr}
								disabled={loadingQr}
							>
								{loadingQr
									? "Generando QR..."
									: qrBase64
										? "🔄 Actualizar QR / Verificar Conexión"
										: "📷 Mostrar Código QR de WhatsApp"}
							</button>
						</div>
					</div>
					{qrBase64 && (
						<div
							style={{
								marginTop: "1rem",
								display: "flex",
								alignItems: "center",
								gap: "1.25rem",
								flexWrap: "wrap",
								background: "#ffffff",
								padding: "1rem",
								borderRadius: "0.75rem",
								border: "1px solid #fde68a",
							}}
						>
							<img
								src={qrBase64}
								alt="Código QR de WhatsApp"
								style={{
									width: "220px",
									height: "220px",
									borderRadius: "0.5rem",
									border: "1px solid #e2e8f0",
								}}
							/>
							<div style={{ fontSize: "0.9rem", color: "#334155" }}>
								<p style={{ margin: "0 0 0.5rem", fontWeight: 600 }}>
									Instrucciones para traer tus grupos reales:
								</p>
								<ol style={{ margin: 0, paddingLeft: "1.2rem", lineHeight: 1.6 }}>
									<li>
										Abre <strong>WhatsApp</strong> en tu teléfono.
									</li>
									<li>
										Toca <strong>Dispositivos vinculados</strong> →{" "}
										<strong>Vincular un dispositivo</strong>.
									</li>
									<li>Escanea este código QR.</li>
									<li>
										Una vez escaneado, pulsa{" "}
										<strong>🔄 Actualizar QR / Verificar Conexión</strong> y luego{" "}
										<strong>Sincronizar con WhatsApp</strong>.
									</li>
								</ol>
							</div>
						</div>
					)}
				</section>
			)}

			<section className="stats-grid">
				<div className="stat-card">
					<div className="stat-label">Grupos Activos</div>
					<div className="stat-value">
						{status?.stats.grupos_activos ?? 0}{" "}
						<span style={{ fontSize: "0.95rem", color: "#64748b" }}>
							/ {status?.stats.total_grupos ?? 0}
						</span>
					</div>
					<div className="stat-meta">Reciben avisos automáticos</div>
				</div>
				<div className="stat-card">
					<div className="stat-label">Plantillas Activas</div>
					<div className="stat-value">
						{status?.stats.plantillas_activas ?? 0}
					</div>
					<div className="stat-meta">Hitos T-0 / T-1 / T-3</div>
				</div>
				<div className="stat-card">
					<div className="stat-label">Envíos Exitosos ({status?.periodo})</div>
					<div className="stat-value" style={{ color: "#16a34a" }}>
						{status?.stats.envios_exitosos_mes ?? 0}
					</div>
					<div className="stat-meta">Protegidos por idempotencia</div>
				</div>
				<div className="stat-card">
					<div className="stat-label">Envíos Fallidos ({status?.periodo})</div>
					<div
						className="stat-value"
						style={{
							color:
								(status?.stats.envios_fallidos_mes ?? 0) > 0
									? "#dc2626"
									: "#0f172a",
						}}
					>
						{status?.stats.envios_fallidos_mes ?? 0}
					</div>
					<div className="stat-meta">Reintentables sin duplicar</div>
				</div>
			</section>

			<nav className="tabs-nav">
				<button
					type="button"
					className={`tab-btn ${activeTab === "groups" ? "active" : ""}`}
					onClick={() => setActiveTab("groups")}
				>
					👥 Grupos de Clientes ({groups.length})
				</button>
				<button
					type="button"
					className={`tab-btn ${activeTab === "templates" ? "active" : ""}`}
					onClick={() => setActiveTab("templates")}
				>
					💬 Plantillas de Mensajes ({templates.length})
				</button>
				<button
					type="button"
					className={`tab-btn ${activeTab === "history" ? "active" : ""}`}
					onClick={() => setActiveTab("history")}
				>
					📋 Historial de Envíos ({history.length})
				</button>
			</nav>

			{activeTab === "groups" && (
				<>
					<div className="panel-card">
						<div className="panel-header">
							<h2>Gestión de Grupos de WhatsApp</h2>
							<button
								type="button"
								className="btn btn-primary"
								onClick={handleSyncWhatsApp}
								disabled={syncingGroups}
							>
								{syncingGroups
									? "Sincronizando con Evolution API..."
									: "🔄 Sincronizar con WhatsApp"}
							</button>
						</div>

						<div className="toolbar">
							<input
								type="search"
								className="input"
								style={{ minWidth: "240px", flex: 1 }}
								placeholder="Buscar por nombre de empresa o JID (@g.us)..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
							/>
							<select
								className="select"
								value={statusFilter}
								onChange={(e) =>
									setStatusFilter(
										e.target.value as "ALL" | "ACTIVE" | "INACTIVE",
									)
								}
							>
								<option value="ALL">Todos los estados</option>
								<option value="ACTIVE">Solo Activos</option>
								<option value="INACTIVE">Solo Inactivos</option>
							</select>
							<label
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: "0.45rem",
									fontSize: "0.88rem",
									fontWeight: 600,
									cursor: "pointer",
								}}
							>
								<input
									type="checkbox"
									checked={onlyClientEmoji}
									onChange={(e) => setOnlyClientEmoji(e.target.checked)}
								/>
								Solo grupos con ©️ / 💲
							</label>
						</div>

						<div className="table-wrapper">
							<table className="data-table">
								<thead>
									<tr>
										<th>Activo</th>
										<th>Nombre Cliente / Grupo</th>
										<th>Group JID</th>
										<th>Día Vencimiento F29</th>
										<th>Acciones</th>
									</tr>
								</thead>
								<tbody>
									{filteredGroups.length === 0 ? (
										<tr>
											<td
												colSpan={5}
												style={{
													textAlign: "center",
													padding: "2rem",
													color: "#64748b",
												}}
											>
												No hay grupos que coincidan con el filtro. Usa el botón
												&quot;Sincronizar con WhatsApp&quot; o agrega uno abajo.
											</td>
										</tr>
									) : (
										filteredGroups.map((group) => (
											<tr key={group.id}>
												<td>
													<label className="switch">
														<input
															type="checkbox"
															checked={group.activo}
															onChange={(e) =>
																handleUpdateGroup(group, {
																	activo: e.target.checked,
																})
															}
														/>
														<span className="slider" />
													</label>
												</td>
												<td>
													<input
														type="text"
														className="input"
														style={{ width: "100%", minWidth: "210px" }}
														defaultValue={group.nombre_empresa}
														onBlur={(e) => {
															const nextName = e.target.value.trim();
															if (
																nextName &&
																nextName !== group.nombre_empresa
															) {
																handleUpdateGroup(group, {
																	nombre_empresa: nextName,
																});
															}
														}}
													/>
												</td>
												<td>
													<code
														style={{
															fontSize: "0.8rem",
															color: "#475569",
															background: "#f1f5f9",
															padding: "0.2rem 0.45rem",
															borderRadius: "4px",
														}}
													>
														{group.group_jid}
													</code>
												</td>
												<td>
													<input
														type="number"
														min={1}
														max={31}
														className="input"
														style={{ width: "85px" }}
														defaultValue={group.dia_vencimiento_f29}
														onBlur={(e) => {
															const nextDay = Number(e.target.value);
															if (
																nextDay >= 1 &&
																nextDay <= 31 &&
																nextDay !== group.dia_vencimiento_f29
															) {
																handleUpdateGroup(group, {
																	dia_vencimiento_f29: nextDay,
																});
															}
														}}
													/>
												</td>
												<td>
													<button
														type="button"
														className="btn btn-sm btn-secondary"
														onClick={() => handleSendTest(group)}
														disabled={sendingTestId === group.id}
													>
														{sendingTestId === group.id
															? "Enviando..."
															: "📤 Enviar Prueba"}
													</button>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>

					<div className="panel-card">
						<div className="panel-header">
							<h2>Agregar Grupo Manualmente</h2>
						</div>
						<form onSubmit={handleCreateManualGroup} className="toolbar">
							<input
								type="text"
								className="input"
								placeholder="Nombre Empresa (ej. El Pache SPA ©️ 💲)"
								style={{ flex: 1, minWidth: "220px" }}
								value={newGroupName}
								onChange={(e) => setNewGroupName(e.target.value)}
								required
							/>
							<input
								type="text"
								className="input"
								placeholder="Group JID (ej. 120363028392101234@g.us)"
								style={{ flex: 1, minWidth: "240px" }}
								value={newGroupJid}
								onChange={(e) => setNewGroupJid(e.target.value)}
								required
							/>
							<input
								type="number"
								min={1}
								max={31}
								className="input"
								style={{ width: "110px" }}
								value={newGroupDay}
								onChange={(e) => setNewGroupDay(Number(e.target.value))}
								title="Día de vencimiento F29"
							/>
							<button type="submit" className="btn btn-primary">
								+ Guardar Grupo
							</button>
						</form>
					</div>
				</>
			)}

			{activeTab === "templates" && (
				<div className="panel-card">
					<div className="panel-header">
						<h2>Editor de Plantillas de Recordatorio F29</h2>
						<div style={{ display: "flex", gap: "0.5rem" }}>
							{templates.map((t) => (
								<button
									key={t.codigo}
									type="button"
									className={`btn btn-sm ${
										selectedTemplateCode === t.codigo
											? "btn-primary"
											: "btn-secondary"
									}`}
									onClick={() => setSelectedTemplateCode(t.codigo)}
								>
									{t.codigo} ({t.dias_anticipacion === 0 ? "Hoy vence" : `${t.dias_anticipacion}d antes`})
								</button>
							))}
						</div>
					</div>

					<div className="template-layout">
						<form onSubmit={handleSaveTemplate}>
							<div
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 140px auto",
									gap: "0.75rem",
									alignItems: "end",
									marginBottom: "1rem",
								}}
							>
								<div>
									<label
										style={{
											display: "block",
											fontSize: "0.82rem",
											fontWeight: 600,
											marginBottom: "0.3rem",
										}}
									>
										Nombre de la Plantilla ({selectedTemplateCode})
									</label>
									<input
										type="text"
										className="input"
										style={{ width: "100%" }}
										value={tplNombre}
										onChange={(e) => setTplNombre(e.target.value)}
										required
									/>
								</div>
								<div>
									<label
										style={{
											display: "block",
											fontSize: "0.82rem",
											fontWeight: 600,
											marginBottom: "0.3rem",
										}}
									>
										Días Anticipación
									</label>
									<input
										type="number"
										min={0}
										max={25}
										className="input"
										style={{ width: "100%" }}
										value={tplDias}
										onChange={(e) => setTplDias(Number(e.target.value))}
										required
									/>
								</div>
								<div style={{ paddingBottom: "0.35rem" }}>
									<label
										style={{
											display: "inline-flex",
											alignItems: "center",
											gap: "0.5rem",
											fontWeight: 600,
											fontSize: "0.88rem",
											cursor: "pointer",
										}}
									>
										<input
											type="checkbox"
											checked={tplActiva}
											onChange={(e) => setTplActiva(e.target.checked)}
										/>
										Activa
									</label>
								</div>
							</div>

							<div>
								<label
									style={{
										display: "block",
										fontSize: "0.82rem",
										fontWeight: 600,
									}}
								>
									Insertar variable dinámica:
								</label>
								<div className="chip-list">
									<button
										type="button"
										className="chip-btn"
										onClick={() =>
											insertVariableInTemplate("{{nombre_empresa}}")
										}
									>
										+ {"{{nombre_empresa}}"}
									</button>
									<button
										type="button"
										className="chip-btn"
										onClick={() =>
											insertVariableInTemplate("{{dia_vencimiento}}")
										}
									>
										+ {"{{dia_vencimiento}}"}
									</button>
									<button
										type="button"
										className="chip-btn"
										onClick={() => insertVariableInTemplate("{{periodo}}")}
									>
										+ {"{{periodo}}"}
									</button>
									{selectedTemplateCode === "T-0" && (
										<button
											type="button"
											className="chip-btn"
											onClick={() => setTplContenido(CONTIDEP_OFFICIAL_T0)}
										>
											↺ Restaurar texto oficial Contidep
										</button>
									)}
								</div>
							</div>

							<textarea
								className="textarea"
								rows={10}
								style={{ width: "100%", marginBottom: "1rem" }}
								value={tplContenido}
								onChange={(e) => setTplContenido(e.target.value)}
								required
							/>

							<button
								type="submit"
								className="btn btn-primary"
								disabled={savingTemplate}
							>
								{savingTemplate
									? "Guardando en D1..."
									: "💾 Guardar Plantilla"}
							</button>
						</form>

						<div>
							<div
								style={{
									fontSize: "0.82rem",
									fontWeight: 600,
									marginBottom: "0.5rem",
									color: "#475569",
								}}
							>
								Vista Previa en WhatsApp (Ejemplo: El Pache SPA ©️ 💲)
							</div>
							<div className="wa-preview-container">
								<div className="wa-header">
									<span>🟢</span>
									<div>
										<div>El Pache SPA ©️ 💲</div>
										<div
											style={{
												fontSize: "0.75rem",
												fontWeight: 400,
												color: "#64748b",
											}}
										>
											Asistcontidep, Caro, Tú
										</div>
									</div>
								</div>
								<div className="wa-bubble">
									{interpolatePreview(
										tplContenido,
										"El Pache SPA",
										20,
										status?.periodo || "2026-10",
									)}
									<div className="wa-time">09:15 ✓✓</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{activeTab === "history" && (
				<div className="panel-card">
					<div className="panel-header">
						<h2>Historial y Auditoría de Envíos</h2>
					</div>

					<div className="toolbar">
						<input
							type="month"
							className="input"
							value={historyPeriod}
							onChange={(e) =>
								handleFilterHistory(e.target.value, historyStatus)
							}
						/>
						<select
							className="select"
							value={historyStatus}
							onChange={(e) =>
								handleFilterHistory(historyPeriod, e.target.value)
							}
						>
							<option value="">Todos los estados</option>
							<option value="SUCCESS">Solo SUCCESS</option>
							<option value="FAILED">Solo FAILED</option>
						</select>
						<button
							type="button"
							className="btn btn-secondary"
							onClick={() => handleFilterHistory(historyPeriod, historyStatus)}
						>
							🔄 Actualizar
						</button>
					</div>

					<div className="table-wrapper">
						<table className="data-table">
							<thead>
								<tr>
									<th>Fecha / Hora</th>
									<th>Cliente / Grupo</th>
									<th>Período</th>
									<th>Plantilla</th>
									<th>Estado</th>
									<th>Respuesta Evolution API</th>
								</tr>
							</thead>
							<tbody>
								{history.length === 0 ? (
									<tr>
										<td
											colSpan={6}
											style={{
												textAlign: "center",
												padding: "2rem",
												color: "#64748b",
											}}
										>
											No hay registros de envíos para el filtro seleccionado.
										</td>
									</tr>
								) : (
									history.map((item) => (
										<tr key={item.id}>
											<td style={{ whiteSpace: "nowrap" }}>
												{new Date(item.fecha_envio).toLocaleString("es-CL")}
											</td>
											<td>
												<strong>{item.nombre_empresa || item.grupo_id}</strong>
												{item.group_jid && (
													<div
														style={{ fontSize: "0.75rem", color: "#64748b" }}
													>
														{item.group_jid}
													</div>
												)}
											</td>
											<td>
												<span className="badge badge-neutral">
													{item.periodo}
												</span>
											</td>
											<td>
												<span className="badge badge-neutral">
													{item.plantilla_codigo}
												</span>
											</td>
											<td>
												<span
													className={`badge ${
														item.estado === "SUCCESS"
															? "badge-success"
															: "badge-failed"
													}`}
												>
													{item.estado}
												</span>
											</td>
											<td>
												<code
													style={{
														fontSize: "0.76rem",
														color: "#334155",
														display: "block",
														maxWidth: "340px",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
													}}
													title={item.response_payload || ""}
												>
													{item.response_payload || "-"}
												</code>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</div>
			)}
		</div>
	);
}

export default App;
