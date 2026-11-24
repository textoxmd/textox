use std::path::{Path, PathBuf};

/// 测试用临时目录守卫：`new` 时按 `<prefix>-<uuid>` 创建，`Drop` 时递归删除。
pub(crate) struct TempRoot {
    path: PathBuf,
}

impl TempRoot {
    pub(crate) fn new(prefix: &str) -> Self {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}
