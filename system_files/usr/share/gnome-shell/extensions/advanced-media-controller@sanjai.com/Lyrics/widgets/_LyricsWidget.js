import GObject from "gi://GObject";
import St from "gi://St";
import PangoCairo from "gi://PangoCairo";
import Pango from "gi://Pango";
import GLib from "gi://GLib";
import Gio from "gi://Gio";
import Clutter from "gi://Clutter";
import Cairo from "cairo";
import { playerConstant } from "../../utils/ui/playerConstant.js";

const SCROLL_EASING_MS = 240; // snappy but smooth
const NEIGHBOR_RANGE = 1;
const COLOR_SCHEME_KEY = "color-scheme";

// ~60 fps for both loading anim and scroll easing
const ANIM_TICK_MS = 16;
// Fade duration when switching states
const FADE_MS = 150;

//  Font metrics
function _metricsForWidth(w) {
  const scale = Math.max(0.7, w / 340);
  return {
    activeSize: Math.round(20 * scale),
    neighborSize: Math.round(14 * scale),
    inactiveSize: Math.round(12 * scale),
    lineSpacing: Math.round(16 * scale),
    paddingX: Math.round(24 * scale),
  };
}

// Easing helpers
function _easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}
function _easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}
function _easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

//  LyricsWidget
export const LyricsWidget = GObject.registerClass(
  {
    GTypeName: "LyricsWidget",
    Signals: { dismiss: {} },
  },
  class LyricsWidget extends St.Widget {
    _init(width = 340, height = 340, settings = null) {
      super._init({
        style_class: "lyrics-widget",
        reactive: false,
        can_focus: false,
        width,
        height,
        layout_manager: new Clutter.FixedLayout(),
        offscreen_redirect: Clutter.OffscreenRedirect.AUTOMATIC_FOR_OPACITY,
      });

      this._width = width;
      this._height = height;
      this._settings = settings;
      this._widthChangedId = 0;

      this._canvas = new St.DrawingArea({
        style: "padding:0;margin:0;",
        reactive: false,
        can_focus: false,
        x: 0,
        y: 0,
        width,
        height,
      });
      this._canvas.connectObject("repaint", (_a) => this._onRepaint(_a), this);
      this.add_child(this._canvas);

      this._dismissBtn = new St.Button({
        style: "background:transparent;border:none;padding:0;",
        reactive: true,
        can_focus: false,
        track_hover: false,
        x: 0,
        y: 0,
        width,
        height,
      });
      this._dismissBtn.connectObject(
        "clicked",
        () => this.emit("dismiss"),
        this,
      );
      this.add_child(this._dismissBtn);

      this._lyrics = [];
      this._lineGeometries = [];
      this._totalHeight = 0;
      this._dirtyGeometry = false;
      this._activeIndex = -1;
      this._currentTime = 0;
      this._scrollOffset = 0;
      this._scrollEaseId = 0;

      this._animId = 0;
      this._animPhase = 0;
      this._animStartTime = 0;

      this._fadeAlpha = 1.0;
      this._fadeId = 0;

      this._state = "loading";
      this._palette = this._buildDefaultPalette();

      this._fontConfig = _metricsForWidth(width);
      this._fontConfigOverride = {};

      St.ThemeContext.get_for_stage(global.stage).connectObject(
        "changed",
        () => this._onThemeChanged(),
        this,
      );

      this._interfaceSettings = null;
      // schema may not exist on every distro build, so check before instantiating
      const src = Gio.SettingsSchemaSource.get_default();
      if (src?.lookup(playerConstant.INTERFACE_SCHEMA, true)) {
        this._interfaceSettings = new Gio.Settings({
          schema_id: playerConstant.INTERFACE_SCHEMA,
        });
        this._interfaceSettings.connectObject(
          `changed::${COLOR_SCHEME_KEY}`,
          () => this._onThemeChanged(),
          this,
        );
      }

      this.connectObject(
        "notify::mapped",
        () => {
          if (this.mapped) this._refreshThemeColors();
        },
        this,
      );

      if (this._settings) {
        this._widthChangedId = this._settings.connect(
          "changed::popup-width",
          () => this._onPopupWidthChanged(),
        );
      }

      this._startAnim();
    }

    _onPopupWidthChanged() {
      if (!this._settings) return;
      const w = Math.max(280, this._settings.get_int("popup-width"));
      this.setSize(w, w);
    }

    setSize(width, height) {
      if (this._width === width && this._height === height) return;
      this._width = width;
      this._height = height;
      this.set_width(width);
      this.set_height(height);
      this._canvas.set_width(width);
      this._canvas.set_height(height);
      this._dismissBtn.set_width(width);
      this._dismissBtn.set_height(height);
      this._fontConfig = this._buildFontConfig(width);
      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    _buildFontConfig(w) {
      return Object.assign(_metricsForWidth(w), this._fontConfigOverride);
    }

    _buildDefaultPalette() {
      return {
        activeColor: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
        neighborColor: { r: 1.0, g: 1.0, b: 1.0, a: 0.55 },
        inactiveColor: { r: 1.0, g: 1.0, b: 1.0, a: 0.22 },
      };
    }

    _refreshThemeColors() {
      if (!this.mapped) return;
      let fg;
      try {
        fg = this.get_theme_node().get_foreground_color();
      } catch (_e) {
        // theme node not ready yet — happens during early allocation
        return;
      }
      const r = fg.red / 255,
        g = fg.green / 255,
        b = fg.blue / 255;
      const dark = this._isDarkMode();
      this._palette = {
        activeColor: { r, g, b, a: dark ? 1.0 : 0.92 },
        neighborColor: { r, g, b, a: dark ? 0.55 : 0.5 },
        inactiveColor: { r, g, b, a: dark ? 0.22 : 0.2 },
      };
      this._canvas.queue_repaint();
    }

    _isDarkMode() {
      if (this._interfaceSettings) {
        const s = this._interfaceSettings.get_string(COLOR_SCHEME_KEY);
        if (s === "prefer-dark") return true;
        if (s === "prefer-light") return false;
      }
      try {
        const fg = this.get_theme_node().get_foreground_color();
        return (
          (fg.red * 299 + fg.green * 587 + fg.blue * 114) / (255 * 1000) > 0.5
        );
      } catch (_e) {
        // fallback if node isn't ready — assume dark so text stays visible
        return true;
      }
    }

    _onThemeChanged() {
      this._refreshThemeColors();
    }

    updateAppearance(config) {
      if (config.activeSize !== undefined)
        this._fontConfigOverride.activeSize = config.activeSize;
      if (config.neighborSize !== undefined)
        this._fontConfigOverride.neighborSize = config.neighborSize;
      if (config.inactiveSize !== undefined)
        this._fontConfigOverride.inactiveSize = config.inactiveSize;
      if (config.spacing !== undefined)
        this._fontConfigOverride.lineSpacing = config.spacing;
      this._fontConfig = this._buildFontConfig(this._width);
      this._invalidateGeometry();
      this._canvas.queue_repaint();
    }

    // Animation loop

    _startAnim() {
      if (this._animId) return;
      this._animStartTime = GLib.get_monotonic_time();
      this._animId = GLib.timeout_add(
        GLib.PRIORITY_HIGH_IDLE,
        ANIM_TICK_MS,
        () => {
          if (!this.mapped || this._state === "lyrics") {
            this._animId = 0;
            return GLib.SOURCE_REMOVE;
          }
          this._animPhase =
            (GLib.get_monotonic_time() - this._animStartTime) / 1_000_000;
          this._canvas.queue_repaint();
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    _stopAnim() {
      if (this._animId) {
        GLib.source_remove(this._animId);
        this._animId = 0;
      }
    }

    // Quick fade-in so state changes feel instant but polished
    _triggerFadeIn() {
      if (this._fadeId) {
        GLib.source_remove(this._fadeId);
        this._fadeId = 0;
      }
      this._fadeAlpha = 0;
      const start = GLib.get_monotonic_time();
      this._fadeId = GLib.timeout_add(
        GLib.PRIORITY_HIGH_IDLE,
        ANIM_TICK_MS,
        () => {
          const t = Math.min(
            1,
            (GLib.get_monotonic_time() - start) / 1000 / FADE_MS,
          );
          this._fadeAlpha = _easeOutCubic(t);
          this._canvas.queue_repaint();
          if (t >= 1) {
            this._fadeId = 0;
            return GLib.SOURCE_REMOVE;
          }
          return GLib.SOURCE_CONTINUE;
        },
      );
    }

    showLoading() {
      this._state = "loading";
      this._lyrics = [];
      this._lineGeometries = [];
      this._dirtyGeometry = false;
      this._triggerFadeIn();
      this._startAnim();
      this._canvas.queue_repaint();
    }

    showEmpty() {
      this._state = "empty";
      this._lyrics = [];
      this._lineGeometries = [];
      this._dirtyGeometry = false;
      this._triggerFadeIn();
      this._startAnim();
      this._canvas.queue_repaint();
    }

    /**
     * Display lyrics immediately — zero delay between calling this and pixels
     * appearing on screen. A brief fade-in polishes the transition.
     */
    setLyrics(lyrics) {
      if (!lyrics || !lyrics.length) {
        this.showEmpty();
        return;
      }
      this._stopAnim();
      this._state = "lyrics";
      this._lyrics = lyrics;
      this._activeIndex = -1;
      this._currentTime = 0;
      this._scrollOffset = 0;
      this._invalidateGeometry();
      this._triggerFadeIn();
      this._canvas.queue_repaint(); // first pixel on screen next frame
    }

    /** @param {number} timeInMs */
    updatePosition(timeInMs) {
      if (this._state !== "lyrics") return;
      this._currentTime = timeInMs;

      let newIndex = -1;
      for (let i = 0; i < this._lyrics.length; i++) {
        if (this._lyrics[i].time <= timeInMs) newIndex = i;
        else break;
      }

      if (this._activeIndex !== newIndex) {
        this._activeIndex = newIndex;
        this._invalidateGeometry();
        this._canvas.queue_repaint();
      }
    }

    setPosition(ms) {
      this.updatePosition(ms);
    }
    clear() {
      this.showLoading();
    }

    //  Geometry

    _invalidateGeometry() {
      this._lineGeometries = [];
      this._totalHeight = 0;
      this._dirtyGeometry = true;
    }

    _smoothScrollTo(target) {
      if (Math.abs(target - this._scrollOffset) < 1) return;
      if (this._scrollEaseId) {
        GLib.source_remove(this._scrollEaseId);
        this._scrollEaseId = 0;
      }
      const from = this._scrollOffset;
      const diff = target - from;
      const start = GLib.get_monotonic_time();

      this._scrollEaseId = GLib.timeout_add(GLib.PRIORITY_HIGH_IDLE, 8, () => {
        if (!this.mapped || this._state !== "lyrics") {
          this._scrollOffset = target;
          this._canvas.queue_repaint();
          this._scrollEaseId = 0;
          return GLib.SOURCE_REMOVE;
        }
        const elapsed = (GLib.get_monotonic_time() - start) / 1000;
        const t = Math.min(1, elapsed / SCROLL_EASING_MS);
        this._scrollOffset = from + diff * _easeOutCubic(t);
        this._canvas.queue_repaint();
        if (t >= 1) {
          this._scrollOffset = target;
          this._scrollEaseId = 0;
          return GLib.SOURCE_REMOVE;
        }
        return GLib.SOURCE_CONTINUE;
      });
    }

    _onRepaint(area) {
      const cr = area.get_context();
      const [width, height] = area.get_surface_size();
      if (!width || !height) {
        cr.$dispose();
        return;
      }

      // Clear to transparent
      cr.save();
      cr.setOperator(Cairo.Operator.CLEAR);
      cr.paint();
      cr.restore();

      if (this._fadeAlpha < 1.0) cr.pushGroup();

      const { activeColor } = this._palette;
      const { activeSize, paddingX } = this._fontConfig;
      const cx = width / 2,
        cy = height / 2;

      //  Loading animation
      if (this._state === "loading") {
        this._drawLoadingVinyl(cr, cx, cy, width, height, activeColor);
        if (this._fadeAlpha < 1.0) {
          cr.popGroupToSource();
          cr.paintWithAlpha(this._fadeAlpha);
        }
        cr.$dispose();
        return;
      }

      //  No-lyrics animation
      if (this._state === "empty") {
        this._drawEmptyState(
          cr,
          cx,
          cy,
          width,
          height,
          activeColor,
          activeSize,
          paddingX,
        );
        if (this._fadeAlpha < 1.0) {
          cr.popGroupToSource();
          cr.paintWithAlpha(this._fadeAlpha);
        }
        cr.$dispose();
        return;
      }

      //  Lyrics
      const { neighborColor, inactiveColor } = this._palette;
      const { neighborSize, inactiveSize, lineSpacing } = this._fontConfig;
      const TEXT_WIDTH = width - paddingX * 2;

      const layout = PangoCairo.create_layout(cr);

      // Rebuild geometry lazily (only when active line or size changed)
      if (this._dirtyGeometry || !this._lineGeometries.length) {
        this._dirtyGeometry = false;
        layout.set_width(TEXT_WIDTH * Pango.SCALE);
        layout.set_wrap(Pango.WrapMode.WORD_CHAR);
        layout.set_alignment(Pango.Alignment.CENTER);

        this._lineGeometries = [];
        let cursorY = 0;

        for (let i = 0; i < this._lyrics.length; i++) {
          const dist = Math.abs(i - this._activeIndex);
          const active = dist === 0;
          const neighbor = dist <= NEIGHBOR_RANGE && dist > 0;
          const fontSize = active
            ? activeSize
            : neighbor
              ? neighborSize
              : inactiveSize;

          const font = Pango.FontDescription.from_string(
            `Sans Bold ${fontSize}`,
          );
          layout.set_font_description(font);
          layout.set_text(this._lyrics[i].text, -1);

          const [, logical] = layout.get_extents();
          const lineH = logical.height / Pango.SCALE;

          this._lineGeometries.push({
            y: cursorY,
            height: lineH,
            text: this._lyrics[i].text,
            font,
            active,
            neighbor,
          });
          cursorY += lineH + lineSpacing;
        }
        this._totalHeight = Math.max(cursorY - lineSpacing, 0);

        const maxScroll = Math.max(0, this._totalHeight - height);
        let target = this._scrollOffset;
        if (this._activeIndex >= 0 && this._lineGeometries[this._activeIndex]) {
          const geo = this._lineGeometries[this._activeIndex];
          const ideal = geo.y + geo.height / 2 - height / 2;
          target = Math.min(Math.max(ideal, 0), maxScroll);
        }
        this._smoothScrollTo(target);
      }

      // Draw lines
      layout.set_width(TEXT_WIDTH * Pango.SCALE);
      layout.set_wrap(Pango.WrapMode.WORD_CHAR);
      layout.set_alignment(Pango.Alignment.CENTER);

      for (const geo of this._lineGeometries) {
        const y = geo.y - this._scrollOffset;
        if (y + geo.height < -40 || y > height + 40) continue;

        layout.set_font_description(geo.font);
        layout.set_text(geo.text, -1);

        const c = geo.active
          ? activeColor
          : geo.neighbor
            ? neighborColor
            : inactiveColor;
        cr.setSourceRGBA(c.r, c.g, c.b, c.a);
        cr.moveTo(paddingX, y);
        PangoCairo.show_layout(cr, layout);
      }

      if (this._fadeAlpha < 1.0) {
        cr.popGroupToSource();
        cr.paintWithAlpha(this._fadeAlpha);
      }

      cr.$dispose();
    }

    //  Loading animation: spinning vinyl record

    _drawLoadingVinyl(cr, cx, cy, width, height, color) {
      const t = this._animPhase;

      // Position the record slightly above centre to leave room for the label
      const ry = cy - 22;

      // Outer record body
      const OUTER_R = 52;
      const LABEL_R = 18;
      const HOLE_R = 4;
      const ROT = t * 1.1; // ~1 revolution every ~5.7 s

      // Record disc (dark, near-black)
      cr.arc(cx, ry, OUTER_R, 0, Math.PI * 2);
      cr.setSourceRGBA(
        color.r * 0.12,
        color.g * 0.12,
        color.b * 0.12,
        0.92 * color.a,
      );
      cr.fillPreserve();
      cr.setSourceRGBA(color.r, color.g, color.b, 0.18 * color.a);
      cr.setLineWidth(1.5);
      cr.stroke();

      // Concentric groove rings
      cr.setLineWidth(0.8);
      for (let i = 1; i <= 5; i++) {
        const gr = LABEL_R + 4 + (OUTER_R - LABEL_R - 6) * (i / 6);
        cr.arc(cx, ry, gr, 0, Math.PI * 2);
        cr.setSourceRGBA(color.r, color.g, color.b, 0.07 * color.a);
        cr.stroke();
      }

      // Coloured centre label
      cr.save();
      cr.translate(cx, ry);
      cr.rotate(ROT);

      // Label background (subtle tint — uses the active colour at low alpha)
      cr.arc(0, 0, LABEL_R, 0, Math.PI * 2);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.28 * color.a);
      cr.fill();

      // Two arcs giving the label a "half-and-half" look
      cr.arc(0, 0, LABEL_R, -Math.PI / 2, Math.PI / 2);
      cr.lineTo(0, 0);
      cr.closePath();
      cr.setSourceRGBA(color.r, color.g, color.b, 0.42 * color.a);
      cr.fill();

      // Centre spindle hole
      cr.arc(0, 0, HOLE_R, 0, Math.PI * 2);
      cr.setSourceRGBA(0, 0, 0, 0.55);
      cr.fill();

      cr.restore();

      //  Tonearm
      // Pivots from top-right of the disc, bobs in a gentle sine arc
      const armPivotX = cx + OUTER_R - 2;
      const armPivotY = ry - OUTER_R + 8;
      const bobAngle = Math.sin(t * 1.4) * 0.06; // subtle oscillation

      // Arm is a line from pivot through/near the groove area
      const armLen = OUTER_R * 1.35;
      const armAngle = Math.PI * 0.72 + bobAngle; // angle pointing toward record
      const armEndX = armPivotX + Math.cos(armAngle) * armLen;
      const armEndY = armPivotY + Math.sin(armAngle) * armLen;

      cr.setLineWidth(2.2);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.55 * color.a);
      cr.moveTo(armPivotX, armPivotY);
      cr.lineTo(armEndX, armEndY);
      cr.stroke();

      // Pivot dot
      cr.arc(armPivotX, armPivotY, 3.5, 0, Math.PI * 2);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.7 * color.a);
      cr.fill();

      // Needle tip dot (slightly larger, brighter — the "playing" indicator)
      cr.arc(armEndX, armEndY, 2.5, 0, Math.PI * 2);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.9 * color.a);
      cr.fill();

      //  Label text
      const layout = PangoCairo.create_layout(cr);
      layout.set_font_description(Pango.FontDescription.from_string("Sans 10"));
      layout.set_width((width - 48) * Pango.SCALE);
      layout.set_alignment(Pango.Alignment.CENTER);

      // Pulsing dot ellipsis (0→1→2→3→2→1 cycle)
      const cycle = Math.floor(t * 2) % 6;
      const dotCount = cycle <= 3 ? cycle : 6 - cycle;
      layout.set_text(`Fetching lyrics${".".repeat(dotCount)}`, -1);

      const labelY = ry + OUTER_R + 14;

      // Gentle alpha pulse on the label
      const pulse = 0.38 + 0.12 * Math.sin(t * 2.5);
      cr.setSourceRGBA(color.r, color.g, color.b, pulse * color.a);
      cr.moveTo(24, labelY);
      PangoCairo.show_layout(cr, layout);
    }

    _drawEmptyState(cr, cx, cy, width, height, color, fontSize, paddingX) {
      const t = this._animPhase;
      const float = Math.sin(t * 1.0) * 4; // gentle levitation

      //  Musical note
      const noteY = cy - 30 + float;
      const noteAlpha = 0.4 + 0.08 * Math.sin(t * 1.0); // breathes in sync

      cr.setSourceRGBA(color.r, color.g, color.b, noteAlpha * color.a);

      // Note head (filled ellipse, slightly tilted)
      cr.save();
      cr.translate(cx - 4, noteY + 18);
      cr.scale(1, 0.72);
      cr.arc(0, 0, 13, 0, Math.PI * 2);
      cr.fill();
      cr.restore();

      // Note stem (vertical line up-right from head)
      cr.setLineWidth(3.5);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.moveTo(cx + 8.5, noteY + 18);
      cr.lineTo(cx + 8.5, noteY - 16);
      cr.stroke();

      // Note flag (two curves, eighth note style)
      cr.setLineWidth(3);
      // First flag
      cr.moveTo(cx + 8.5, noteY - 16);
      cr.curveTo(cx + 22, noteY - 10, cx + 22, noteY - 2, cx + 12, noteY + 2);
      cr.stroke();
      // Second flag (a little lower — makes it a beamed sixteenth note look)
      cr.moveTo(cx + 8.5, noteY - 8);
      cr.curveTo(cx + 22, noteY - 2, cx + 22, noteY + 6, cx + 12, noteY + 10);
      cr.stroke();

      // ── Soft "×" overlay — not found indicator
      // Small, positioned at top-right of the note, so it reads as "muted"
      const xCx = cx + 20,
        xCy = noteY - 20;
      const xS = 5.5;
      cr.setLineWidth(2.2);
      cr.setLineCap(Cairo.LineCap.ROUND);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.5 * color.a);
      cr.moveTo(xCx - xS, xCy - xS);
      cr.lineTo(xCx + xS, xCy + xS);
      cr.stroke();
      cr.moveTo(xCx + xS, xCy - xS);
      cr.lineTo(xCx - xS, xCy + xS);
      cr.stroke();

      // Small circle around ×
      cr.setLineWidth(1.5);
      cr.arc(xCx, xCy, xS + 3.5, 0, Math.PI * 2);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.3 * color.a);
      cr.stroke();

      // ── "No lyrics found" text + shimmer ─────────────────────────────────
      const layout = PangoCairo.create_layout(cr);
      layout.set_font_description(
        Pango.FontDescription.from_string(`Sans Bold ${fontSize}`),
      );
      layout.set_width((width - paddingX * 2) * Pango.SCALE);
      layout.set_alignment(Pango.Alignment.CENTER);
      layout.set_text("No lyrics found", -1);

      const [, logical] = layout.get_extents();
      const textW = logical.width / Pango.SCALE;
      const textH = logical.height / Pango.SCALE;
      const textX = paddingX;
      const textY = noteY + 38;

      // Base text (dimmed)
      cr.setSourceRGBA(color.r, color.g, color.b, 0.42 * color.a);
      cr.moveTo(textX, textY);
      PangoCairo.show_layout(cr, layout);

      // Shimmer stripe: sweeps left → right every 3 s, pauses between sweeps
      const SHIMMER_PERIOD = 3.0;
      const progress = (t % SHIMMER_PERIOD) / SHIMMER_PERIOD;
      // Only sweep during first 60% of the period; idle for the remaining 40%
      const sweepP = Math.min(1, progress / 0.6);
      const stripeX = textX + (textW + 60) * sweepP - 30;
      const stripeW = 32;

      const grad = new Cairo.LinearGradient(stripeX, 0, stripeX + stripeW, 0);
      grad.addColorStopRGBA(0, color.r, color.g, color.b, 0);
      grad.addColorStopRGBA(0.5, color.r, color.g, color.b, 0.3 * color.a);
      grad.addColorStopRGBA(1, color.r, color.g, color.b, 0);
      cr.setSource(grad);

      cr.rectangle(textX, textY, textW, textH);
      cr.clip();
      cr.moveTo(textX, textY);
      PangoCairo.show_layout(cr, layout);
      cr.resetClip();

      // Subtitle
      const sub = PangoCairo.create_layout(cr);
      sub.set_font_description(
        Pango.FontDescription.from_string(`Sans ${Math.max(9, fontSize - 3)}`),
      );
      sub.set_width((width - paddingX * 2) * Pango.SCALE);
      sub.set_alignment(Pango.Alignment.CENTER);
      sub.set_text("Synced lyrics unavailable", -1);
      cr.setSourceRGBA(color.r, color.g, color.b, 0.28 * color.a);
      cr.moveTo(textX, textY + textH + 6);
      PangoCairo.show_layout(cr, sub);
    }

    //Cairo helper: rounded rectangle path
    _roundedRect(cr, x, y, w, h, r) {
      const r2 = Math.min(r, w / 2, h / 2);
      cr.newPath();
      cr.arc(x + r2, y + r2, r2, Math.PI, Math.PI * 1.5);
      cr.arc(x + w - r2, y + r2, r2, Math.PI * 1.5, 0);
      cr.arc(x + w - r2, y + h - r2, r2, 0, Math.PI * 0.5);
      cr.arc(x + r2, y + h - r2, r2, Math.PI * 0.5, Math.PI);
      cr.closePath();
    }

    destroy() {
      this._stopAnim();

      if (this._scrollEaseId) {
        GLib.source_remove(this._scrollEaseId);
        this._scrollEaseId = 0;
      }
      if (this._fadeId) {
        GLib.source_remove(this._fadeId);
        this._fadeId = 0;
      }
      if (this._widthChangedId && this._settings) {
        this._settings.disconnect(this._widthChangedId);
        this._widthChangedId = 0;
      }

      St.ThemeContext.get_for_stage(global.stage).disconnectObject(this);
      if (this._interfaceSettings) {
        this._interfaceSettings.disconnectObject(this);
        this._interfaceSettings = null;
      }
      if (this._canvas) this._canvas.disconnectObject(this);
      if (this._dismissBtn) this._dismissBtn.disconnectObject(this);
      this.disconnectObject(this);

      super.destroy();
    }
  },
);