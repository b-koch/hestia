import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class ForceMaxBrightnessExtension {
    _forceMax() {
        const bm = Main.brightnessManager;
        if (bm?.globalScale)
            bm.globalScale.value = 1.0;
    }

    enable() {
        this._forceMax();
        this._changedId = Main.brightnessManager?.connect('changed', () => this._forceMax());
    }

    disable() {
        if (this._changedId) {
            Main.brightnessManager?.disconnect(this._changedId);
            this._changedId = null;
        }
    }
}
