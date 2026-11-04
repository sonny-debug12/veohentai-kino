// Kino plugin: VeoHentai (veohentai.com) — hentai subtitulado al español.
// Solo lee lo que cualquiera vería en el sitio sin cuenta: el catálogo, las series,
// los episodios y el reproductor que el propio sitio incrusta en cada episodio.
//
// Refs:
//   s~<slug>        una serie
//   v~<slug>        un episodio (slug completo, p. ej. "sister-breeder-episodio-6")
//   p~<base64>      un servidor concreto (las "alternativas" de un Stream)

const BASE = "https://veohentai.com";
const PLAYER = "https://hentaiplayer.com";
const TIMEOUT = 12000;
const MAX_ITEMS = 60;
const MAX_EPISODES = 3000;

function log(...args) {
  try {
    kino.log(...args);
  } catch {}
}

function es() {
  return String(kino.lang || "es-CO").toLowerCase().indexOf("en") !== 0;
}

function msg(esText, enText) {
  return es() ? esText : enText;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function getText(url, referer) {
  const headers = {};
  if (referer) headers.Referer = referer;
  const r = await kino.fetch(url, { headers, timeoutMs: TIMEOUT });
  if (!r.ok) throw new Error(url + " respondió " + r.status);
  return r.text();
}

function abs(path) {
  return new URL(path, BASE).href;
}

function clean(text, max) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max || 200);
}

// Normaliza URLs de imágenes: absolutas, relativas y protocol-relative.
function imageUrl(value, pageUrl) {
  if (!value || typeof value !== "string") return undefined;

  let v = value.trim().replace(/&amp;/gi, "&");

  if (!v || /^data:/i.test(v)) return undefined;
  if (v.startsWith("//")) v = "https:" + v;

  try {
    return new URL(v, pageUrl || BASE + "/").href;
  } catch {
    return undefined;
  }
}

// Base64 con o sin relleno, estándar o url-safe.
function b64(value) {
  let s = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return atob(s);
}

// Base64 seguro para URLs con caracteres fuera de Latin-1.
function encodeRef(url) {
  try {
    return btoa(encodeURIComponent(url));
  } catch {
    return btoa(url);
  }
}

function decodeRef(value) {
  let raw;

  try {
    raw = atob(value);
  } catch {
    throw kino.error("not_found", "ese servidor ya no sirve");
  }

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function attr(tag, name) {
  const m = new RegExp(
    "\\b" + name + "\\s*=\\s*([\"'])([\\s\\S]*?)\\1",
    "i"
  ).exec(tag);

  return m ? m[2] : "";
}

function srcsetUrl(value) {
  if (!value) return "";

  const candidates = value
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);

  return candidates.length ? candidates[candidates.length - 1] : "";
}

// Extrae portadas normales, lazy-load, picture, srcset y metadatos sociales.
function extractImage(block, pageUrl) {
  if (!block) return undefined;

  const tags = [];
  const tagRe = /<(?:img|source)\b[^>]*>/gi;
  let m;

  while ((m = tagRe.exec(block))) {
    tags.push(m[0]);
  }

  const attributes = [
    "data-src",
    "data-lazy-src",
    "data-original",
    "data-original-src",
    "data-image",
    "data-poster",
    "data-thumb",
    "src",
  ];

  for (const tag of tags) {
    for (const name of attributes) {
      const url = imageUrl(attr(tag, name), pageUrl);
      if (url) return url;
    }

    const set = imageUrl(srcsetUrl(attr(tag, "srcset")), pageUrl);
    if (set) return set;

    const setLazy = imageUrl(srcsetUrl(attr(tag, "data-srcset")), pageUrl);
    if (setLazy) return setLazy;
  }

  const metaRe = /<meta\b[^>]*>/gi;

  while ((m = metaRe.exec(block))) {
    const tag = m[0];
    const property = (attr(tag, "property") || attr(tag, "name")).toLowerCase();

    if (property === "og:image" || property === "twitter:image") {
      const url = imageUrl(attr(tag, "content"), pageUrl);
      if (url) return url;
    }
  }

  return undefined;
}

// Corta el HTML en las tarjetas de una lista (enlaces a /ver/).
function parseCards(html, pageUrl) {
  const re =
    /<a\b[^>]*href\s*=\s*(["'])(?:https?:\/\/veohentai\.com)?\/ver\/([^"'\/\s?#]+)/gi;

  const marks = [];
  let m;

  while ((m = re.exec(html))) {
    marks.push({ slug: m[2], at: m.index, end: re.lastIndex });
  }

  const out = [];
  const seen = new Set();

  for (let i = 0; i < marks.length; i++) {
    const slug = marks[i].slug;

    if (seen.has(slug)) continue;
    seen.add(slug);

    const from = marks[i].at;
    const next = i + 1 < marks.length ? marks[i + 1].at : from + 3000;

    const chunk = html.slice(from, next);

    const previousEnd = i > 0 ? marks[i - 1].end : Math.max(0, from - 1200);
    const before = html.slice(Math.max(previousEnd, from - 1200), from);

    const poster =
      extractImage(chunk, pageUrl) || extractImage(before, pageUrl);

    const titleM =
      /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(chunk) ||
      /<img\b[^>]*\balt\s*=\s*(["'])([\s\S]*?)\1/i.exec(chunk) ||
      /title\s*=\s*(["'])([\s\S]*?)\1/i.exec(chunk);

    const title = clean(
      titleM ? titleM[2] || titleM[1] : slug.replace(/-/g, " "),
      200
    );

    out.push({
      slug,
      title: title || slug.replace(/-/g, " "),
      poster,
    });
  }

  return out;
}

function splitEpisode(slug) {
  const m = /^(.*)-episodio-(\d+)$/.exec(slug);
  return m ? { slug: m[1], num: Number(m[2]) } : null;
}

function seriesItem(c) {
  return {
    id: "s~" + c.slug,
    ref: "s~" + c.slug,
    title: c.title,
    kind: "series",
    poster: c.poster,
    genres: ["hentai"],
  };
}

function episodeItem(c) {
  return {
    id: "v~" + c.slug,
    ref: "v~" + c.slug,
    title: c.title,
    kind: "movie",
    poster: c.poster,
    genres: ["hentai"],
  };
}

// ---- search ----------------------------------------------------------------

export async function search(query) {
  await null;

  const terms = [];
  const seenTerm = new Set();

  for (const raw of [query && query.q, query && query.originalTitle]) {
    if (typeof raw !== "string" || !raw.trim()) continue;

    const text = kino.rank.shortQuery(raw).trim();
    const key = text.toLowerCase();

    if (!text || seenTerm.has(key)) continue;

    seenTerm.add(key);
    terms.push(text);

    if (terms.length === 2) break;
  }

  if (!terms.length) return [];

  const answers = await Promise.all(
    terms.map(async (term) => {
      try {
        return await getText(
          abs("/buscar?q=" + encodeURIComponent(term)),
          BASE + "/"
        );
      } catch (e) {
        log("búsqueda falló", term, e.message);
        return null;
      }
    })
  );

  if (answers.every((a) => a === null)) {
    throw kino.error("unavailable", "el sitio no respondió");
  }

  const found = [];
  const seen = new Set();

  for (const html of answers) {
    if (!html) continue;

    for (const c of parseCards(html, BASE + "/")) {
      if (seen.has(c.slug)) continue;

      seen.add(c.slug);
      found.push(c);
    }
  }

  const relevant = kino.rank.filterRelevant(found, terms, (c) => c.title);

  const kept = relevant.length ? relevant : found;

  const sorted = kino.rank.sortBySimilarity(kept, terms, (c) => c.title);

  return sorted.slice(0, MAX_ITEMS).map(episodeItem);
}

// ---- home ------------------------------------------------------------------

export async function home() {
  await null;

  const [front, top, seen, uncensored] = await Promise.all([
    getText(BASE + "/", BASE + "/").catch((e) => {
      log("Inicio falló", e.message);
      return null;
    }),

    getText(abs("/explorar/?orden=vistas-semana"), BASE + "/").catch(() => null),

    getText(abs("/explorar/?orden=vistas"), BASE + "/").catch(() => null),

    getText(abs("/genero/hentai-sin-censura/"), BASE + "/").catch(() => null),
  ]);

  const rows = [];

  const push = (id, title, items) => {
    if (items.length) {
      rows.push({
        id,
        title,
        genre: "hentai",
        items: items.slice(0, MAX_ITEMS),
      });
    }
  };

  if (front) {
    push(
      "recientes",
      msg("Recién agregados", "Recently added"),
      parseCards(front, BASE + "/").map(episodeItem)
    );
  }

  if (top) {
    push(
      "tendencias",
      msg("Tendencias de la semana", "Trending this week"),
      parseCards(top, BASE + "/").map(episodeItem)
    );
  }

  if (seen) {
    push(
      "vistos",
      msg("Los más vistos", "Most watched"),
      parseCards(seen, BASE + "/").map(episodeItem)
    );
  }

  if (uncensored) {
    push(
      "sin-censura",
      msg("Sin censura", "Uncensored"),
      parseCards(uncensored, BASE + "/").map(episodeItem)
    );
  }

  if (!rows.length) {
    throw kino.error("unavailable", "el sitio no devolvió nada");
  }

  return rows;
}

// ---- episodes --------------------------------------------------------------

export async function episodes(ref) {
  await null;

  const parts = String(ref || "").split("~");
  const slug = parts[1] || "";

  if (parts[0] !== "s" || !slug) {
    throw kino.error("not_found", "esa serie ya no existe");
  }

  let html;

  try {
    html = await getText(abs("/serie/" + slug + "/"), BASE + "/");
  } catch (e) {
    throw kino.error(
      "not_found",
      "no se pudo abrir la serie: " + e.message
    );
  }

  const titleM = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const seriesPoster = extractImage(html, abs("/serie/" + slug + "/"));

  const list = [];
  const seen = new Set();

  for (const c of parseCards(html, abs("/serie/" + slug + "/"))) {
    const ep = splitEpisode(c.slug);

    if (!ep || ep.slug !== slug || seen.has(c.slug)) continue;

    seen.add(c.slug);

    list.push({
      season: 1,
      number: ep.num,
      ref: "v~" + c.slug,
      title: c.title || msg("Episodio " + ep.num, "Episode " + ep.num),
    });
  }

  if (!list.length) {
    throw kino.error("not_found", "esa serie no tiene episodios");
  }

  list.sort((a, b) => a.number - b.number);

  return {
    series: {
      title: clean(titleM ? titleM[1] : slug.replace(/-/g, " "), 200),
      poster: seriesPoster,
      genres: ["hentai"],
    },
    episodes: list,
  };
}

// ---- episodio --------------------------------------------------------------

// Encuentra el iframe del reproductor dentro de la página del episodio.
function parseEmbed(html) {
  const re = /<iframe\b[^>]*>/gi;
  let m;

  while ((m = re.exec(html))) {
    const src = imageUrl(attr(m[0], "src"), BASE + "/");

    if (src && hostOf(src).indexOf("hentaiplayer.com") !== -1) {
      return src;
    }
  }

  const loose = /https?:\/\/hentaiplayer\.com\/v\/[A-Za-z0-9_-]+\/?/.exec(html);
  return loose ? loose[0] : "";
}

// Lee el data-id de la lista de servidores y lo convierte en MP4 + subtítulo.
function parseServers(page) {
  const out = [];

  const re = /<li\b[^>]*\bdata-id\s*=\s*(["'])([\s\S]*?)\1/gi;
  let m;

  while ((m = re.exec(page))) {
    const dataId = m[2].replace(/&amp;/gi, "&");
    const vidM = /[?&]vid=([^&"'\s]+)/.exec(dataId);

    if (!vidM) continue;

    let file;

    try {
      file = b64(decodeURIComponent(vidM[1])).split("|")[0];
    } catch {
      continue;
    }

    if (!/^https?:\/\//i.test(file)) continue;

    let subtitle;

    const sM = /[?&]s=([^&"'\s]+)/.exec(dataId);

    if (sM) {
      try {
        subtitle = b64(decodeURIComponent(sM[1]));
      } catch {}
    }

    if (subtitle && !/^https?:\/\//i.test(subtitle)) subtitle = undefined;

    out.push({ file, subtitle, dataId });
  }

  return out;
}

async function episodeHtml(slug) {
  const url = abs("/ver/" + slug + "/");

  try {
    return await getText(url, BASE + "/");
  } catch (e) {
    if (!/-episodio-\d+$/.test(slug)) {
      try {
        return await getText(abs("/ver/" + slug + "-episodio-1/"), BASE + "/");
      } catch {}
    }

    throw e;
  }
}

// Convierte un data-id (o un mp4 directo) en un Stream reproducible.
async function playServer(entry) {
  if (/^https?:\/\//i.test(entry)) {
    return {
      url: entry,
      mime: /\.m3u8(\?|$)/i.test(entry)
        ? "application/x-mpegURL"
        : "video/mp4",
      headers: { Referer: PLAYER + "/" },
    };
  }

  const stream = {
    url: entry.file,
    mime: "video/mp4",
    headers: { Referer: PLAYER + "/" },
  };

  if (entry.subtitle) {
    stream.subtitles = [
      { url: entry.subtitle, label: "Español", lang: "es" },
    ];
  }

  return stream;
}

export async function resolve(ref) {
  await null;

  const parts = String(ref || "").split("~");

  if (parts[0] === "p") {
    let raw;

    try {
      raw = decodeRef(parts.slice(1).join("~"));
    } catch {
      throw kino.error("not_found", "ese servidor ya no sirve");
    }

    return await playServer(raw);
  }

  if (parts[0] !== "v" || !parts[1]) {
    throw kino.error("not_found", "esa dirección no es un episodio");
  }

  const slug = parts[1];

  let html;

  try {
    html = await episodeHtml(slug);
  } catch (e) {
    throw kino.error(
      "not_found",
      "no se pudo abrir el episodio: " + e.message
    );
  }

  const embed = parseEmbed(html);

  if (!embed) {
    throw kino.error("not_found", "el episodio no tiene reproductor", {
      userMessage: msg(
        "Este episodio no tiene reproductor disponible.",
        "This episode has no available player."
      ),
    });
  }

  let page;

  try {
    page = await getText(embed, BASE + "/");
  } catch (e) {
    throw kino.error(
      "unavailable",
      "el reproductor no respondió: " + e.message
    );
  }

  const servers = parseServers(page);

  if (!servers.length) {
    // Último recurso: el MP4 suelto en el JS del reproductor.
    const loose = /(https?:\/\/[^"'\s]+?\.mp4[^"'\s]*)/i.exec(page);

    if (loose) {
      servers.push({ file: loose[1], dataId: loose[1] });
    }
  }

  if (!servers.length) {
    throw kino.error("unavailable", "el reproductor no entregó archivo", {
      userMessage: msg(
        "El reproductor no entregó ningún video.",
        "The player returned no video."
      ),
    });
  }

  const stream = await playServer(servers[0]);

  const alternatives = [];

  for (let i = 1; i < servers.length; i++) {
    alternatives.push({
      label: msg("Servidor " + (i + 1), "Server " + (i + 1)),
      ref: "p~" + encodeRef(servers[i].dataId),
    });
  }

  return {
    ...stream,
    label: msg("Servidor 1", "Server 1"),
    alternatives,
  };
}