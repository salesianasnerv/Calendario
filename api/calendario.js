// Lee el Word del calendario del curso directamente de SharePoint (con el enlace
// para compartir de config.json) y lo devuelve como datos para la web.
//   /api/calendario              -> JSON para la web
//   /api/calendario?formato=ics  -> suscripción para Google / Apple / Outlook (también /calendario.ics)
//   &etapa=ESO                   -> solo esa etapa y los eventos comunes
// Como se lee el documento en cada consulta (con una caché de 5 minutos), cualquier
// cambio que se haga en el Word aparece solo en la web.

const zlib = require("zlib");
const config = require("../config.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const ETAPAS = {
  Infantil: /\bINF\b|INFANTIL|\bE\.?\s?I\b|Ed\.\s*Infantil|\d\s*años/i,
  Primaria: /PRIMARIA|\bPRIM\b|\bEPO\b|\bE\.?P\b|\d\s*º\s*(?:A\s*\d\s*º\s*)?(?:PR|EP)\b|\bciclo\s+(?:de\s+)?prim/i,
  ESO: /(?:\b|\d)ESO\b/i,
  Bachillerato: /(?:\b|\d)BACH|BACHILLER/i,
  FP: /\bFP\b|\bCCFF\b|\bF\.P\b|\bCF\b|FARMACIA|TCAE|ADMINISTRATIVA|\bDAM\b|ciclos?\s+formativos?|formación en empresa|incorporación a empresas/i,
};
const CATEGORIAS = [
  ["festivo", /FESTIV|FIESTA NACIONAL|NO LECTIVO|VACACIONES|SEMANA SANTA|\bFERIA\b|\bCORPUS\b|DÍA DE LA INMACULADA|DÍA DEL TRABAJO|DÍA DE ANDALUCÍA/i],
  ["evaluacion", /EXÁMEN|EXAMEN|EVALUACI|\bEV\.|NOTAS|\bPAU\b|RECLAMACI|RECUPERACI|PRUEBAS? (?:DE )?DIAGN/i],
  ["familias", /FAMILIA/i],
  ["pastoral", /PASTORAL|EUCARIST|TRIDUO|ADVIENTO|CUARESMA|DON BOSCO|JUAN BOSCO|DOMUND|DOMISAL|CAPILLA|ORACI|PASCUA|RESURRECCI|MARÍA AUXILIADORA|MAZZARELLO|INMACULADA|NAVIDAD|BELÉN|BELENES|SOLIDARI|CONVIVENCIA|CARISMA|ESTRELLAS EN EL CIELO|HOLYWINS|BENDICI|CELEBRACI|MISA|CONFESI|CAMINO (?:DE )?SANTIAGO|BUENOS DÍAS|VOCACION|SOR EUSEBIA|LAURA VICUÑA|FRANCISCO DE SALES|DOMINGO DE|\bFMA\b|\bADMA\b|COOPERADORES|HOGARES|ANTIGU[OA]S ALUMN|SANDENEL|SANEL|MOVIMIENTO EXA/i],
  ["reunion", /EQUIPO|CLAUSTRO|COMISI|REUNI|ENCUENTRO|FORMACI|HORAS (?:NO LECTIVAS|COMPLEMENTARIAS)|COORDINADOR|CONSEJO|SESIÓN|FORMATIVA|CONGRESO|PONENTE|RESPONSABLES DE|EDUCADORES|ACTUALIZACIÓN DE PROFESORES|ENTREGA (?:DE )?(?:PROGRAMACIONES|PLAN)|DIRECTIVOS/i],
  ["actividad", /SALIDA|VISITA|VIAJE|EXCURSI|JORNADA|TALLER|TORNEO|CONCURSO|DÍA (?:MUNDIAL|INTERNACIONAL|DE|DEL)|SEMANA|FOTOS|MUSICAL|TEATRO|GRADUACI|ACTO|PROYECTO|CHARLA|CARRERA|ERASMUS|CASTAÑADA|MERCADILLO|COTILLÓN|ORLA|CERTAMEN|PASACALLES|APADRINAMIENTO|MOTIVACIÓN|ACTIVIDAD|VACUNACI|ST\. PATRICK|AMPA/i],
];

module.exports = async (req, res) => {
  const q = req.query || {};
  try {
    const docx = await descargarDocumento(process.env.DOCUMENTO_URL || config.documento);
    const datos = leerCalendario(docx);
    datos.documento = process.env.DOCUMENTO_URL || config.documento;
    datos.consultado = new Date().toISOString();

    // Vercel guarda la respuesta 5 minutos; después la renueva en segundo plano.
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
    if (String(q.formato || "").toLowerCase() === "ics") {
      res.setHeader("Content-Type", "text/calendar; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="calendario.ics"');
      return res.status(200).send(generarIcs(datos, q.etapa));
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).send(JSON.stringify(datos));
  } catch (err) {
    console.error(err);
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).json({ error: err.message || "No se pudo leer el documento." });
  }
};

// ---------------------------------------------------------------
// DESCARGA DESDE SHAREPOINT (enlace «cualquier persona con el enlace»)
// ---------------------------------------------------------------
async function descargarDocumento(enlace) {
  if (!enlace) throw new Error("Falta el enlace del documento en config.json.");
  const cookies = new Map();
  const cabeceras = () => ({
    "User-Agent": UA,
    Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "),
  });
  const pedir = async (url) => {
    for (let saltos = 0; saltos < 10; saltos++) {
      const r = await fetch(url, { redirect: "manual", headers: cabeceras() });
      for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) {
        const [par] = c.split(";");
        const i = par.indexOf("=");
        if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
      }
      const destino = r.headers.get("location");
      if (r.status >= 300 && r.status < 400 && destino) { url = new URL(destino, url).href; continue; }
      return { r, url };
    }
    throw new Error("Demasiadas redirecciones al abrir el documento.");
  };

  // 1) Abrir el enlace para compartir: SharePoint da la cookie de acceso y redirige al visor.
  const { r: visor, url: urlVisor } = await pedir(enlace);
  if (visor.status === 401 || visor.status === 403 || /login\.microsoftonline/.test(urlVisor)) {
    throw new Error("El enlace del documento ya no es público (pide iniciar sesión). Hay que compartirlo con «Cualquier persona con el vínculo».");
  }
  const html = await visor.text();
  const guid = (decodeURIComponent(urlVisor).match(/sourcedoc=\{?([0-9a-f-]{36})/i) ||
                html.match(/"(?:uniqueId|UniqueId|sourcedoc)"\s*:\s*"\{?([0-9a-f-]{36})/i) || [])[1];
  const sitio = urlVisor.split("/_layouts/")[0];
  if (!guid || !sitio.startsWith("https://")) throw new Error("No se ha encontrado el documento en el enlace de config.json.");

  // 2) Descargar el .docx con esa cookie.
  const { r: archivo } = await pedir(`${sitio}/_layouts/15/download.aspx?UniqueId=${guid}`);
  const buf = Buffer.from(await archivo.arrayBuffer());
  if (!archivo.ok || buf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("SharePoint no ha dejado descargar el documento (" + archivo.status + ").");
  }
  return buf;
}

// Lector mínimo de .zip (un .docx es un zip) para no depender de librerías.
function leerZip(buf) {
  let fin = buf.length - 22;
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error("El archivo descargado no es un Word válido.");
  const total = buf.readUInt16LE(fin + 10);
  let p = buf.readUInt32LE(fin + 16);
  const archivos = {};
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const lNombre = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lComent = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString("utf8", p + 46, p + 46 + lNombre);
    archivos[nombre] = () => {
      const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const datos = buf.subarray(ini, ini + tam);
      return (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString("utf8");
    };
    p += 46 + lNombre + lExtra + lComent;
  }
  return archivos;
}

// ---------------------------------------------------------------
// LECTURA DEL WORD
// Estructura: «Calendario 2026-2027», luego por cada mes un párrafo con su nombre
// (p. ej. «MAYO “Contigo...GRACIAS”»), una o varias tablas (día | letra | eventos)
// y, a veces, párrafos de notas.
// ---------------------------------------------------------------
function leerCalendario(docx) {
  const zip = leerZip(docx);
  if (!zip["word/document.xml"]) throw new Error("El documento no tiene el formato esperado.");
  const xml = zip["word/document.xml"]();
  const core = zip["docProps/core.xml"] ? zip["docProps/core.xml"]() : "";
  const modificado = (core.match(/<dcterms:modified[^>]*>([^<]+)</) || [])[1] || null;

  const cuerpo = xml.slice(xml.indexOf("<w:body"));
  const bloques = cuerpo.match(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g) || [];

  let titulo = "", anio1 = null, mesActual = null;
  const meses = [], dias = [];

  for (const b of bloques) {
    if (b.startsWith("<w:tbl>")) {
      if (!mesActual) continue;
      for (const fila of b.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
        const celdas = fila.match(/<w:tc>[\s\S]*?<\/w:tc>/g) || [];
        if (celdas.length < 3) continue;
        const dia = parseInt(textoDe(celdas[0]).replace(/\D/g, ""), 10);
        if (!dia || dia > 31) continue;
        const letra = textoDe(celdas[1]).trim().toUpperCase().slice(0, 1);
        const color = relleno(celdas[1]) || relleno(celdas[2]);
        const eventos = celdas.slice(2).flatMap(parrafosDe).map(limpiar).filter((t) => t && !/^[.\s\-–?]*$/.test(t));
        const fecha = `${mesActual.anio}-${String(mesActual.mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        const finde = letra === "S" || letra === "D";
        dias.push({
          fecha,
          letra,
          color,
          tipo: tipoDeDia(color, finde, eventos),
          eventos: eventos.map((texto) => ({ texto, etapas: etapasDe(texto), cat: categoriaDe(texto) })),
        });
      }
      continue;
    }

    const t = limpiar(textoDe(b));
    if (!t) continue;
    if (!titulo && /calendario/i.test(t)) {
      titulo = t;
      const m = t.match(/(20\d\d)\s*[-/–]\s*(?:20)?(\d\d)/);
      if (m) anio1 = parseInt(m[1], 10);
      continue;
    }
    const nombre = MESES.find((m) => t.toUpperCase().startsWith(m));
    if (nombre && t.length < 80) {
      if (!anio1) anio1 = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
      const mes = MESES.indexOf(nombre) + 1;
      const lema = t.slice(nombre.length).trim().replace(/^[“"”]|[“"”]$/g, "").trim();
      mesActual = { anio: mes >= 8 ? anio1 : anio1 + 1, mes, nombre: nombre.charAt(0) + nombre.slice(1).toLowerCase(), lema, notas: [] };
      meses.push(mesActual);
    } else if (mesActual) {
      mesActual.notas.push(t.replace(/^\*+|\*+$/g, "").trim());
    }
  }

  if (!dias.length) throw new Error("No se han encontrado días en el documento.");
  const curso = anio1 ? `${anio1}-${anio1 + 1}` : "";
  return { titulo: titulo || "Calendario", curso, modificado, meses, dias };
}

function decodificar(s) {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// Texto de un trozo de XML; los saltos de línea dentro de un párrafo se convierten en «\n».
function textoDe(x) {
  return (x.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>|<w:br [^>]*\/>/g) || [])
    .map((s) => s.startsWith("<w:tab") ? " " : s.startsWith("<w:br") ? "\n" : decodificar(s.replace(/<[^>]+>/g, "")))
    .join("");
}

// Cada párrafo (o línea dentro de un párrafo) de la celda es un evento.
function parrafosDe(celda) {
  return (celda.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).flatMap((p) => textoDe(p).split("\n"));
}

function limpiar(t) {
  return t.replace(/[\u00a0\s]+/g, " ").trim();
}

function relleno(celda) {
  const m = (celda.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/) || [""])[0].match(/w:fill="([0-9A-Fa-f]{6})"/);
  if (!m || /^(FFFFFF|auto)$/i.test(m[1])) return null;
  return m[1].toUpperCase();
}

function tono(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 0.08) return -1;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// Tipo de día según el color que tiene en el Word (y lo que dice el texto).
function tipoDeDia(color, finde, eventos) {
  const texto = eventos.join(" ");
  if (/FESTIV|FIESTA NACIONAL|NO LECTIVO|D[IÍ]A DE LA INMACULADA/i.test(texto) && !finde) return "festivo";
  if (/VACACIONES/i.test(texto) && !finde) return "festivo";
  if (finde) return "finde";
  if (!color) return null;
  const h = tono(color);
  if (h >= 15 && h < 50) return "vacaciones";
  if (h >= 170 && h < 260) return "festivo";
  return "especial";
}

function etapasDe(texto) {
  return Object.keys(ETAPAS).filter((e) => ETAPAS[e].test(texto));
}

function categoriaDe(texto) {
  const c = CATEGORIAS.find(([, re]) => re.test(texto));
  return c ? c[0] : "otro";
}

// ---------------------------------------------------------------
// SUSCRIPCIÓN (iCalendar)
// ---------------------------------------------------------------
function generarIcs(datos, etapa) {
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const doblar = (linea) => {
    const out = [];
    let resto = Buffer.from(linea, "utf8");
    while (resto.length > 74) {
      let corte = 74;
      while (corte > 0 && (resto[corte] & 0xc0) === 0x80) corte--; // no partir una letra con tilde
      out.push(resto.subarray(0, corte).toString("utf8"));
      resto = resto.subarray(corte);
    }
    out.push(resto.toString("utf8"));
    return out.join("\r\n ");
  };
  const sello = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const nombre = "Calendario del curso" + (etapa ? ` · ${etapa}` : "") + " · Salesianas Nervión";
  const lineas = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Salesianas Nervion//Calendario del curso//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(nombre)}`, "X-WR-TIMEZONE:Europe/Madrid", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const d of datos.dias) {
    const siguiente = new Date(d.fecha + "T12:00:00Z");
    siguiente.setUTCDate(siguiente.getUTCDate() + 1);
    d.eventos.forEach((e, i) => {
      if (etapa && e.etapas.length && !e.etapas.includes(etapa)) return;
      lineas.push(
        "BEGIN:VEVENT",
        `UID:${d.fecha}-${i}-${hash(e.texto)}@calendario-nervion`,
        `DTSTAMP:${sello}`,
        `DTSTART;VALUE=DATE:${d.fecha.replace(/-/g, "")}`,
        `DTEND;VALUE=DATE:${siguiente.toISOString().slice(0, 10).replace(/-/g, "")}`,
        `SUMMARY:${esc(e.texto)}`,
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
    });
  }
  lineas.push("END:VCALENDAR");
  return lineas.map(doblar).join("\r\n") + "\r\n";
}

function hash(s) {
  let h = 5381;
  for (const ch of s) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

module.exports.leerCalendario = leerCalendario;
module.exports.descargarDocumento = descargarDocumento;
