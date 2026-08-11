fn main() {
    tauri_build::build();

    #[cfg(windows)]
    {
        let resource = std::path::PathBuf::from(
            std::env::var("OUT_DIR").expect("Cargo should provide OUT_DIR"),
        )
        .join("resource.rc");
        embed_resource::compile_for_tests(resource, embed_resource::NONE)
            .manifest_required()
            .expect("failed to embed the Windows manifest in test binaries");
    }
}
