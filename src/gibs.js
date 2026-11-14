/*
 * NASA GIBS access for the live tuner.
 *
 * GIBS is an OGC WMS that serves one rendered image per layer per date. It sends
 * `Access-Control-Allow-Origin: *`, which is the only reason a page can read
 * those pixels with a canvas and sonify them without a server in the middle.
 *
 * Kept tiny on purpose: the heavy lifting is in analyze.js and sonify.js.
 */

const Gibs = (() => {
  const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

  /**
   * One world-extent frame. WMS 1.1.1 with EPSG:4326 expects
   * BBOX=minx,miny,maxx,maxy, i.e. longitude before latitude.
   */
  function url(layer, day, width = 1280, height = 640) {
    const q = [
      "SERVICE=WMS", "REQUEST=GetMap", "VERSION=1.1.1",
      `LAYERS=${encodeURIComponent(layer)}`,
      "STYLES=", "FORMAT=image/png", "TRANSPARENT=TRUE", "SRS=EPSG:4326",
      "BBOX=-180,-90,180,90", `WIDTH=${width}`, `HEIGHT=${height}`,
      `TIME=${day}`,
    ];
    return `${WMS}?${q.join("&")}`;
  }

  function isoDay(date) {
    return date.toISOString().slice(0, 10);
  }

  /**
   * A series of dates ending a few days back, newest last.
   * GIBS imagery lags real time by roughly a day, so the tail is held back
   * rather than asked for and returned empty.
   */
  function dates(count, stepDays = 1, lagDays = 4) {
    const out = [];
    const end = new Date();
    end.setUTCDate(end.getUTCDate() - lagDays);
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setUTCDate(d.getUTCDate() - i * stepDays);
      out.push(isoDay(d));
    }
    return out;
  }

  async function series(layer, count = 18, stepDays = 1, opts = {}) {
    const days = dates(count, stepDays, opts.lagDays ?? 4);
    const frames = days.map((day) => ({ src: url(layer, day, opts.width || 1280, opts.height || 640), date: day }));

    // Fail fast and loudly if the service is unreachable or the layer is not
    // valid, so the UI can say so instead of showing eighteen broken images.
    const probe = await fetch(frames[frames.length - 1].src, { mode: "cors" });
    if (!probe.ok) throw new Error(`GIBS returned ${probe.status} for ${layer}`);
    return frames;
  }

  return { url, dates, series, isoDay };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Gibs;
