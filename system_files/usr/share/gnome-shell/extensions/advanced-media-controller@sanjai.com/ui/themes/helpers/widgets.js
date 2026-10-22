import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";

export function makeIcon(name, size = 20) {
  return new Gtk.Image({
    icon_name: name,
    pixel_size: size,
    valign: Gtk.Align.CENTER,
  });
}

export function openUri(uri) {
  Gtk.show_uri(null, uri, Gdk.CURRENT_TIME);
}

export function linkRow({
  title,
  subtitle,
  icon,
  trailing = "go-next-symbolic",
  onActivate,
}) {
  const row = new Adw.ActionRow({
    title,
    subtitle,
    activatable: true,
    use_markup: false,
  });
  row.add_prefix(makeIcon(icon));
  if (trailing) row.add_suffix(makeIcon(trailing, 16));
  row.connect("activated", onActivate);
  return row;
}

// AdwAlertDialog needs libadwaita 1.5 (GNOME 46), older shells get AdwMessageDialog
export function presentDialog(
  parent,
  {
    heading,
    body,
    extraChild,
    responses,
    defaultResponse,
    closeResponse,
    onResponse,
  },
) {
  const root = parent.get_root();
  const props = { heading };
  if (body) props.body = body;
  if (extraChild) props.extra_child = extraChild;

  const hasAlertDialog = typeof Adw.AlertDialog !== "undefined";
  const dialog = hasAlertDialog
    ? new Adw.AlertDialog(props)
    : new Adw.MessageDialog({ ...props, transient_for: root, modal: true });

  for (const [id, label, appearance] of responses) {
    dialog.add_response(id, label);
    if (appearance !== undefined)
      dialog.set_response_appearance(id, appearance);
  }
  if (defaultResponse) dialog.set_default_response(defaultResponse);
  if (closeResponse) dialog.set_close_response(closeResponse);
  if (onResponse) dialog.connect("response", (_dialog, id) => onResponse(id));

  if (hasAlertDialog) dialog.present(root);
  else dialog.present();

  return dialog;
}