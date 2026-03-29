mod adb_plugin;
mod stream_decoder;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .invoke_handler(tauri::generate_handler![
      adb_plugin::tauri_adb_list_devices,
      adb_plugin::tauri_adb_pair,
      adb_plugin::tauri_adb_connect,
      adb_plugin::tauri_adb_screenshot,
      adb_plugin::tauri_adb_capture_still,
      adb_plugin::tauri_adb_capture_still_stream,
      adb_plugin::tauri_adb_shell,
      adb_plugin::tauri_adb_push,
      adb_plugin::tauri_adb_forward,
      adb_plugin::tauri_adb_remove_forward,
      adb_plugin::tauri_adb_start_server,
      adb_plugin::tauri_adb_stop_server,
      stream_decoder::tauri_scanner_start_stream,
      stream_decoder::tauri_scanner_stop_stream,
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
