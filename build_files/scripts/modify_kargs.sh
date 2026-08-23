# Append kernel quirk to fix the ASUS ROG Azoth keyboard sometimes not working.
# HID_QUIRK_ALWAYS_POLL (0x00000400) and HID_QUIRK_NOGET (0x00000008)
bootc kargs --append=usbhid.quirks=0x0b05:0x1ace:0x00000408