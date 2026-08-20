mod adb_plugin;
pub mod scan_enhance;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .register_uri_scheme_protocol("skidhw", |_ctx, request| {
            scan_enhance::handle_protocol(request)
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            adb_plugin::tauri_adb_list_devices,
            adb_plugin::tauri_adb_pair,
            adb_plugin::tauri_adb_connect,
            adb_plugin::tauri_adb_push,
            adb_plugin::tauri_adb_forward,
            adb_plugin::tauri_adb_remove_forward,
            adb_plugin::tauri_adb_screenshot,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
