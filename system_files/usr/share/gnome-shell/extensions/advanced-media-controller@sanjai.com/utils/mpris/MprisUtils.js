import Gio from "gi://Gio";
import Shell from "gi://Shell";
import { MprisConstants } from "./MprisConstants.js";

export class MprisUtils {
  static getString(variant) {
    if (!variant) return null;
    const type = variant.get_type_string();
    if (type !== "s" && type !== "o") return null;
    return variant.get_string()[0] || null;
  }

  static getInt64(variant) {
    if (!variant || !"xtiu".includes(variant.get_type_string())) return null;
    return Number(variant.unpack());
  }

  static getInt32(variant) {
    if (!variant || !"iunq".includes(variant.get_type_string())) return null;
    return Number(variant.unpack());
  }

  static getAppInfo(name, desktopEntries) {
    const desktopEntry = desktopEntries.get(name);
    if (desktopEntry) {
      const appInfo =
        Gio.DesktopAppInfo.new(`${desktopEntry}.desktop`) ??
        Gio.DesktopAppInfo.new(desktopEntry);
      if (appInfo) return appInfo;
    }

    const cleanName = name
      .replace(`${MprisConstants.MPRIS_PREFIX}.`, "")
      .toLowerCase()
      .replace(/\.instance_\d+_\d+$/, "");

    const appSystem = Shell.AppSystem.get_default();
    let app = appSystem.lookup_app(`${cleanName}.desktop`);
    if (app) return app.get_app_info();

    if (cleanName === "spotify") {
      app = appSystem.lookup_app("com.spotify.Client.desktop");
      if (app) return app.get_app_info();
    }

    return null;
  }

  static getAppIcon(name, desktopEntries) {
    const icon = MprisUtils.getAppInfo(name, desktopEntries)?.get_icon();
    return icon ? icon.to_string() : "audio-x-generic-symbolic";
  }
}