// Arvgrid 桌面端：SF2 声库管理
// 支持多 SF2 文件加载、切换、内置 SF2

use std::path::{Path, PathBuf};
use std::fs;
use std::collections::HashMap;
use std::sync::Mutex;

/// SF2 声库管理器
pub struct Sf2Library {
    /// SF2 文件目录
    library_dir: Mutex<Option<PathBuf>>,
    /// 已扫描的 SF2 文件列表 {name, path, size}
    files: Mutex<Vec<Sf2Entry>>,
    /// 当前加载的 SF2 索引
    current_index: Mutex<Option<usize>>,
}

#[derive(Clone, serde::Serialize)]
pub struct Sf2Entry {
    pub name: String,
    pub path: String,
    pub size_mb: f64,
}

impl Default for Sf2Library {
    fn default() -> Self {
        Self {
            library_dir: Mutex::new(None),
            files: Mutex::new(Vec::new()),
            current_index: Mutex::new(None),
        }
    }
}

impl Sf2Library {
    /// 设置 SF2 声库文件夹并扫描
    pub fn set_library_dir(&self, dir: &str) -> Result<Vec<Sf2Entry>, String> {
        let path = Path::new(dir);
        if !path.exists() {
            return Err(format!("Directory not found: {}", dir));
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let file_path = entry.path();
            if let Some(ext) = file_path.extension() {
                if ext == "sf2" || ext == "SF2" || ext == "sf3" || ext == "SF3" {
                    let name = file_path
                        .file_stem()
                        .and_then(|n| n.to_str())
                        .unwrap_or("Unknown")
                        .to_string();
                    let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                    entries.push(Sf2Entry {
                        name,
                        path: file_path.to_string_lossy().to_string(),
                        size_mb: size as f64 / 1_048_576.0,
                    });
                }
            }
        }

        entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

        *self.library_dir.lock().unwrap() = Some(PathBuf::from(dir));
        *self.files.lock().unwrap() = entries.clone();

        Ok(entries)
    }

    /// 获取已扫描的 SF2 文件列表
    pub fn list_files(&self) -> Vec<Sf2Entry> {
        self.files.lock().unwrap().clone()
    }

    /// 获取内置 SF2 路径（打包在 resources/ 目录）
    pub fn get_builtin_sf2_path(&self) -> Option<String> {
        // Tauri 资源目录
        let candidates = [
            "resources/FluidR3_GM.sf2",
            "resources/FluidR3_GM.sf3",
            "resources/GeneralUser GS.sf2",
        ];
        for candidate in &candidates {
            if Path::new(candidate).exists() {
                return Some(candidate.to_string());
            }
        }
        None
    }

    /// 读取 SF2 文件字节
    pub fn read_sf2(&self, path: &str) -> Result<Vec<u8>, String> {
        fs::read(path).map_err(|e| format!("Failed to read SF2: {}", e))
    }
}
