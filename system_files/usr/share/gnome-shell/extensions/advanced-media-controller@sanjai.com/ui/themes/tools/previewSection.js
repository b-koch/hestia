import Gdk from "gi://Gdk";
import GLib from "gi://GLib";

import {
  buildPreviewArea,
  roundedRectCr,
  GifPlayer,
} from "../helpers/previewHelpers.js";
import {
  PREVIEW_W,
  PREVIEW_H,
  PREVIEW_MARGIN,
  THUMB_SIZE,
  TAU,
} from "../constants.js";

const TRACK_HEIGHT = 4;

export function buildPreview(
  themeEngine,
  getUseNativeSlider,
  getCurrentColor,
  getUseSystemColor,
  cleanups,
) {
  let ratio = 0.48;
  let offset = 0;
  let gif = null;
  let failedThemeId = null;

  const area = buildPreviewArea(PREVIEW_W, PREVIEW_H);

  const drawNative = (cr, W, H) => {
    const trough = area.get_color();
    const fill = new Gdk.RGBA({
      red: 0.208,
      green: 0.518,
      blue: 0.894,
      alpha: 1,
    });
    if (!getUseSystemColor()) fill.parse(getCurrentColor());

    const trackW = W - PREVIEW_MARGIN * 2;
    const trackY = H / 2;
    const top = trackY - TRACK_HEIGHT / 2;
    const fillEnd = PREVIEW_MARGIN + ratio * trackW;
    const radius = TRACK_HEIGHT / 2;

    cr.setSourceRGBA(trough.red, trough.green, trough.blue, 0.15);
    roundedRectCr(cr, PREVIEW_MARGIN, top, trackW, TRACK_HEIGHT, radius);
    cr.fill();

    cr.setSourceRGBA(fill.red, fill.green, fill.blue, 1);
    roundedRectCr(
      cr,
      PREVIEW_MARGIN,
      top,
      Math.max(TRACK_HEIGHT, fillEnd - PREVIEW_MARGIN),
      TRACK_HEIGHT,
      radius,
    );
    cr.fill();

    cr.arc(fillEnd, trackY, 7, 0, TAU);
    cr.fill();
    cr.setSourceRGBA(1, 1, 1, 0.4);
    cr.setLineWidth(1.5);
    cr.arc(fillEnd, trackY, 6.25, 0, TAU);
    cr.stroke();
  };

  const drawThemed = (cr, W, H) => {
    const theme = themeEngine.getActiveTheme();
    if (!theme) return;

    const trackW = W - PREVIEW_MARGIN * 2;
    const trackY = H / 2;
    const fillEnd = PREVIEW_MARGIN + ratio * trackW;

    try {
      theme.drawTrack({
        cr,
        W,
        H,
        ratio,
        offset,
        isPlaying: true,
        trackY,
        margin: PREVIEW_MARGIN,
        trackW,
        fillEnd,
        fillStart: PREVIEW_MARGIN,
      });

      if (typeof theme.drawThumb === "function") {
        const size = THUMB_SIZE;
        cr.save();
        cr.translate(fillEnd - size / 2, trackY - size / 2);
        theme.drawThumb({
          cr,
          size,
          ratio,
          offset,
          isPlaying: true,
          cx: size / 2,
          cy: size / 2,
          r: size / 2 - 1,
          pixbuf: gif?.pixbuf ?? null,
        });
        cr.restore();
      }
    } catch (e) {
      if (failedThemeId !== theme.id) {
        failedThemeId = theme.id;
        console.error(`Theme "${theme.id}" failed to draw: ${e.message}`);
      }
    }
  };

  area.set_draw_func((_area, cr, W, H) => {
    cr.save();
    if (getUseNativeSlider()) drawNative(cr, W, H);
    else drawThemed(cr, W, H);
    cr.restore();
  });

  const timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
    offset = (offset + 2) % 10000;
    area.queue_draw();
    return GLib.SOURCE_CONTINUE;
  });
  cleanups.push(() => GLib.source_remove(timer));

  return {
    previewArea: area,
    setPreviewRatio: (v) => {
      ratio = Math.min(1, Math.max(0, v));
    },
    setPreviewGif: (path) => {
      gif = path ? new GifPlayer(path, THUMB_SIZE) : null;
    },
    getPreviewGifPixbuf: () => gif?.pixbuf ?? null,
  };
}
