/*
 * Frame analysis — the "needle" of the jukebox.
 *
 * Reads a rendered Earth frame pixel by pixel and returns numbers a musician
 * can act on. No DOM, no audio: pure arithmetic over a Uint8ClampedArray, so
 * the same code runs in the page and in a test harness.
 *
 * Two conventions matter and are used everywhere downstream:
 *   - every scalar is normalised to 0..1, so a mapping never needs to know the
 *     dynamic range of a particular product;
 *   - "no data" is marked as -1 in the luminance grid, so texture is measured
 *     only where the sensor actually saw something. Silence must mean silence,
 *     not an invented texture at the edge of the swath.
 */

const Analyze = (() => {
  const STEP = 2;            // sample stride; 1280x720 -> ~230k samples, ~8 ms
  const ALPHA_CUTOFF = 24;   // below this alpha the product has no data here
  const BAND_COUNT = 16;     // vertical columns: the melodic resolution
  const ROW_COUNT = 6;       // horizontal bands: drives voicing, not melody

  function rgbToHsl(r, g, b) {
    const rn = r / 255, gn = g / 255, bn = b / 255;
    const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
    const l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
      else if (max === gn) h = ((bn - rn) / d + 2) / 6;
      else h = ((rn - gn) / d + 4) / 6;
    }
    return [h * 360, s, l];
  }

  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  /**
   * @param {Uint8ClampedArray} px RGBA pixels
   * @param {number} width
   * @param {number} height
   * @param {{axis?: number[][]}} opts axis = [coolRGB, warmRGB] taken from the
   *        product's own published colour bar. That pair is what turns "average
   *        colour" into the physical quantity the record is about.
   */
  function analyzePixels(px, width, height, opts) {
    const axis = (opts && opts.axis) || [[30, 60, 140], [210, 70, 50]];
    const cols = Math.max(4, Math.floor(width / STEP));
    const rows = Math.max(4, Math.floor(height / STEP));

    const lum = new Float32Array(cols * rows);
    let count = 0, sumR = 0, sumG = 0, sumB = 0, sumL = 0, sumS = 0;
    let hueCos = 0, hueSin = 0, hueWeight = 0;
    let sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0;
    let bloom = 0, dark = 0;

    for (let row = 0; row < rows; row++) {
      const y = Math.min(height - 1, row * STEP);
      const rowBase = row * cols;
      for (let col = 0; col < cols; col++) {
        const x = Math.min(width - 1, col * STEP);
        const i = (y * width + x) * 4;
        const a = px[i + 3];
        if (a < ALPHA_CUTOFF) { lum[rowBase + col] = -1; continue; }
        const r = px[i], g = px[i + 1], b = px[i + 2];
        // Composite over black so a semi-transparent swath edge is not read as
        // a bright pixel.
        const af = a / 255;
        const rr = r * af, gg = g * af, bb = b * af;
        const L = (0.2126 * rr + 0.7152 * gg + 0.0722 * bb) / 255;
        lum[rowBase + col] = L;
        count++;
        sumR += rr; sumG += gg; sumB += bb; sumL += L;
        if (L > 0.78) bloom++;
        if (L < 0.06) dark++;

        const hsl = rgbToHsl(rr, gg, bb);
        const h = hsl[0], s = hsl[1];
        sumS += s;
        const w = s * (0.15 + L);
        const rad = (h * Math.PI) / 180;
        hueCos += Math.cos(rad) * w;
        hueSin += Math.sin(rad) * w;
        hueWeight += w;

        const rg = rr - gg;
        const yb = 0.5 * (rr + gg) - bb;
        sumRg += rg; sumYb += yb; sumRg2 += rg * rg; sumYb2 += yb * yb;
      }
    }

    const total = cols * rows;
    const coverage = count / total;
    if (count === 0) return emptyFrame(coverage, rows);

    const meanR = sumR / count, meanG = sumG / count, meanB = sumB / count;

    let hue = 0;
    if (hueWeight > 1e-6) {
      hue = Math.atan2(hueSin / hueWeight, hueCos / hueWeight) * (180 / Math.PI);
      if (hue < 0) hue += 360;
    }

    const meanRg = sumRg / count, meanYb = sumYb / count;
    const sdRg = Math.sqrt(Math.max(0, sumRg2 / count - meanRg * meanRg));
    const sdYb = Math.sqrt(Math.max(0, sumYb2 / count - meanYb * meanYb));
    const colorfulness = (Math.sqrt(sdRg * sdRg + sdYb * sdYb) + 0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb)) / 110;

    const cool = axis[0], warm = axis[1];
    const axR = warm[0] - cool[0], axG = warm[1] - cool[1], axB = warm[2] - cool[2];
    const axLen2 = axR * axR + axG * axG + axB * axB || 1;
    const warmth = clamp01(((meanR - cool[0]) * axR + (meanG - cool[1]) * axG + (meanB - cool[2]) * axB) / axLen2);

    // Pass 2: Sobel over the luminance grid. Texture, phrase, and where on the
    // globe the energy sits.
    const bands = new Float32Array(BAND_COUNT);
    const rowBands = new Float32Array(ROW_COUNT);
    let edgeSum = 0, edgeCount = 0, edgeStrong = 0;
    let cxAcc = 0, cyAcc = 0;

    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const idx = row * cols + col;
        const c = lum[idx];
        const l = lum[idx - 1], r = lum[idx + 1];
        const u = lum[idx - cols], d = lum[idx + cols];
        const ul = lum[idx - cols - 1], ur = lum[idx - cols + 1];
        const dl = lum[idx + cols - 1], dr = lum[idx + cols + 1];
        if (c < 0 || l < 0 || r < 0 || u < 0 || d < 0 || ul < 0 || ur < 0 || dl < 0 || dr < 0) continue;

        const gx = (ur + 2 * r + dr) - (ul + 2 * l + dl);
        const gy = (dl + 2 * d + dr) - (ul + 2 * u + ur);
        const mag = Math.sqrt(gx * gx + gy * gy) / 4;
        edgeSum += mag;
        edgeCount++;
        if (mag > 0.14) edgeStrong++;
        cxAcc += mag * (col / (cols - 1));
        cyAcc += mag * (row / (rows - 1));

        const b = Math.min(BAND_COUNT - 1, Math.floor((col / cols) * BAND_COUNT));
        bands[b] += mag;
        const rb = Math.min(ROW_COUNT - 1, Math.floor((row / rows) * ROW_COUNT));
        rowBands[rb] += mag;
      }
    }

    const edgeMean = edgeCount ? edgeSum / edgeCount : 0;
    const edge = clamp01(
      0.35 * clamp01((edgeCount ? edgeStrong / edgeCount : 0) * 2.4) +
      0.65 * clamp01(edgeMean / 0.18)
    );
    const centroidX = edgeSum > 1e-6 ? cxAcc / edgeSum : 0.5;
    const centroidY = edgeSum > 1e-6 ? cyAcc / edgeSum : 0.5;

    // Normalise both grids twice. `rel` keeps each frame's own shape (the
    // melodic contour), `abs` is measured against a fixed gradient scale so a
    // frame with no real texture reports no notes instead of a full phrase.
    const bandStats = normaliseGrid(bands, Math.max(1, edgeCount / BAND_COUNT));
    const rowStats = normaliseGrid(rowBands, Math.max(1, edgeCount / ROW_COUNT));

    return {
      coverage,
      luma: sumL / count,
      sat: sumS / count,
      hue,
      warmth,
      colorfulness: clamp01(colorfulness),
      edge,
      edgeMean,
      bands: bandStats.rel,
      bandsAbs: bandStats.abs,
      rows: rowStats.rel,
      rowsAbs: rowStats.abs,
      centroidX,
      centroidY,
      bloom: clamp01((bloom / count) * 6),
      dark: clamp01(dark / count),
      meanRgb: [meanR, meanG, meanB],
    };
  }

  const ABS_TEXTURE = 0.22;   // gradient magnitude that counts as "fully textured"

  function normaliseGrid(grid, divisor) {
    let max = 0;
    for (let i = 0; i < grid.length; i++) {
      grid[i] /= divisor;
      if (grid[i] > max) max = grid[i];
    }
    const rel = new Array(grid.length);
    const abs = new Array(grid.length);
    for (let i = 0; i < grid.length; i++) {
      rel[i] = max > 1e-6 ? clamp01(grid[i] / max) : 0;
      abs[i] = clamp01(grid[i] / ABS_TEXTURE);
    }
    return { rel, abs };
  }

  function emptyFrame(coverage, rows) {
    return {
      coverage, luma: 0, sat: 0, hue: 0, warmth: 0.5, colorfulness: 0,
      edge: 0, edgeMean: 0,
      bands: new Array(BAND_COUNT).fill(0),
      bandsAbs: new Array(BAND_COUNT).fill(0),
      rows: new Array(ROW_COUNT).fill(0),
      rowsAbs: new Array(ROW_COUNT).fill(0),
      centroidX: 0.5, centroidY: 0.5,
      bloom: 0, dark: 1,
      meanRgb: [0, 0, 0],
      empty: true,
    };
  }

  /** Browser helper: draw an image into a scratch canvas and measure it. */
  function analyzeImage(img, opts) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("canvas 2D context unavailable");
    ctx.drawImage(img, 0, 0);
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      // A cross-origin image without CORS headers taints the canvas; surface it
      // as a real error rather than as a silent zero frame.
      throw new Error("frame is not readable (cross-origin without CORS)");
    }
    return analyzePixels(data, w, h, opts);
  }

  /**
   * Frame-to-frame change in 0..1. This is what makes tempo data-driven: a
   * planet that is visibly rearranging earns a faster pulse.
   */
  function changeBetween(prev, next) {
    if (!prev || prev.empty || next.empty) return 0;
    const dLuma = Math.abs((next.luma || 0) - (prev.luma || 0));
    const dEdge = Math.abs((next.edge || 0) - (prev.edge || 0));
    const dWarmth = Math.abs((next.warmth || 0) - (prev.warmth || 0));
    const dBloom = Math.abs((next.bloom || 0) - (prev.bloom || 0));
    const dHue = Math.abs((((next.hue || 0) - (prev.hue || 0) + 540) % 360) - 180) / 360;
    return clamp01(dLuma * 5 + dEdge * 3 + dWarmth * 1.5 + dBloom * 2 + dHue * 0.6);
  }

  return { analyzePixels, analyzeImage, changeBetween, rgbToHsl, BAND_COUNT, ROW_COUNT };
})();

if (typeof module !== "undefined" && module.exports) module.exports = Analyze;
