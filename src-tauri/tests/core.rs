use streamdrop_lib::{output_template, parse_progress, quality_selector, readable_process_error, valid_rate_limit, validate_url};

#[test]
fn quality_presets_generate_bounded_selectors() {
    assert_eq!(
        quality_selector(Some("1080")),
        "bv*[height<=1080]+ba/b[height<=1080]"
    );
    assert_eq!(quality_selector(Some("smallest")), "worst*");
    assert_eq!(quality_selector(None), "bv*+ba/b");
}

#[test]
fn progress_parser_accepts_missing_exact_total() {
    let event = parse_progress(
        "job-1",
        "STREAMDROP_PROGRESS\tdownloading\t512\tNA\t1024\t256\t2\t50.0%",
    )
    .expect("progress should parse");
    assert_eq!(event.downloaded_bytes, Some(512));
    assert_eq!(event.total_bytes, Some(1024));
    assert_eq!(event.percent, Some(50.0));
}

#[test]
fn rejects_non_web_urls() {
    assert!(validate_url("file:///secrets.txt").is_err());
    assert!(validate_url("https://example.com/video").is_ok());
}

#[test]
fn friendly_errors_cover_common_failures() {
    assert!(readable_process_error("ERROR: Sign in to confirm your age. Use cookies").contains("signed-in browser"));
    assert!(readable_process_error("ERROR: ffmpeg not found").contains("FFmpeg is required"));
    assert!(readable_process_error("ERROR: connection timed out").contains("connection was interrupted"));
}

#[test]
fn settings_values_map_to_safe_arguments() {
    assert_eq!(output_template(Some("title")), "%(title).180B.%(ext)s");
    assert!(output_template(Some("playlist")).contains("playlist_index"));
    assert!(valid_rate_limit("4M"));
    assert!(valid_rate_limit("1.5G"));
    assert!(!valid_rate_limit("4M --exec"));
}
