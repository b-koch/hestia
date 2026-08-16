import Adw from "gi://Adw";
import Gtk from "gi://Gtk";
import Gio from "gi://Gio";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import { gettext as _ } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

/**
 * @param {Gio.Settings} settings
 * @returns {Adw.PreferencesPage}
 */
export function buildGeneralPage(settings) {
  const generalPage = new Adw.PreferencesPage({
    title: _("General"),
    icon_name: "preferences-system-symbolic",
  });

  // Panel Placement
  const panelGroup = new Adw.PreferencesGroup({
    title: _("Panel Placement"),
    description: _("Where the indicator sits in the top bar"),
  });
  generalPage.add(panelGroup);

  const positionRow = new Adw.ComboRow({ title: _("Panel Position") });
  const positionModel = new Gtk.StringList();
  [_("Left"), _("Center"), _("Right")].forEach((l) => positionModel.append(l));
  positionRow.model = positionModel;
  const positions = ["left", "center", "right"];
  positionRow.selected = Math.max(
    0,
    positions.indexOf(settings.get_string("panel-position")),
  );
  positionRow.connect("notify::selected", (w) =>
    settings.set_string("panel-position", positions[w.selected]),
  );
  panelGroup.add(positionRow);

  const indexRow = new Adw.SpinRow({
    title: _("Panel Index"),
    subtitle: _("Position within the panel area (-1 = automatic)"),
    adjustment: new Gtk.Adjustment({
      lower: -1,
      upper: 20,
      step_increment: 1,
      page_increment: 5,
      value: settings.get_int("panel-index"),
    }),
  });
  settings.bind(
    "panel-index",
    indexRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelGroup.add(indexRow);

  // Panel Label
  const labelGroup = new Adw.PreferencesGroup({
    title: _("Panel Label"),
    description: _("Track name shown in the top bar"),
  });
  generalPage.add(labelGroup);

  const showTrackRow = new Adw.SwitchRow({
    title: _("Show Track Name"),
    subtitle: _("Display the current track title in the panel"),
  });
  settings.bind(
    "show-track-name",
    showTrackRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  labelGroup.add(showTrackRow);

  const showArtistRow = new Adw.SwitchRow({
    title: _("Show Artist Name"),
    subtitle: _("Append the artist name to the track title"),
  });
  settings.bind(
    "show-artist",
    showArtistRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  labelGroup.add(showArtistRow);

  const separatorRow = new Adw.EntryRow({
    title: _("Title / Artist Separator"),
    text: settings.get_string("separator-text"),
    show_apply_button: true,
  });
  separatorRow.connect("apply", () =>
    settings.set_string("separator-text", separatorRow.text),
  );
  labelGroup.add(separatorRow);

  // Panel Scrolling
  const panelScrollGroup = new Adw.PreferencesGroup({
    title: _("Panel Scrolling"),
    description: _("Marquee scroll of the track label in the top bar"),
  });
  generalPage.add(panelScrollGroup);

  const enablePanelScrollRow = new Adw.SwitchRow({
    title: _("Enable Panel Label Scrolling"),
    subtitle: _(
      "Scroll the track/artist text one full loop then pause before repeating. " +
        "When off, the text is truncated with an ellipsis.",
    ),
  });
  settings.bind(
    "enable-panel-scroll",
    enablePanelScrollRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelScrollGroup.add(enablePanelScrollRow);

  const panelScrollSpeedRow = new Adw.SpinRow({
    title: _("Panel Scroll Speed"),
    subtitle: _("1 = slowest, 10 = fastest"),
    adjustment: new Gtk.Adjustment({
      lower: 1,
      upper: 10,
      step_increment: 1,
      page_increment: 2,
      value: settings.get_int("scroll-speed"),
    }),
  });
  settings.bind(
    "scroll-speed",
    panelScrollSpeedRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelScrollGroup.add(panelScrollSpeedRow);

  const panelLabelWidthRow = new Adw.SpinRow({
    title: _("Panel Label Width"),
    subtitle: _(
      "Visible pixel width of the track label in the top bar (60 – 400 px). " +
        "Takes effect immediately — no restart needed.",
    ),
    adjustment: new Gtk.Adjustment({
      lower: 60,
      upper: 400,
      step_increment: 10,
      page_increment: 40,
      value: settings.get_int("panel-label-width"),
    }),
  });
  settings.bind(
    "panel-label-width",
    panelLabelWidthRow,
    "value",
    Gio.SettingsBindFlags.DEFAULT,
  );
  panelScrollGroup.add(panelLabelWidthRow);

  // Panel Element Order
  const panelOrderGroup = new Adw.PreferencesGroup({
      title: _("Panel Element Order"),
      description: _(
        "Drag and drop the rows to reorder the icon, label, and controls " +
        "shown in the top bar. Changes take effect immediately.",
      ),
    });
    generalPage.add(panelOrderGroup);
  
    const PANEL_ELEMENTS = [
      { id: "icon",     label: _("App Icon"),          icon: "image-x-generic-symbolic" },
      { id: "label",    label: _("Track Label"),        icon: "text-x-generic-symbolic" },
      { id: "controls", label: _("Playback Controls"),  icon: "media-playback-start-symbolic" },
    ];

    const _readPanelOrder = () => {
        try {
          const raw = settings.get_string("panel-element-order");
          if (!raw) throw new Error("empty");
          return raw.split(",").map(s => s.trim()).filter(Boolean);
        } catch (_e) {
          return ["icon", "label", "controls"];
        }
      };
    
      const _writePanelOrder = (arr) =>
        settings.set_string("panel-element-order", arr.join(","));
    
      const _rebuildPanelOrderRows = () => {
        if (panelOrderGroup.listBox) {
          panelOrderGroup.remove(panelOrderGroup.listBox);
        }
    
        const listBox = new Gtk.ListBox({
          css_classes: ["boxed-list"],
          selection_mode: Gtk.SelectionMode.NONE,
        });
        panelOrderGroup.listBox = listBox;
        panelOrderGroup.add(listBox);
    
        const currentOrder = _readPanelOrder();
    
        currentOrder.forEach((id) => {
          const meta = PANEL_ELEMENTS.find(e => e.id === id) ||
            { id, label: id, icon: "application-x-executable-symbolic" };
    
          const row = new Adw.ActionRow({ title: meta.label, activatable: false });
          
          row.add_prefix(new Gtk.Image({
            icon_name: "list-drag-handle-symbolic",
            pixel_size: 16,
            valign: Gtk.Align.CENTER,
            margin_end: 8,
            css_classes: ["dim-label"]
          }));
    
          row.add_prefix(new Gtk.Image({
            icon_name: meta.icon,
            pixel_size: 20,
            valign: Gtk.Align.CENTER,
          }));
    
          // DND: Drag Source
          const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
          dragSource.connect("prepare", () => {
            const val = new GObject.Value();
            val.init(GObject.TYPE_STRING);
            val.set_string(meta.id);
            return Gdk.ContentProvider.new_for_value(val);
          });
          row.add_controller(dragSource);
    
          // DND: Drop Target
          const dropTarget = new Gtk.DropTarget({
            actions: Gdk.DragAction.MOVE,
            formats: Gdk.ContentFormats.new_for_gtype(GObject.TYPE_STRING)
          });
          
          dropTarget.connect("drop", (target, value) => {
            const sourceId = typeof value === "string" ? value : value.get_string();
            if (sourceId === meta.id) return false;
    
            const order = _readPanelOrder();
            const fromIdx = order.indexOf(sourceId);
            const toIdx = order.indexOf(meta.id);
    
            if (fromIdx > -1 && toIdx > -1) {
              order.splice(fromIdx, 1);
              order.splice(toIdx, 0, sourceId);
              _writePanelOrder(order);
              _rebuildPanelOrderRows();
              return true;
            }
            return false;
          });
          row.add_controller(dropTarget);
    
          listBox.append(row);
        });
      };
    
      _rebuildPanelOrderRows();
    
      const _panelOrderChangedId = settings.connect(
        "changed::panel-element-order",
        () => _rebuildPanelOrderRows(),
      );
      generalPage.connect("destroy", () => {
        settings.disconnect(_panelOrderChangedId);
      });

  // Popup Info Alignment
  const infoAlignGroup = new Adw.PreferencesGroup({
    title: _("Popup Player Layout"),
    description: _("How the track title and artist are aligned in the popup"),
  });
  generalPage.add(infoAlignGroup);

  const infoAlignRow = new Adw.SwitchRow({
    title: _("Centre-align Track Info"),
    subtitle: _(
      "When on, the track title and artist name are centred under the album art. " +
        "When off, they are left-aligned. Takes effect immediately.",
    ),
  });
  settings.bind(
    "info-align-center",
    infoAlignRow,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );
  infoAlignGroup.add(infoAlignRow);

  // System Integration
  const systemGroup = new Adw.PreferencesGroup({
    title: _("System Integration"),
    description: _(
      "Controls how this extension interacts with other parts of GNOME Shell.",
    ),
  });
  generalPage.add(systemGroup);

  const hideDefaultExpanderRow = new Adw.ExpanderRow({
    title: _("Hide Default GNOME Media Player"),
    subtitle: _(
      "Remove the built-in media controls from the system date/time menu",
    ),
  });

  const hideDefaultToggle = new Gtk.Switch({
    active: settings.get_boolean("hide-default-player"),
    valign: Gtk.Align.CENTER,
  });
  settings.bind(
    "hide-default-player",
    hideDefaultToggle,
    "active",
    Gio.SettingsBindFlags.DEFAULT,
  );

  hideDefaultExpanderRow.add_suffix(hideDefaultToggle);
  hideDefaultExpanderRow.activatable_widget = hideDefaultToggle;

  const hideDefaultInfoLabel = new Gtk.Label({
    label: _(
      "When ON, the extension hides the stock GNOME media controls that\n" +
        "normally appear in the calendar / notification panel (the date-time\n" +
        "menu). This prevents a duplicate 'now playing' widget.\n\n" +
        "The built-in controls are fully restored the moment you:\n" +
        "  \u2022 Turn this switch off, or\n" +
        "  \u2022 Disable or uninstall this extension.",
    ),
    wrap: true,
    xalign: 0,
    margin_top: 10,
    margin_bottom: 10,
    margin_start: 16,
    margin_end: 16,
    css_classes: ["dim-label"],
  });

  const hideDefaultInfoBox = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
  });
  hideDefaultInfoBox.append(hideDefaultInfoLabel);
  hideDefaultExpanderRow.add_row(hideDefaultInfoBox);

  systemGroup.add(hideDefaultExpanderRow);

  return generalPage;
}