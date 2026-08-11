# Third-party notices

Streamdrop is an independent graphical interface. It does not bundle yt-dlp,
FFmpeg, or ffprobe in its source archive or installer. A user may choose to
download these separate programs from inside Streamdrop.

## yt-dlp

Streamdrop downloads `yt-dlp.exe` from the official
[yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) and verifies it
against the release checksum before installation. yt-dlp is licensed separately
under [The Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE).

## FFmpeg and ffprobe

Streamdrop downloads the Windows release-essentials archive from
[Gyan.dev](https://www.gyan.dev/ffmpeg/builds/), a provider linked by the
[official FFmpeg download page](https://ffmpeg.org/download.html), and verifies
the provider's SHA-256 checksum before extraction. FFmpeg and ffprobe are
licensed separately by their respective authors; licensing depends on the
specific build and enabled components. See the provider archive and the
[FFmpeg legal page](https://ffmpeg.org/legal.html) for details.

## Application dependencies

Streamdrop also uses open-source Rust and JavaScript dependencies declared in
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `package.json`, and
`package-lock.json`. Their license texts and notices remain the property of
their respective authors.

Streamdrop is not affiliated with or endorsed by yt-dlp, FFmpeg, Gyan.dev, or
any supported media site.
