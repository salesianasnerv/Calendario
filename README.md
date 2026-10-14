# Calendario del curso

Web del calendario del curso de las Escuelas Salesianas María Auxiliadora (Nervión, Sevilla).

**No hay que copiar nada a mano:** la web lee directamente el documento Word del calendario que está en SharePoint
(Comisión pedagógica). Cuando quien lo gestiona cambia algo en el Word, la web lo muestra en unos 5 minutos.

## Qué hace

- Calendario por meses (rejilla en ordenador, lista en móvil) con los colores de los días del documento:
  fin de semana, festivo / no lectivo y vacaciones. El día de hoy aparece marcado.
- Filtros por **etapa** (Infantil, Primaria, ESO, Bachillerato, FP) y por **tipo** (evaluación, reuniones, pastoral,
  familias, actividades, festivos). La etapa se deduce del texto del evento (INF, EPO, ESO, BACH, FP, CCFF…);
  los eventos sin etapa se consideran comunes a todo el centro y se ven siempre.
- Buscador en todo el curso, «Próximos 14 días», notas del mes y lema del mes (p. ej. MAYO «Contigo...GRACIAS»).
- Suscripción para Google Calendar, iPhone y Outlook (completo o por etapa), que también se actualiza sola.
- Impresión del mes en A4 apaisado, se instala como app (PWA) y funciona sin conexión con la última copia.

## Cada curso nuevo (lo único que hay que cambiar)

1. En SharePoint, abre el Word del nuevo curso → **Compartir** → «**Cualquier persona con el vínculo** puede ver» → Copiar vínculo.
2. En GitHub, edita `config.json` y pega el nuevo enlace en `"documento"`. Guarda (Commit changes).
3. Vercel publica el cambio solo en un minuto.

El Word debe seguir el mismo formato: un título «Calendario 2027-2028», el nombre de cada mes en un párrafo y
una tabla por mes con tres columnas (día | letra del día L M X J V S D | eventos, uno por línea).
Los meses de agosto a diciembre se toman del primer año del título y de enero a julio, del segundo.

Si el enlace deja de ser público, la web avisa y sigue enseñando la última copia guardada en cada dispositivo.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | La web |
| `api/calendario.js` | Lee el Word de SharePoint y lo convierte en datos (y en `calendario.ics` para suscribirse) |
| `config.json` | **El enlace del documento** (lo único que se cambia cada año) |
| `vercel.json` | Dirección `/calendario.ics` y permisos |
| `manifest.json`, `sw.js`, iconos, `favicon*` | App instalable y modo sin conexión |
| `og-image.png` | Imagen que sale al compartir el enlace por WhatsApp (1200×630) |

## Publicar (Vercel)

La web necesita **Vercel** (no basta GitHub Pages) porque lee el Word desde el servidor.

1. Crea el repositorio en GitHub (p. ej. `salesianasnerv/Calendario-curso`) y sube **todo el contenido de esta carpeta**,
   incluida la carpeta `api` (Add file → Upload files, arrastrando los archivos y la carpeta).
2. En https://vercel.com → Add New → Project → importa el repositorio → Deploy (sin cambiar nada).
3. En el proyecto de Vercel → Settings → Domains, deja la dirección `calendario-nervion.vercel.app`.
   Si usas otra, cámbiala en `index.html` (líneas `og:url`, `og:image`, `twitter:image` y `VERCEL_URL`).
