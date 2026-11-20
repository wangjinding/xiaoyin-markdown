// 小银 Markdown —— Tauri 2 后端
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_dialog::DialogExt;

const MD_EXTS: [&str; 6] = ["md", "markdown", "mdown", "mkd", "mdwn", "txt"];

/// 首次启动时 argv 里的文件只发一次（页面重载/多窗口不重复发）
static STARTUP_FILE_SENT: std::sync::Once = std::sync::Once::new();

/* ---------------- 数据结构 ---------------- */

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DocResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    eol: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

impl DocResult {
    fn ok(path: &Path, text: String, eol: String) -> Self {
        DocResult {
            ok: true,
            canceled: None,
            path: Some(path.to_string_lossy().to_string()),
            name: Some(path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()),
            text: Some(text),
            eol: Some(eol),
            error: None,
        }
    }
    fn canceled() -> Self {
        DocResult { ok: false, canceled: Some(true), path: None, name: None, text: None, eol: None, error: None }
    }
    fn err(msg: String) -> Self {
        DocResult { ok: false, canceled: None, path: None, name: None, text: None, eol: None, error: Some(msg) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DirResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    entries: Option<Vec<Entry>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/* ---------------- 工具函数 ---------------- */

fn smart_read(path: &Path) -> Result<(String, String), String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut text = String::from_utf8_lossy(&bytes).to_string();
    if let Some(stripped) = text.clone().strip_prefix('\u{feff}') {
        text = stripped.to_string();
    }
    let eol = if text.contains("\r\n") { "\r\n" } else { "\n" }.to_string();
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    Ok((text, eol))
}

fn smart_write(path: &Path, content: &str, eol: &str) -> Result<(), String> {
    let text = if eol == "\r\n" { content.replace('\n', "\r\n") } else { content.to_string() };
    fs::write(path, text).map_err(|e| e.to_string())
}

fn is_md_file(name: &str) -> bool {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .map(|e| MD_EXTS.contains(&e.as_str()))
        .unwrap_or(false)
}

fn list_dir(path: &Path) -> Result<Vec<Entry>, String> {
    let mut dirs: Vec<Entry> = Vec::new();
    let mut files: Vec<Entry> = Vec::new();
    for e in fs::read_dir(path).map_err(|e| e.to_string())? {
        let Ok(e) = e else { continue };
        let name = e.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let Ok(ft) = e.file_type() else { continue };
        let is_dir = ft.is_dir();
        if !is_dir && !is_md_file(&name) {
            continue;
        }
        let full = e.path().to_string_lossy().to_string();
        let entry = Entry { name, path: full, is_dir };
        if is_dir {
            dirs.push(entry);
        } else {
            files.push(entry);
        }
    }
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    dirs.extend(files);
    Ok(dirs)
}

fn path_of(fp: tauri_plugin_dialog::FilePath) -> Option<PathBuf> {
    match fp {
        tauri_plugin_dialog::FilePath::Path(p) => Some(p),
        _ => None,
    }
}

/* ---------------- 文件命令 ---------------- */

#[tauri::command]
fn read_text_file(path: String) -> DocResult {
    let p = PathBuf::from(&path);
    match smart_read(&p) {
        Ok((text, eol)) => DocResult::ok(&p, text, eol),
        Err(e) => DocResult::err(e),
    }
}

#[tauri::command]
fn write_text_file(path: String, content: String, eol: String) -> DocResult {
    let p = PathBuf::from(&path);
    match smart_write(&p, &content, &eol) {
        Ok(_) => DocResult::ok(&p, String::new(), eol),
        Err(e) => DocResult::err(e),
    }
}

#[tauri::command]
fn open_file_dialog(window: tauri::WebviewWindow) -> DocResult {
    let picked = window
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown", "mdown", "mkd", "mdwn", "txt"])
        .add_filter("所有文件", &["*"])
        .set_title("打开 Markdown 文件")
        .blocking_pick_file();
    let Some(fp) = picked else { return DocResult::canceled() };
    let Some(p) = path_of(fp) else { return DocResult::canceled() };
    match smart_read(&p) {
        Ok((text, eol)) => DocResult::ok(&p, text, eol),
        Err(e) => DocResult::err(e),
    }
}

#[tauri::command]
fn save_file(
    window: tauri::WebviewWindow,
    content: String,
    save_as: bool,
    eol: String,
    current_path: Option<String>,
) -> DocResult {
    let mut target: Option<PathBuf> = current_path.as_ref().map(PathBuf::from);

    if target.is_none() || save_as || !Path::new(target.as_ref().unwrap()).exists() {
        let default_path = current_path.clone().map(PathBuf::from).unwrap_or_else(|| {
            let doc = window
                .app_handle()
                .path()
                .document_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            doc.join("未命名.md")
        });
        let picked = window
            .dialog()
            .file()
            .add_filter("Markdown", &["md"])
            .add_filter("纯文本", &["txt"])
            .add_filter("所有文件", &["*"])
            .set_file_name(default_path.to_string_lossy().as_ref())
            .set_title(if save_as { "另存为" } else { "保存" })
            .blocking_save_file();
        let Some(fp) = picked else { return DocResult::canceled() };
        let Some(p) = path_of(fp) else { return DocResult::canceled() };
        target = Some(p);
    }

    let p = target.unwrap();
    match smart_write(&p, &content, &eol) {
        Ok(_) => DocResult::ok(&p, String::new(), eol),
        Err(e) => DocResult::err(e),
    }
}

#[tauri::command]
fn open_dir_dialog(window: tauri::WebviewWindow) -> DirResult {
    let picked = window.dialog().file().set_title("选择文件夹").blocking_pick_folder();
    let Some(fp) = picked else {
        return DirResult { ok: false, canceled: Some(true), path: None, name: None, entries: None, error: None };
    };
    let Some(p) = path_of(fp) else {
        return DirResult { ok: false, canceled: Some(true), path: None, name: None, entries: None, error: None };
    };
    match list_dir(&p) {
        Ok(entries) => DirResult {
            ok: true,
            canceled: None,
            path: Some(p.to_string_lossy().to_string()),
            name: Some(p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()),
            entries: Some(entries),
            error: None,
        },
        Err(e) => DirResult { ok: false, canceled: None, path: None, name: None, entries: None, error: Some(e) },
    }
}

#[tauri::command]
fn read_dir(path: String) -> DirResult {
    let p = PathBuf::from(&path);
    match list_dir(&p) {
        Ok(entries) => DirResult {
            ok: true,
            canceled: None,
            path: Some(p.to_string_lossy().to_string()),
            name: Some(p.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()),
            entries: Some(entries),
            error: None,
        },
        Err(e) => DirResult { ok: false, canceled: None, path: None, name: None, entries: None, error: Some(e) },
    }
}

/* ---------------- 剪贴板 ---------------- */

#[tauri::command]
fn copy_file_to_clipboard(path: String) -> Result<(), String> {
    // 手写 CF_HDROP：DROPFILES 头 + 双 \0 结尾的 UTF-16 路径列表
    use windows_sys::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT};
    use windows_sys::Win32::UI::Shell::DROPFILES;

    const CF_HDROP: u32 = 15;

    unsafe {
        if OpenClipboard(std::ptr::null_mut()) == 0 {
            return Err("无法打开剪贴板".into());
        }
        if EmptyClipboard() == 0 {
            CloseClipboard();
            return Err("无法清空剪贴板".into());
        }

        let mut wide: Vec<u16> = path.encode_utf16().collect();
        wide.push(0); // 路径自身的 \0 终止符

        let header_size = std::mem::size_of::<DROPFILES>();
        let list_bytes = (wide.len() + 1) * 2; // +1 是列表级双 \0 结束符
        let total = header_size + list_bytes;

        let h = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total);
        if h.is_null() {
            CloseClipboard();
            return Err("内存分配失败".into());
        }
        let locked = GlobalLock(h);
        if locked.is_null() {
            CloseClipboard();
            return Err("内存锁定失败".into());
        }
        let df = locked as *mut DROPFILES;
        (*df).pFiles = header_size as u32;
        (*df).fWide = 1; // UTF-16
        let dst = (locked as *mut u8).add(header_size);
        std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, dst, wide.len() * 2);
        GlobalUnlock(h);

        if SetClipboardData(CF_HDROP, h).is_null() {
            CloseClipboard();
            return Err("写入剪贴板失败".into());
        }
        CloseClipboard();
    }
    Ok(())
}

#[tauri::command]
fn read_clipboard_text() -> String {
    use clipboard_win::formats;
    use clipboard_win::get_clipboard;
    get_clipboard(formats::Unicode).unwrap_or_default()
}

#[tauri::command]
fn write_clipboard_text(text: String) -> Result<(), String> {
    use clipboard_win::formats;
    use clipboard_win::set_clipboard;
    set_clipboard(formats::Unicode, text).map_err(|e| e.to_string())
}

/* ---------------- 系统 ---------------- */

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p.is_file() {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        std::process::Command::new("explorer")
            .arg(&p)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("仅允许打开 http/https 链接".into());
    }
    std::process::Command::new("explorer")
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn message_box(window: tauri::WebviewWindow, title: String, message: String, detail: Option<String>) -> i32 {
    use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
    let text = match &detail {
        Some(d) if !d.is_empty() => format!("{}\n{}", message, d),
        _ => message.clone(),
    };
    let _ = window
        .dialog()
        .message(text)
        .title(&title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::Ok)
        .blocking_show();
    0
}

/* ---------------- 多窗口 ---------------- */

fn next_window_label(app: &AppHandle) -> String {
    let mut i = 1;
    let existing = app.webview_windows();
    loop {
        let label = format!("win-{}", i);
        if !existing.contains_key(&label) {
            return label;
        }
        i += 1;
    }
}

fn create_doc_window(app: &AppHandle, doc: Option<serde_json::Value>) -> Result<String, String> {
    let label = next_window_label(app);
    let win = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("未命名 — 小银 Markdown")
        .inner_size(1380.0, 880.0)
        .min_inner_size(860.0, 520.0)
        .build()
        .map_err(|e| e.to_string())?;
    if let Some(d) = doc {
        let _ = win.emit("mig:adopt-doc", d);
    }
    Ok(label)
}

#[tauri::command]
fn open_new_window(app: AppHandle, path: Option<String>) -> Result<String, String> {
    let doc = match &path {
        Some(p) => {
            let pb = PathBuf::from(p);
            match smart_read(&pb) {
                Ok((text, eol)) => Some(serde_json::json!({
                    "path": p, "name": pb.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default(),
                    "text": text, "eol": eol
                })),
                Err(_) => None,
            }
        }
        None => None,
    };
    create_doc_window(&app, doc)
}

#[tauri::command]
fn force_close(window: tauri::WebviewWindow) {
    window.destroy();
}

#[tauri::command]
fn get_window_count(app: AppHandle) -> usize {
    app.webview_windows().len()
}

/* 模式迁移：前端先通过事件收集各窗口文档，再调用这里执行窗口增删 */
#[tauri::command]
fn migrate_apply(app: AppHandle, mode: String, docs: Vec<serde_json::Value>, keep_label: String) -> Result<(), String> {
    let old_labels: Vec<String> = app.webview_windows().keys().cloned().collect();

    match mode.as_str() {
        "tabs" => {
            // 全部合并进保留窗口
            if let Some(win) = app.get_webview_window(&keep_label) {
                let _ = win.emit("mig:adopt-tabs", serde_json::json!({ "docs": docs }));
            }
            for l in old_labels.iter() {
                if l != &keep_label {
                    if let Some(w) = app.get_webview_window(l) {
                        w.destroy();
                    }
                }
            }
        }
        "windows" => {
            // 每份文档一个新窗口
            for d in docs.iter() {
                let label = create_doc_window(&app, Some(d.clone()))?;
                let _ = label;
            }
            for l in old_labels.iter() {
                if let Some(w) = app.get_webview_window(l) {
                    w.destroy();
                }
            }
        }
        _ => return Err(format!("未知模式 {}", mode)),
    }
    Ok(())
}

/* ---------------- 在线升级 ---------------- */

/// 检查结果回给前端：available=false 时 version 就是当前版本
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateStatus {
    available: bool,
    current: String,
    version: String,
    notes: String,
    date: String,
}

/// 当前程序版本（状态栏显示用，不联网）
#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

/// 查 https://md.wangjinding.com/update/latest.json 有没有比当前新的版本。
/// 用官方 updater 插件：带 minisign 签名校验，装的是签名过的安装包，避免被中间人替换。
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<UpdateStatus, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| format!("初始化升级器失败：{e}"))?;
    match updater.check().await {
        Ok(Some(u)) => Ok(UpdateStatus {
            available: true,
            current,
            version: u.version.clone(),
            notes: u.body.clone().unwrap_or_default(),
            // u.date 是 time::OffsetDateTime（UTC）。默认 Display 是 "2:43:08.0 +00:00:00"，
            // 这里按时间戳转成本地时间，精确到分钟。
            date: u
                .date
                .and_then(|d| {
                    chrono::DateTime::from_timestamp(d.unix_timestamp(), 0)
                        .map(|c| c.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
                })
                .unwrap_or_default(),
        }),
        Ok(None) => Ok(UpdateStatus {
            available: false,
            version: current.clone(),
            current,
            notes: String::new(),
            date: String::new(),
        }),
        Err(e) => Err(format!("检查更新失败：{e}")),
    }
}

/// 下载 + 校验签名 + 跑安装包覆盖安装，然后重启自己。
/// 进度通过 `update-progress` 事件推给前端（chunk 为已下载字节，total 可能为 null）。
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| format!("初始化升级器失败：{e}"))?;
    let found = updater.check().await.map_err(|e| format!("检查更新失败：{e}"))?;
    let Some(update) = found else {
        return Err("已经是最新版本".into());
    };
    let handle = app.clone();
    let mut downloaded: u64 = 0;
    update
        .download_and_install(
            move |chunk: usize, total: Option<u64>| {
                downloaded += chunk as u64;
                let _ = handle.emit(
                    "update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(|e| format!("下载或安装失败：{e}"))?;
    // 安装包已静默跑完并覆盖了程序，重启到新版本
    let _ = app.emit("update-restarting", serde_json::json!({}));
    app.restart();
}

/* ---------------- 入口 ---------------- */

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // 双击 .md 用本程序打开时的「首次启动」路径：
        //   · 首次启动（进程还不存在）→ 页面加载完成后把 argv 里的文件发给前端
        //   · 已在运行（再双击另一个文件）→ 走下面的 single_instance 回调
        // 用 Once 保证只发一次，避免页面重载时反复打开同一个文件。
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                STARTUP_FILE_SENT.call_once(|| {
                    if let Some(path) = std::env::args()
                        .skip(1)
                        .find(|a| PathBuf::from(a).is_file())
                    {
                        let _ = webview.emit("open-external", path);
                    }
                });
            }
        })
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
                if let Some(path) = argv.iter().nth(1) {
                    let p = PathBuf::from(path);
                    if p.is_file() {
                        let _ = win.emit("open-external", p.to_string_lossy().to_string());
                    }
                }
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            open_file_dialog,
            save_file,
            open_dir_dialog,
            read_dir,
            copy_file_to_clipboard,
            read_clipboard_text,
            write_clipboard_text,
            reveal_in_explorer,
            open_external,
            message_box,
            open_new_window,
            force_close,
            get_window_count,
            migrate_apply,
            app_version,
            check_update,
            install_update
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // 交给前端确认（未保存提示）
                api.prevent_close();
                let _ = window.emit("close-confirm", window.label());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
