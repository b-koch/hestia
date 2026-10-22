import GLib from "gi://GLib";


export const USER_THEMES_DIR = GLib.build_filenamev([
    GLib.get_user_data_dir(),
    "gnome-shell", "extensions", "Advanced-media-controller-themes",
]);

export const THUMB_SIZE = 28;
export const PREVIEW_W = 300;
export const PREVIEW_H = 48;
export const PREVIEW_MARGIN = THUMB_SIZE / 2 + 4;
export const TAU = Math.PI * 2;

export const SAMPLE_THEME_SRC = `\
const theme = {
    id: "my-custom-theme",
    label: "My Custom Theme",
    author: "Your Name",
    version: "1.0",

    drawTrack(ctx) {
        const { cr, margin, trackY, trackW, fillEnd, ratio, offset } = ctx;
        const pulse = Math.sin(offset * 0.15) * 0.5 + 0.5;
        const th = 4;
        const r = 2;
        const ty = trackY - th / 2;

        cr.save();
        cr.setSourceRGBA(1, 1, 1, 0.12);
        _roundedRect(cr, margin, ty, trackW, th, r);
        cr.fill();

        if (ratio > 0) {
            const fillW = Math.max(th, fillEnd - margin);
            const g = new Cairo.LinearGradient(margin, 0, fillEnd, 0);
            g.addColorStopRGBA(0,   0.1, 0.9, 0.6, 1.0);
            g.addColorStopRGBA(0.5, 0.0, 0.7, 1.0, 1.0);
            g.addColorStopRGBA(1,   0.5, 0.2, 1.0, 1.0);
            cr.setSource(g);
            _roundedRect(cr, margin, ty, fillW + pulse * 2, th, r);
            cr.fill();
        }
        cr.restore();
    },

    drawThumb(ctx) {
        const { cr, cx, cy, r, offset } = ctx;
        const pulse = Math.sin(offset * 0.15) * 0.5 + 0.5;
        cr.save();
        const glow = new Cairo.RadialGradient(cx, cy, 0, cx, cy, r + 8 + pulse * 4);
        glow.addColorStopRGBA(0,   0.3, 0.9, 1.0, 0.8);
        glow.addColorStopRGBA(0.5, 0.0, 0.6, 1.0, 0.3);
        glow.addColorStopRGBA(1,   0.0, 0.3, 0.8, 0.0);
        cr.setSource(glow);
        cr.arc(cx, cy, r + 8 + pulse * 4, 0, Math.PI * 2);
        cr.fill();
        const bg = new Cairo.RadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        bg.addColorStopRGBA(0, 0.6, 1.0, 0.9, 1.0);
        bg.addColorStopRGBA(1, 0.1, 0.5, 0.9, 1.0);
        cr.setSource(bg);
        cr.arc(cx, cy, r, 0, Math.PI * 2);
        cr.fill();
        cr.setSourceRGBA(1, 1, 1, 0.35);
        cr.setLineWidth(1.5);
        cr.arc(cx, cy, r - 0.75, 0, Math.PI * 2);
        cr.stroke();
        cr.restore();
    },
};

function _roundedRect(cr, x, y, w, h, r) {
    const PI = Math.PI;
    cr.newPath();
    cr.arc(x + r,     y + r,     r, PI,         3 * PI / 2);
    cr.arc(x + w - r, y + r,     r, 3 * PI / 2, 0);
    cr.arc(x + w - r, y + h - r, r, 0,           PI / 2);
    cr.arc(x + r,     y + h - r, r, PI / 2,      PI);
    cr.closePath();
}
`;

export const PRESET_GIFS = [
    { id: "sonic",   label: "Sonic",    file: "Sonic.gif",  color: "#1565c0", themeId: "sonic" },
    { id: "nyancat", label: "Nyan Cat", file: "Cat.gif",     color: "#cc6fa8", themeId: "nyancat" },
    { id: "zenitsu", label: "Zenitsu",  file: "Zenitsu.gif", color: "#f5a623", themeId: "zenitsu" },
];

export const COLOR_PRESETS = [
    { label: "GNOME Blue",   hex: "#3584e4" },
    { label: "Green",        hex: "#33d17a" },
    { label: "Purple",       hex: "#9141ac" },
    { label: "Red",          hex: "#e01b24" },
    { label: "Orange",       hex: "#ff7800" },
    { label: "Pink",         hex: "#dc8add" },
    { label: "Teal",         hex: "#2ec27e" },
    { label: "Sonic Blue",   hex: "#1565c0" },
    { label: "Nyan Pink",    hex: "#cc6fa8" },
    { label: "Thunder Gold", hex: "#f5a623" },
];