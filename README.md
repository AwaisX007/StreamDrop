# Streamdrop

Streamdrop is a compact Windows desktop interface for
[yt-dlp](https://github.com/yt-dlp/yt-dlp). It makes downloading videos, audio,
subtitles, clips, and playlists approachable without requiring command-line
knowledge.

**Current version:** 3.0.0  
**Created by:** Syed Awais Shah (MarineoFPS)  
**Contact:** [Email](mailto:shahwais35@gmail.com) ·
[Discord](https://discord.com/invite/b3KebadbpA) ·
[Website](https://marineofps.dev) ·
[YouTube](https://youtube.com/@LearnwithMarineo)

## Features

- Download individual videos, audio, subtitles, clips, or playlists.
- Analyze links before downloading and select quality or exact formats.
- Queue multiple links with asynchronous progress, speed, ETA, cancellation,
  retry, and completed-file actions.
- Choose output folders, filename templates, containers, audio formats, subtitle
  languages, metadata, chapters, and SponsorBlock behavior.
- Persist settings and download history.
- Install or update official `yt-dlp.exe` from inside the application.
- Download, verify, and extract the Gyan.dev FFmpeg essentials build on demand.
- Keep a compact footprint by using the Windows WebView2 runtime instead of
  bundling Chromium.

yt-dlp and FFmpeg are optional downloads and are not bundled with Streamdrop.

## Using Streamdrop

1. Install Streamdrop with the Windows setup executable from this repository's
   GitHub Releases page, or run the portable executable.
2. Open **Tools** and install yt-dlp. Install FFmpeg there when merging or
   conversion is required.
3. Paste a supported video or playlist link and select **Analyze**.
4. Choose the download type, quality, and destination folder.
5. Select **Download** and follow the job in the queue.

Only download media you are authorized to access. Streamdrop does not bypass
DRM and is not affiliated with or endorsed by yt-dlp, FFmpeg, Gyan.dev, or any
supported media site.

## Development

Streamdrop uses Tauri 2, Rust, TypeScript, and Vite. The supplied PowerShell
scripts keep downloaded toolchains, package caches, temporary files, and build
outputs inside the repository workspace.

From a PowerShell terminal opened in the project folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

The development command opens the native Tauri window and enables Vite hot
module replacement for frontend changes.

Run validation:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check.ps1
```

Build the optimized Windows NSIS installer:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

Generated dependencies and artifacts are intentionally excluded by
`.gitignore`. They can always be recreated with `scripts/bootstrap.ps1` and the
build command.

## Project structure

```text
assets/       Application artwork
scripts/      Workspace-local bootstrap, development, test, and build scripts
src/          TypeScript user interface
src-tauri/    Rust backend, Tauri configuration, tests, and application icons
```

## Release verification

Published executables should include a `SHA256SUMS.txt` file in the GitHub
Release. Streamdrop v3.0.0 is currently unsigned, so Windows SmartScreen may
show an unknown-publisher warning until future builds use a code-signing
certificate.

## Support development

- Payoneer: `44036104`
- Skrill: `393735512`

## License

Streamdrop is available under the [MIT License](LICENSE). yt-dlp, FFmpeg, and
other dependencies retain their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
