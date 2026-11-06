//! 语言服务器一键下载（2.6 三级策略第三级："产品化关键路径"）。
//! 下载 → sha256 校验 → 解压/落盘到 servers 目录（P5-1）。
//!
//! 事实源：下方常量与 [`ReleaseAsset`] 是唯一的版本/URL/哈希来源
//! （sha256 取自 GitHub Releases 资产的 `digest` 字段）。
//! P5-7 的在线更新复用同一份清单，不要另写一套 URL 或哈希。
//!
//! 安全约束：
//! - 校验失败一律 fail-closed：删除临时文件、拒绝安装、返回 `[verify]` 错误，无降级分支；
//! - 错误按阶段打上稳定前缀（`[network]` / `[verify]` / `[extract]` / `[io]`），便于区分与测试。

use std::io::Read;
use std::path::{Path, PathBuf};

use air_core::{AirError, AirResult};

/// 官方发布仓库（GitHub Releases）。
pub const RELEASE_REPO: &str = "PHPantom-dev/phpantom_lsp";
/// 当前锁定的官方版本。
pub const RELEASE_VERSION: &str = "0.11.1";

/// 一个发布资产的固定信息（可校验的单一事实源）。
#[derive(Debug, Clone, Copy)]
pub struct ReleaseAsset {
    /// 资产文件名（与 Releases 页一致）
    pub file: &'static str,
    /// 官方 sha256（小写十六进制，来自 Release 资产的 digest）
    pub sha256: &'static str,
    /// 资产字节数
    pub size_bytes: u64,
    /// zip 内可执行文件名（安装时重命名为 registry 程序名）
    pub zip_exe: &'static str,
}

impl ReleaseAsset {
    /// 官方下载地址：由仓库 + 版本 + 资产名拼装，避免散落硬编码。
    pub fn url(&self, version: &str) -> String {
        format!(
            "https://github.com/{RELEASE_REPO}/releases/download/{version}/{}",
            self.file
        )
    }
}

/// 下载源（静态注册表：URL 与校验和都是编译期常量，不接受外部传入）。
#[derive(Debug, Clone, Copy)]
pub enum DownloadSource {
    /// PHPantom Windows x64（GitHub Releases）
    PhpantomWinX64,
}

impl DownloadSource {
    /// 该来源的官方资产清单。
    pub fn asset(self) -> ReleaseAsset {
        match self {
            Self::PhpantomWinX64 => ReleaseAsset {
                file: "phpantom_lsp-x86_64-pc-windows-msvc.zip",
                sha256: "2f717c05e44573ae7ad3ab394fc322a5fa0309edae116b245c299c740b4dae8e",
                size_bytes: 15_886_721,
                zip_exe: "phpantom_lsp.exe",
            },
        }
    }

    /// 官方下载地址。
    pub fn url(self) -> String {
        self.asset().url(RELEASE_VERSION)
    }

    /// 期望的 sha256（必填：没有"跳过校验"分支）。
    pub fn expected_sha256(self) -> &'static str {
        self.asset().sha256
    }

    /// servers 下的安装子目录名。
    pub fn install_dir(self) -> &'static str {
        "phpantom"
    }

    /// 安装后的可执行文件名。必须与 registry 的程序名一致：
    /// `probe_server` 按 `<program>.exe` 在 servers 子目录里找。
    pub fn exe_name(self) -> &'static str {
        "phpantom.exe"
    }
}

/// 安装失败阶段（错误信息前缀可被前端与测试稳定识别）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStage {
    Network,
    Verify,
    Extract,
    Io,
}

impl InstallStage {
    pub fn tag(self) -> &'static str {
        match self {
            Self::Network => "[network]",
            Self::Verify => "[verify]",
            Self::Extract => "[extract]",
            Self::Io => "[io]",
        }
    }
}

fn stage_err(stage: InstallStage, msg: impl std::fmt::Display) -> AirError {
    AirError::Lsp(format!("{} {msg}", stage.tag()))
}

/// 下载并安装（同步，调用方放 spawn_blocking）。
/// 返回安装后可执行文件路径。
pub fn install(source: DownloadSource) -> AirResult<PathBuf> {
    let url = source.url();
    let bytes = fetch(&url)?;
    install_bytes(source, &bytes)
}

/// 已下载内容的安装流程（E2E / 离线分发可复用）：校验 → 解压 → 落盘。
/// 校验失败删除临时文件并返回 `[verify]` 错误，不做静默降级。
pub fn install_bytes(source: DownloadSource, bytes: &[u8]) -> AirResult<PathBuf> {
    let servers = crate::session::servers_dir()
        .ok_or_else(|| stage_err(InstallStage::Io, "LOCALAPPDATA 未设置，无法定位 servers 目录"))?;
    let exe = install_into(source, bytes, &servers)?;
    // 安装目录是 servers/<name>/，立即刷新 PATH，免重启即可按程序名启动
    crate::session::register_servers_on_path();
    Ok(exe)
}

/// 安装核心（目录可注入，便于测试不污染真实 servers 目录）。
fn install_into(source: DownloadSource, bytes: &[u8], servers: &Path) -> AirResult<PathBuf> {
    let asset = source.asset();
    let dir = servers.join(source.install_dir());
    std::fs::create_dir_all(&dir)
        .map_err(|e| stage_err(InstallStage::Io, format!("创建 {} 失败: {e}", dir.display())))?;

    // 1. 写临时文件（校验通过前唯一的落盘物）
    let tmp = dir.join(format!("{}.download", source.exe_name()));
    std::fs::write(&tmp, bytes)
        .map_err(|e| stage_err(InstallStage::Io, format!("写临时文件失败: {e}")))?;

    // 2. sha256 + 大小校验（fail-closed：失败删临时文件并拒绝安装）
    if let Err(err) = verify(bytes, asset) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err);
    }

    // 3. 解压/落盘，然后清理临时文件
    let extracted = extract(bytes, &dir, source.exe_name(), asset.zip_exe);
    let _ = std::fs::remove_file(&tmp);
    let exe = extracted?;

    if !exe.is_file() {
        return Err(stage_err(
            InstallStage::Io,
            format!("安装后未找到 {}", exe.display()),
        ));
    }
    Ok(exe)
}

/// 校验下载内容：sha256 必须与官方 digest 一致，大小也必须一致。
fn verify(bytes: &[u8], asset: ReleaseAsset) -> AirResult<()> {
    let actual = sha256_hex(bytes);
    if !actual.eq_ignore_ascii_case(asset.sha256) || bytes.len() as u64 != asset.size_bytes {
        return Err(stage_err(
            InstallStage::Verify,
            format!(
                "sha256 校验失败（期望 {} / {} 字节，实际 {} / {} 字节）——已拒绝安装并删除临时文件",
                asset.sha256,
                asset.size_bytes,
                actual,
                bytes.len()
            ),
        ));
    }
    Ok(())
}

/// 解压 zip 中的可执行文件（统一重命名为 registry 程序名）；非 zip 内容直接落盘。
fn extract(bytes: &[u8], dir: &Path, exe_name: &str, zip_exe: &str) -> AirResult<PathBuf> {
    let exe = dir.join(exe_name);
    if !bytes.starts_with(b"PK") {
        std::fs::write(&exe, bytes)
            .map_err(|e| stage_err(InstallStage::Io, format!("写入 {} 失败: {e}", exe.display())))?;
        return Ok(exe);
    }

    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| stage_err(InstallStage::Extract, format!("zip 解析失败: {e}")))?;
    let mut found = None;
    for i in 0..archive.len() {
        let entry = archive
            .by_index(i)
            .map_err(|e| stage_err(InstallStage::Extract, format!("zip 读取失败: {e}")))?;
        if entry.name().to_ascii_lowercase().ends_with(".exe") {
            found = Some(i);
            break;
        }
    }
    let index = found.ok_or_else(|| {
        stage_err(
            InstallStage::Extract,
            format!("zip 中未找到 {zip_exe}（或任何 .exe）"),
        )
    })?;

    let mut entry = archive
        .by_index(index)
        .map_err(|e| stage_err(InstallStage::Extract, format!("zip 条目读取失败: {e}")))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .map_err(|e| stage_err(InstallStage::Extract, format!("zip 解压失败: {e}")))?;
    drop(entry);

    std::fs::write(&exe, &buf)
        .map_err(|e| stage_err(InstallStage::Io, format!("写入 {} 失败: {e}", exe.display())))?;
    Ok(exe)
}

/// 极简 HTTP GET（reqwest 阻塞客户端，调用方放 spawn_blocking）。
pub fn fetch(url: &str) -> AirResult<Vec<u8>> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("AirIDE-updater")
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| stage_err(InstallStage::Network, format!("HTTP 客户端创建失败: {e}")))?;
    let resp = client
        .get(url)
        .send()
        .map_err(|e| stage_err(InstallStage::Network, format!("下载失败: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(stage_err(
            InstallStage::Network,
            format!("下载失败: HTTP {}（{url}）", status.as_u16()),
        ));
    }
    resp.bytes()
        .map(|b| b.to_vec())
        .map_err(|e| stage_err(InstallStage::Network, format!("读取下载内容失败: {e}")))
}

/// SHA-256（FIPS 180-4，零依赖手写约 80 行）。
pub fn sha256_hex(data: &[u8]) -> String {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];

    // 填充
    let bit_len = (data.len() as u64).wrapping_mul(8);
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut w = [0u32; 64];
    // chunks_exact 保留（可读性优先；as_chunks 的元组解构在这里更难读）
    #[allow(clippy::chunks_exact_to_as_chunks)]
    for chunk in msg.chunks_exact(64) {
        for i in 0..16 {
            w[i] = u32::from_be_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }

    let mut out = String::with_capacity(64);
    for v in h {
        out.push_str(&format!("{v:08x}"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 临时目录（测试结束清理；不碰真实 servers 目录）。
    fn temp_case_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("air-lsp-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("创建测试目录");
        dir
    }

    #[test]
    fn test_sha256_known_vectors() {
        // FIPS 180-4 标准向量
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            sha256_hex(b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
        );
    }

    #[test]
    fn test_sha256_chinese() {
        // 中文输入：验证多字节处理
        let h = sha256_hex("中文".as_bytes());
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_manifest_single_source_of_truth() {
        let source = DownloadSource::PhpantomWinX64;
        let asset = source.asset();

        assert_eq!(source.expected_sha256(), asset.sha256);
        assert_eq!(source.expected_sha256().len(), 64);
        assert!(source
            .expected_sha256()
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert!(asset.size_bytes > 0);

        // URL 只能由清单拼出，不允许散落
        assert_eq!(
            source.url(),
            format!(
                "https://github.com/{RELEASE_REPO}/releases/download/{RELEASE_VERSION}/{}",
                asset.file
            )
        );

        // 安装名必须与 registry 的 program 一致（probe_server 按 <program>.exe 查找）
        assert_eq!(
            source.exe_name(),
            format!("{}.exe", crate::ServerKind::Phpantom.program())
        );
    }

    #[test]
    fn test_verify_rejects_tampered_payload_and_removes_tmp() {
        let dir = temp_case_dir("verify");
        let bytes = b"not-the-real-release".to_vec();

        let err = install_into(DownloadSource::PhpantomWinX64, &bytes, &dir).unwrap_err();
        let AirError::Lsp(msg) = err else {
            panic!("预期 AirError::Lsp");
        };
        assert!(msg.starts_with(InstallStage::Verify.tag()), "msg={msg}");

        // fail-closed：临时文件与可执行文件都不应留下
        let target = dir.join("phpantom");
        assert!(
            !target.join("phpantom.exe.download").exists(),
            "临时文件未删除"
        );
        assert!(!target.join("phpantom.exe").exists(), "不应安装");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_extract_renames_to_registry_program_name() {
        use std::io::Write as _;

        // 构造最小 zip：内层名 phpantom_lsp.exe（与真实资产一致）
        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated);
            writer.start_file("phpantom_lsp.exe", opts).expect("start_file");
            writer.write_all(b"MZ-fake-exe").expect("写入 zip 内容");
            writer.finish().expect("finish zip");
        }

        let dir = temp_case_dir("extract");
        let exe = extract(&buf, &dir, "phpantom.exe", "phpantom_lsp.exe").expect("解压");
        assert_eq!(exe.file_name().unwrap(), "phpantom.exe");
        assert_eq!(std::fs::read(&exe).unwrap(), b"MZ-fake-exe");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_extract_reports_missing_exe() {
        use std::io::Write as _;

        let mut buf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            writer.start_file("readme.txt", opts).expect("start_file");
            writer.write_all(b"no exe here").expect("写入 zip 内容");
            writer.finish().expect("finish zip");
        }

        let dir = temp_case_dir("missing");
        let err = extract(&buf, &dir, "phpantom.exe", "phpantom_lsp.exe").unwrap_err();
        let AirError::Lsp(msg) = err else {
            panic!("预期 AirError::Lsp");
        };
        assert!(msg.starts_with(InstallStage::Extract.tag()), "msg={msg}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_fetch_error_carries_network_tag() {
        // 本机回环的未监听端口：连接被拒 → 必须归为网络失败
        let err = fetch("http://127.0.0.1:1/air-p5-1").unwrap_err();
        let AirError::Lsp(msg) = err else {
            panic!("预期 AirError::Lsp");
        };
        assert!(msg.starts_with(InstallStage::Network.tag()), "msg={msg}");
    }

    #[test]
    fn test_extract_reports_broken_zip() {
        let dir = temp_case_dir("broken");
        let bytes = b"PK\x03\x04broken-zip-body".to_vec();
        let err = extract(&bytes, &dir, "phpantom.exe", "phpantom_lsp.exe").unwrap_err();
        let AirError::Lsp(msg) = err else {
            panic!("预期 AirError::Lsp");
        };
        assert!(msg.starts_with(InstallStage::Extract.tag()), "msg={msg}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
