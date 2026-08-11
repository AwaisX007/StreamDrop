export interface ToolStatus {
  name: string;
  installed: boolean;
  path: string;
  version?: string;
}

export interface ToolsStatus {
  ytDlp: ToolStatus;
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
}

export interface ReleaseInfo {
  version: string;
  assetName: string;
  downloadUrl: string;
}

export interface ToolDownloadProgress {
  downloadedBytes: number;
  totalBytes?: number;
  percent?: number;
}

export interface FormatOption {
  formatId: string;
  extension: string;
  resolution: string;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  fileSize?: number;
  note?: string;
  bitrate?: number;
  dynamicRange?: string;
  language?: string;
}

export interface Chapter {
  title: string;
  startTime: number;
  endTime: number;
}

export interface SubtitleTrack {
  language: string;
  label: string;
  automatic: boolean;
  formats: string[];
}

export interface PlaylistEntry {
  id: string;
  title: string;
  url: string;
  duration?: number;
  thumbnail?: string;
  index?: number;
}

export interface MediaInfo {
  id: string;
  title: string;
  url: string;
  thumbnail?: string;
  duration?: number;
  uploader?: string;
  mediaType: "video" | "playlist";
  playlistCount?: number;
  entries: PlaylistEntry[];
  formats: FormatOption[];
  subtitles: SubtitleTrack[];
  chapters: Chapter[];
}

export type DownloadMode = "video" | "audio" | "subtitles";

export interface DownloadRequest {
  url: string;
  mode: DownloadMode;
  quality?: string;
  container?: string;
  audioFormat?: string;
  audioQuality?: string;
  subtitleLanguages?: string[];
  subtitleFormat?: string;
  saveDir: string;
  playlistItems?: number[];
  formatId?: string;
  filenameStyle?: string;
  overwriteBehavior?: string;
  cookieBrowser?: string;
  clipStart?: string;
  clipEnd?: string;
  splitChapters?: boolean;
  sponsorblockMode?: string;
  embedThumbnail?: boolean;
  embedMetadata?: boolean;
  embedSubtitles?: boolean;
  saveDescription?: boolean;
  saveThumbnail?: boolean;
  preserveUploadDate?: boolean;
  archiveEnabled?: boolean;
  concurrentFragments?: number;
  parallelDownloads?: number;
  rateLimit?: string;
  retries?: number;
}

export interface DownloadEvent {
  jobId: string;
  kind: string;
  title?: string;
  percent?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speed?: number;
  eta?: number;
  path?: string;
  message?: string;
}

export interface DownloadJob extends DownloadEvent {
  createdAt: number;
  mode: DownloadMode;
  request?: DownloadRequest;
}

export interface AppSettings {
  downloadDir: string;
  preferredQuality: string;
  preferredAudioFormat: string;
  preferredAudioQuality: string;
  preferredContainer: string;
  filenameStyle: string;
  overwriteBehavior: string;
  cookieBrowser: string;
  parallelDownloads: number;
  concurrentFragments: number;
  rateLimit: string;
  retries: number;
  embedThumbnail: boolean;
  embedMetadata: boolean;
  embedSubtitles: boolean;
  saveDescription: boolean;
  saveThumbnail: boolean;
  preserveUploadDate: boolean;
  archiveEnabled: boolean;
  clipboardDetection: boolean;
}

export interface HistoryEntry {
  id: string;
  title: string;
  url: string;
  path?: string;
  mode: DownloadMode;
  completedAt: number;
}
