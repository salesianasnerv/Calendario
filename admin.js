// ─── Administración del calendario (solo cuentas autorizadas) ────────────────
// Se entra con Microsoft 365 a través del Supabase compartido (config.js). Guarda en cal_documentos los enlaces
// a los documentos actualizados (Word del calendario de cada curso, PDF de horas no lectivas…) y en cal_admin
// las cuentas con acceso. El calendario sigue abierto a todo el profesorado sin iniciar sesión.
// La librería de Supabase solo se descarga al abrir Administración o si ya hay una sesión iniciada.
(() => {
  const CFG = window.APP_CONFIG || {};
  const DOMINIOS = [CFG.dominio, ...(CFG.dominiosExtra || [])].filter(Boolean);
  const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const VOLVER_KEY = "calendario-admin-volver";
  const TIPOS_DOC = {
    calendario: { label: "Calendario del curso", ico: "calendar-days" },
    horas: { label: "Horas no lectivas", ico: "clock" },
    otro: { label: "Otros documentos", ico: "file-text" },
  };
  const ICONO_MS = `<svg viewBox="0 0 21 21" width="20" height="20" aria-hidden="true"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>`;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(s);
  const ok = (r) => { if (r.error) throw r.error; return r.data; };
  let sb = null, yo = null, documentos = [], admins = [], editando = null;

  // ── Supabase (carga diferida) ──────────────────────────────────────────────
  function cargarLibreria() {
    if (window.supabase) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SUPABASE_JS;
      s.onload = resolve;
      s.onerror = () => reject(new Error("No se pudo cargar el inicio de sesión. Comprueba la conexión."));
      document.head.appendChild(s);
    });
  }
  async function cliente() {
    if (!sb) { await cargarLibreria(); sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey); }
    return sb;
  }
  const haySesionGuardada = () => {
    try { return Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k)); } catch { return false; }
  };
  const vieneDelLogin = () => /access_token=|[?&]code=|error_description=/.test(location.hash + location.search);

  async function comprobarSesion() {
    const c = await cliente();
    const { data: { session } } = await c.auth.getSession();
    if (!session) { yo = null; pintarSesion(); return null; }
    const u = session.user, email = (u.email || "").toLowerCase();
    if (!DOMINIOS.some((d) => email.endsWith("@" + d))) {
      await c.auth.signOut();
      yo = null; pintarSesion();
      throw new Error(`Solo se permite el acceso con cuentas @${CFG.dominio}.`);
    }
    // Solo devuelve fila si esta cuenta está en cal_admin (lo impone la base de datos)
    const adm = await c.from("cal_admin").select("email").eq("email", email).limit(1);
    yo = { email, nombre: u.user_metadata?.full_name || u.user_metadata?.name || email.split("@")[0], admin: !adm.error && adm.data.length > 0 };
    pintarSesion();
    return yo;
  }

  async function entrar() {
    $("loginError").textContent = "";
    try {
      const c = await cliente();
      try { sessionStorage.setItem(VOLVER_KEY, "1"); } catch {}
      ok(await c.auth.signInWithOAuth({ provider: "azure", options: { scopes: "email profile", redirectTo: location.origin + location.pathname } }));
    } catch (e) { $("loginError").textContent = e.message || String(e); }
  }
  async function salir() {
    if (sb) await sb.auth.signOut();
    yo = null; pintarSesion();
    if (location.hash === "#admin") pintarAdmin();
  }

  function pintarSesion() {
    $("sesion").hidden = !yo;
    $("usuario").textContent = yo ? yo.nombre : "";
    $("rolEtq").hidden = !(yo && yo.admin);
    $("tabAdmin").hidden = !(yo && yo.admin);
  }

  // ── Vista Administración (#admin) ──────────────────────────────────────────
  function enAdmin() { return location.hash === "#admin"; }

  async function abrirAdmin() {
    document.body.classList.remove("vista-proximos", "vista-suscripcion");
    document.body.classList.add("modo-admin");
    document.querySelectorAll("#tabs > a").forEach((a) => a.classList.toggle("activa", a.id === "tabAdmin"));
    window.scrollTo({ top: 0 });
    pintarCargando();
    try { await comprobarSesion(); } catch (e) { showToast(e.message || String(e)); }
    await pintarAdmin();
  }
  function cerrarAdmin() {
    document.body.classList.remove("modo-admin");
    $("tabAdmin").classList.remove("activa");
    if (typeof updateNavSpy === "function") updateNavSpy();
  }

  function pintarCargando() {
    $("admin-cuerpo").innerHTML = `<div class="cargando h-40 rounded-xl"></div>`;
  }

  async function pintarAdmin() {
    const cuerpo = $("admin-cuerpo");
    if (!yo) {
      cuerpo.innerHTML = `
        <section class="login">
          <div class="tarjeta">
            <h2>Iniciar sesión</h2>
            <p>La administración del calendario es solo para <strong>cuentas autorizadas</strong>. Pulsa el botón y entra con tu cuenta del colegio <strong>@${esc(CFG.dominio)}</strong>.</p>
            <button id="btnLogin" class="btn primario grande btn-ms" type="button">${ICONO_MS}Entrar con Microsoft 365</button>
            <p id="loginError" class="error"></p>
            <a href="#calendario" class="volver"><i data-lucide="arrow-left" class="w-4 h-4"></i>Volver al calendario</a>
          </div>
        </section>`;
      $("btnLogin").addEventListener("click", entrar);
      lucide.createIcons();
      return;
    }
    if (!yo.admin) {
      cuerpo.innerHTML = `
        <section class="login">
          <div class="tarjeta">
            <h2>Sin acceso</h2>
            <p>Tu cuenta <strong>${esc(yo.email)}</strong> no tiene acceso a la administración del calendario. Si lo necesitas, pídeselo a alguna de las personas que ya lo tienen.</p>
            <a href="#calendario" class="btn primario grande">Volver al calendario</a>
            <p class="error"></p>
          </div>
        </section>`;
      return;
    }
    cuerpo.innerHTML = `
      <section class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div class="flex items-center gap-2 text-corp-blue">
          <i data-lucide="folder-open" class="w-5 h-5 text-corp-green"></i>
          <h2 class="text-sm font-bold uppercase tracking-wider">Documentos actualizados</h2>
        </div>
        <p class="text-xs text-slate-500">Enlaces a los documentos de cada curso: el Word del calendario, los PDF de horas no lectivas del Claustro de cada trimestre y cualquier otro que haga falta tener a mano. Solo los ven las cuentas de administración.</p>
        <form id="docForm" class="grid grid-cols-1 md:grid-cols-6 gap-3 border border-slate-200 rounded-lg p-3 bg-slate-50" autocomplete="off">
          <label class="md:col-span-2 text-xs font-semibold text-slate-600">Tipo
            <select id="docTipo" class="campo">${Object.entries(TIPOS_DOC).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join("")}</select></label>
          <label class="md:col-span-3 text-xs font-semibold text-slate-600">Nombre
            <input id="docTitulo" class="campo" required maxlength="160" placeholder="Ej.: Horas no lectivas · 2.º trimestre (PDF)"></label>
          <label class="text-xs font-semibold text-slate-600">Curso
            <input id="docCurso" class="campo" maxlength="20" placeholder="2026-2027"></label>
          <label class="md:col-span-4 text-xs font-semibold text-slate-600">Enlace
            <input id="docEnlace" class="campo" type="url" required placeholder="https://salesianas.sharepoint.com/…"></label>
          <label class="md:col-span-2 text-xs font-semibold text-slate-600">Notas <span class="font-normal text-slate-400">(opcional)</span>
            <input id="docNotas" class="campo" maxlength="300" placeholder="Dónde está, quién lo gestiona…"></label>
          <div class="md:col-span-6 flex flex-wrap gap-2 justify-end">
            <button type="button" id="docCancelar" class="btn" hidden>Cancelar</button>
            <button type="submit" id="docGuardar" class="btn primario">Añadir documento</button>
          </div>
        </form>
        <div id="docLista" class="space-y-4"></div>
      </section>

      <section class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-3">
        <div class="flex items-center gap-2 text-corp-blue">
          <i data-lucide="shield-check" class="w-5 h-5 text-corp-green"></i>
          <h2 class="text-sm font-bold uppercase tracking-wider">Cuentas de administración</h2>
        </div>
        <p class="text-xs text-slate-500">Estas cuentas ven el apartado Administración y pueden dar o quitar este acceso. El resto del profesorado ve el calendario sin iniciar sesión.</p>
        <form id="admForm" class="flex flex-wrap gap-2" autocomplete="off">
          <input id="admEmail" class="campo flex-1 min-w-[220px]" type="email" required placeholder="nombre.apellido@${esc(CFG.dominio)}">
          <button type="submit" class="btn primario">Dar acceso</button>
        </form>
        <ul id="admLista" class="divide-y divide-slate-100 border border-slate-200 rounded-lg"></ul>
      </section>`;
    $("docForm").addEventListener("submit", guardarDocumento);
    $("docCancelar").addEventListener("click", () => limpiarForm());
    $("admForm").addEventListener("submit", darAcceso);
    $("docCurso").value = cursoActual();
    lucide.createIcons();
    await Promise.all([cargarDocumentos(), cargarAdmins()]);
  }

  function cursoActual() {
    const d = new Date(), y = d.getFullYear() - (d.getMonth() < 8 ? 1 : 0);
    return `${y}-${y + 1}`;
  }

  // ── Documentos ─────────────────────────────────────────────────────────────
  async function cargarDocumentos() {
    try {
      documentos = ok(await sb.from("cal_documentos").select("*").order("curso", { ascending: false }).order("titulo"));
      pintarDocumentos();
    } catch (e) { $("docLista").innerHTML = `<p class="text-xs text-rose-700">No se pudieron cargar los documentos: ${esc(e.message)}</p>`; }
  }

  function pintarDocumentos() {
    const lista = $("docLista");
    if (!documentos.length) { lista.innerHTML = `<p class="text-xs text-slate-400">Todavía no hay documentos.</p>`; return; }
    lista.innerHTML = Object.entries(TIPOS_DOC).map(([tipo, t]) => {
      const docs = documentos.filter((d) => d.tipo === tipo);
      if (!docs.length) return "";
      return `<div>
        <h3 class="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 mb-2"><i data-lucide="${t.ico}" class="w-4 h-4"></i>${t.label}</h3>
        <ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg">${docs.map((d) => `
          <li class="p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <div class="flex-1 min-w-[200px]">
              <a href="${esc(d.enlace)}" target="_blank" rel="noopener noreferrer" class="font-semibold text-sm text-corp-blue hover:underline">${esc(d.titulo)}</a>
              ${d.curso ? `<span class="ml-1 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 whitespace-nowrap">${esc(d.curso)}</span>` : ""}
              ${d.notas ? `<p class="text-xs text-slate-500 mt-0.5">${esc(d.notas)}</p>` : ""}
            </div>
            <div class="flex gap-1.5">
              <button type="button" class="btn mini" data-copiar="${d.id}" title="Copiar el enlace"><i data-lucide="link" class="w-3.5 h-3.5"></i><span class="sr-only">Copiar enlace</span></button>
              <button type="button" class="btn mini" data-editar="${d.id}">Editar</button>
              <button type="button" class="btn mini peligro" data-borrar="${d.id}">Quitar</button>
            </div>
          </li>`).join("")}</ul></div>`;
    }).join("");
    lista.querySelectorAll("[data-copiar]").forEach((b) => b.addEventListener("click", () => copiar(documentos.find((d) => d.id == b.dataset.copiar).enlace)));
    lista.querySelectorAll("[data-editar]").forEach((b) => b.addEventListener("click", () => editar(documentos.find((d) => d.id == b.dataset.editar))));
    lista.querySelectorAll("[data-borrar]").forEach((b) => b.addEventListener("click", () => borrar(documentos.find((d) => d.id == b.dataset.borrar))));
    lucide.createIcons();
  }

  function editar(d) {
    editando = d.id;
    $("docTipo").value = d.tipo; $("docTitulo").value = d.titulo; $("docCurso").value = d.curso;
    $("docEnlace").value = d.enlace; $("docNotas").value = d.notas;
    $("docGuardar").textContent = "Guardar cambios";
    $("docCancelar").hidden = false;
    $("docForm").scrollIntoView({ behavior: "smooth", block: "center" });
    $("docTitulo").focus();
  }
  function limpiarForm() {
    editando = null;
    $("docForm").reset();
    $("docCurso").value = cursoActual();
    $("docGuardar").textContent = "Añadir documento";
    $("docCancelar").hidden = true;
  }

  async function guardarDocumento(ev) {
    ev.preventDefault();
    const fila = {
      tipo: $("docTipo").value, titulo: $("docTitulo").value.trim(), curso: $("docCurso").value.trim(),
      enlace: $("docEnlace").value.trim(), notas: $("docNotas").value.trim(),
    };
    if (!/^https?:\/\//i.test(fila.enlace)) { showToast("El enlace tiene que empezar por https://"); return; }
    const btn = $("docGuardar"); btn.disabled = true;
    try {
      if (editando) ok(await sb.from("cal_documentos").update(fila).eq("id", editando));
      else ok(await sb.from("cal_documentos").insert(fila));
      showToast(editando ? "Documento actualizado." : "Documento añadido.", "success", 2500);
      limpiarForm();
      await cargarDocumentos();
    } catch (e) { showToast("No se pudo guardar: " + (e.message || e)); }
    finally { btn.disabled = false; }
  }

  async function borrar(d) {
    if (!confirm(`¿Quitar «${d.titulo}»${d.curso ? ` (${d.curso})` : ""} de la lista? El documento no se borra de SharePoint.`)) return;
    try {
      ok(await sb.from("cal_documentos").delete().eq("id", d.id));
      if (editando === d.id) limpiarForm();
      await cargarDocumentos();
    } catch (e) { showToast("No se pudo quitar: " + (e.message || e)); }
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); showToast("Enlace copiado.", "success", 2000); }
    catch { prompt("Copia el enlace:", texto); }
  }

  // ── Cuentas de administración ──────────────────────────────────────────────
  async function cargarAdmins() {
    try {
      admins = ok(await sb.from("cal_admin").select("email").order("email")).map((a) => a.email);
      $("admLista").innerHTML = admins.map((e) => `
        <li class="px-3 py-2 flex items-center justify-between gap-2 text-sm">
          <span class="truncate">${esc(e)}${e === yo.email ? ` <span class="text-[11px] text-slate-400">(tú)</span>` : ""}</span>
          ${e === yo.email ? "" : `<button type="button" class="btn mini peligro" data-quitar="${esc(e)}">Quitar</button>`}
        </li>`).join("");
      $("admLista").querySelectorAll("[data-quitar]").forEach((b) => b.addEventListener("click", () => quitarAcceso(b.dataset.quitar)));
    } catch (e) { $("admLista").innerHTML = `<li class="p-3 text-xs text-rose-700">No se pudieron cargar las cuentas: ${esc(e.message)}</li>`; }
  }

  async function darAcceso(ev) {
    ev.preventDefault();
    const email = $("admEmail").value.trim().toLowerCase();
    if (!email.endsWith("@" + CFG.dominio)) { showToast(`Tiene que ser una cuenta @${CFG.dominio}.`); return; }
    const r = await sb.from("cal_admin").insert({ email });
    if (r.error) { showToast(r.error.code === "23505" ? "Esa cuenta ya tiene acceso." : "No se pudo dar acceso: " + r.error.message); return; }
    $("admEmail").value = "";
    showToast("Acceso concedido.", "success", 2500);
    await cargarAdmins();
  }

  async function quitarAcceso(email) {
    if (!confirm(`¿Quitar el acceso de administración a ${email}?`)) return;
    try { ok(await sb.from("cal_admin").delete().eq("email", email)); await cargarAdmins(); }
    catch (e) { showToast("No se pudo quitar: " + (e.message || e)); }
  }

  // ── Arranque ───────────────────────────────────────────────────────────────
  function segunHash() { if (enAdmin()) abrirAdmin(); else cerrarAdmin(); }

  document.addEventListener("DOMContentLoaded", async () => {
    $("btnAdminFranja").addEventListener("click", () => { if (enAdmin()) abrirAdmin(); else location.hash = "#admin"; });
    $("btnSalir").addEventListener("click", salir);
    window.addEventListener("hashchange", segunHash);
    if (!CFG.supabaseUrl) { $("btnAdminFranja").hidden = true; return; }

    let volver = false;
    try { volver = sessionStorage.getItem(VOLVER_KEY) === "1"; sessionStorage.removeItem(VOLVER_KEY); } catch {}
    if (vieneDelLogin() || volver) {
      // Vuelta de Microsoft: Supabase lee el token de la dirección y la limpia; después se abre Administración.
      try { await comprobarSesion(); } catch (e) { showToast(e.message || String(e)); }
      if (location.hash !== "#admin") history.replaceState(null, "", location.pathname + location.search + "#admin");
      abrirAdmin();
      return;
    }
    if (enAdmin()) { abrirAdmin(); return; }
    if (haySesionGuardada()) comprobarSesion().catch(() => {});
  });
})();
