use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindowBuilder};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    sync::{Mutex, Semaphore},
};
use tokio_util::sync::CancellationToken;
use url::Url;

const GITHUB_LATEST_RELEASE: &str =
    "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
const FFMPEG_ZIP_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
const FFMPEG_SHA256_URL: &str = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[doc(hidden)]
pub type CommandResult<T> = Result<T, String>;

struct AppState {
    jobs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    download_gate: Arc<Semaphore>,
    next_job: AtomicU64,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            jobs: Arc::new(Mutex::new(HashMap::new())),
            // Six permits allows exact 1/2/3-job limits by acquiring 6/3/2 per job.
            download_gate: Arc::new(Semaphore::new(6)),
            next_job: AtomicU64::new(0),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default)]
    download_dir: String,
    #[serde(default = "default_quality")]
    preferred_quality: String,
    #[serde(default = "default_audio_format")]
    preferred_audio_format: String,
    #[serde(default = "default_audio_quality")]
    preferred_audio_quality: String,
    #[serde(default = "default_container")]
    preferred_container: String,
    #[serde(default = "default_filename_style")]
    filename_style: String,
    #[serde(default = "default_overwrite_behavior")]
    overwrite_behavior: String,
    #[serde(default)]
    cookie_browser: String,
    #[serde(default = "default_parallel_downloads")]
    parallel_downloads: u32,
    #[serde(default = "default_concurrent_fragments")]
    concurrent_fragments: u32,
    #[serde(default)]
    rate_limit: String,
    #[serde(default = "default_retries")]
    retries: u32,
    #[serde(default)]
    embed_thumbnail: bool,
    #[serde(default = "default_true")]
    embed_metadata: bool,
    #[serde(default)]
    embed_subtitles: bool,
    #[serde(default)]
    save_description: bool,
    #[serde(default)]
    save_thumbnail: bool,
    #[serde(default = "default_true")]
    preserve_upload_date: bool,
    #[serde(default = "default_true")]
    archive_enabled: bool,
    #[serde(default = "default_true")]
    clipboard_detection: bool,
}

fn default_quality() -> String { "best".to_owned() }
fn default_audio_format() -> String { "mp3".to_owned() }
fn default_audio_quality() -> String { "320K".to_owned() }
fn default_container() -> String { "mp4".to_owned() }
fn default_filename_style() -> String { "title-id".to_owned() }
fn default_overwrite_behavior() -> String { "skip".to_owned() }
fn default_parallel_downloads() -> u32 { 2 }
fn default_concurrent_fragments() -> u32 { 4 }
fn default_retries() -> u32 { 10 }
fn default_true() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        Self {
            download_dir: String::new(),
            preferred_quality: default_quality(),
            preferred_audio_format: default_audio_format(),
            preferred_audio_quality: default_audio_quality(),
            preferred_container: default_container(),
            filename_style: default_filename_style(),
            overwrite_behavior: default_overwrite_behavior(),
            cookie_browser: String::new(),
            parallel_downloads: default_parallel_downloads(),
            concurrent_fragments: default_concurrent_fragments(),
            rate_limit: String::new(),
            retries: default_retries(),
            embed_thumbnail: false,
            embed_metadata: true,
            embed_subtitles: false,
            save_description: false,
            save_thumbnail: false,
            preserve_upload_date: true,
            archive_enabled: true,
            clipboard_detection: true,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolStatus {
    name: String,
    installed: bool,
    path: String,
    version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolsStatus {
    yt_dlp: ToolStatus,
    ffmpeg: ToolStatus,
    ffprobe: ToolStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseInfo {
    version: String,
    asset_name: String,
    download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ToolDownloadProgress {
    downloaded_bytes: u64,
    total_bytes: Option<u64>,
    percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatOption {
    format_id: String,
    extension: String,
    resolution: String,
    width: Option<u64>,
    height: Option<u64>,
    fps: Option<f64>,
    video_codec: Option<String>,
    audio_codec: Option<String>,
    file_size: Option<u64>,
    note: Option<String>,
    bitrate: Option<f64>,
    dynamic_range: Option<String>,
    language: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Chapter {
    title: String,
    start_time: f64,
    end_time: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubtitleTrack {
    language: String,
    label: String,
    automatic: bool,
    formats: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistEntry {
    id: String,
    title: String,
    url: String,
    duration: Option<f64>,
    thumbnail: Option<String>,
    index: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaInfo {
    id: String,
    title: String,
    url: String,
    thumbnail: Option<String>,
    duration: Option<f64>,
    uploader: Option<String>,
    media_type: String,
    playlist_count: Option<u64>,
    entries: Vec<PlaylistEntry>,
    formats: Vec<FormatOption>,
    subtitles: Vec<SubtitleTrack>,
    chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRequest {
    url: String,
    mode: String,
    quality: Option<String>,
    container: Option<String>,
    audio_format: Option<String>,
    audio_quality: Option<String>,
    subtitle_languages: Option<Vec<String>>,
    subtitle_format: Option<String>,
    save_dir: String,
    playlist_items: Option<Vec<u64>>,
    format_id: Option<String>,
    filename_style: Option<String>,
    overwrite_behavior: Option<String>,
    cookie_browser: Option<String>,
    clip_start: Option<String>,
    clip_end: Option<String>,
    split_chapters: Option<bool>,
    sponsorblock_mode: Option<String>,
    embed_thumbnail: Option<bool>,
    embed_metadata: Option<bool>,
    embed_subtitles: Option<bool>,
    save_description: Option<bool>,
    save_thumbnail: Option<bool>,
    preserve_upload_date: Option<bool>,
    archive_enabled: Option<bool>,
    concurrent_fragments: Option<u32>,
    parallel_downloads: Option<u32>,
    rate_limit: Option<String>,
    retries: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    id: String,
    title: String,
    url: String,
    path: Option<String>,
    mode: String,
    completed_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEvent {
    pub job_id: String,
    pub kind: String,
    pub title: Option<String>,
    pub percent: Option<f64>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed: Option<f64>,
    pub eta: Option<f64>,
    pub path: Option<String>,
    pub message: Option<String>,
}

impl DownloadEvent {
    fn state(job_id: &str, kind: &str) -> Self {
        Self {
            job_id: job_id.to_owned(),
            kind: kind.to_owned(),
            title: None,
            percent: None,
            downloaded_bytes: None,
            total_bytes: None,
            speed: None,
            eta: None,
            path: None,
            message: None,
        }
    }
}

fn managed_bin_dir() -> CommandResult<PathBuf> {
    if let Some(path) = std::env::var_os("STREAMDROP_BIN_DIR") {
        return Ok(PathBuf::from(path));
    }

    let executable = std::env::current_exe()
        .map_err(|error| format!("Could not locate the Streamdrop executable: {error}"))?;
    let parent = executable
        .parent()
        .ok_or_else(|| "The Streamdrop executable has no parent directory".to_owned())?;
    Ok(parent.join("bin"))
}

fn tool_path(name: &str) -> CommandResult<PathBuf> {
    Ok(managed_bin_dir()?.join(name))
}

fn managed_data_dir() -> CommandResult<PathBuf> {
    if let Some(path) = std::env::var_os("STREAMDROP_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    Ok(managed_bin_dir()?
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from("."))
        .join("data"))
}

fn settings_path() -> CommandResult<PathBuf> {
    Ok(managed_data_dir()?.join("settings.json"))
}

fn history_path() -> CommandResult<PathBuf> {
    Ok(managed_data_dir()?.join("history.json"))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn command_for(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[doc(hidden)]
pub fn validate_url(value: &str) -> CommandResult<()> {
    let url = Url::parse(value.trim()).map_err(|_| "Enter a valid web address".to_owned())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only http and https links are supported".to_owned());
    }
    Ok(())
}

async fn installed_version(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let mut output = command_for(path).arg("--version").output().await.ok()?;
    if !output.status.success() {
        output = command_for(path).arg("-version").output().await.ok()?;
    }
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout)
        .lines().next().unwrap_or_default().trim().to_owned();
    (!version.is_empty()).then_some(version)
}

async fn status_for(name: &str, filename: &str) -> CommandResult<ToolStatus> {
    let path = tool_path(filename)?;
    let version = installed_version(&path).await;
    Ok(ToolStatus {
        name: name.to_owned(),
        installed: version.is_some(),
        path: display_path(&path),
        version,
    })
}

#[tauri::command]
async fn get_tools_status() -> CommandResult<ToolsStatus> {
    let (yt_dlp, ffmpeg, ffprobe) = tokio::join!(
        status_for("yt-dlp", "yt-dlp.exe"),
        status_for("FFmpeg", "ffmpeg.exe"),
        status_for("FFprobe", "ffprobe.exe"),
    );

    Ok(ToolsStatus {
        yt_dlp: yt_dlp?,
        ffmpeg: ffmpeg?,
        ffprobe: ffprobe?,
    })
}

fn github_client() -> CommandResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(format!("Streamdrop/{}", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("Could not create the update client: {error}"))
}

fn yt_dlp_asset_name() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "yt-dlp_arm64.exe",
        "x86" => "yt-dlp_x86.exe",
        _ => "yt-dlp.exe",
    }
}

async fn fetch_latest_release() -> CommandResult<(GithubRelease, GithubAsset)> {
    let client = github_client()?;
    let release = client
        .get(GITHUB_LATEST_RELEASE)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|error| format!("Could not contact GitHub: {error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub returned an error: {error}"))?
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("Could not read the yt-dlp release: {error}"))?;

    let wanted = yt_dlp_asset_name();
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name == wanted)
        .cloned()
        .ok_or_else(|| format!("The latest yt-dlp release does not contain {wanted}"))?;
    Ok((release, asset))
}

impl Clone for GithubAsset {
    fn clone(&self) -> Self {
        Self {
            name: self.name.clone(),
            browser_download_url: self.browser_download_url.clone(),
            digest: self.digest.clone(),
        }
    }
}

#[tauri::command]
async fn get_latest_yt_dlp_release() -> CommandResult<ReleaseInfo> {
    let (release, asset) = fetch_latest_release().await?;
    Ok(ReleaseInfo {
        version: release.tag_name,
        asset_name: asset.name,
        download_url: asset.browser_download_url,
    })
}

async fn checksum_from_release(
    client: &reqwest::Client,
    release: &GithubRelease,
    asset: &GithubAsset,
) -> CommandResult<String> {
    if let Some(digest) = asset.digest.as_deref() {
        if let Some(checksum) = digest.strip_prefix("sha256:") {
            return Ok(checksum.to_ascii_lowercase());
        }
    }

    let sums_asset = release
        .assets
        .iter()
        .find(|candidate| candidate.name == "SHA2-256SUMS")
        .ok_or_else(|| "The release does not provide a SHA-256 checksum".to_owned())?;
    let sums = client
        .get(&sums_asset.browser_download_url)
        .send()
        .await
        .map_err(|error| format!("Could not download the checksum list: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The checksum download failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Could not read the checksum list: {error}"))?;

    sums.lines()
        .find_map(|line| {
            let mut parts = line.split_whitespace();
            let checksum = parts.next()?;
            let name = parts.next()?.trim_start_matches('*');
            (name == asset.name).then(|| checksum.to_ascii_lowercase())
        })
        .ok_or_else(|| format!("No checksum was published for {}", asset.name))
}

#[tauri::command]
async fn install_yt_dlp(app: AppHandle) -> CommandResult<ToolStatus> {
    let client = github_client()?;
    let (release, asset) = fetch_latest_release().await?;
    let expected_checksum = checksum_from_release(&client, &release, &asset).await?;
    let bin_dir = managed_bin_dir()?;
    fs::create_dir_all(&bin_dir)
        .await
        .map_err(|error| format!("Could not create the tools folder: {error}"))?;

    let temporary = bin_dir.join("yt-dlp.new.exe");
    let target = bin_dir.join("yt-dlp.exe");
    let backup = bin_dir.join("yt-dlp.backup.exe");
    let _ = fs::remove_file(&temporary).await;

    let response = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|error| format!("Could not download yt-dlp: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The yt-dlp download failed: {error}"))?;
    let total = response.content_length();
    let mut stream = response.bytes_stream();
    let mut file = fs::File::create(&temporary)
        .await
        .map_err(|error| format!("Could not create the temporary download: {error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("The yt-dlp download was interrupted: {error}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Could not save yt-dlp: {error}"))?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        let progress = ToolDownloadProgress {
            downloaded_bytes: downloaded,
            total_bytes: total,
            percent: total.map(|size| downloaded as f64 * 100.0 / size as f64),
        };
        let _ = app.emit("tool-download-progress", progress);
    }
    file.flush()
        .await
        .map_err(|error| format!("Could not finish saving yt-dlp: {error}"))?;
    drop(file);

    let actual_checksum = hex::encode(hasher.finalize());
    if actual_checksum != expected_checksum {
        let _ = fs::remove_file(&temporary).await;
        return Err("The downloaded yt-dlp checksum did not match the official release".to_owned());
    }

    let new_version = installed_version(&temporary)
        .await
        .ok_or_else(|| "The downloaded yt-dlp executable failed validation".to_owned())?;

    if target.exists() {
        let _ = fs::remove_file(&backup).await;
        fs::rename(&target, &backup)
            .await
            .map_err(|error| format!("Could not prepare the existing yt-dlp for update: {error}"))?;
    }

    if let Err(error) = fs::rename(&temporary, &target).await {
        if backup.exists() {
            let _ = fs::rename(&backup, &target).await;
        }
        return Err(format!("Could not install yt-dlp: {error}"));
    }

    Ok(ToolStatus {
        name: "yt-dlp".to_owned(),
        installed: true,
        path: display_path(&target),
        version: Some(new_version),
    })
}

async fn find_file_recursive(root: &Path, wanted: &str) -> Option<PathBuf> {
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let mut entries = fs::read_dir(directory).await.ok()?;
        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
            } else if path.file_name().is_some_and(|name| name.eq_ignore_ascii_case(wanted)) {
                return Some(path);
            }
        }
    }
    None
}

#[tauri::command]
async fn install_ffmpeg(app: AppHandle) -> CommandResult<ToolsStatus> {
    let client = github_client()?;
    let expected_checksum = client
        .get(FFMPEG_SHA256_URL)
        .send().await.map_err(|error| format!("Could not download the FFmpeg checksum: {error}"))?
        .error_for_status().map_err(|error| format!("The FFmpeg checksum request failed: {error}"))?
        .text().await.map_err(|error| format!("Could not read the FFmpeg checksum: {error}"))?
        .split_whitespace().next()
        .filter(|value| value.len() == 64)
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "The FFmpeg provider returned an invalid checksum".to_owned())?;

    let bin_dir = managed_bin_dir()?;
    let temp_root = managed_data_dir()?.join("temp").join(format!(
        "ffmpeg-install-{}",
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
    ));
    let archive = temp_root.join("ffmpeg-release-essentials.zip");
    let extracted = temp_root.join("extracted");
    fs::create_dir_all(&extracted).await.map_err(|error| format!("Could not prepare FFmpeg installation: {error}"))?;

    let install_result: CommandResult<()> = async {
        let response = client
            .get(FFMPEG_ZIP_URL)
            .send().await.map_err(|error| format!("Could not download FFmpeg: {error}"))?
            .error_for_status().map_err(|error| format!("The FFmpeg download failed: {error}"))?;
        let total = response.content_length();
        let mut stream = response.bytes_stream();
        let mut file = fs::File::create(&archive).await.map_err(|error| format!("Could not create the FFmpeg archive: {error}"))?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0_u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| format!("The FFmpeg download was interrupted: {error}"))?;
            file.write_all(&chunk).await.map_err(|error| format!("Could not save FFmpeg: {error}"))?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            let _ = app.emit("ffmpeg-download-progress", ToolDownloadProgress {
                downloaded_bytes: downloaded,
                total_bytes: total,
                percent: total.map(|size| downloaded as f64 * 100.0 / size as f64),
            });
        }
        file.flush().await.map_err(|error| format!("Could not finish saving FFmpeg: {error}"))?;
        drop(file);
        if hex::encode(hasher.finalize()) != expected_checksum {
            return Err("The FFmpeg download failed SHA-256 verification".to_owned());
        }

        let status = command_for(Path::new("tar.exe"))
            .args(["-xf", &display_path(&archive), "-C", &display_path(&extracted)])
            .status().await.map_err(|error| format!("Could not extract the FFmpeg ZIP archive: {error}"))?;
        if !status.success() { return Err("Windows could not extract the FFmpeg ZIP archive".to_owned()); }
        let ffmpeg_source = find_file_recursive(&extracted, "ffmpeg.exe").await.ok_or_else(|| "The archive did not contain ffmpeg.exe".to_owned())?;
        let ffprobe_source = find_file_recursive(&extracted, "ffprobe.exe").await.ok_or_else(|| "The archive did not contain ffprobe.exe".to_owned())?;
        fs::create_dir_all(&bin_dir).await.map_err(|error| format!("Could not create the tools folder: {error}"))?;

        for (source, filename) in [(ffmpeg_source, "ffmpeg.exe"), (ffprobe_source, "ffprobe.exe")] {
            let temporary = bin_dir.join(format!("{filename}.new"));
            let target = bin_dir.join(filename);
            let backup = bin_dir.join(format!("{filename}.backup"));
            let _ = fs::remove_file(&temporary).await;
            fs::copy(source, &temporary).await.map_err(|error| format!("Could not prepare {filename}: {error}"))?;
            if installed_version(&temporary).await.is_none() { return Err(format!("The downloaded {filename} failed validation")); }
            if target.is_file() {
                let _ = fs::remove_file(&backup).await;
                fs::rename(&target, &backup).await.map_err(|error| format!("Could not update {filename}: {error}"))?;
            }
            if let Err(error) = fs::rename(&temporary, &target).await {
                if backup.is_file() { let _ = fs::rename(&backup, &target).await; }
                return Err(format!("Could not install {filename}: {error}"));
            }
            let _ = fs::remove_file(&backup).await;
        }
        Ok(())
    }.await;

    let _ = fs::remove_dir_all(&temp_root).await;
    install_result?;
    get_tools_status().await
}

fn string_field(value: &Value, name: &str) -> Option<String> {
    value.get(name)?.as_str().map(ToOwned::to_owned)
}

fn number_field(value: &Value, name: &str) -> Option<f64> {
    value.get(name)?.as_f64()
}

fn unsigned_field(value: &Value, name: &str) -> Option<u64> {
    value.get(name)?.as_u64()
}

fn best_thumbnail(value: &Value) -> Option<String> {
    string_field(value, "thumbnail").or_else(|| {
        value
            .get("thumbnails")?
            .as_array()?
            .iter()
            .rev()
            .find_map(|thumbnail| string_field(thumbnail, "url"))
    })
}

fn parse_entries(value: &Value) -> Vec<PlaylistEntry> {
    value
        .get("entries")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            if entry.is_null() {
                return None;
            }
            Some(PlaylistEntry {
                id: string_field(entry, "id").unwrap_or_default(),
                title: string_field(entry, "title").unwrap_or_else(|| "Unavailable item".to_owned()),
                url: string_field(entry, "webpage_url")
                    .or_else(|| string_field(entry, "url"))
                    .unwrap_or_default(),
                duration: number_field(entry, "duration"),
                thumbnail: best_thumbnail(entry),
                index: unsigned_field(entry, "playlist_index"),
            })
        })
        .collect()
}

fn parse_formats(value: &Value) -> Vec<FormatOption> {
    value
        .get("formats")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|format| FormatOption {
            format_id: string_field(format, "format_id").unwrap_or_default(),
            extension: string_field(format, "ext").unwrap_or_default(),
            resolution: string_field(format, "resolution")
                .or_else(|| string_field(format, "format_note"))
                .unwrap_or_else(|| "Unknown".to_owned()),
            width: unsigned_field(format, "width"),
            height: unsigned_field(format, "height"),
            fps: number_field(format, "fps"),
            video_codec: string_field(format, "vcodec").filter(|codec| codec != "none"),
            audio_codec: string_field(format, "acodec").filter(|codec| codec != "none"),
            file_size: unsigned_field(format, "filesize")
                .or_else(|| unsigned_field(format, "filesize_approx")),
            note: string_field(format, "format_note"),
            bitrate: number_field(format, "tbr").or_else(|| number_field(format, "abr")),
            dynamic_range: string_field(format, "dynamic_range"),
            language: string_field(format, "language"),
        })
        .collect()
}

fn parse_chapters(value: &Value) -> Vec<Chapter> {
    value
        .get("chapters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|chapter| {
            Some(Chapter {
                title: string_field(chapter, "title").unwrap_or_else(|| "Untitled chapter".to_owned()),
                start_time: number_field(chapter, "start_time")?,
                end_time: number_field(chapter, "end_time")?,
            })
        })
        .collect()
}

fn parse_subtitle_group(value: Option<&Value>, automatic: bool) -> Vec<SubtitleTrack> {
    value
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|tracks| tracks.iter())
        .map(|(language, variants)| {
            let formats = variants
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|variant| string_field(variant, "ext"))
                .collect::<Vec<_>>();
            SubtitleTrack {
                language: language.clone(),
                label: variants
                    .as_array()
                    .and_then(|items| items.first())
                    .and_then(|item| string_field(item, "name"))
                    .unwrap_or_else(|| language.clone()),
                automatic,
                formats,
            }
        })
        .collect()
}

fn parse_media(value: Value, original_url: &str) -> MediaInfo {
    let mut subtitles = parse_subtitle_group(value.get("subtitles"), false);
    subtitles.extend(parse_subtitle_group(value.get("automatic_captions"), true));
    subtitles.sort_by(|left, right| {
        left.automatic
            .cmp(&right.automatic)
            .then_with(|| left.language.cmp(&right.language))
    });

    let entries = parse_entries(&value);
    let media_type = if entries.is_empty() {
        "video"
    } else {
        "playlist"
    };
    MediaInfo {
        id: string_field(&value, "id").unwrap_or_default(),
        title: string_field(&value, "title").unwrap_or_else(|| "Untitled media".to_owned()),
        url: string_field(&value, "webpage_url").unwrap_or_else(|| original_url.to_owned()),
        thumbnail: best_thumbnail(&value),
        duration: number_field(&value, "duration"),
        uploader: string_field(&value, "uploader").or_else(|| string_field(&value, "channel")),
        media_type: media_type.to_owned(),
        playlist_count: unsigned_field(&value, "playlist_count")
            .or_else(|| (!entries.is_empty()).then_some(entries.len() as u64)),
        entries,
        formats: parse_formats(&value),
        subtitles,
        chapters: parse_chapters(&value),
    }
}

#[tauri::command]
async fn analyze_url(url: String, cookie_browser: Option<String>) -> CommandResult<MediaInfo> {
    validate_url(&url)?;
    let yt_dlp = tool_path("yt-dlp.exe")?;
    if !yt_dlp.is_file() {
        return Err("Install yt-dlp from Tools before analyzing a link".to_owned());
    }

    let mut args = vec![
        "--ignore-config".to_owned(),
        "--dump-single-json".to_owned(),
        "--skip-download".to_owned(),
        "--no-warnings".to_owned(),
        "--no-colors".to_owned(),
    ];
    if let Some(browser) = cookie_browser.filter(|value| !value.trim().is_empty()) {
        args.extend(["--cookies-from-browser".to_owned(), browser]);
    }
    args.extend(["--".to_owned(), url.trim().to_owned()]);

    let output = command_for(&yt_dlp)
        .args(args)
        .output()
        .await
        .map_err(|error| format!("Could not start yt-dlp: {error}"))?;

    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        return Err(readable_process_error(&details));
    }

    let value = serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("yt-dlp returned metadata Streamdrop could not read: {error}"))?;
    Ok(parse_media(value, url.trim()))
}

#[doc(hidden)]
pub fn readable_process_error(details: &str) -> String {
    let lower = details.to_ascii_lowercase();
    if lower.contains("sign in") || lower.contains("login") || lower.contains("cookies") {
        return "This media requires a signed-in browser session. Choose your browser in Settings, then try again.".to_owned();
    }
    if lower.contains("private video") || lower.contains("private content") {
        return "This media is private. Confirm that your selected browser account has access.".to_owned();
    }
    if lower.contains("ffmpeg") && (lower.contains("not found") || lower.contains("not installed")) {
        return "FFmpeg is required for this format. Install it from Tools and retry.".to_owned();
    }
    if lower.contains("disk") && (lower.contains("space") || lower.contains("full")) {
        return "There is not enough free disk space in the selected save location.".to_owned();
    }
    if lower.contains("timed out") || lower.contains("connection") || lower.contains("network") {
        return "The connection was interrupted. Check your internet connection and retry.".to_owned();
    }
    if lower.contains("unsupported url") {
        return "This link is not supported by the installed version of yt-dlp.".to_owned();
    }
    details
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().trim_start_matches("ERROR: ").to_owned())
        .unwrap_or_else(|| "yt-dlp could not complete the request".to_owned())
}

#[doc(hidden)]
pub fn quality_selector(quality: Option<&str>) -> String {
    match quality.unwrap_or("best") {
        height @ ("2160" | "1440" | "1080" | "720" | "480") => {
            format!("bv*[height<={height}]+ba/b[height<={height}]")
        }
        "smallest" => "worst*".to_owned(),
        _ => "bv*+ba/b".to_owned(),
    }
}

#[doc(hidden)]
pub fn output_template(style: Option<&str>) -> &'static str {
    match style.unwrap_or("title-id") {
        "title" => "%(title).180B.%(ext)s",
        "uploader-title" => "%(uploader,channel|Unknown)s - %(title).160B [%(id)s].%(ext)s",
        "playlist" => "%(playlist_title|Playlist)s/%(playlist_index)03d - %(title).150B [%(id)s].%(ext)s",
        _ => "%(title).180B [%(id)s].%(ext)s",
    }
}

fn valid_cookie_browser(value: &str) -> bool {
    matches!(value, "brave" | "chrome" | "chromium" | "edge" | "firefox" | "opera" | "vivaldi")
}

#[doc(hidden)]
pub fn valid_rate_limit(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| character.is_ascii_digit() || ".kKmMgG".contains(character))
}

fn build_download_args(request: &DownloadRequest, bin_dir: &Path, data_dir: &Path) -> CommandResult<Vec<String>> {
    let mut args = vec![
        "--ignore-config".to_owned(),
        "--newline".to_owned(),
        "--no-colors".to_owned(),
        "--progress-template".to_owned(),
        "download:STREAMDROP_PROGRESS\t%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s\t%(progress._percent_str)s".to_owned(),
        "--print".to_owned(),
        "before_dl:STREAMDROP_TITLE=%(title)j".to_owned(),
        "--print".to_owned(),
        "after_move:STREAMDROP_FILE=%(filepath)j".to_owned(),
        "--paths".to_owned(),
        request.save_dir.clone(),
        "--output".to_owned(),
        output_template(request.filename_style.as_deref()).to_owned(),
        "--ffmpeg-location".to_owned(),
        display_path(bin_dir),
    ];

    args.push(if request.overwrite_behavior.as_deref() == Some("overwrite") {
        "--force-overwrites".to_owned()
    } else {
        "--no-overwrites".to_owned()
    });

    if let Some(browser) = request.cookie_browser.as_deref().filter(|value| !value.is_empty()) {
        if !valid_cookie_browser(browser) {
            return Err("Choose a supported browser for signed-in downloads".to_owned());
        }
        args.extend(["--cookies-from-browser".to_owned(), browser.to_owned()]);
    }

    let fragments = request.concurrent_fragments.unwrap_or(4).clamp(1, 16);
    args.extend(["--concurrent-fragments".to_owned(), fragments.to_string()]);
    args.extend(["--retries".to_owned(), request.retries.unwrap_or(10).clamp(0, 100).to_string()]);
    args.extend(["--fragment-retries".to_owned(), request.retries.unwrap_or(10).clamp(0, 100).to_string()]);
    if let Some(limit) = request.rate_limit.as_deref().filter(|value| !value.trim().is_empty()) {
        if !valid_rate_limit(limit) {
            return Err("The speed limit must look like 500K, 4M, or 1.5G".to_owned());
        }
        args.extend(["--limit-rate".to_owned(), limit.to_owned()]);
    }

    match request.mode.as_str() {
        "video" => {
            let selector = request
                .format_id
                .as_deref()
                .filter(|value| !value.is_empty())
                .map(|value| format!("{value}+ba/{value}/b"))
                .unwrap_or_else(|| quality_selector(request.quality.as_deref()));
            args.extend(["--format".to_owned(), selector]);
            if let Some(container) = request.container.as_deref().filter(|value| *value != "auto") {
                args.extend(["--merge-output-format".to_owned(), container.to_owned()]);
            }
        }
        "audio" => {
            args.extend(["--format".to_owned(), "ba/b".to_owned()]);
            if let Some(format) = request.audio_format.as_deref().filter(|value| *value != "best") {
                args.extend([
                    "--extract-audio".to_owned(),
                    "--audio-format".to_owned(),
                    format.to_owned(),
                ]);
                if let Some(quality) = request.audio_quality.as_deref().filter(|value| matches!(*value, "320K" | "256K" | "192K" | "128K")) {
                    args.extend(["--audio-quality".to_owned(), quality.to_owned()]);
                }
            }
        }
        "subtitles" => {
            args.extend([
                "--skip-download".to_owned(),
                "--write-subs".to_owned(),
                "--write-auto-subs".to_owned(),
            ]);
            let languages = request
                .subtitle_languages
                .as_ref()
                .filter(|languages| !languages.is_empty())
                .map(|languages| languages.join(","))
                .unwrap_or_else(|| "all".to_owned());
            args.extend(["--sub-langs".to_owned(), languages]);
            if let Some(format) = request.subtitle_format.as_deref().filter(|value| *value != "best") {
                args.extend(["--sub-format".to_owned(), format.to_owned()]);
            }
        }
        _ => return Err("Choose video, audio, or subtitles".to_owned()),
    }

    if let Some(items) = request.playlist_items.as_ref().filter(|items| !items.is_empty()) {
        args.extend([
            "--playlist-items".to_owned(),
            items.iter().map(u64::to_string).collect::<Vec<_>>().join(","),
        ]);
    }

    if let (Some(start), Some(end)) = (
        request.clip_start.as_deref().filter(|value| !value.trim().is_empty()),
        request.clip_end.as_deref().filter(|value| !value.trim().is_empty()),
    ) {
        args.extend(["--download-sections".to_owned(), format!("*{}-{}", start.trim(), end.trim())]);
    }
    if request.split_chapters.unwrap_or(false) {
        args.push("--split-chapters".to_owned());
    }
    match request.sponsorblock_mode.as_deref().unwrap_or("off") {
        "mark" => args.extend(["--sponsorblock-mark".to_owned(), "default".to_owned()]),
        "remove" => args.extend(["--sponsorblock-remove".to_owned(), "default".to_owned()]),
        "remove-sponsors-intros" => args.extend(["--sponsorblock-remove".to_owned(), "sponsor,intro".to_owned()]),
        _ => {}
    }
    if request.embed_thumbnail.unwrap_or(false) { args.push("--embed-thumbnail".to_owned()); }
    if request.embed_metadata.unwrap_or(false) { args.push("--embed-metadata".to_owned()); }
    if request.embed_subtitles.unwrap_or(false) {
        args.extend(["--write-subs".to_owned(), "--write-auto-subs".to_owned(), "--embed-subs".to_owned()]);
    }
    if request.save_description.unwrap_or(false) { args.push("--write-description".to_owned()); }
    if request.save_thumbnail.unwrap_or(false) { args.push("--write-thumbnail".to_owned()); }
    if !request.preserve_upload_date.unwrap_or(true) { args.push("--no-mtime".to_owned()); }
    if request.archive_enabled.unwrap_or(true) {
        args.extend([
            "--download-archive".to_owned(),
            display_path(&data_dir.join("download-archive.txt")),
        ]);
    }
    args.extend(["--".to_owned(), request.url.trim().to_owned()]);
    Ok(args)
}

fn parse_optional_number(value: Option<&&str>) -> Option<f64> {
    value
        .map(|text| text.trim().trim_end_matches('%'))
        .filter(|text| !text.is_empty() && *text != "NA" && *text != "N/A")
        .and_then(|text| text.parse::<f64>().ok())
}

#[doc(hidden)]
pub fn parse_progress(job_id: &str, line: &str) -> Option<DownloadEvent> {
    let content = line.strip_prefix("STREAMDROP_PROGRESS\t")?;
    let fields = content.split('\t').collect::<Vec<_>>();
    let downloaded = parse_optional_number(fields.get(1));
    let exact_total = parse_optional_number(fields.get(2));
    let estimated_total = parse_optional_number(fields.get(3));
    Some(DownloadEvent {
        job_id: job_id.to_owned(),
        kind: fields.first().copied().unwrap_or("downloading").to_owned(),
        title: None,
        percent: parse_optional_number(fields.get(6)),
        downloaded_bytes: downloaded.map(|value| value as u64),
        total_bytes: exact_total.or(estimated_total).map(|value| value as u64),
        speed: parse_optional_number(fields.get(4)),
        eta: parse_optional_number(fields.get(5)),
        path: None,
        message: None,
    })
}

async fn read_stdout(app: AppHandle, job_id: String, stdout: tokio::process::ChildStdout) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if let Some(event) = parse_progress(&job_id, &line) {
            let _ = app.emit("download-event", event);
        } else if let Some(encoded) = line.strip_prefix("STREAMDROP_TITLE=") {
            if let Ok(title) = serde_json::from_str::<String>(encoded) {
                let mut event = DownloadEvent::state(&job_id, "preparing");
                event.title = Some(title);
                let _ = app.emit("download-event", event);
            }
        } else if let Some(encoded) = line.strip_prefix("STREAMDROP_FILE=") {
            if let Ok(path) = serde_json::from_str::<String>(encoded) {
                let mut event = DownloadEvent::state(&job_id, "processing");
                event.path = Some(path);
                let _ = app.emit("download-event", event);
            }
        }
    }
}

async fn read_stderr(stderr: tokio::process::ChildStderr) -> String {
    let mut lines = BufReader::new(stderr).lines();
    let mut recent = Vec::new();
    while let Ok(Some(line)) = lines.next_line().await {
        if !line.trim().is_empty() {
            recent.push(line);
            if recent.len() > 20 {
                recent.remove(0);
            }
        }
    }
    recent.join("\n")
}

async fn run_download(
    app: AppHandle,
    jobs: Arc<Mutex<HashMap<String, CancellationToken>>>,
    download_gate: Arc<Semaphore>,
    job_id: String,
    request: DownloadRequest,
    token: CancellationToken,
) {
    let result = async {
        let parallel_downloads = request.parallel_downloads.unwrap_or(2).clamp(1, 3);
        let permits_per_job = 6 / parallel_downloads;
        let _permit = tokio::select! {
            permit = download_gate.acquire_many_owned(permits_per_job) => {
                permit.map_err(|_| "The download queue is shutting down".to_owned())?
            }
            _ = token.cancelled() => return Ok("cancelled".to_owned()),
        };
        let bin_dir = managed_bin_dir()?;
        let data_dir = managed_data_dir()?;
        let yt_dlp = bin_dir.join("yt-dlp.exe");
        let arguments = build_download_args(&request, &bin_dir, &data_dir)?;
        let mut command = command_for(&yt_dlp);
        command
            .args(arguments)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start yt-dlp: {error}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Could not read yt-dlp progress".to_owned())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Could not read yt-dlp errors".to_owned())?;
        let stdout_task = tokio::spawn(read_stdout(app.clone(), job_id.clone(), stdout));
        let stderr_task = tokio::spawn(read_stderr(stderr));

        let (cancelled, status) = tokio::select! {
            status = child.wait() => (false, Some(status.map_err(|error| format!("Could not monitor yt-dlp: {error}"))?)),
            _ = token.cancelled() => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                (true, None)
            }
        };
        let _ = stdout_task.await;
        let errors = stderr_task.await.unwrap_or_default();
        if cancelled {
            return Ok("cancelled".to_owned());
        }
        if status.is_some_and(|status| status.success()) {
            Ok("completed".to_owned())
        } else {
            Err(readable_process_error(&errors))
        }
    }
    .await;

    let event = match result {
        Ok(kind) => DownloadEvent::state(&job_id, &kind),
        Err(message) => {
            let mut event = DownloadEvent::state(&job_id, "failed");
            event.message = Some(message);
            event
        }
    };
    let _ = app.emit("download-event", event);
    jobs.lock().await.remove(&job_id);
}

#[tauri::command]
async fn start_download(
    app: AppHandle,
    state: State<'_, AppState>,
    request: DownloadRequest,
) -> CommandResult<String> {
    validate_url(&request.url)?;
    let yt_dlp = tool_path("yt-dlp.exe")?;
    if !yt_dlp.is_file() {
        return Err("Install yt-dlp from Tools before downloading".to_owned());
    }
    let save_dir = PathBuf::from(request.save_dir.trim());
    if request.save_dir.trim().is_empty() {
        return Err("Choose a save folder".to_owned());
    }
    fs::create_dir_all(&save_dir)
        .await
        .map_err(|error| format!("Could not use the save folder: {error}"))?;
    if !save_dir.is_dir() {
        return Err("The selected save location is not a folder".to_owned());
    }

    let id = state.next_job.fetch_add(1, Ordering::Relaxed);
    let job_id = format!("job-{id}");
    let token = CancellationToken::new();
    let jobs = state.jobs.clone();
    let download_gate = state.download_gate.clone();
    jobs.lock().await.insert(job_id.clone(), token.clone());
    let task_job_id = job_id.clone();
    tauri::async_runtime::spawn(run_download(
        app,
        jobs,
        download_gate,
        task_job_id,
        request,
        token,
    ));
    Ok(job_id)
}

#[tauri::command]
async fn cancel_download(state: State<'_, AppState>, job_id: String) -> CommandResult<()> {
    let token = state.jobs.lock().await.get(&job_id).cloned();
    if let Some(token) = token {
        token.cancel();
        Ok(())
    } else {
        Err("That download is no longer running".to_owned())
    }
}

#[tauri::command]
async fn default_download_dir() -> String {
    get_settings().await
        .map(|settings| settings.download_dir)
        .unwrap_or_else(|_| managed_data_dir()
        .unwrap_or_else(|_| PathBuf::from("data"))
        .join("downloads")
        .to_string_lossy()
        .into_owned())
}

#[tauri::command]
async fn save_default_download_dir(path: String) -> CommandResult<()> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Choose a save folder".to_owned());
    }
    let download_dir = PathBuf::from(trimmed);
    fs::create_dir_all(&download_dir)
        .await
        .map_err(|error| format!("Could not use the save folder: {error}"))?;
    let mut settings = get_settings().await?;
    settings.download_dir = trimmed.to_owned();
    save_settings(settings).await
}

#[tauri::command]
async fn get_settings() -> CommandResult<Settings> {
    let mut settings = if let Ok(contents) = fs::read(settings_path()?).await {
        serde_json::from_slice::<Settings>(&contents).unwrap_or_default()
    } else {
        Settings::default()
    };
    if settings.download_dir.trim().is_empty() {
        settings.download_dir = managed_data_dir()?.join("downloads").to_string_lossy().into_owned();
    }
    Ok(settings)
}

#[tauri::command]
async fn save_settings(mut settings: Settings) -> CommandResult<()> {
    settings.parallel_downloads = settings.parallel_downloads.clamp(1, 3);
    settings.concurrent_fragments = settings.concurrent_fragments.clamp(1, 16);
    settings.retries = settings.retries.clamp(0, 100);
    if settings.download_dir.trim().is_empty() {
        return Err("Choose a default download folder".to_owned());
    }
    fs::create_dir_all(&settings.download_dir)
        .await
        .map_err(|error| format!("Could not use the download folder: {error}"))?;
    let target = settings_path()?;
    if let Some(parent) = target.parent() { fs::create_dir_all(parent).await.map_err(|error| error.to_string())?; }
    let contents = serde_json::to_vec_pretty(&settings).map_err(|error| error.to_string())?;
    fs::write(target, contents).await.map_err(|error| format!("Could not save settings: {error}"))
}

#[tauri::command]
async fn get_history() -> CommandResult<Vec<HistoryEntry>> {
    let path = history_path()?;
    if !path.is_file() { return Ok(Vec::new()); }
    let contents = fs::read(path).await.map_err(|error| format!("Could not read history: {error}"))?;
    serde_json::from_slice(&contents).map_err(|error| format!("Could not read history: {error}"))
}

#[tauri::command]
async fn add_history(entry: HistoryEntry) -> CommandResult<()> {
    let mut history = get_history().await.unwrap_or_default();
    history.retain(|existing| existing.id != entry.id);
    history.insert(0, entry);
    history.truncate(200);
    let target = history_path()?;
    if let Some(parent) = target.parent() { fs::create_dir_all(parent).await.map_err(|error| error.to_string())?; }
    let contents = serde_json::to_vec_pretty(&history).map_err(|error| error.to_string())?;
    fs::write(target, contents).await.map_err(|error| format!("Could not save history: {error}"))
}

#[tauri::command]
async fn clear_history() -> CommandResult<()> {
    let target = history_path()?;
    if target.is_file() { fs::write(target, b"[]").await.map_err(|error| format!("Could not clear history: {error}"))?; }
    Ok(())
}

#[tauri::command]
async fn open_path(path: String, reveal: Option<bool>) -> CommandResult<()> {
    let target = PathBuf::from(path.trim());
    if !target.exists() { return Err("That file or folder no longer exists".to_owned()); }
    let mut command = Command::new("explorer.exe");
    if reveal.unwrap_or(false) && target.is_file() {
        command.arg(format!("/select,{}", display_path(&target)));
    } else {
        command.arg(target);
    }
    command.spawn().map_err(|error| format!("Could not open that location: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn open_external(url: String) -> CommandResult<()> {
    let allowed = [
        "mailto:shahwais35@gmail.com",
        "https://marineofps.dev",
        "https://marineofps.dev/",
        "https://discord.com/invite/b3KebadbpA",
        "https://youtube.com/@LearnwithMarineo",
    ];
    if !allowed.contains(&url.as_str()) { return Err("That external link is not allowed".to_owned()); }
    Command::new("explorer.exe")
        .arg(url)
        .spawn()
        .map_err(|error| format!("Could not open the system browser: {error}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_tools_status,
            get_latest_yt_dlp_release,
            install_yt_dlp,
            install_ffmpeg,
            analyze_url,
            start_download,
            cancel_download,
            default_download_dir,
            save_default_download_dir,
            get_settings,
            save_settings,
            get_history,
            add_history,
            clear_history,
            open_path,
            open_external,
        ])
        .setup(|app| {
            let bin_dir = managed_bin_dir().map_err(std::io::Error::other)?;
            std::fs::create_dir_all(bin_dir)?;
            let webview_data = managed_data_dir()
                .map_err(std::io::Error::other)?
                .join("webview");
            std::fs::create_dir_all(&webview_data)?;
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Streamdrop")
                .inner_size(1000.0, 760.0)
                .min_inner_size(760.0, 620.0)
                .center()
                .data_directory(webview_data)
                .disable_drag_drop_handler()
                .enable_clipboard_access()
                .visible(true)
                .focused(true)
                .build()?;
            window.show()?;
            window.set_focus()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Streamdrop");
}
