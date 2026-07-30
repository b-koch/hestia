# Hestia

A reliable, production-focused desktop image built on top of Bazzite.

Hestia is a personal Linux image designed for development, productivity, and everyday computing while retaining the gaming optimizations and hardware support that make Bazzite a strong foundation.

The goal is not to create a gaming distribution, but a dependable workstation environment where development tools, virtual machines, creative applications, and games all work well togethe without a gaming branding.

## Switch to Hestia

```
sudo bootc switch --enforce-container-sigpolicy ghcr.io/b-koch/hestia
```

## Why "Hestia"?

In Greek mythology, **Hestia** is the goddess of the hearth, home, and domestic stability.

The hearth was the center of the ancient Greek home: a constant source of warmth, safety, and reliability. Unlike many figures in Greek mythology, Hestia is not associated with conflict or conquest. Her role is quiet and essential — maintaining the foundation that allows everything else to happen.

This reflects the purpose of Hestia Linux:

> The operating system should be a reliable foundation, not the focus of attention.

Hestia aims to be a stable home for:

* __myself__
* software development
* virtualization and testing
* productivity workflows
* creative work
* gaming

## Goals

* Provide a reliable workstation environment
* Keep the benefits of an atomic Linux system
* Support development workflows out of the box
* Include virtualization capabilities by default
* Maintain strong gaming compatibility
* Reduce unnecessary components and distractions
* Stay close to upstream while providing sensible defaults

## Based on

Hestia is built using the Bazzite image template and follows the Universal Blue image building approach.

It uses Bazzite as a foundation because of its excellent hardware enablement, gaming optimizations, and immutable system design.

Hestia extends that foundation toward a broader workstation use case.

## Features

* Atomic updates and rollback capabilities
* Modern Linux desktop stack
* Development-focused tooling
* Virtual machine support
* Container-friendly workflow
* Gaming optimizations inherited from Bazzite
* Customized system defaults

## Philosophy

A good operating system should be like a well-kept home:

The foundation is dependable.
The tools are available when needed.
The system stays out of the way.

Hestia aims to provide that quiet foundation.

# GNOME defaults

App folders, workspace-switch keybindings, volume step, and sleep-on-AC are baked into the image as a compiled gschema override (`system_files/usr/share/glib-2.0/schemas/zz1-00-hestia-defaults.gschema.override`), applied via `glib-compile-schemas` in `configure.sh`. Sleep/suspend/hibernate targets are masked via `/dev/null` symlinks in `system_files/etc/systemd/system/`.

> [!NOTE]
> Schema overrides only change the *default* value. If a user account already has a stored value for one of these keys (from before switching to this image, or from manually running `gsettings set` previously), that stored value still wins. Run `dconf reset -f /org/gnome/desktop/app-folders/` (and similarly for the other affected schemas) once per existing account after rebasing to pick up the new defaults; fresh accounts get them automatically.

# Set up gnome app folders

```
dconf reset -f "/org/gnome/desktop/app-folders/"
gsettings set org.gnome.desktop.app-folders folder-children "['Office', 'Graphics', 'Development', 'Audio&Video', 'Games', 'Education', 'Network', 'Science', 'Settings', 'System', 'Utilities', 'GamingUtilities', 'Containers', 'Misc', 'Wine', 'YaST', 'Pardus']"

gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Office/ categories "['Office', 'WordProcessor', 'Spreadsheet', 'Presentation', 'Scanning']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Office/ name "Office"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Development/ categories "['Development', 'IDE']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Development/ name "Development"
gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Audio&Video/" categories "['AudioVideo', 'Audio', 'Video', 'Recorder']"
gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Audio&Video/" name "Audio & Video"
gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Audio&Video/" apps "['com.blackmagicdesign.resolve.desktop']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Games/ categories "['Game']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Games/ name "Games"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Games/ excluded-apps "['wine-winemine.desktop']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Education/ categories "['Education']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Education/ name "Education"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Network/ categories "['Network', 'WebBrowser', 'FileTransfer']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Network/ name "Web"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Network/ excluded-apps "['steam.desktop']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Science/ categories "['Science']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Science/ name "Science"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Settings/ categories "['Settings']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Settings/ name "Settings"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/System/ categories "['System']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/System/ name "System"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Utilities/ categories "['Utility']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Utilities/ name "Utilities"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Graphics/ categories "['Graphics', '2DGraphics', 'RasterGraphics']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Graphics/ name "Graphics"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Graphics/ excluded-apps "['org.gnome.Evince.desktop', 'simple-scan.desktop']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Wine/ categories "['X-Wine']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Wine/ name "Wine"
gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Wine/" apps "['wine-winemine.desktop']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Containers/ name "Containers"
gsettings set org.gnome.desktop.app-folders.folder:"/org/gnome/desktop/app-folders/folders/Containers/" apps "['org.gnome.Boxes.desktop', 'virt-manager.desktop']"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Misc/ name "Misc"
gsettings set org.gnome.desktop.app-folders.folder:/org/gnome/desktop/app-folders/folders/Misc/ apps "['com.blackmagicdesign.resolve-Panels.desktop', 'com.blackmagicdesign.resolve-Installer.desktop', 'com.blackmagicdesign.resolve-CaptureLogs.desktop']"
```

# Set up additional short-cuts

```
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Left', '<Super>less']"
gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Right', '<Super>y']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Shift><Super>Left', '<Shift><Super>less']"
gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Shift><Super>Right', '<Shift><Super>y']"

gsettings get org.gnome.desktop.wm.keybindings switch-to-workspace-left
gsettings get org.gnome.desktop.wm.keybindings switch-to-workspace-right
gsettings get org.gnome.desktop.wm.keybindings move-to-workspace-left
gsettings get org.gnome.desktop.wm.keybindings move-to-workspace-right
```

# Settings

```
gsettings set org.gnome.settings-daemon.plugins.media-keys volume-step 2
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'nothing'
```

---

# image-template

This image is based on the [ublue-os image template](https://github.com/ublue-os/image-template).
