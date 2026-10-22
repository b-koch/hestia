export function makeSettingsHelpers(settings, cleanups) {
  const _sc = (key, fn) => {
    const id = settings.connect(key, fn);
    cleanups.push(() => settings.disconnect(id));
  };

  const getCurrentThemeId = () =>
    settings.get_string("progress-theme-id") || "default";
  const getCurrentGifPath = () => settings.get_string("progress-gif-path");
  const getCurrentColor = () =>
    settings.get_string("progress-bar-color") || "#3584e4";
  const getUseSystemColor = () =>
    settings.get_boolean("progress-bar-use-system-color");
  const getUseNativeSlider = () =>
    settings.get_boolean("progress-use-native-slider");

  return {
    _sc,
    getCurrentThemeId,
    getCurrentGifPath,
    getCurrentColor,
    getUseSystemColor,
    getUseNativeSlider,
  };
}