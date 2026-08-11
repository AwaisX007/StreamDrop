import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  DownloadEvent,
  DownloadJob,
  DownloadMode,
  DownloadRequest,
  HistoryEntry,
  MediaInfo,
  ReleaseInfo,
  ToolDownloadProgress,
  ToolsStatus,
} from "./types";
import "./styles.css";

const appRoot = document.querySelector<HTMLDivElement>("#app");
if (!appRoot) throw new Error("Streamdrop could not find its application root");
const app: HTMLDivElement = appRoot;

const inTauri = "__TAURI_INTERNALS__" in window;
const jobs = new Map<string, DownloadJob>();
const defaultSettings: AppSettings = {
  downloadDir: "D:\\Streamdrop\\downloads",
  preferredQuality: "best",
  preferredAudioFormat: "mp3",
  preferredAudioQuality: "320K",
  preferredContainer: "mp4",
  filenameStyle: "title-id",
  overwriteBehavior: "skip",
  cookieBrowser: "",
  parallelDownloads: 2,
  concurrentFragments: 4,
  rateLimit: "",
  retries: 10,
  embedThumbnail: false,
  embedMetadata: true,
  embedSubtitles: false,
  saveDescription: false,
  saveThumbnail: false,
  preserveUploadDate: true,
  archiveEnabled: true,
  clipboardDetection: true,
};

let tools: ToolsStatus | null = null;
let settings: AppSettings = { ...defaultSettings };
let history: HistoryEntry[] = [];
let latestRelease: ReleaseInfo | null = null;
let media: MediaInfo | null = null;
let currentUrl = "";
let saveDir = "";
let mode: DownloadMode = "video";
let quality = "best";
let container = "auto";
let audioFormat = "best";
let audioQuality = "320K";
let subtitleFormat = "best";
let selectedSubtitleLanguages = new Set<string>();
let selectedPlaylistItems = new Set<number>();
let playlistSelection: "all" | "selected" = "all";
let toolsOpen = false;
let aboutOpen = false;
let settingsOpen = false;
let historyOpen = false;
let advancedOpen = false;
let batchUrls: string[] = [];
let selectedFormatId = "auto";
let clipStart = "";
let clipEnd = "";
let splitChapters = false;
let sponsorblockMode = "off";
let analyzing = false;
let installing = false;
let installingFfmpeg = false;
let latestLoading = false;
let installProgress: ToolDownloadProgress | null = null;
let ffmpegInstallProgress: ToolDownloadProgress | null = null;
let notice: { kind: "error" | "success" | "info"; text: string } | null = null;

const icons: Record<string, string> = {
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a4 4 0 0 0 5.7.1l2-2a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M13.4 10.6a4 4 0 0 0-5.7-.1l-2 2a4 4 0 0 0 5.7 5.7l1.1-1.1"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5"/><path d="M5 21h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5 5L3 18l3 3 6.7-6.7a4 4 0 0 0 5-5l-2.4 2.4-3-3z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  cancel: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6"/></svg>',
  retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-1.4 4.2"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  queue: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3" cy="6" r=".7"/><circle cx="3" cy="12" r=".7"/><circle cx="3" cy="18" r=".7"/></svg>',
  person: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a4 4 0 0 1-4 4H8l-5 2 1.5-4A7 7 0 0 1 3 13V8a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></svg>',
  youtube: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="4"/><path d="m10 9 5 3-5 3z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/></svg>',
  history: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4a3 3 0 0 1 6 0v2H9z"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M19 13v6H5V5h6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/></svg>',
};

function icon(name: keyof typeof icons): string {
  return `<span class="icon">${icons[name]}</span>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something unexpected happened";
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function formatDuration(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "Unknown length";
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const rest = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function isRunning(kind: string): boolean {
  return !["completed", "failed", "cancelled"].includes(kind);
}

function statusLabel(kind: string): string {
  const labels: Record<string, string> = {
    queued: "Waiting",
    preparing: "Preparing",
    downloading: "Downloading",
    finished: "Processing",
    processing: "Processing",
    completed: "Completed",
    failed: "Needs attention",
    cancelled: "Cancelled",
  };
  return labels[kind] ?? "Working";
}

function qualityOptions(checkAvailability = true): Array<{ value: string; label: string; disabled: boolean }> {
  const maxHeight = Math.max(0, ...(media?.formats.map((format) => format.height ?? 0) ?? []));
  return [
    { value: "best", label: "Best", disabled: false },
    ...[2160, 1440, 1080, 720, 480].map((height) => ({
      value: String(height),
      label: `${height}p`,
      disabled: Boolean(checkAvailability && media && maxHeight > 0 && maxHeight < height),
    })),
    { value: "smallest", label: "Smallest", disabled: false },
  ];
}

function toolInstalled(): boolean {
  return tools?.ytDlp.installed === true;
}

function requiresFfmpeg(): boolean {
  if (mode === "audio") return audioFormat !== "best";
  if (mode === "video") return quality !== "smallest";
  return false;
}

function render(): void {
  const activeJobs = [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="Streamdrop home">
          <span class="brand-mark" aria-hidden="true"><span></span></span>
          <span class="brand-name">Stream<span>drop</span></span>
          <span class="version-badge">v3</span>
        </a>
        <nav class="header-actions" aria-label="Application sections">
          <button class="tool-button compact-action" id="history-button" type="button">
            ${icon("history")}
            <span>History</span>
          </button>
          <button class="tool-button compact-action" id="settings-button" type="button">
            ${icon("settings")}
            <span>Settings</span>
          </button>
          <button class="tool-button" id="about-button" type="button">
            ${icon("person")}
            <span>About</span>
          </button>
          <button class="tool-button" id="tools-button" type="button">
            <span class="status-dot ${toolInstalled() ? "online" : "offline"}"></span>
            ${icon("tools")}
            <span>Tools</span>
          </button>
        </nav>
      </header>

      <main>
        <section class="intro" aria-labelledby="page-title">
          <p class="eyebrow">Simple media downloads</p>
          <h1 id="page-title">Save what matters.<br /><span>Skip the commands.</span></h1>
          <p>Paste a link, pick what you want, and Streamdrop handles the rest.</p>
        </section>

        ${renderNotice()}

        <section class="link-card" aria-label="Analyze a media link">
          <div class="link-input-wrap">
            ${icon("link")}
            <textarea
              id="url-input"
              inputmode="url"
              spellcheck="false"
              rows="1"
              placeholder="Paste one or more video or playlist links"
              aria-label="Video or playlist links"
            >${escapeHtml(currentUrl)}</textarea>
            <button class="paste-button" id="paste-button" type="button" title="Paste from clipboard" aria-label="Paste from clipboard">${icon("clipboard")}</button>
          </div>
          <button class="primary-button analyze-button" id="analyze-button" type="button" ${analyzing ? "disabled" : ""}>
            ${analyzing ? '<span class="spinner"></span> Looking…' : "Analyze"}
          </button>
        </section>
        <div class="input-hints">
          <span>Drop links or a .txt file anywhere</span>
          ${batchUrls.length > 1 ? `<strong>${batchUrls.length} links in this batch</strong>` : ""}
        </div>

        ${media ? renderWorkspace(activeJobs) : renderWelcome(activeJobs)}
      </main>
    </div>
    ${toolsOpen ? renderToolsPanel() : ""}
    ${aboutOpen ? renderAboutPanel() : ""}
    ${settingsOpen ? renderSettingsPanel() : ""}
    ${historyOpen ? renderHistoryPanel() : ""}
  `;
  bindEvents();
}

function renderNotice(): string {
  if (!notice) return "";
  return `<div class="notice ${notice.kind}" role="${notice.kind === "error" ? "alert" : "status"}">
    <span>${notice.kind === "success" ? icon("check") : ""}${escapeHtml(notice.text)}</span>
    <button id="dismiss-notice" type="button" aria-label="Dismiss">${icon("close")}</button>
  </div>`;
}

function renderWelcome(activeJobs: DownloadJob[]): string {
  return `
    <div class="welcome-grid">
      <section class="starter-card">
        <div class="starter-visual" aria-hidden="true">
          <span class="pulse-ring ring-one"></span>
          <span class="pulse-ring ring-two"></span>
          <span class="download-glyph">${icon("download")}</span>
        </div>
        <div>
          <h2>Ready when you are</h2>
          <p>Streamdrop supports videos, audio, subtitles, and playlists from sites handled by yt-dlp.</p>
          ${!toolInstalled() ? '<button class="text-button" id="setup-tools" type="button">Set up yt-dlp <span aria-hidden="true">→</span></button>' : ""}
        </div>
      </section>
      ${renderQueue(activeJobs)}
    </div>`;
}

function renderWorkspace(activeJobs: DownloadJob[]): string {
  return `
    <div class="workspace-grid">
      <section class="download-panel">
        ${renderMediaCard()}
        ${renderModePicker()}
        ${renderModeOptions()}
        ${renderPlaylistOptions()}
        ${renderAdvancedOptions()}
        <div class="save-section">
          <label for="save-dir">Save to</label>
          <button class="folder-picker" id="folder-picker" type="button">
            ${icon("folder")}
            <span id="save-dir">${escapeHtml(saveDir || "Choose a folder")}</span>
            <span class="browse-label">Browse</span>
          </button>
        </div>
        ${requiresFfmpeg() && !tools?.ffmpeg.installed ? `
          <div class="requirement-note">
            <span>FF</span>
            <p><strong>FFmpeg may be needed</strong><br />Best-quality merging or conversion needs FFmpeg. You can still try a source-provided combined format.</p>
          </div>` : ""}
        <button class="download-button" id="download-button" type="button" ${!saveDir ? "disabled" : ""}>
          ${icon("download")} Download ${mode === "subtitles" ? "subtitles" : mode}
        </button>
      </section>
      ${renderQueue(activeJobs)}
    </div>`;
}

function formatLabel(format: MediaInfo["formats"][number]): string {
  const parts = [
    format.height ? `${format.height}p` : format.resolution,
    format.fps && format.fps > 30 ? `${Math.round(format.fps)} FPS` : undefined,
    format.extension.toUpperCase(),
    format.dynamicRange && format.dynamicRange !== "SDR" ? format.dynamicRange : undefined,
    format.fileSize ? formatBytes(format.fileSize) : undefined,
  ].filter(Boolean);
  return parts.join(" · ");
}

function renderAdvancedOptions(): string {
  const formats = (media?.formats ?? [])
    .filter((format) => Boolean(format.videoCodec))
    .sort((left, right) => (right.height ?? 0) - (left.height ?? 0) || (right.fps ?? 0) - (left.fps ?? 0))
    .slice(0, 40);
  return `<details class="advanced-options" ${advancedOpen ? "open" : ""}>
    <summary><span><strong>Advanced options</strong><small>Formats, clips, chapters, metadata, and SponsorBlock</small></span><span class="summary-action">${advancedOpen ? "Hide" : "Show"}</span></summary>
    <div class="advanced-body">
      ${mode === "video" && formats.length ? `<label class="wide-field">Exact format <select id="format-select"><option value="auto">Smart automatic choice</option>${formats.map((format) => `<option value="${escapeHtml(format.formatId)}" ${selectedFormatId === format.formatId ? "selected" : ""}>${escapeHtml(formatLabel(format))}</option>`).join("")}</select></label>` : ""}
      <div class="advanced-grid">
        <label>Clip start <input id="clip-start" type="text" placeholder="00:00" value="${escapeHtml(clipStart)}" /></label>
        <label>Clip end <input id="clip-end" type="text" placeholder="00:30" value="${escapeHtml(clipEnd)}" /></label>
        <label>SponsorBlock <select id="sponsorblock-select">
          <option value="off" ${sponsorblockMode === "off" ? "selected" : ""}>Keep everything</option>
          <option value="mark" ${sponsorblockMode === "mark" ? "selected" : ""}>Mark sections</option>
          <option value="remove" ${sponsorblockMode === "remove" ? "selected" : ""}>Remove common segments</option>
          <option value="remove-sponsors-intros" ${sponsorblockMode === "remove-sponsors-intros" ? "selected" : ""}>Remove sponsors + intros</option>
        </select></label>
        <label class="switch-row"><input id="split-chapters" type="checkbox" ${splitChapters ? "checked" : ""} /><span><strong>Split chapters</strong><small>${media?.chapters.length ? `${media.chapters.length} chapters detected` : "When chapters are available"}</small></span></label>
      </div>
      <div class="feature-toggles">
        ${advancedToggle("embed-thumbnail", "Embed thumbnail", settings.embedThumbnail)}
        ${advancedToggle("embed-metadata", "Embed metadata", settings.embedMetadata)}
        ${advancedToggle("embed-subtitles", "Embed subtitles", settings.embedSubtitles)}
        ${advancedToggle("save-description", "Save description", settings.saveDescription)}
        ${advancedToggle("save-thumbnail", "Save thumbnail", settings.saveThumbnail)}
        ${advancedToggle("preserve-date", "Preserve upload date", settings.preserveUploadDate)}
      </div>
    </div>
  </details>`;
}

function advancedToggle(id: string, label: string, checked: boolean): string {
  return `<label class="feature-toggle"><input id="${id}" type="checkbox" ${checked ? "checked" : ""} /><span>${label}</span></label>`;
}

function renderMediaCard(): string {
  if (!media) return "";
  const meta = [
    media.uploader,
    media.mediaType === "playlist" ? `${media.playlistCount ?? media.entries.length} items` : formatDuration(media.duration),
  ].filter(Boolean);
  return `<article class="media-card">
    <div class="thumbnail ${media.thumbnail ? "" : "empty"}">
      ${media.thumbnail ? `<img src="${escapeHtml(media.thumbnail)}" alt="" referrerpolicy="no-referrer" />` : icon("download")}
      ${media.mediaType === "video" ? `<span>${escapeHtml(formatDuration(media.duration))}</span>` : ""}
    </div>
    <div class="media-copy">
      <span class="media-badge">${media.mediaType === "playlist" ? "Playlist" : "Ready"}</span>
      <h2 title="${escapeHtml(media.title)}">${escapeHtml(media.title)}</h2>
      <p>${meta.map(escapeHtml).join(" <span>•</span> ")}</p>
    </div>
    <button class="icon-button" id="clear-media" type="button" aria-label="Clear analyzed link">${icon("close")}</button>
  </article>`;
}

function renderModePicker(): string {
  const modes: Array<{ value: DownloadMode; title: string; hint: string }> = [
    { value: "video", title: "Video", hint: "Picture + sound" },
    { value: "audio", title: "Audio", hint: "Music or speech" },
    { value: "subtitles", title: "Subtitles", hint: "Caption files" },
  ];
  return `<fieldset class="mode-picker">
    <legend>What would you like?</legend>
    <div class="mode-options">
      ${modes.map((item) => `<label class="mode-option ${mode === item.value ? "selected" : ""}">
        <input type="radio" name="mode" value="${item.value}" ${mode === item.value ? "checked" : ""} />
        <span class="mode-symbol ${item.value}">${item.value === "video" ? "▶" : item.value === "audio" ? "♪" : "CC"}</span>
        <span><strong>${item.title}</strong><small>${item.hint}</small></span>
        <span class="radio-mark"></span>
      </label>`).join("")}
    </div>
  </fieldset>`;
}

function renderModeOptions(): string {
  if (mode === "video") {
    return `<div class="option-grid">
      <label>Quality
        <select id="quality-select">
          ${qualityOptions().map((option) => `<option value="${option.value}" ${quality === option.value ? "selected" : ""} ${option.disabled ? "disabled" : ""}>${option.label}</option>`).join("")}
        </select>
      </label>
      <label>File type
        <select id="container-select">
          ${["auto", "mp4", "webm", "mkv"].map((value) => `<option value="${value}" ${container === value ? "selected" : ""}>${value === "auto" ? "Automatic" : value.toUpperCase()}</option>`).join("")}
        </select>
      </label>
    </div>`;
  }
  if (mode === "audio") {
    return `<div class="option-grid">
      <label>Audio format
        <select id="audio-format-select">
          ${["best", "mp3", "m4a", "opus", "flac", "wav"].map((value) => `<option value="${value}" ${audioFormat === value ? "selected" : ""}>${value === "best" ? "Best original audio" : value.toUpperCase()}</option>`).join("")}
        </select>
      </label>
      <label>Audio quality
        <select id="audio-quality-select">
          ${["320K", "256K", "192K", "128K"].map((value) => `<option value="${value}" ${audioQuality === value ? "selected" : ""}>${value.replace("K", " kbps")}</option>`).join("")}
        </select>
      </label>
    </div>`;
  }
  const tracks = media?.subtitles ?? [];
  return `<div class="subtitle-options">
    <div class="option-grid single">
      <label>Subtitle format
        <select id="subtitle-format-select">
          ${["best", "srt", "vtt", "ass"].map((value) => `<option value="${value}" ${subtitleFormat === value ? "selected" : ""}>${value === "best" ? "Best available" : value.toUpperCase()}</option>`).join("")}
        </select>
      </label>
    </div>
    <div class="language-header"><span>Languages</span><button class="text-button compact" id="toggle-languages" type="button">${selectedSubtitleLanguages.size === tracks.length && tracks.length ? "Clear" : "Select all"}</button></div>
    ${tracks.length ? `<div class="language-list">
      ${tracks.map((track) => `<label class="language-chip ${selectedSubtitleLanguages.has(track.language) ? "selected" : ""}">
        <input type="checkbox" value="${escapeHtml(track.language)}" ${selectedSubtitleLanguages.has(track.language) ? "checked" : ""} />
        <span>${escapeHtml(track.label || track.language)}</span>${track.automatic ? "<small>Auto</small>" : ""}
      </label>`).join("")}
    </div>` : '<p class="empty-message">No subtitle tracks were reported for this link.</p>'}
  </div>`;
}

function renderPlaylistOptions(): string {
  if (!media || media.mediaType !== "playlist") return "";
  return `<details class="playlist-options">
    <summary>
      <span><strong>Playlist items</strong><small>${playlistSelection === "all" ? `All ${media.entries.length} items` : `${selectedPlaylistItems.size} selected`}</small></span>
      <span class="summary-action">Choose</span>
    </summary>
    <div class="playlist-toolbar">
      <button class="segmented ${playlistSelection === "all" ? "active" : ""}" id="playlist-all" type="button">All items</button>
      <button class="segmented ${playlistSelection === "selected" ? "active" : ""}" id="playlist-custom" type="button">Choose items</button>
    </div>
    ${playlistSelection === "selected" ? `<div class="playlist-list">
      ${media.entries.map((entry, position) => {
        const index = entry.index ?? position + 1;
        return `<label class="playlist-row">
          <input type="checkbox" value="${index}" ${selectedPlaylistItems.has(index) ? "checked" : ""} />
          <span class="playlist-number">${index}</span>
          <span class="playlist-title">${escapeHtml(entry.title)}</span>
          <small>${escapeHtml(formatDuration(entry.duration))}</small>
        </label>`;
      }).join("")}
    </div>` : ""}
  </details>`;
}

function renderQueue(activeJobs: DownloadJob[]): string {
  return `<aside class="queue-panel" aria-labelledby="queue-title">
    <div class="section-heading">
      <div><span class="heading-icon">${icon("queue")}</span><h2 id="queue-title">Downloads</h2></div>
      ${activeJobs.some((job) => !isRunning(job.kind)) ? '<button class="text-button compact" id="clear-finished" type="button">Clear finished</button>' : ""}
    </div>
    ${activeJobs.length ? `<div class="job-list">${activeJobs.map(renderJob).join("")}</div>` : `<div class="empty-queue">
      <span>${icon("download")}</span>
      <h3>Your queue is empty</h3>
      <p>Downloads will appear here with live progress.</p>
    </div>`}
  </aside>`;
}

function renderJob(job: DownloadJob): string {
  const percent = Math.min(100, Math.max(0, job.percent ?? (job.kind === "completed" ? 100 : 0)));
  const detail = job.kind === "failed"
    ? job.message ?? "The download could not finish"
    : job.kind === "completed"
      ? job.path ?? "Saved successfully"
      : [
          job.downloadedBytes !== undefined ? `${formatBytes(job.downloadedBytes)}${job.totalBytes ? ` of ${formatBytes(job.totalBytes)}` : ""}` : null,
          job.speed ? `${formatBytes(job.speed)}/s` : null,
          job.eta !== undefined ? `${formatDuration(job.eta)} left` : null,
        ].filter(Boolean).join(" · ") || "Getting things ready…";
  return `<article class="job-card ${escapeHtml(job.kind)}">
    <div class="job-topline">
      <span class="job-mode">${job.mode === "video" ? "▶" : job.mode === "audio" ? "♪" : "CC"}</span>
      <div><h3>${escapeHtml(job.title ?? media?.title ?? "Media download")}</h3><p>${escapeHtml(statusLabel(job.kind))}</p></div>
      <div class="job-actions">
        ${isRunning(job.kind) ? `<button class="icon-button cancel-job" data-job-id="${escapeHtml(job.jobId)}" type="button" aria-label="Cancel download">${icon("cancel")}</button>` : ""}
        ${job.kind === "failed" && job.request ? `<button class="icon-button retry-job" data-job-id="${escapeHtml(job.jobId)}" type="button" aria-label="Retry download">${icon("retry")}</button>` : ""}
        ${job.kind === "completed" && job.path ? `<button class="icon-button queue-open" data-path="${escapeHtml(job.path)}" type="button" aria-label="Open downloaded file">${icon("open")}</button><button class="icon-button queue-reveal" data-path="${escapeHtml(job.path)}" type="button" aria-label="Show downloaded file in folder">${icon("folder")}</button>` : ""}
      </div>
    </div>
    <div class="progress-track" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(percent)}">
      <span style="width:${percent}%"></span>
    </div>
    <div class="job-detail"><span title="${escapeHtml(detail)}">${escapeHtml(detail)}</span><strong>${job.percent !== undefined ? `${Math.round(job.percent)}%` : ""}</strong></div>
  </article>`;
}

function renderToolsPanel(): string {
  const yt = tools?.ytDlp;
  const ffmpeg = tools?.ffmpeg;
  const updateAvailable = Boolean(yt?.version && latestRelease?.version && yt.version !== latestRelease.version);
  return `<div class="modal-backdrop" id="tools-backdrop">
    <section class="tools-panel" role="dialog" aria-modal="true" aria-labelledby="tools-title">
      <div class="panel-header">
        <div><p class="eyebrow">Managed dependencies</p><h2 id="tools-title">Tools</h2></div>
        <button class="icon-button" id="close-tools" type="button" aria-label="Close tools">${icon("close")}</button>
      </div>
      <p class="panel-intro">Streamdrop keeps its downloader tools together in the app folder. No terminal setup required.</p>
      <article class="tool-card">
        <div class="tool-logo yt">yt</div>
        <div class="tool-copy">
          <div class="tool-title"><h3>yt-dlp</h3><span class="tool-state ${yt?.installed ? "installed" : "missing"}">${yt?.installed ? "Installed" : "Required"}</span></div>
          <p>${yt?.installed ? `Version ${escapeHtml(yt.version)}` : "The download engine Streamdrop uses to understand media links."}</p>
          <small title="${escapeHtml(yt?.path)}">${escapeHtml(yt?.path ?? "Checking app folder…")}</small>
          ${installing ? `<div class="install-progress"><span style="width:${Math.max(2, installProgress?.percent ?? 2)}%"></span></div><p class="install-label">Downloading ${installProgress?.percent ? `${Math.round(installProgress.percent)}%` : "…"}</p>` : ""}
        </div>
        <button class="secondary-button install-tool" id="install-yt-dlp" type="button" ${installing || !inTauri ? "disabled" : ""}>
          ${installing ? '<span class="spinner"></span>' : icon("download")}
          ${yt?.installed ? (updateAvailable ? "Update" : "Reinstall") : "Download"}
        </button>
      </article>
      <article class="tool-card">
        <div class="tool-logo ff">FF</div>
        <div class="tool-copy">
          <div class="tool-title"><h3>FFmpeg</h3><span class="tool-state ${ffmpeg?.installed ? "installed" : "planned"}">${ffmpeg?.installed ? "Detected" : "Optional"}</span></div>
          <p>${ffmpeg?.installed ? `Version ${escapeHtml(ffmpeg.version)}` : "Enables best-quality merging, conversion, and media embedding."}</p>
          <small>${ffmpeg?.installed ? escapeHtml(ffmpeg.path) : "Gyan.dev release-essentials ZIP · SHA-256 verified"}</small>
          ${installingFfmpeg ? `<div class="install-progress"><span style="width:${Math.max(2, ffmpegInstallProgress?.percent ?? 2)}%"></span></div><p class="install-label">Downloading ${ffmpegInstallProgress?.percent ? `${Math.round(ffmpegInstallProgress.percent)}%` : "…"}</p>` : ""}
        </div>
        <button class="secondary-button" id="install-ffmpeg" type="button" ${installingFfmpeg || !inTauri ? "disabled" : ""}>${installingFfmpeg ? '<span class="spinner"></span>' : icon("download")}${ffmpeg?.installed ? "Reinstall" : "Download"}</button>
      </article>
      <div class="tool-footer">
        <div>
          ${latestRelease ? `<span>Latest official yt-dlp: <strong>${escapeHtml(latestRelease.version)}</strong></span>` : "<span>Check the official release without installing it.</span>"}
        </div>
        <button class="text-button" id="check-latest" type="button" ${latestLoading ? "disabled" : ""}>${latestLoading ? "Checking…" : "Check for updates"}</button>
      </div>
      ${!inTauri ? '<div class="preview-note">Browser preview: native tool actions are available in the Tauri development window.</div>' : ""}
    </section>
  </div>`;
}

function renderAboutPanel(): string {
  return `<div class="modal-backdrop" id="about-backdrop">
    <section class="tools-panel about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <div class="panel-header">
        <div><p class="eyebrow">Creator & project</p><h2 id="about-title">About Streamdrop</h2></div>
        <button class="icon-button" id="close-about" type="button" aria-label="Close About">${icon("close")}</button>
      </div>

      <article class="creator-card">
        <span class="creator-monogram" aria-hidden="true">M</span>
        <div>
          <span class="about-version">Streamdrop · Version 3</span>
          <h3>Syed Awais Shah</h3>
          <p>MarineoFPS · Creator & developer</p>
        </div>
      </article>

      <p class="about-message">Built to make powerful media downloads feel simple, approachable, and free from command-line friction.</p>

      <div class="about-section-heading"><span>Connect</span></div>
      <nav class="about-links" aria-label="Creator contact links">
        <a class="about-link external-link" href="mailto:shahwais35@gmail.com">
          <span class="about-link-icon">${icon("mail")}</span>
          <span><strong>Email</strong><small>shahwais35@gmail.com</small></span>
          <span class="link-arrow" aria-hidden="true">→</span>
        </a>
        <a class="about-link external-link" href="https://marineofps.dev" target="_blank" rel="noreferrer">
          <span class="about-link-icon">${icon("globe")}</span>
          <span><strong>Website</strong><small>marineofps.dev</small></span>
          <span class="link-arrow" aria-hidden="true">↗</span>
        </a>
        <a class="about-link external-link" href="https://discord.com/invite/b3KebadbpA" target="_blank" rel="noreferrer">
          <span class="about-link-icon">${icon("chat")}</span>
          <span><strong>Discord</strong><small>Join the community</small></span>
          <span class="link-arrow" aria-hidden="true">↗</span>
        </a>
        <a class="about-link external-link" href="https://youtube.com/@LearnwithMarineo" target="_blank" rel="noreferrer">
          <span class="about-link-icon">${icon("youtube")}</span>
          <span><strong>YouTube</strong><small>@LearnwithMarineo</small></span>
          <span class="link-arrow" aria-hidden="true">↗</span>
        </a>
      </nav>

      <div class="about-section-heading support-heading">${icon("heart")}<span>Support development</span></div>
      <p class="support-intro">If Streamdrop helps you, donations help support its continued development.</p>
      <div class="donation-list">
        <article class="donation-card">
          <span class="payment-mark payoneer" aria-hidden="true">P</span>
          <div class="donation-copy"><h3>Payoneer</h3><p>Account ID</p></div>
          <code>44036104</code>
          <button class="copy-donation" data-copy="44036104" type="button">${icon("copy")}<span class="copy-label">Copy</span></button>
        </article>
        <article class="donation-card">
          <span class="payment-mark skrill" aria-hidden="true">S</span>
          <div class="donation-copy"><h3>Skrill</h3><p>Account ID</p></div>
          <code>393735512</code>
          <button class="copy-donation" data-copy="393735512" type="button">${icon("copy")}<span class="copy-label">Copy</span></button>
        </article>
      </div>
      <p class="donation-note">Please verify the recipient details in your payment app before sending.</p>
    </section>
  </div>`;
}

function renderSettingsPanel(): string {
  return `<div class="modal-backdrop" id="settings-backdrop">
    <section class="tools-panel settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div class="panel-header">
        <div><p class="eyebrow">Your defaults</p><h2 id="settings-title">Settings</h2></div>
        <button class="icon-button" id="close-settings" type="button" aria-label="Close Settings">${icon("close")}</button>
      </div>
      <p class="panel-intro">Choose sensible defaults once. You can still override them for an individual download.</p>

      <div class="settings-section"><h3>Downloads</h3>
        <label class="settings-field wide-field">Default save folder
          <button class="folder-picker" id="settings-folder" type="button">${icon("folder")}<span>${escapeHtml(settings.downloadDir)}</span><span class="browse-label">Browse</span></button>
        </label>
        <div class="settings-grid">
          <label class="settings-field">Video quality <select id="setting-quality">${qualityOptions(false).map((option) => `<option value="${option.value}" ${settings.preferredQuality === option.value ? "selected" : ""}>${option.label}</option>`).join("")}</select></label>
          <label class="settings-field">Video container <select id="setting-container">${["auto", "mp4", "mkv", "webm"].map((value) => `<option value="${value}" ${settings.preferredContainer === value ? "selected" : ""}>${value === "auto" ? "Automatic" : value.toUpperCase()}</option>`).join("")}</select></label>
          <label class="settings-field">Audio format <select id="setting-audio">${["best", "mp3", "m4a", "opus", "flac", "wav"].map((value) => `<option value="${value}" ${settings.preferredAudioFormat === value ? "selected" : ""}>${value === "best" ? "Original" : value.toUpperCase()}</option>`).join("")}</select></label>
          <label class="settings-field">Audio quality <select id="setting-audio-quality">${["320K", "256K", "192K", "128K"].map((value) => `<option value="${value}" ${settings.preferredAudioQuality === value ? "selected" : ""}>${value.replace("K", " kbps")}</option>`).join("")}</select></label>
          <label class="settings-field">Filename style <select id="setting-filename">
            <option value="title-id" ${settings.filenameStyle === "title-id" ? "selected" : ""}>Title [ID]</option>
            <option value="title" ${settings.filenameStyle === "title" ? "selected" : ""}>Title only</option>
            <option value="uploader-title" ${settings.filenameStyle === "uploader-title" ? "selected" : ""}>Creator - Title</option>
            <option value="playlist" ${settings.filenameStyle === "playlist" ? "selected" : ""}>Playlist folders</option>
          </select></label>
          <label class="settings-field">Existing files <select id="setting-overwrite"><option value="skip" ${settings.overwriteBehavior === "skip" ? "selected" : ""}>Skip safely</option><option value="overwrite" ${settings.overwriteBehavior === "overwrite" ? "selected" : ""}>Overwrite</option></select></label>
          <label class="settings-field">Signed-in browser <select id="setting-browser"><option value="">Do not use cookies</option>${["edge", "chrome", "firefox", "brave", "vivaldi", "opera"].map((value) => `<option value="${value}" ${settings.cookieBrowser === value ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}</select></label>
        </div>
      </div>

      <div class="settings-section"><h3>Performance</h3><div class="settings-grid">
        <label class="settings-field">Simultaneous downloads <select id="setting-parallel">${[1, 2, 3].map((value) => `<option value="${value}" ${settings.parallelDownloads === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label class="settings-field">Download connections <select id="setting-fragments">${[1, 2, 4, 8, 12, 16].map((value) => `<option value="${value}" ${settings.concurrentFragments === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label class="settings-field">Speed limit <input id="setting-rate" value="${escapeHtml(settings.rateLimit)}" placeholder="Unlimited or 4M" /></label>
        <label class="settings-field">Retries <input id="setting-retries" type="number" min="0" max="100" value="${settings.retries}" /></label>
      </div></div>

      <div class="settings-section"><h3>Automatic extras</h3><div class="settings-toggles">
        ${settingToggle("setting-archive", "Prevent duplicate downloads", settings.archiveEnabled)}
        ${settingToggle("setting-clipboard", "Detect links on the clipboard", settings.clipboardDetection)}
        ${settingToggle("setting-metadata", "Embed metadata", settings.embedMetadata)}
        ${settingToggle("setting-thumbnail", "Embed thumbnail", settings.embedThumbnail)}
        ${settingToggle("setting-subtitles", "Embed subtitles", settings.embedSubtitles)}
        ${settingToggle("setting-date", "Preserve upload date", settings.preserveUploadDate)}
      </div></div>
      <button class="download-button settings-save" id="save-settings" type="button">${icon("check")} Save settings</button>
    </section>
  </div>`;
}

function settingToggle(id: string, label: string, checked: boolean): string {
  return `<label class="settings-toggle"><input id="${id}" type="checkbox" ${checked ? "checked" : ""} /><span><strong>${label}</strong></span></label>`;
}

function renderHistoryPanel(): string {
  return `<div class="modal-backdrop" id="history-backdrop">
    <section class="tools-panel history-panel" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="panel-header">
        <div><p class="eyebrow">Recent activity</p><h2 id="history-title">Download history</h2></div>
        <button class="icon-button" id="close-history" type="button" aria-label="Close History">${icon("close")}</button>
      </div>
      <p class="panel-intro">Open completed files, find their folders, or prepare the same link again.</p>
      ${history.length ? `<div class="history-list">${history.map((entry) => `<article class="history-card">
        <span class="history-mode">${entry.mode === "video" ? "▶" : entry.mode === "audio" ? "♪" : "CC"}</span>
        <div><h3 title="${escapeHtml(entry.title)}">${escapeHtml(entry.title)}</h3><p>${new Date(entry.completedAt).toLocaleString()} · ${escapeHtml(entry.mode)}</p></div>
        <div class="history-actions">
          ${entry.path ? `<button class="icon-button history-open" data-path="${escapeHtml(entry.path)}" type="button" title="Open file">${icon("open")}</button><button class="icon-button history-reveal" data-path="${escapeHtml(entry.path)}" type="button" title="Show in folder">${icon("folder")}</button>` : ""}
          <button class="icon-button history-again" data-url="${escapeHtml(entry.url)}" type="button" title="Download again">${icon("retry")}</button>
        </div>
      </article>`).join("")}</div><button class="text-button clear-history" id="clear-history" type="button">${icon("trash")} Clear history</button>` : `<div class="history-empty">${icon("history")}<h3>No downloads yet</h3><p>Successfully completed downloads will appear here.</p></div>`}
    </section>
  </div>`;
}

function bindEvents(): void {
  document.querySelector(".brand")?.addEventListener("click", (event) => event.preventDefault());
  document.querySelector("#url-input")?.addEventListener("input", (event) => {
    currentUrl = (event.target as HTMLTextAreaElement).value;
    batchUrls = parseUrls(currentUrl);
  });
  document.querySelector("#url-input")?.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Enter") void analyze();
  });
  document.querySelector("#analyze-button")?.addEventListener("click", () => void analyze());
  document.querySelector("#paste-button")?.addEventListener("click", () => void pasteFromClipboard());
  document.querySelector("#dismiss-notice")?.addEventListener("click", () => { notice = null; render(); });
  document.querySelector("#tools-button")?.addEventListener("click", () => { closePanels(); toolsOpen = true; render(); });
  document.querySelector("#about-button")?.addEventListener("click", () => { closePanels(); aboutOpen = true; render(); });
  document.querySelector("#settings-button")?.addEventListener("click", () => { closePanels(); settingsOpen = true; render(); });
  document.querySelector("#history-button")?.addEventListener("click", () => { closePanels(); historyOpen = true; render(); });
  document.querySelector("#setup-tools")?.addEventListener("click", () => { toolsOpen = true; render(); });
  document.querySelector("#close-tools")?.addEventListener("click", () => { toolsOpen = false; render(); });
  document.querySelector("#tools-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) { toolsOpen = false; render(); }
  });
  document.querySelector("#close-about")?.addEventListener("click", () => { aboutOpen = false; render(); });
  document.querySelector("#about-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) { aboutOpen = false; render(); }
  });
  document.querySelector("#close-settings")?.addEventListener("click", () => { settingsOpen = false; render(); });
  document.querySelector("#settings-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) { settingsOpen = false; render(); }
  });
  document.querySelector("#close-history")?.addEventListener("click", () => { historyOpen = false; render(); });
  document.querySelector("#history-backdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) { historyOpen = false; render(); }
  });
  document.querySelectorAll<HTMLAnchorElement>(".external-link").forEach((link) => link.addEventListener("click", (event) => {
    if (!inTauri) return;
    event.preventDefault();
    void invoke("open_external", { url: link.href }).catch((error) => {
      notice = { kind: "error", text: errorMessage(error) };
      render();
    });
  }));
  document.querySelectorAll<HTMLButtonElement>(".copy-donation").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copy;
      if (!value) return;
      const label = button.querySelector<HTMLSpanElement>(".copy-label");
      try {
        await navigator.clipboard.writeText(value);
        if (label) label.textContent = "Copied";
        button.classList.add("copied");
        window.setTimeout(() => {
          if (label) label.textContent = "Copy";
          button.classList.remove("copied");
        }, 1400);
      } catch {
        if (label) label.textContent = "Select ID";
      }
    });
  });
  document.querySelector("#clear-media")?.addEventListener("click", () => {
    media = null;
    selectedSubtitleLanguages.clear();
    selectedPlaylistItems.clear();
    render();
  });
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((input) => input.addEventListener("change", () => {
    mode = input.value as DownloadMode;
    render();
  }));
  document.querySelector<HTMLSelectElement>("#quality-select")?.addEventListener("change", (event) => { quality = (event.target as HTMLSelectElement).value; render(); });
  document.querySelector<HTMLSelectElement>("#container-select")?.addEventListener("change", (event) => { container = (event.target as HTMLSelectElement).value; });
  document.querySelector<HTMLSelectElement>("#audio-format-select")?.addEventListener("change", (event) => { audioFormat = (event.target as HTMLSelectElement).value; render(); });
  document.querySelector<HTMLSelectElement>("#audio-quality-select")?.addEventListener("change", (event) => { audioQuality = (event.target as HTMLSelectElement).value; });
  document.querySelector<HTMLSelectElement>("#subtitle-format-select")?.addEventListener("change", (event) => { subtitleFormat = (event.target as HTMLSelectElement).value; });
  document.querySelector<HTMLDetailsElement>(".advanced-options")?.addEventListener("toggle", (event) => { advancedOpen = (event.target as HTMLDetailsElement).open; });
  document.querySelector<HTMLSelectElement>("#format-select")?.addEventListener("change", (event) => { selectedFormatId = (event.target as HTMLSelectElement).value; });
  document.querySelector<HTMLInputElement>("#clip-start")?.addEventListener("input", (event) => { clipStart = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLInputElement>("#clip-end")?.addEventListener("input", (event) => { clipEnd = (event.target as HTMLInputElement).value; });
  document.querySelector<HTMLSelectElement>("#sponsorblock-select")?.addEventListener("change", (event) => { sponsorblockMode = (event.target as HTMLSelectElement).value; });
  document.querySelector<HTMLInputElement>("#split-chapters")?.addEventListener("change", (event) => { splitChapters = (event.target as HTMLInputElement).checked; });
  bindSettingCheckbox("#embed-thumbnail", "embedThumbnail");
  bindSettingCheckbox("#embed-metadata", "embedMetadata");
  bindSettingCheckbox("#embed-subtitles", "embedSubtitles");
  bindSettingCheckbox("#save-description", "saveDescription");
  bindSettingCheckbox("#save-thumbnail", "saveThumbnail");
  bindSettingCheckbox("#preserve-date", "preserveUploadDate");
  document.querySelectorAll<HTMLInputElement>(".language-chip input").forEach((input) => input.addEventListener("change", () => {
    if (input.checked) selectedSubtitleLanguages.add(input.value);
    else selectedSubtitleLanguages.delete(input.value);
    render();
  }));
  document.querySelector("#toggle-languages")?.addEventListener("click", () => {
    const tracks = media?.subtitles ?? [];
    if (selectedSubtitleLanguages.size === tracks.length) selectedSubtitleLanguages.clear();
    else tracks.forEach((track) => selectedSubtitleLanguages.add(track.language));
    render();
  });
  document.querySelector("#playlist-all")?.addEventListener("click", () => { playlistSelection = "all"; render(); });
  document.querySelector("#playlist-custom")?.addEventListener("click", () => {
    playlistSelection = "selected";
    if (!selectedPlaylistItems.size) media?.entries.forEach((entry, index) => selectedPlaylistItems.add(entry.index ?? index + 1));
    render();
    document.querySelector<HTMLDetailsElement>(".playlist-options")?.setAttribute("open", "");
  });
  document.querySelectorAll<HTMLInputElement>(".playlist-row input").forEach((input) => input.addEventListener("change", () => {
    const index = Number(input.value);
    if (input.checked) selectedPlaylistItems.add(index);
    else selectedPlaylistItems.delete(index);
  }));
  document.querySelector("#folder-picker")?.addEventListener("click", () => void chooseFolder());
  document.querySelector("#download-button")?.addEventListener("click", () => void beginDownload());
  document.querySelectorAll<HTMLButtonElement>(".cancel-job").forEach((button) => button.addEventListener("click", () => void cancelJob(button.dataset.jobId ?? "")));
  document.querySelectorAll<HTMLButtonElement>(".retry-job").forEach((button) => button.addEventListener("click", () => void retryJob(button.dataset.jobId ?? "")));
  document.querySelectorAll<HTMLButtonElement>(".queue-open").forEach((button) => button.addEventListener("click", () => void openNativePath(button.dataset.path ?? "", false)));
  document.querySelectorAll<HTMLButtonElement>(".queue-reveal").forEach((button) => button.addEventListener("click", () => void openNativePath(button.dataset.path ?? "", true)));
  document.querySelector("#clear-finished")?.addEventListener("click", () => {
    for (const [id, job] of jobs) if (!isRunning(job.kind)) jobs.delete(id);
    render();
  });
  document.querySelector("#install-yt-dlp")?.addEventListener("click", () => void installYtDlp());
  document.querySelector("#install-ffmpeg")?.addEventListener("click", () => void installFfmpeg());
  document.querySelector("#check-latest")?.addEventListener("click", () => void checkLatest());
  document.querySelector("#settings-folder")?.addEventListener("click", () => void chooseSettingsFolder());
  document.querySelector("#save-settings")?.addEventListener("click", () => void saveSettingsPanel());
  document.querySelector("#clear-history")?.addEventListener("click", () => void clearDownloadHistory());
  document.querySelectorAll<HTMLButtonElement>(".history-open").forEach((button) => button.addEventListener("click", () => void openNativePath(button.dataset.path ?? "", false)));
  document.querySelectorAll<HTMLButtonElement>(".history-reveal").forEach((button) => button.addEventListener("click", () => void openNativePath(button.dataset.path ?? "", true)));
  document.querySelectorAll<HTMLButtonElement>(".history-again").forEach((button) => button.addEventListener("click", () => {
    currentUrl = button.dataset.url ?? "";
    batchUrls = parseUrls(currentUrl);
    historyOpen = false;
    render();
    void analyze();
  }));
}

type BooleanSettingKey = "embedThumbnail" | "embedMetadata" | "embedSubtitles" | "saveDescription" | "saveThumbnail" | "preserveUploadDate";

function bindSettingCheckbox(selector: string, key: BooleanSettingKey): void {
  document.querySelector<HTMLInputElement>(selector)?.addEventListener("change", (event) => {
    settings[key] = (event.target as HTMLInputElement).checked;
  });
}

function closePanels(): void {
  toolsOpen = false;
  aboutOpen = false;
  settingsOpen = false;
  historyOpen = false;
}

function parseUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[),.;]+$/, "")))];
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    const urls = parseUrls(text);
    if (!urls.length) throw new Error("The clipboard does not contain a web link");
    currentUrl = urls.join("\n");
    batchUrls = urls;
    notice = urls.length > 1 ? { kind: "info", text: `${urls.length} links are ready as one batch.` } : null;
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  }
  render();
}

async function chooseSettingsFolder(): Promise<void> {
  if (!inTauri) {
    const selected = window.prompt("Default download folder", settings.downloadDir);
    if (selected) settings.downloadDir = selected;
    render();
    return;
  }
  const selected = await open({ directory: true, multiple: false, defaultPath: settings.downloadDir, title: "Choose the default download folder" });
  if (typeof selected === "string") {
    settings.downloadDir = selected;
    saveDir = selected;
    render();
  }
}

function fieldValue(id: string): string {
  return document.querySelector<HTMLInputElement | HTMLSelectElement>(id)?.value ?? "";
}

function fieldChecked(id: string): boolean {
  return document.querySelector<HTMLInputElement>(id)?.checked ?? false;
}

async function saveSettingsPanel(): Promise<void> {
  settings = {
    ...settings,
    preferredQuality: fieldValue("#setting-quality"),
    preferredContainer: fieldValue("#setting-container"),
    preferredAudioFormat: fieldValue("#setting-audio"),
    preferredAudioQuality: fieldValue("#setting-audio-quality"),
    filenameStyle: fieldValue("#setting-filename"),
    overwriteBehavior: fieldValue("#setting-overwrite"),
    cookieBrowser: fieldValue("#setting-browser"),
    parallelDownloads: Number(fieldValue("#setting-parallel")),
    concurrentFragments: Number(fieldValue("#setting-fragments")),
    rateLimit: fieldValue("#setting-rate").trim(),
    retries: Number(fieldValue("#setting-retries")),
    archiveEnabled: fieldChecked("#setting-archive"),
    clipboardDetection: fieldChecked("#setting-clipboard"),
    embedMetadata: fieldChecked("#setting-metadata"),
    embedThumbnail: fieldChecked("#setting-thumbnail"),
    embedSubtitles: fieldChecked("#setting-subtitles"),
    preserveUploadDate: fieldChecked("#setting-date"),
  };
  quality = settings.preferredQuality;
  container = settings.preferredContainer;
  audioFormat = settings.preferredAudioFormat;
  saveDir = settings.downloadDir;
  try {
    if (inTauri) await invoke("save_settings", { settings });
    settingsOpen = false;
    notice = { kind: "success", text: "Your download defaults have been saved." };
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  }
  render();
}

async function openNativePath(path: string, reveal: boolean): Promise<void> {
  if (!path) return;
  if (!inTauri) {
    notice = { kind: "info", text: "File actions are available in the desktop development window." };
    render();
    return;
  }
  try { await invoke("open_path", { path, reveal }); }
  catch (error) { notice = { kind: "error", text: errorMessage(error) }; render(); }
}

async function clearDownloadHistory(): Promise<void> {
  try {
    if (inTauri) await invoke("clear_history");
    history = [];
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  }
  render();
}

async function analyze(): Promise<void> {
  const urls = parseUrls(currentUrl);
  if (!urls.length) {
    notice = { kind: "error", text: "Paste a video or playlist link first." };
    render();
    return;
  }
  if (!toolInstalled()) {
    toolsOpen = true;
    notice = { kind: "info", text: "Install yt-dlp once, then Streamdrop can analyze links." };
    render();
    return;
  }
  analyzing = true;
  batchUrls = urls;
  notice = null;
  render();
  try {
    media = await invoke<MediaInfo>("analyze_url", { url: urls[0], cookieBrowser: settings.cookieBrowser || null });
    selectedSubtitleLanguages = new Set(
      media.subtitles.filter((track) => !track.automatic).slice(0, 1).map((track) => track.language),
    );
    selectedPlaylistItems = new Set(media.entries.map((entry, index) => entry.index ?? index + 1));
    playlistSelection = "all";
    selectedFormatId = "auto";
    if (urls.length > 1) notice = { kind: "info", text: `${urls.length} links are ready. These choices will be applied to the whole batch.` };
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  } finally {
    analyzing = false;
    render();
  }
}

async function chooseFolder(): Promise<void> {
  if (!inTauri) {
    const result = window.prompt("Preview save folder", saveDir);
    if (result) saveDir = result;
    render();
    return;
  }
  const selected = await open({ directory: true, multiple: false, defaultPath: saveDir || undefined, title: "Choose where to save downloads" });
  if (typeof selected === "string") {
    saveDir = selected;
    render();
    try {
      await invoke("save_default_download_dir", { path: selected });
    } catch (error) {
      notice = { kind: "error", text: errorMessage(error) };
      render();
    }
  }
}

async function beginDownload(): Promise<void> {
  if (!media || !saveDir) return;
  if (mode === "subtitles" && media.subtitles.length && !selectedSubtitleLanguages.size) {
    notice = { kind: "error", text: "Choose at least one subtitle language." };
    render();
    return;
  }
  if (playlistSelection === "selected" && !selectedPlaylistItems.size) {
    notice = { kind: "error", text: "Choose at least one playlist item." };
    render();
    return;
  }
  if (Boolean(clipStart) !== Boolean(clipEnd)) {
    notice = { kind: "error", text: "Enter both a clip start and clip end time." };
    render();
    return;
  }
  const advancedNeedsFfmpeg = Boolean(clipStart || splitChapters || sponsorblockMode !== "off" || settings.embedThumbnail || settings.embedSubtitles);
  if (advancedNeedsFfmpeg && !tools?.ffmpeg.installed) {
    toolsOpen = true;
    notice = { kind: "info", text: "Install FFmpeg once to use the selected advanced options." };
    render();
    return;
  }
  const baseRequest: Omit<DownloadRequest, "url"> = {
    mode,
    quality,
    container,
    audioFormat,
    audioQuality,
    subtitleFormat,
    subtitleLanguages: [...selectedSubtitleLanguages],
    saveDir,
    playlistItems: media.mediaType === "playlist" && playlistSelection === "selected" ? [...selectedPlaylistItems].sort((a, b) => a - b) : undefined,
    formatId: selectedFormatId === "auto" ? undefined : selectedFormatId,
    filenameStyle: settings.filenameStyle,
    overwriteBehavior: settings.overwriteBehavior,
    cookieBrowser: settings.cookieBrowser || undefined,
    clipStart: clipStart || undefined,
    clipEnd: clipEnd || undefined,
    splitChapters,
    sponsorblockMode,
    embedThumbnail: settings.embedThumbnail,
    embedMetadata: settings.embedMetadata,
    embedSubtitles: settings.embedSubtitles,
    saveDescription: settings.saveDescription,
    saveThumbnail: settings.saveThumbnail,
    preserveUploadDate: settings.preserveUploadDate,
    archiveEnabled: settings.archiveEnabled,
    concurrentFragments: settings.concurrentFragments,
    parallelDownloads: settings.parallelDownloads,
    rateLimit: settings.rateLimit || undefined,
    retries: settings.retries,
  };
  const targets = batchUrls.length > 1 ? batchUrls : [media.url || batchUrls[0] || currentUrl.trim()];
  const results = await Promise.allSettled(targets.map(async (url, index) => {
    const request: DownloadRequest = { ...baseRequest, url };
    const jobId = await invoke<string>("start_download", { request });
    jobs.set(jobId, {
      jobId,
      kind: "queued",
      title: index === 0 ? media?.title : `Batch item ${index + 1}`,
      createdAt: Date.now() + index,
      mode,
      request,
    });
  }));
  const failed = results.filter((result) => result.status === "rejected");
  notice = failed.length
    ? { kind: "error", text: `${targets.length - failed.length} added, ${failed.length} could not be queued: ${errorMessage((failed[0] as PromiseRejectedResult).reason)}` }
    : { kind: "success", text: `${targets.length === 1 ? "Download" : `${targets.length} downloads`} added to the queue.` };
  render();
}

async function cancelJob(jobId: string): Promise<void> {
  try {
    await invoke("cancel_download", { jobId });
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
    render();
  }
}

async function retryJob(jobId: string): Promise<void> {
  const previous = jobs.get(jobId);
  if (!previous?.request) return;
  try {
    const nextId = await invoke<string>("start_download", { request: previous.request });
    jobs.set(nextId, { ...previous, jobId: nextId, kind: "queued", percent: 0, message: undefined, path: undefined, createdAt: Date.now() });
    notice = { kind: "success", text: "The download has been queued again." };
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  }
  render();
}

async function installYtDlp(): Promise<void> {
  installing = true;
  installProgress = null;
  notice = null;
  render();
  try {
    await invoke("install_yt_dlp");
    tools = await invoke<ToolsStatus>("get_tools_status");
    notice = { kind: "success", text: "yt-dlp is installed and ready." };
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  } finally {
    installing = false;
    installProgress = null;
    render();
  }
}

async function installFfmpeg(): Promise<void> {
  installingFfmpeg = true;
  ffmpegInstallProgress = null;
  notice = null;
  render();
  try {
    tools = await invoke<ToolsStatus>("install_ffmpeg");
    notice = { kind: "success", text: "FFmpeg and FFprobe are installed and ready." };
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  } finally {
    installingFfmpeg = false;
    ffmpegInstallProgress = null;
    render();
  }
}

async function checkLatest(): Promise<void> {
  latestLoading = true;
  render();
  try {
    latestRelease = await invoke<ReleaseInfo>("get_latest_yt_dlp_release");
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  } finally {
    latestLoading = false;
    render();
  }
}

async function initialize(): Promise<void> {
  if (!inTauri) {
    tools = {
      ytDlp: { name: "yt-dlp", installed: false, path: "Streamdrop/bin/yt-dlp.exe" },
      ffmpeg: { name: "FFmpeg", installed: false, path: "Streamdrop/bin/ffmpeg.exe" },
      ffprobe: { name: "FFprobe", installed: false, path: "Streamdrop/bin/ffprobe.exe" },
    };
    settings = { ...defaultSettings };
    saveDir = settings.downloadDir;
    applySettingsDefaults();
    setupDropHandling();
    render();
    return;
  }

  const [downloadUnlisten, toolsUnlisten, ffmpegUnlisten] = await Promise.all([
    listen<DownloadEvent>("download-event", ({ payload }) => {
      const current = jobs.get(payload.jobId);
      const next: DownloadJob = {
        ...current,
        ...payload,
        jobId: payload.jobId,
        title: payload.title ?? current?.title,
        path: payload.path ?? current?.path,
        message: payload.message ?? current?.message,
        mode: current?.mode ?? mode,
        createdAt: current?.createdAt ?? Date.now(),
        request: current?.request,
      };
      jobs.set(payload.jobId, next);
      if (payload.kind === "completed") void rememberCompletedDownload(next);
      render();
    }),
    listen<ToolDownloadProgress>("tool-download-progress", ({ payload }) => {
      installProgress = payload;
      render();
    }),
    listen<ToolDownloadProgress>("ffmpeg-download-progress", ({ payload }) => {
      ffmpegInstallProgress = payload;
      render();
    }),
  ]);
  window.addEventListener("beforeunload", () => { downloadUnlisten(); toolsUnlisten(); ffmpegUnlisten(); }, { once: true });

  try {
    const loaded = await Promise.all([
      invoke<ToolsStatus>("get_tools_status"),
      invoke<AppSettings>("get_settings"),
      invoke<HistoryEntry[]>("get_history"),
    ]);
    tools = loaded[0];
    settings = loaded[1];
    history = loaded[2];
    saveDir = settings.downloadDir;
    applySettingsDefaults();
  } catch (error) {
    notice = { kind: "error", text: errorMessage(error) };
  }
  setupDropHandling();
  render();
  void detectClipboardLink();
}

function applySettingsDefaults(): void {
  quality = settings.preferredQuality;
  container = settings.preferredContainer;
  audioFormat = settings.preferredAudioFormat;
  audioQuality = settings.preferredAudioQuality;
}

async function rememberCompletedDownload(job: DownloadJob): Promise<void> {
  if (!job.request || history.some((entry) => entry.id === job.jobId)) return;
  const entry: HistoryEntry = {
    id: job.jobId,
    title: job.title ?? "Completed download",
    url: job.request.url,
    path: job.path,
    mode: job.mode,
    completedAt: Date.now(),
  };
  history = [entry, ...history].slice(0, 200);
  try { await invoke("add_history", { entry }); } catch { /* Keep the current session history usable. */ }
}

async function detectClipboardLink(): Promise<void> {
  if (!settings.clipboardDetection || currentUrl) return;
  try {
    const text = await navigator.clipboard.readText();
    const urls = parseUrls(text);
    if (!urls.length) return;
    currentUrl = urls.join("\n");
    batchUrls = urls;
    notice = { kind: "info", text: `${urls.length > 1 ? `${urls.length} links were` : "A media link was"} detected on your clipboard and is ready to analyze.` };
    render();
  } catch { /* Clipboard permission is optional and never blocks startup. */ }
}

function setupDropHandling(): void {
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !(toolsOpen || aboutOpen || settingsOpen || historyOpen)) return;
    closePanels();
    render();
  });
  window.addEventListener("dragover", (event) => { event.preventDefault(); document.body.classList.add("dragging"); });
  window.addEventListener("dragleave", (event) => { if (!(event.relatedTarget instanceof Node)) document.body.classList.remove("dragging"); });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    void (async () => {
      const droppedText = event.dataTransfer?.getData("text/uri-list") || event.dataTransfer?.getData("text/plain") || "";
      const file = event.dataTransfer?.files?.[0];
      const text = droppedText || (file?.name.toLowerCase().endsWith(".txt") ? await file.text() : "");
      const urls = parseUrls(text);
      if (!urls.length) {
        notice = { kind: "error", text: "Drop one or more web links, or a text file containing links." };
      } else {
        currentUrl = urls.join("\n");
        batchUrls = urls;
        notice = { kind: "info", text: `${urls.length} ${urls.length === 1 ? "link is" : "links are"} ready to analyze.` };
      }
      render();
    })();
  });
}

render();
void initialize();
