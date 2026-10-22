import Cairo from "gi://cairo";
import { setSourcePixbuf } from "./pixbufSurface.js";

const _sin = Math.sin;
const _cos = Math.cos;
const _PI = Math.PI;
const _TAU = _PI * 2;

const TRACK_H = 4;
const RADIUS = TRACK_H / 2;

function _roundedRect(cr, x, y, w, h, r) {
  cr.newPath();
  cr.arc(x + r, y + r, r, _PI, (3 * _PI) / 2);
  cr.arc(x + w - r, y + r, r, (3 * _PI) / 2, 0);
  cr.arc(x + w - r, y + h - r, r, 0, _PI / 2);
  cr.arc(x + r, y + h - r, r, _PI / 2, _PI);
  cr.closePath();
}

function drawPixbufThumb(cr, cx, cy, r, pixbuf) {
  cr.save();
  cr.arc(cx, cy, r, 0, _TAU);
  cr.clip();
  setSourcePixbuf(cr, pixbuf, 0, 0);
  cr.paint();
  cr.restore();
}

export const BUILTIN_THEMES = [
  {
    id: "default",
    label: "Default",
    author: "Built-in",
    version: "1.0",

    drawTrack(ctx) {
      const { cr, margin, trackY, trackW, fillEnd, ratio } = ctx;
      const th = TRACK_H;
      const r = RADIUS;
      const ty = trackY - th / 2;

      cr.save();
      cr.setSourceRGBA(1, 1, 1, 0.15);
      _roundedRect(cr, margin, ty, trackW, th, r);
      cr.fill();

      if (ratio > 0) {
        const fillW = Math.max(th, fillEnd - margin);
        const g = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
        g.addColorStopRGBA(0, 0.208, 0.518, 0.894, 1);
        g.addColorStopRGBA(1, 0.4, 0.7, 1.0, 1);
        cr.setSource(g);
        _roundedRect(cr, margin, ty, fillW, th, r);
        cr.fill();
      }
      cr.restore();
    },

    drawThumb(ctx) {
      const { cr, cx, cy, r, pixbuf } = ctx;
      if (pixbuf) {
        drawPixbufThumb(cr, cx, cy, r, pixbuf);
        return;
      }
      cr.save();
      const bg = new Cairo.RadialGradient(
        cx - r * 0.3,
        cy - r * 0.3,
        0,
        cx,
        cy,
        r,
      );
      bg.addColorStopRGBA(0, 0.55, 0.78, 1.0, 1);
      bg.addColorStopRGBA(1, 0.208, 0.518, 0.894, 1);
      cr.setSource(bg);
      cr.arc(cx, cy, r, 0, _TAU);
      cr.fill();
      cr.setSourceRGBA(1, 1, 1, 0.35);
      cr.setLineWidth(1.5);
      cr.arc(cx, cy, r - 0.75, 0, _TAU);
      cr.stroke();
      cr.restore();
    },
  },

  {
    id: "zenitsu",
    label: "Zenitsu Thunder",
    author: "Built-in",
    version: "1.0",

    drawTrack(ctx) {
      const { cr, margin, trackY, trackW, fillEnd, offset, ratio } = ctx;
      const pulse = _sin(offset * 0.18) * 0.5 + 0.5;
      const pulse2 = _sin(offset * 0.11 + 1.2) * 0.5 + 0.5;
      const th = TRACK_H + pulse * 2;
      const r = th / 2;
      const ty = trackY - th / 2;

      cr.save();
      cr.setSourceRGBA(0.05, 0.04, 0.0, 0.7);
      _roundedRect(cr, margin, ty, trackW, th, r);
      cr.fill();

      if (ratio > 0) {
        const fillW = Math.max(th, fillEnd - margin);
        const outerGlow = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
        outerGlow.addColorStopRGBA(0.0, 0.6, 0.45, 0.0, 0.0);
        outerGlow.addColorStopRGBA(0.15, 0.9, 0.7, 0.0, 0.5);
        outerGlow.addColorStopRGBA(0.5, 1.0, 0.82, 0.0, 0.8);
        outerGlow.addColorStopRGBA(0.85, 0.9, 0.55, 0.0, 0.9);
        outerGlow.addColorStopRGBA(1.0, 1.0, 0.9, 0.1, 1.0);
        cr.setSource(outerGlow);
        _roundedRect(cr, margin, ty, fillW, th, r);
        cr.fill();

        const coreGrad = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
        coreGrad.addColorStopRGBA(0.0, 1.0, 0.95, 0.6, 0.6);
        coreGrad.addColorStopRGBA(0.5, 1.0, 1.0, 0.9, 0.9);
        coreGrad.addColorStopRGBA(1.0, 1.0, 1.0, 1.0, 1.0);
        cr.setSource(coreGrad);
        _roundedRect(cr, margin, ty + th * 0.3, fillW, th * 0.4, th * 0.2);
        cr.fill();

        const STRIPE = 14;
        const sPhase = offset % (STRIPE * 2);
        cr.save();
        _roundedRect(cr, margin, ty, fillW, th, r);
        cr.clip();
        for (
          let sx = margin - sPhase;
          sx < fillEnd + STRIPE;
          sx += STRIPE * 2
        ) {
          cr.setSourceRGBA(0.05, 0.02, 0.0, 0.18 + 0.1 * pulse);
          cr.moveTo(sx, ty);
          cr.lineTo(sx + STRIPE * 0.6, ty);
          cr.lineTo(sx + STRIPE * 0.6 - 3, ty + th);
          cr.lineTo(sx - 3, ty + th);
          cr.closePath();
          cr.fill();
        }
        cr.restore();

        for (const seed of [0, 1, 2]) {
          const boltPhase = (offset + seed * 23) % 60;
          if (boltPhase > 30) continue;
          const ba =
            boltPhase < 5
              ? boltPhase / 5
              : boltPhase < 20
                ? 1.0
                : (30 - boltPhase) / 10;
          if (ba <= 0) continue;
          const rng = (n) =>
            _sin(seed * 17.3 + n * 5.7 + Math.floor(offset / 30) * 3.1) * 0.5 +
            0.5;
          const bx = margin + rng(0) * (fillEnd - margin - 20) + 10;
          if (bx > fillEnd - 4 || bx < margin + 4) continue;
          const bh = 10 + rng(1) * 8;
          const bmid = trackY - bh * 0.3 + rng(2) * bh * 0.3;
          const boff = -3 + rng(3) * 6;
          cr.save();
          cr.setLineWidth(1.2 + pulse * 0.6);
          cr.setLineCap(Cairo.LineCap.ROUND);
          cr.setLineJoin(Cairo.LineJoin.ROUND);
          cr.setSourceRGBA(1.0, 1.0, 0.5, ba * 0.55);
          cr.moveTo(bx + 2, trackY - bh);
          cr.lineTo(bx + boff, bmid);
          cr.lineTo(bx + 3 + boff, bmid);
          cr.lineTo(bx + 1, trackY + bh * 0.7);
          cr.stroke();
          cr.setLineWidth(0.6);
          cr.setSourceRGBA(1.0, 1.0, 1.0, ba * 0.8);
          cr.moveTo(bx + 2, trackY - bh);
          cr.lineTo(bx + boff, bmid);
          cr.lineTo(bx + 3 + boff, bmid);
          cr.lineTo(bx + 1, trackY + bh * 0.7);
          cr.stroke();
          cr.restore();
        }

        if (ratio > 0.02) {
          const auraR = 10 + pulse * 5;
          const auraGrad = new Cairo.RadialGradient(
            fillEnd,
            trackY,
            0,
            fillEnd,
            trackY,
            auraR + 8,
          );
          auraGrad.addColorStopRGBA(0.0, 1.0, 1.0, 0.8, 0.95);
          auraGrad.addColorStopRGBA(0.25, 1.0, 0.88, 0.0, 0.7 + pulse * 0.2);
          auraGrad.addColorStopRGBA(0.6, 1.0, 0.65, 0.0, 0.3);
          auraGrad.addColorStopRGBA(1.0, 1.0, 0.5, 0.0, 0.0);
          cr.setSource(auraGrad);
          cr.arc(fillEnd, trackY, auraR + 8, 0, _TAU);
          cr.fill();

          for (let i = 0; i < 6; i++) {
            const st = (offset * 0.12 + i * ((_PI * 2) / 6)) % _TAU;
            const sparkR = 6 + pulse2 * 8 + i * 1.5;
            const sparkAngle = st + i * 1.05;
            const sx2 = fillEnd + _cos(sparkAngle) * sparkR;
            const sy2 = trackY + _sin(sparkAngle) * sparkR * 0.5;
            cr.save();
            cr.setLineWidth(1.0);
            cr.setLineCap(Cairo.LineCap.ROUND);
            cr.setSourceRGBA(
              1.0,
              0.95,
              0.3,
              0.4 + 0.55 * Math.abs(_sin(st + i)),
            );
            cr.moveTo(sx2, sy2);
            cr.lineTo(
              sx2 + _cos(sparkAngle + 0.5) * (2.5 + pulse * 2),
              sy2 + _sin(sparkAngle + 0.5) * (2.5 + pulse * 2) * 0.5,
            );
            cr.stroke();
            cr.restore();
          }
        }
      }
      cr.restore();
    },

    drawThumb(ctx) {
      const { cr, cx, cy, r, offset, pixbuf } = ctx;
      if (pixbuf) {
        drawPixbufThumb(cr, cx, cy, r, pixbuf);
        return;
      }
      const pulse = _sin(offset * 0.18) * 0.5 + 0.5;
      cr.save();
      const glowR = new Cairo.RadialGradient(
        cx,
        cy,
        r * 0.3,
        cx,
        cy,
        r + 6 + pulse * 4,
      );
      glowR.addColorStopRGBA(0, 1.0, 0.95, 0.3, 0.9);
      glowR.addColorStopRGBA(0.5, 1.0, 0.75, 0.0, 0.5);
      glowR.addColorStopRGBA(1, 1.0, 0.6, 0.0, 0.0);
      cr.setSource(glowR);
      cr.arc(cx, cy, r + 6 + pulse * 4, 0, _TAU);
      cr.fill();
      const bg = new Cairo.RadialGradient(
        cx - r * 0.25,
        cy - r * 0.25,
        0,
        cx,
        cy,
        r,
      );
      bg.addColorStopRGBA(0, 1.0, 0.98, 0.6, 1);
      bg.addColorStopRGBA(0.6, 1.0, 0.82, 0.0, 1);
      bg.addColorStopRGBA(1, 0.8, 0.55, 0.0, 1);
      cr.setSource(bg);
      cr.arc(cx, cy, r, 0, _TAU);
      cr.fill();
      cr.setSourceRGBA(1, 1, 0.6, 0.5);
      cr.setLineWidth(1.5);
      cr.arc(cx, cy, r - 0.75, 0, _TAU);
      cr.stroke();
      const boltH = r * 0.65;
      cr.setSourceRGBA(0.05, 0.02, 0.0, 0.7);
      cr.setLineWidth(2);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setLineJoin(Cairo.LineJoin.ROUND);
      cr.moveTo(cx + 2, cy - boltH);
      cr.lineTo(cx - 2, cy - 1);
      cr.lineTo(cx + 3, cy - 1);
      cr.lineTo(cx + 1, cy + boltH);
      cr.stroke();
      cr.setSourceRGBA(1, 1, 0.9, 0.9);
      cr.setLineWidth(1.2);
      cr.moveTo(cx + 2, cy - boltH);
      cr.lineTo(cx - 2, cy - 1);
      cr.lineTo(cx + 3, cy - 1);
      cr.lineTo(cx + 1, cy + boltH);
      cr.stroke();
      cr.restore();
    },
  },

  {
    id: "sonic",
    label: "Sonic Speed",
    author: "Built-in",
    version: "1.0",

    drawTrack(ctx) {
      const { cr, margin, trackY, trackW, fillEnd, offset, ratio } = ctx;
      const th = TRACK_H;
      const r = RADIUS;
      const ty = trackY - th / 2;

      cr.save();
      cr.setSourceRGBA(0.15, 0.15, 0.15, 0.3);
      _roundedRect(cr, margin, ty, trackW, th, r);
      cr.fill();

      if (ratio > 0) {
        const fillW = Math.max(th, fillEnd - margin);
        const speedGrad = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
        speedGrad.addColorStopRGBA(0.0, 0.0, 0.3, 1.0, 1.0);
        speedGrad.addColorStopRGBA(0.5, 0.15, 0.55, 1.0, 1.0);
        speedGrad.addColorStopRGBA(1.0, 0.8, 0.9, 1.0, 1.0);
        cr.setSource(speedGrad);
        _roundedRect(cr, margin, ty, fillW, th, r);
        cr.fill();

        const TOTAL = 28;
        const phase = offset % TOTAL;
        for (let i = 0; i < 6; i++) {
          const baseX = fillEnd - 10 - i * 12 - phase * 0.5;
          if (baseX < margin || baseX > fillEnd) continue;
          const alpha = (1.0 - i / 6) * 0.7;
          cr.setSourceRGBA(0.6, 0.8, 1.0, alpha);
          cr.setLineWidth(Math.max(1, 3 - i * 0.4));
          cr.setLineCap(Cairo.LineCap.ROUND);
          cr.moveTo(baseX - 11, trackY - i * 0.3);
          cr.lineTo(baseX, trackY - i * 0.3);
          cr.stroke();
          if (i > 0) {
            cr.moveTo(baseX - 7, trackY + i * 0.3);
            cr.lineTo(baseX, trackY + i * 0.3);
            cr.stroke();
          }
        }
      }
      cr.restore();
    },

    drawThumb(ctx) {
      const { cr, cx, cy, r, offset, pixbuf } = ctx;
      if (pixbuf) {
        drawPixbufThumb(cr, cx, cy, r, pixbuf);
        return;
      }
      cr.save();
      const bg = new Cairo.RadialGradient(
        cx - r * 0.3,
        cy - r * 0.35,
        0,
        cx,
        cy,
        r,
      );
      bg.addColorStopRGBA(0, 0.45, 0.72, 1.0, 1);
      bg.addColorStopRGBA(0.6, 0.0, 0.38, 0.85, 1);
      bg.addColorStopRGBA(1, 0.0, 0.2, 0.6, 1);
      cr.setSource(bg);
      cr.arc(cx, cy, r, 0, _TAU);
      cr.fill();
      cr.setSourceRGBA(0.8, 0.9, 1.0, 0.4);
      cr.setLineWidth(1.5);
      cr.arc(cx, cy, r - 0.75, 0, _TAU);
      cr.stroke();
      for (let i = 0; i < 3; i++) {
        const lx = cx + r * 0.55 - i * r * 0.22;
        const alpha = (1 - i * 0.3) * 0.7;
        cr.setSourceRGBA(0.85, 0.95, 1.0, alpha);
        cr.setLineWidth(1.5 - i * 0.35);
        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.moveTo(lx, cy - r * 0.3 - i * 1.5);
        cr.lineTo(lx - r * 0.5, cy - r * 0.3 - i * 1.5);
        cr.stroke();
      }
      cr.restore();
    },
  },

  {
    id: "nyancat",
    label: "Nyan Cat",
    author: "Built-in",
    version: "1.0",

    drawTrack(ctx) {
      const { cr, margin, trackY, trackW, fillEnd, offset, ratio } = ctx;
      const RAINBOW = [
        [1.0, 0.0, 0.0],
        [1.0, 0.5, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 0.85, 0.0],
        [0.0, 0.45, 1.0],
        [0.55, 0.0, 0.85],
      ];
      const BAND_H = 3;
      const totalH = RAINBOW.length * BAND_H;
      const startY = trackY - totalH / 2;

      cr.save();

      for (let i = 0; i < RAINBOW.length; i++) {
        const [rr, g, b] = RAINBOW[i];
        const y = startY + i * BAND_H + BAND_H / 2;
        const bR = BAND_H / 2;

        _roundedRect(cr, margin, startY + i * BAND_H, trackW, BAND_H, bR);
        cr.setSourceRGBA(rr * 0.2, g * 0.2, b * 0.2, 0.2);
        cr.fill();

        if (ratio > 0 && fillEnd > margin + 2) {
          const fillW = Math.max(BAND_H, fillEnd - margin);
          cr.save();
          _roundedRect(cr, margin, startY, fillW, totalH, BAND_H / 2);
          cr.clip();
          cr.setSourceRGBA(rr, g, b, 0.95);
          cr.setLineWidth(BAND_H);
          cr.setLineCap(Cairo.LineCap.ROUND);
          const steps = Math.ceil(fillEnd - margin);
          let first = true;
          for (let px = 0; px <= steps; px++) {
            const wx = margin + px;
            const wy =
              y + _sin(((px + offset * 1.5 + i * 7) / 40) * _PI * 2) * 0.6;
            if (first) {
              cr.moveTo(wx, wy);
              first = false;
            } else cr.lineTo(wx, wy);
          }
          cr.stroke();
          cr.restore();
        }
      }

      const STAR_PHASE = offset * 0.1;
      for (const sp of [0.15, 0.35, 0.55, 0.7, 0.85]) {
        const sx = margin + sp * trackW;
        if (sx > fillEnd) continue;
        const sy = trackY + _sin(STAR_PHASE + sp * 6) * 8;
        cr.setSourceRGBA(
          1,
          1,
          1,
          0.4 + 0.4 * Math.abs(_sin(STAR_PHASE + sp * 3)),
        );
        cr.arc(sx, sy, 1.2, 0, _TAU);
        cr.fill();
      }
      cr.restore();
    },

    drawThumb(ctx) {
      const { cr, cx, cy, r, offset, pixbuf } = ctx;
      if (pixbuf) {
        drawPixbufThumb(cr, cx, cy, r, pixbuf);
        return;
      }
      cr.save();
      const RAINBOW = [
        [1.0, 0.0, 0.0],
        [1.0, 0.5, 0.0],
        [1.0, 1.0, 0.0],
        [0.0, 0.85, 0.0],
        [0.0, 0.45, 1.0],
        [0.55, 0.0, 0.85],
      ];
      for (let i = 0; i < RAINBOW.length; i++) {
        const [rr, g, b] = RAINBOW[i];
        const a0 = (i / RAINBOW.length) * _TAU + offset * 0.06;
        const a1 = ((i + 1) / RAINBOW.length) * _TAU + offset * 0.06;
        cr.setSourceRGBA(rr, g, b, 1.0);
        cr.moveTo(cx, cy);
        cr.arc(cx, cy, r, a0, a1);
        cr.closePath();
        cr.fill();
      }
      cr.setSourceRGBA(1, 1, 1, 0.9);
      cr.arc(cx, cy, r * 0.4, 0, _TAU);
      cr.fill();
      cr.setSourceRGBA(0.9, 0.5, 0.75, 1);
      cr.arc(cx, cy, r * 0.22, 0, _TAU);
      cr.fill();
      cr.restore();
    },
  },

  {
    id: "plasma",
    label: "Plasma Wave",
    author: "Built-in",
    version: "1.0",

    drawTrack(ctx) {
      const { cr, margin, trackY, trackW, fillEnd, offset, ratio } = ctx;
      const th = TRACK_H;
      const r = RADIUS;
      const ty = trackY - th / 2;

      cr.save();
      cr.setSourceRGBA(0.05, 0.0, 0.15, 0.5);
      _roundedRect(cr, margin, ty, trackW, th, r);
      cr.fill();

      if (ratio > 0) {
        const fillW = Math.max(th, fillEnd - margin);
        const t = offset * 0.04;
        const g = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
        g.addColorStopRGBA(0.0, _sin(t) * 0.5 + 0.5, 0.0, 1.0, 1.0);
        g.addColorStopRGBA(0.33, 0.5, _sin(t + 2) * 0.5 + 0.5, 1.0, 1.0);
        g.addColorStopRGBA(0.66, 1.0, 0.0, _sin(t + 4) * 0.5 + 0.5, 1.0);
        g.addColorStopRGBA(1.0, _sin(t + 6) * 0.5 + 0.5, 0.0, 1.0, 1.0);

        cr.save();
        _roundedRect(cr, margin, ty, fillW, th, r);
        cr.clip();
        cr.setSource(g);
        cr.setLineWidth(th);
        cr.setLineCap(Cairo.LineCap.ROUND);
        let first = true;
        for (let px = 0; px <= fillEnd - margin; px++) {
          const wx = margin + px;
          const wy = trackY + _sin(px * 0.08 + offset * 0.2) * (th * 0.4);
          if (first) {
            cr.moveTo(wx, wy);
            first = false;
          } else cr.lineTo(wx, wy);
        }
        cr.stroke();
        cr.restore();

        const glow = new Cairo.RadialGradient(
          fillEnd,
          trackY,
          0,
          fillEnd,
          trackY,
          16,
        );
        glow.addColorStopRGBA(0, 0.8, 0.4, 1.0, 0.9);
        glow.addColorStopRGBA(0.5, 0.5, 0.0, 1.0, 0.4);
        glow.addColorStopRGBA(1, 0.3, 0.0, 0.8, 0.0);
        cr.setSource(glow);
        cr.arc(fillEnd, trackY, 16, 0, _TAU);
        cr.fill();
      }
      cr.restore();
    },

    drawThumb(ctx) {
      const { cr, cx, cy, r, offset } = ctx;
      cr.save();
      const t = offset * 0.04;
      const glowR = new Cairo.RadialGradient(cx, cy, 0, cx, cy, r + 8);
      glowR.addColorStopRGBA(0, _sin(t) * 0.5 + 0.5, 0.2, 1.0, 1.0);
      glowR.addColorStopRGBA(0.5, 0.6, 0.0, 1.0, 0.5);
      glowR.addColorStopRGBA(1, 0.3, 0.0, 0.8, 0.0);
      cr.setSource(glowR);
      cr.arc(cx, cy, r + 8, 0, _TAU);
      cr.fill();
      const bg = new Cairo.RadialGradient(cx, cy, 0, cx, cy, r);
      bg.addColorStopRGBA(0, 0.9, 0.5, 1.0, 1.0);
      bg.addColorStopRGBA(0.5, 0.5, 0.0, 1.0, 1.0);
      bg.addColorStopRGBA(1, 0.2, 0.0, 0.7, 1.0);
      cr.setSource(bg);
      cr.arc(cx, cy, r, 0, _TAU);
      cr.fill();
      for (let ring = 0; ring < 3; ring++) {
        cr.setSourceRGBA(1.0, 0.6, 1.0, 0.4 - ring * 0.1);
        cr.setLineWidth(1.2 - ring * 0.3);
        cr.arc(cx, cy, r * (0.35 + ring * 0.22), 0, _TAU);
        cr.stroke();
      }
      cr.restore();
    },
  },

  {
    id: "fire",
    label: "Fire",
    author: "Built-in",
    version: "1.0",

    drawTrack(ctx) {
      const { cr, margin, trackY, trackW, fillEnd, offset, ratio } = ctx;
      const th = TRACK_H;
      const r = RADIUS;
      const ty = trackY - th / 2;

      cr.save();
      cr.setSourceRGBA(0.1, 0.05, 0.0, 0.5);
      _roundedRect(cr, margin, ty, trackW, th, r);
      cr.fill();

      if (ratio > 0) {
        const fillW = Math.max(th, fillEnd - margin);
        const g = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
        g.addColorStopRGBA(0.0, 0.6, 0.05, 0.0, 1.0);
        g.addColorStopRGBA(0.4, 1.0, 0.25, 0.0, 1.0);
        g.addColorStopRGBA(0.75, 1.0, 0.65, 0.0, 1.0);
        g.addColorStopRGBA(1.0, 1.0, 0.95, 0.4, 1.0);
        cr.setSource(g);
        _roundedRect(cr, margin, ty, fillW, th, r);
        cr.fill();

        const embLen = Math.min(fillEnd - margin, 60);
        for (let i = 0; i < 8; i++) {
          const phase = (offset * 0.15 + i * 0.77) % _TAU;
          const ex = fillEnd - 4 - i * (embLen / 8);
          const ey = trackY + _sin(phase) * (2 + i * 0.3);
          const ea = (1 - i / 8) * 0.7;
          cr.setSourceRGBA(1.0, 0.6 + _sin(phase) * 0.2, 0.0, ea);
          cr.arc(ex, ey, 1.5 - i * 0.12, 0, _TAU);
          cr.fill();
        }

        const glowFire = new Cairo.RadialGradient(
          fillEnd,
          trackY,
          0,
          fillEnd,
          trackY,
          14,
        );
        glowFire.addColorStopRGBA(0, 1.0, 0.9, 0.4, 1.0);
        glowFire.addColorStopRGBA(0.4, 1.0, 0.4, 0.0, 0.6);
        glowFire.addColorStopRGBA(1, 0.8, 0.1, 0.0, 0.0);
        cr.setSource(glowFire);
        cr.arc(fillEnd, trackY, 14, 0, _TAU);
        cr.fill();
      }
      cr.restore();
    },

    drawThumb(ctx) {
      const { cr, cx, cy, r, offset } = ctx;
      cr.save();
      const pulse = _sin(offset * 0.22) * 0.5 + 0.5;
      const outerGlow = new Cairo.RadialGradient(
        cx,
        cy,
        0,
        cx,
        cy,
        r + 10 + pulse * 5,
      );
      outerGlow.addColorStopRGBA(0, 1.0, 0.8, 0.2, 0.9);
      outerGlow.addColorStopRGBA(0.4, 1.0, 0.35, 0.0, 0.5);
      outerGlow.addColorStopRGBA(1, 0.6, 0.0, 0.0, 0.0);
      cr.setSource(outerGlow);
      cr.arc(cx, cy, r + 10 + pulse * 5, 0, _TAU);
      cr.fill();
      const bg = new Cairo.RadialGradient(
        cx - r * 0.2,
        cy - r * 0.3,
        0,
        cx,
        cy,
        r,
      );
      bg.addColorStopRGBA(0, 1.0, 0.95, 0.5, 1.0);
      bg.addColorStopRGBA(0.4, 1.0, 0.5, 0.0, 1.0);
      bg.addColorStopRGBA(1, 0.7, 0.05, 0.0, 1.0);
      cr.setSource(bg);
      cr.arc(cx, cy, r, 0, _TAU);
      cr.fill();
      cr.setSourceRGBA(1.0, 0.7, 0.0, 0.3);
      cr.setLineWidth(1.5);
      cr.arc(cx, cy, r - 0.75, 0, _TAU);
      cr.stroke();
      cr.restore();
    },
  },
];