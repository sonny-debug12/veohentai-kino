const BASE = "https://veohentai.com";
const PLAYER_HOST = "hentaiplayer.com";
const TIMEOUT = 12000;
const MAX_ITEMS = 60;
const MAX_EPISODES = 3000;
const LOG_PREFIX = "[veohentai]";

function log(...args) {
  try {
    kino.log(LOG_PREFIX, ...args);
  } catch {}
}

function isEnglish(lang) {
  return String(lang || kino.lang || "es").toLowerCase().startsWith("en");
}

function msg(esText, enText) {
  return isEnglish() ? enText : esText;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function abs(path) {
  return new URL(path, BASE).href;
}

async function getText(url, referer) {
  log("GET", url);

  const headers = {};
  if (referer) headers.Referer = referer;

  const response = await kino.fetch(url, {
    headers,
    timeoutMs: TIMEOUT
  });

  if (!response.ok) {
    log("HTTP error", response.status, url);
    throw new Error(url + " respondió " + response.status);
  }

  const html = await response.text();
  log("GET OK", response.status, html.length + " bytes");
  return html;
}

async function parallelLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;

      try {
        results[index] = await fn(items[index], index);
      } catch (error) {
        log("Tarea falló", index, error && error.message);
        results[index] = null;
      }
    }
  }

  const count = Math.min(Math.max(1, Number(limit) || 1), items.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

function clean(value, max = 200) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function imageUrl(value, pageUrl) {
  if (!value || typeof value !== "string") return undefined;

  let url = value.trim().replace(/&amp;/gi, "&");
  if (!url || /^data:/i.test(url)) return undefined;
  if (url.startsWith("//")) url = "https:" + url;

  try {
    return new URL(url, pageUrl || BASE + "/").href;
  } catch {
    return undefined;
  }
}

function validPoster(value, pageUrl) {
  const url = imageUrl(value, pageUrl);
  if (!url) return undefined;

  const filename = url.split("/").pop().split("?")[0].toLowerCase();

  if (
    filename.endsWith(".svg") ||
    /^(logo|favicon|icon|avatar|placeholder)([-_.]|$)/i.test(filename)
  ) {
    return undefined;
  }

  return url;
}

function attr(tag, name) {
  const match = new RegExp(
    "\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1",
    "i"
  ).exec(tag);

  return match ? match[2] : "";
}

function srcsetUrl(value) {
  if (!value) return "";

  const candidates = value
    .split(",")
    .map(part => part.trim().split(/\s+/)[0])
    .filter(Boolean);

  return candidates.length ? candidates[candidates.length - 1] : "";
}

function extractImage(block, pageUrl) {
  if (!block) return undefined;

  const tags = [];
  const tagRegex = /<(?:img|source)\b[^>]*>/gi;
  let match;

  while ((match = tagRegex.exec(block))) tags.push(match[0]);

  const attributes = [
    "data-poster",
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-original-src",
    "data-image",
    "data-thumb",
    "src"
  ];

  for (const tag of tags) {
    for (const name of attributes) {
      const poster = validPoster(attr(tag, name), pageUrl);
      if (poster) return poster;
    }

    const srcset = validPoster(srcsetUrl(attr(tag, "srcset")), pageUrl);
    if (srcset) return srcset;

    const lazySrcset = validPoster(
      srcsetUrl(attr(tag, "data-srcset")),
      pageUrl
    );
    if (lazySrcset) return lazySrcset;
  }

  const metaRegex = /<meta\b[^>]*>/gi;

  while ((match = metaRegex.exec(block))) {
    const tag = match[0];
    const property = (attr(tag, "property") || attr(tag, "name")).toLowerCase();

    if (property === "og:image" || property === "twitter:image") {
      const poster = validPoster(attr(tag, "content"), pageUrl);
      if (poster) return poster;
    }
  }

  return undefined;
}

function parseCards(html, pageUrl) {
  const regex =
    /<a\b[^>]*href\s*=\s*(["'])(?:https?:\/\/(?:www\.)?veohentai\.com)?\/ver\/([^"'\/\s?#]+)/gi;

  const marks = [];
  let match;

  while ((match = regex.exec(html))) {
    marks.push({
      slug: match[2],
      at: match.index,
      end: regex.lastIndex
    });
  }

  const output = [];
  const seen = new Set();

  for (let i = 0; i < marks.length; i++) {
    const slug = marks[i].slug;
    if (seen.has(slug)) continue;
    seen.add(slug);

    const from = marks[i].at;
    const next = i + 1 < marks.length ? marks[i + 1].at : from + 3000;
    const chunk = html.slice(from, next);

    const previousEnd = i > 0
      ? marks[i - 1].end
      : Math.max(0, from - 1200);

    const before = html.slice(Math.max(previousEnd, from - 1200), from);
    const poster =
      extractImage(chunk, pageUrl) ||
      extractImage(before, pageUrl);

    const titleMatch =
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(chunk) ||
      /<img\b[^>]*\balt\s*=\s*(["'])([\s\S]*?)\1/i.exec(chunk) ||
      /title\s*=\s*(["'])([\s\S]*?)\1/i.exec(chunk);

    const title = clean(
      titleMatch ? titleMatch[2] || titleMatch[1] : slug.replace(/-/g, " "),
      200
    );

    output.push({
      slug,
      title: title || slug.replace(/-/g, " "),
      poster
    });
  }

  return output;
}

function splitEpisode(slug) {
  const match = /^(.*)-episodio-(\d+)$/i.exec(slug);
  return match
    ? { slug: match[1], number: Number(match[2]) }
    : null;
}

function seriesTitle(title, slug) {
  return clean(title, 200)
    .replace(/\s*[-–|:]?\s*episodio\s*\d+\s*$/i, "")
    .trim() || slug.replace(/-/g, " ");
}

function seriesItem(card) {
  return {
    id: "s~" + card.slug,
    ref: "s~" + card.slug,
    title: card.title,
    kind: "series",
    adult: true,
    poster: card.poster,
    genres: ["anime"]
  };
}

function episodeItem(card) {
  return {
    id: "v~" + card.slug,
    ref: "v~" + card.slug + "~1",
    title: card.title,
    kind: "movie",
    adult: true,
    poster: card.poster,
    genres: ["anime"]
  };
}

function catalogItems(cards) {
  const result = [];
  const seriesSeen = new Set();

  for (const card of cards) {
    const episode = splitEpisode(card.slug);

    if (!episode) {
      result.push(episodeItem(card));
      continue;
    }

    if (seriesSeen.has(episode.slug)) continue;
    seriesSeen.add(episode.slug);

    result.push(seriesItem({
      slug: episode.slug,
      title: seriesTitle(card.title, episode.slug),
      poster: card.poster
    }));
  }

  return result;
}

// -----------------------------------------------------------------------------
// BÚSQUEDA
// -----------------------------------------------------------------------------

export async function search(query) {
  await null;

  const terms = [];
  const seenTerms = new Set();

  for (const raw of [query && query.q, query && query.originalTitle]) {
    if (typeof raw !== "string" || !raw.trim()) continue;

    const term = kino.rank.shortQuery(raw).trim();
    const key = term.toLowerCase();

    if (!term || seenTerms.has(key)) continue;
    seenTerms.add(key);
    terms.push(term);

    if (terms.length === 2) break;
  }

  if (!terms.length) return [];

  log("Búsqueda iniciada", terms.join(", "));

  const pages = await parallelLimit(terms, 2, async term => {
    try {
      return await getText(
        abs("/buscar?q=" + encodeURIComponent(term)),
        BASE + "/"
      );
    } catch (error) {
      log("Búsqueda falló", term, error.message);
      return null;
    }
  });

  if (pages.every(page => page === null)) {
    throw kino.error("unavailable", "el sitio no respondió");
  }

  const found = [];
  const seen = new Set();

  for (const html of pages) {
    if (!html) continue;

    for (const card of parseCards(html, BASE + "/")) {
      if (seen.has(card.slug)) continue;
      seen.add(card.slug);
      found.push(card);
    }
  }

  const relevant = kino.rank.filterRelevant(found, terms, card => card.title);
  const kept = relevant.length ? relevant : found;

  const sorted = kino.rank.sortBySimilarity(
    kept,
    terms,
    card => card.title
  );

  const result = catalogItems(sorted).slice(0, MAX_ITEMS);
  log("Búsqueda terminada", result.length, "resultados");
  return result;
}

// -----------------------------------------------------------------------------
// INICIO
// -----------------------------------------------------------------------------

export async function home() {
  await null;
  log("Cargando inicio");

  const paths = [
    { id: "front", url: BASE + "/" },
    { id: "top", url: abs("/explorar/?orden=vistas-semana") },
    { id: "seen", url: abs("/explorar/?orden=vistas") },
    { id: "uncensored", url: abs("/genero/hentai-sin-censura/") }
  ];

  const pages = await parallelLimit(paths, 4, async entry => {
    try {
      return await getText(entry.url, BASE + "/");
    } catch (error) {
      log("Fila no disponible", entry.id, error.message);
      return null;
    }
  });

  const rows = [];

  function pushRow(id, title, items) {
    if (!items.length) return;

    rows.push({
      id,
      title,
      genre: "anime",
      items: items.slice(0, MAX_ITEMS)
    });

    log("Fila creada", id, items.length);
  }

  const [front, top, seen, uncensored] = pages;

  if (front) {
    pushRow(
      "recientes",
      msg("Recién agregados", "Recently added"),
      catalogItems(parseCards(front, BASE + "/"))
    );
  }

  if (top) {
    pushRow(
      "tendencias",
      msg("Tendencias de la semana", "Trending this week"),
      catalogItems(parseCards(top, BASE + "/"))
    );
  }

  if (seen) {
    pushRow(
      "vistos",
      msg("Más vistos", "Most viewed"),
      catalogItems(parseCards(seen, BASE + "/"))
    );
  }

  if (uncensored) {
    pushRow(
      "sin-censura",
      msg("Sin censura", "Uncensored"),
      catalogItems(parseCards(uncensored, BASE + "/"))
    );
  }

  log("Inicio terminado", rows.length, "filas");
  return rows;
}// -----------------------------------------------------------------------------
// EPISODIOS (LISTA NATIVA DE KINO)
// -----------------------------------------------------------------------------

export async function episodes(ref) {
  await null;

  const parts = String(ref || "").split("~");
  const slug = parts[1] || "";

  if (parts[0] !== "s" || !slug) {
    throw kino.error("not_found", "esa serie ya no existe");
  }

  log("Cargando episodios", slug);

  const seriesUrl = abs("/serie/" + slug + "/");
  let html;

  try {
    html = await getText(seriesUrl, BASE + "/");
  } catch (error) {
    throw kino.error("not_found", "no se pudo abrir la serie: " + error.message);
  }

  const titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const poster = extractImage(html, seriesUrl);
  const list = [];
  const seen = new Set();

  for (const card of parseCards(html, seriesUrl)) {
    const episode = splitEpisode(card.slug);

    if (
      !episode ||
      episode.slug !== slug ||
      seen.has(card.slug)
    ) {
      continue;
    }

    seen.add(card.slug);

    list.push({
      season: 1,
      number: episode.number,
      ref: "v~" + card.slug,
      title: card.title || msg(
        "Episodio " + episode.number,
        "Episode " + episode.number
      ),
      adult: true
    });

    if (list.length >= MAX_EPISODES) break;
  }

  if (!list.length) {
    throw kino.error("not_found", "esa serie no tiene episodios");
  }

  list.sort((a, b) => a.number - b.number);
  log("Episodios encontrados", slug, list.length);

  return {
    series: {
      title: clean(
        titleMatch ? titleMatch[1] : slug.replace(/-/g, " "),
        200
      ),
      poster,
      genres: ["anime"],
      adult: true
    },
    episodes: list
  };
}

// -----------------------------------------------------------------------------
// RESOLVER
// No intentamos reproducir directamente los MP4: el servidor responde 403.
// El vídeo se abre desde la pantalla Reproductor mediante el navegador visual.
// -----------------------------------------------------------------------------

export async function resolve(ref) {
  await null;

  const parts = String(ref || "").split("~");

  if (parts[0] !== "v" || !parts[1]) {
    throw kino.error("not_found", "esa dirección no es un episodio");
  }

  throw kino.error(
    "unavailable",
    msg(
      "Abre VeoHentai > Reproductor en el menú de Kino y selecciona el episodio allí.",
      "Open VeoHentai > Player from the Kino menu and select the episode there."
    )
  );
}

// -----------------------------------------------------------------------------
// REPRODUCTOR ORIGINAL
// -----------------------------------------------------------------------------

function parseEmbed(html, pageUrl) {
  const iframeRegex = /<iframe\b[^>]*>/gi;
  let match;

  while ((match = iframeRegex.exec(html))) {
    const src = imageUrl(attr(match[0], "src"), pageUrl || BASE + "/");
    if (!src) continue;

    const host = hostOf(src);
    if (host === PLAYER_HOST || host.endsWith("." + PLAYER_HOST)) {
      return src;
    }
  }

  const loose =
    /https?:\/\/(?:www\.)?hentaiplayer\.com\/v\/[A-Za-z0-9_-]+\/?/i.exec(html);

  return loose ? loose[0] : "";
}

async function episodePage(slug) {
  const url = abs("/ver/" + slug + "/");
  return {
    url,
    html: await getText(url, BASE + "/")
  };
}

function validEpisodeSlug(slug) {
  return typeof slug === "string" && /^[a-zA-Z0-9_-]+$/.test(slug);
}

function visualBrowserAvailable() {
  return Boolean(
    kino.visualBrowser &&
    typeof kino.visualBrowser.open === "function"
  );
}

async function openOriginalPlayer(slug) {
  if (!validEpisodeSlug(slug)) {
    throw kino.error("not_found", "episodio inválido");
  }

  if (!visualBrowserAvailable()) {
    throw kino.error(
      "unavailable",
      msg(
        "El navegador visual no está disponible. Comprueba que Kino y el plugin admitan visualBrowser.",
        "Visual Browser is unavailable. Check that Kino and the plugin support visualBrowser."
      )
    );
  }

  log("Buscando reproductor original", slug);

  const page = await episodePage(slug);
  const embed = parseEmbed(page.html, page.url);

  if (!embed) {
    log("No se encontró iframe del reproductor", slug);
    throw kino.error(
      "not_found",
      msg(
        "No se encontró el reproductor original en la página de este episodio.",
        "The original player was not found on this episode page."
      )
    );
  }

  const host = hostOf(embed);
  if (!(host === PLAYER_HOST || host.endsWith("." + PLAYER_HOST))) {
    throw kino.error("not_found", "dominio del reproductor no válido");
  }

  log("Abriendo navegador visual", embed);

  const result = await kino.visualBrowser.open({
    url: embed,
    title: "VeoHentai",
    timeoutMs: 600000
  });

  log("Navegador visual finalizado", result && result.status);

  if (result && result.status === "timeout") {
    return msg(
      "La ventana del reproductor alcanzó el límite de tiempo.",
      "The player window reached its time limit."
    );
  }

  return msg("Reproductor cerrado.", "Player closed.");
}// -----------------------------------------------------------------------------
// PANTALLA PROPIA: MENÚ > REPRODUCTOR
// -----------------------------------------------------------------------------

export async function screen({ state, lang }) {
  const english = isEnglish(lang);
  const text = (esText, enText) => english ? enText : esText;

  if (state && state.view === "episodes" && Array.isArray(state.entries)) {
    return {
      type: "Column",
      padding: 16,
      gap: 12,
      children: [
        {
          type: "Row",
          gap: 12,
          onTap: { event: "back-home" },
          children: [
            {
              type: "Text",
              text: "← " + text("Volver", "Back"),
              style: "h3"
            }
          ]
        },
        {
          type: "Text",
          text: state.title || "VeoHentai",
          style: "h3"
        },
        {
          type: "Text",
          text: text(
            "Selecciona un episodio para abrirlo en el reproductor original.",
            "Select an episode to open it in the original player."
          ),
          style: "caption",
          color: "muted"
        },
        {
          type: "ListView",
          items: state.entries.map(episode => ({
            type: "Row",
            key: episode.slug,
            gap: 12,
            onTap: {
              event: "open-episode",
              arg: episode.slug
            },
            children: [
              {
                type: "Text",
                text: episode.title,
                style: "h3",
                maxLines: 2
              }
            ]
          }))
        }
      ]
    };
  }

  try {
    const html = await getText(BASE + "/", BASE + "/");
    const cards = parseCards(html, BASE + "/").slice(0, MAX_ITEMS);

    const items = cards.map(card => {
      const episode = splitEpisode(card.slug);

      return {
        type: "Row",
        key: card.slug,
        gap: 12,
        onTap: {
          event: episode ? "open-episode" : "open-series",
          arg: card.slug
        },
        children: [
          ...(card.poster ? [{
            type: "Image",
            url: card.poster,
            width: 76,
            height: 104,
            borderRadius: "small"
          }] : []),
          {
            type: "Column",
            flex: 1,
            children: [
              {
                type: "Text",
                text: card.title,
                style: "h3",
                maxLines: 3
              },
              {
                type: "Text",
                text: episode
                  ? text("Abrir episodio", "Open episode")
                  : text("Ver episodios", "View episodes"),
                style: "caption",
                color: "muted"
              }
            ]
          }
        ]
      };
    });

    return {
      type: "Column",
      padding: 16,
      gap: 12,
      children: [
        {
          type: "Text",
          text: "VeoHentai",
          style: "h3"
        },
        {
          type: "Text",
          text: text(
            "Elige una serie o un episodio. La reproducción se realizará en la página original.",
            "Choose a series or episode. Playback will run on the original website."
          ),
          style: "caption",
          color: "muted"
        },
        {
          type: "ListView",
          items
        }
      ]
    };
  } catch (error) {
    log("Error cargando pantalla", error && error.message);

    return {
      type: "Column",
      padding: 16,
      gap: 12,
      children: [
        {
          type: "Text",
          text: "VeoHentai",
          style: "h3"
        },
        {
          type: "Text",
          text: text(
            "No se pudo cargar el catálogo: ",
            "Could not load the catalogue: "
          ) + (error && error.message ? error.message : "Error"),
          color: "muted"
        }
      ]
    };
  }
}

// -----------------------------------------------------------------------------
// EVENTOS DE LA PANTALLA
// -----------------------------------------------------------------------------

export async function screenEvent({ name, arg }) {
  await null;

  if (name === "back-home") {
    return {
      state: { view: "home" }
    };
  }

  if (name === "open-series") {
    const slug = String(arg || "");

    if (!validEpisodeSlug(slug)) {
      throw kino.error("not_found", "serie inválida");
    }

    log("Abriendo serie desde pantalla", slug);

    const seriesUrl = abs("/serie/" + slug + "/");
    const html = await getText(seriesUrl, BASE + "/");
    const titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);

    const entries = [];
    const seen = new Set();

    for (const card of parseCards(html, seriesUrl)) {
      const episode = splitEpisode(card.slug);

      if (
        !episode ||
        episode.slug !== slug ||
        seen.has(card.slug)
      ) {
        continue;
      }

      seen.add(card.slug);

      entries.push({
        slug: card.slug,
        number: episode.number,
        title: card.title || (
          msg("Episodio ", "Episode ") + episode.number
        )
      });

      if (entries.length >= MAX_EPISODES) break;
    }

    entries.sort((a, b) => a.number - b.number);

    if (!entries.length) {
      throw kino.error("not_found", "esa serie no tiene episodios");
    }

    return {
      state: {
        view: "episodes",
        slug,
        title: clean(
          titleMatch ? titleMatch[1] : slug.replace(/-/g, " "),
          200
        ),
        entries
      },
      toast: msg(
        entries.length + " episodios encontrados",
        entries.length + " episodes found"
      )
    };
  }

  if (name === "open-episode") {
    const slug = String(arg || "");
    const status = await openOriginalPlayer(slug);

    return {
      toast: status
    };
  }

  return null;
}