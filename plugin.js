
async function playServer(entry) {
  const file = typeof entry === "string"
    ? entry
    : entry && entry.file;

  const subtitle = typeof entry === "object"
    ? entry.subtitle
    : undefined;

  if (!/^https?:\/\//i.test(file || "")) {
    throw kino.error(
      "not_found",
      "servidor de video inválido"
    );
  }

  const headers = {
    "Referer": PLAYER + "/",
    "Origin": PLAYER,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };

  log("PREPARANDO VIDEO", file);
  log("REFERER", headers.Referer);
  log("ORIGIN", headers.Origin);

  const stream = {
    url: file,
    mime: /\.m3u8(\?|$)/i.test(file)
      ? "application/x-mpegURL"
      : "video/mp4",
    headers
  };

  if (
    subtitle &&
    /^https?:\/\//i.test(subtitle)
  ) {
    stream.subtitles = [
      {
        url: subtitle,
        label: "Español",
        lang: "es"
      }
    ];
  }

  return stream;
}