# Privacy Policy

_Effective date: the date this document was first published at its public URL._

samuxy ("the app") is a Windows developer tool with local workspace, terminal, source-control, file preview, AI usage, and mobile remote-control features. This policy describes what data the app handles and what it does not.

## Summary

- No account, no sign-up, no email required.
- No analytics, advertising, or third-party tracking SDKs.
- The app communicates only with the Windows desktop instance you choose to pair with.
- All data stays on your devices.

## What the app stores on your device

The app stores the following locally on your paired device and Windows machine. None of it is transmitted to samuxy or any third party.

- **Pairing credentials.** A random device ID and token are generated during pairing and stored locally. They are used to authenticate the paired device to the Windows desktop app.
- **Saved devices.** The names, hostnames, and ports of paired desktops are stored locally. Credentials are not shared with third parties.
- **Preferences.** Terminal font size and display preferences.
- **Diagnostic log.** While the app is running, it may keep local connection events to help troubleshoot connection problems. These logs are not sent anywhere automatically.

You can remove a saved device at any time. Uninstalling the app removes app-managed local data according to the Windows uninstaller settings.

## What the app sends over the network

When you connect to a Windows desktop, the app opens a direct WebSocket connection to the address and port you entered. It sends only the messages required to authenticate, view terminal output, control panes, and perform the version-control actions you initiate.

The app does not contact any samuxy-operated server. It does not contact any third-party server. It does not perform background networking.

## What the app does not collect

- No personal information.
- No contacts, photos, location, microphone, or camera data.
- No usage analytics or crash analytics.
- No advertising identifiers.
- No data sold or shared with third parties.

## Permissions

- **Local Network.** Required on paired mobile devices so the app can reach the Windows desktop on your LAN or VPN.

## Children

The app is a developer tool and is not directed to children under 13.

## Changes to this policy

If this policy changes, the updated version will be posted at this URL with a new "Last updated" date.

## Contact

Questions about this policy should be reported through this repository.
