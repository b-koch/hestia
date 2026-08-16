[group("hestia")]
hestia-disable-suspend:
    #!/usr/bin/bash
    sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
    gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type 'blank'

hestia-set-workspace-shortcuts:
    #!/usr/bin/bash
    gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-left "['<Super>Left', '<Super>less']"
    gsettings set org.gnome.desktop.wm.keybindings switch-to-workspace-right "['<Super>Right', '<Super>y']"
    gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-left "['<Shift><Super>Left', '<Shift><Super>less']"
    gsettings set org.gnome.desktop.wm.keybindings move-to-workspace-right "['<Shift><Super>Right', '<Shift><Super>y']"

hestia-set-volume-step
    #!/usr/bin/bash
    gsettings set org.gnome.settings-daemon.plugins.media-keys volume-step 2

hestia-setup-app-folders:
    #!/usr/bin/bash
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
