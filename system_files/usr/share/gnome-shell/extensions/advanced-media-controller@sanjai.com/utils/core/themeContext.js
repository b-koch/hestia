export class ThemeContext {
    constructor(cr, W, H, ratio, offset, isPlaying, trackY, margin) {
        this.cr = cr;
        this.W = W;
        this.H = H;
        this.ratio = Math.max(0, Math.min(1, ratio));
        this.offset = offset;
        this.isPlaying = isPlaying;
        this.trackY = trackY;
        this.margin = margin;
        this.trackW = W - margin * 2;
        this.fillEnd = margin + this.ratio * this.trackW;
        this.fillStart = margin;
    }
}

export class ThumbContext {
    constructor(cr, size, ratio, offset, isPlaying, pixbuf) {
        this.cr = cr;
        this.size = size;
        this.ratio = Math.max(0, Math.min(1, ratio));
        this.offset = offset;
        this.isPlaying = isPlaying;
        this.pixbuf = pixbuf;
        this.cx = size / 2;
        this.cy = size / 2;
        this.r = size / 2 - 1;
    }
}