import Soup from "gi://Soup";
import GLib from "gi://GLib";

const decode = (data) => new TextDecoder().decode(data);

const CACHE_MAX = 80;
const TIMEOUT_S = 6;

export class LyricsClient {
  constructor() {
    this._session = new Soup.Session();
    this._session.timeout = TIMEOUT_S;
    this._cache = new Map();
    this._inflight = new Map();
  }

  /**
   * @param {string} title
   * @param {string} artist
   * @param {string} album
   * @param {number} durationSec
   * @returns {Promise<{time:number,text:string}[]|null>}
   */
  async getLyrics(title, artist, album, durationSec) {
    if (!title && !artist) return null;

    const key = this._cacheKey(title, artist, album, durationSec);

    if (this._cache.has(key)) return this._lruGet(key);

    if (this._inflight.has(key)) return this._inflight.get(key);

    const promise = this._fetchAll(title, artist, album, durationSec, key);
    this._inflight.set(key, promise);

    try {
      return await promise;
    } finally {
      this._inflight.delete(key);
    }
  }

  prefetch(title, artist, album, durationSec) {
    if (!title && !artist) return;
    const key = this._cacheKey(title, artist, album, durationSec);
    if (this._cache.has(key) || this._inflight.has(key)) return;
    // fire-and-forget; result lands in cache for next call
    this.getLyrics(title, artist, album, durationSec).catch(() => {});
  }

  destroy() {
    this._session.abort();
    this._session = null;
    this._cache.clear();
    this._inflight.clear();
  }

  _cacheKey(title, artist, album, durationSec) {
    return `${title}||${artist}||${album}||${Math.round(durationSec)}`;
  }

  _lruGet(key) {
    const v = this._cache.get(key);
    // move to tail so LRU eviction skips recently used entries
    this._cache.delete(key);
    this._cache.set(key, v);
    return v;
  }

  _setCache(key, value) {
    if (this._cache.size >= CACHE_MAX)
      this._cache.delete(this._cache.keys().next().value);
    this._cache.set(key, value);
  }

  // Fires all three sources in parallel; first truthy result wins.
  // lrclib exact > lrclib search get priority over ovh (no timestamps).
  async _fetchAll(title, artist, album, durationSec, key) {
    const exact = this._lrclibExact(title, artist, album, durationSec);
    const search = this._lrclibSearch(title, artist, durationSec);
    const ovh = this._lyricsOvh(title, artist, durationSec);

    // wraps a promise so it only resolves on a truthy value, never rejects
    const firstOf = (p) =>
      new Promise((res) =>
        p
          .then((v) => {
            if (v) res(v);
          })
          .catch(() => {}),
      );

    const winner = await Promise.race([
      Promise.race([firstOf(exact), firstOf(search)]),
      firstOf(ovh),
      Promise.allSettled([exact, search, ovh]).then(
        ([a, b, c]) => a.value ?? b.value ?? c.value ?? null,
      ),
    ]);

    const result = winner ?? null;
    this._setCache(key, result);
    return result;
  }

  async _lrclibExact(title, artist, album, durationSec) {
    const p = new URLSearchParams();
    p.set("track_name", title || "");
    p.set("artist_name", artist || "");
    if (album) p.set("album_name", album);
    if (durationSec > 0) p.set("duration", String(Math.round(durationSec)));

    const data = await this._fetchJSON(`https://lrclib.net/api/get?${p}`).catch(
      () => null,
    );
    if (!data?.syncedLyrics) return null;
    return this._parseLRC(data.syncedLyrics);
  }

  async _lrclibSearch(title, artist, durationSec) {
    const q = encodeURIComponent(`${title} ${artist}`.trim());
    const data = await this._fetchJSON(
      `https://lrclib.net/api/search?q=${q}`,
    ).catch(() => null);

    if (!Array.isArray(data) || data.length === 0) return null;

    const withSynced = data.filter((r) => r.syncedLyrics);
    if (withSynced.length === 0) return null;

    // pick the result closest in duration; drop if >5 s off
    let best = null,
      bestDiff = Infinity;
    for (const r of withSynced) {
      const diff =
        durationSec > 0 ? Math.abs((r.duration ?? 0) - durationSec) : 0;
      if (diff < bestDiff) {
        bestDiff = diff;
        best = r;
      }
    }
    if (!best || (durationSec > 0 && bestDiff > 5)) return null;

    return this._parseLRC(best.syncedLyrics);
  }

  async _lyricsOvh(title, artist, durationSec) {
    if (!title || !artist) return null;

    const enc = (s) => encodeURIComponent(s.trim());
    const data = await this._fetchJSON(
      `https://api.lyrics.ovh/v1/${enc(artist)}/${enc(title)}`,
    ).catch(() => null);
    if (!data?.lyrics) return null;

    // ovh returns plain text with [Verse] tags — strip them
    const rawLines = data.lyrics
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.match(/^\[.*\]$/));
    if (rawLines.length === 0) return null;

    // no timestamps available, so distribute lines evenly (4-min default)
    const totalMs = durationSec > 10 ? durationSec * 1000 : 240_000;
    const step = totalMs / (rawLines.length + 1);
    return rawLines.map((text, i) => ({
      time: Math.round(step * (i + 1)),
      text,
    }));
  }

  async _fetchJSON(url) {
    const msg = Soup.Message.new("GET", url);
    msg.request_headers.append(
      "User-Agent",
      "AdvancedMediaController/5 (https://codeberg.org)",
    );
    msg.request_headers.append("Accept-Encoding", "gzip, deflate");
    msg.request_headers.append("Accept", "application/json");

    const bytes = await this._session.send_and_read_async(
      msg,
      GLib.PRIORITY_HIGH,
      null,
    );
    if (msg.status_code !== 200) throw new Error(`HTTP ${msg.status_code}`);

    const raw = bytes.get_data();
    if (!raw) throw new Error("empty body");

    return JSON.parse(decode(raw));
  }

  _parseLRC(lrcText) {
    if (!lrcText) return null;
    const RE = /^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    const lines = [];

    for (const raw of lrcText.split("\n")) {
      const m = raw.match(RE);
      if (!m) continue;
      const ms =
        parseInt(m[1], 10) * 60_000 +
        parseInt(m[2], 10) * 1_000 +
        (m[3].length === 2 ? parseInt(m[3], 10) * 10 : parseInt(m[3], 10));
      const text = m[4].trim();
      if (text) lines.push({ time: ms, text });
    }
    return lines.length > 0 ? lines : null;
  }
}