# Launching HEX

## Normal launch

Double-click the **HEX** shortcut on the Windows desktop.

HEX appears as a small tab on the right edge of the screen. Click that tab to expand it. If HEX is already running, launching it again brings the existing overlay forward instead of opening another copy.

## Backup launch

If the desktop shortcut is missing:

1. Open `Codex Home\01_Projects\Browser_Base` in File Explorer.
2. Double-click `Launch HEX.cmd`.
3. Look for the small HEX tab on the right edge of the screen.

## Developer fallback

Only use this if the shortcut and launcher do not work:

```powershell
Set-Location -LiteralPath "C:\Users\Ortiz\OneDrive\Desktop\Codex Home\01_Projects\Browser_Base"
npm start
```

## Why this was difficult to remember

HEX is currently a development build, not an installed Windows application. It previously required remembering:

- the project's exact folder
- how to change folders in PowerShell
- the `npm start` command
- where the small edge overlay appears

That is implementation machinery, not a reasonable user workflow. The double-click launcher removes those steps. A packaged HEX installer will eventually replace the launcher with a normal Start-menu application.

## Memory instruction

**To open HEX, double-click HEX on the desktop and look at the right edge of the screen.**
