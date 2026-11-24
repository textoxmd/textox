fn main() {
    println!("cargo:rerun-if-changed=icons/");
    // `bundle.resources` 引用的 resources/plugins 由 scripts/build/plugins.mjs 生成。
    // 直接跑 cargo test/check 时它可能还不存在（Tauri 会因资源路径缺失而报错），兜底建空目录。
    let _ = std::fs::create_dir_all("resources/plugins");
    // devtools 是否开启在编译期决定；声明 env 依赖，环境一变 cargo 必重编（避免复用旧产物）
    println!("cargo:rerun-if-env-changed=TEXTO_DEVTOOLS");
    // Sentry DSN 只在编译期读取（option_env!），同样需要声明，否则换 DSN 不会重编
    println!("cargo:rerun-if-env-changed=SENTRY_DSN");
    println!("cargo:rustc-check-cfg=cfg(devtools)");
    if std::env::var_os("TEXTO_DEVTOOLS").is_some_and(|v| !v.is_empty()) {
        println!("cargo:rustc-cfg=devtools");
    }
    tauri_build::build()
}
