// P5-7：用真实的 tauri-plugin-updater 校验链路（check → download → 验签）
// 对接本地静态服务器，覆盖「有更新 / 无更新 / 签名错误 / 404 / 平台不匹配」。
// 签名 fixture 由测试专用密钥生成（私钥不入库），与生产更新密钥解耦，
// 生产密钥轮换不影响本测试。见 docs/UPDATER.md「测试密钥」。

use std::{
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use serde_json::{json, Value};
use tauri_plugin_updater::UpdaterExt;

mod common;

const FIXTURE_DIR: &str = "tests/fixtures/updater";
/// fixture 签名绑定的「永远有更新」版本：签名是静态的，不能随每次发版重签。
const NEWER_VERSION: &str = "9999.0.0";
/// 测试专用公钥（对应本地 `%USERPROFILE%\.air-ide\test-updater.key`，私钥不入库）。
const TEST_PUBKEY: &str = include_str!("fixtures/updater/test-pubkey.txt");

struct ServerState {
    manifest_status: u16,
    manifest: String,
    artifact: Vec<u8>,
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn fixture(name: &str) -> String {
    let path = manifest_dir().join(FIXTURE_DIR).join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("读取 {} 失败: {e}", path.display()))
}

fn signature() -> String {
    fixture("artifact.bin.sig").trim().to_string()
}

/// 极简 HTTP 服务器：只响应 /latest.json 与 /artifact.bin，用于模拟更新源。
fn start_server() -> (SocketAddr, Arc<Mutex<ServerState>>, Arc<AtomicBool>, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    listener.set_nonblocking(true).expect("设置非阻塞");
    let addr = listener.local_addr().expect("获取端口");
    let artifact = std::fs::read(manifest_dir().join(FIXTURE_DIR).join("artifact.bin")).expect("读取 artifact");
    let state = Arc::new(Mutex::new(ServerState {
        manifest_status: 404,
        manifest: String::new(),
        artifact,
    }));
    let shutdown = Arc::new(AtomicBool::new(false));

    let st = state.clone();
    let sd = shutdown.clone();
    let handle = thread::spawn(move || {
        while !sd.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((stream, _)) => handle_conn(stream, &st),
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(5));
                }
                Err(_) => break,
            }
        }
    });

    (addr, state, shutdown, handle)
}

fn handle_conn(mut stream: TcpStream, state: &Arc<Mutex<ServerState>>) {
    let _ = stream.set_nonblocking(false);
    let mut reader = BufReader::new(stream.try_clone().expect("复制 stream"));
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    // 吃掉请求头，保证响应前连接状态干净
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
            break;
        }
    }

    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let st = state.lock().expect("获取服务器状态");
    let (status, body, content_type) = match path {
        "/latest.json" => (
            st.manifest_status,
            if st.manifest_status == 200 {
                st.manifest.clone().into_bytes()
            } else {
                b"not found".to_vec()
            },
            "application/json",
        ),
        "/artifact.bin" => (200, st.artifact.clone(), "application/octet-stream"),
        _ => (404, b"not found".to_vec(), "text/plain"),
    };
    drop(st);

    let head = format!(
        "HTTP/1.1 {status} {}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        if status == 200 { "OK" } else { "Not Found" },
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(&body);
    let _ = stream.flush();
    let _ = reader.into_inner().shutdown(std::net::Shutdown::Both);
}

fn mock_app() -> tauri::App<tauri::test::MockRuntime> {
    // 用真实 tauri.conf.json 生成 context（requireSignedVersion 与生产一致），
    // 但把 pubkey 覆写为测试专用公钥：夹具验签只看测试密钥，不依赖生产密钥。
    tauri::test::mock_builder()
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(TEST_PUBKEY.trim())
                .build(),
        )
        .build(tauri::generate_context!())
        .expect("构建 mock app")
}

fn manifest(url: &str, version: &str, sig: &str, platforms: Vec<&str>) -> String {
    let entries: serde_json::Map<String, Value> = platforms
        .into_iter()
        .map(|p| {
            (
                p.to_string(),
                json!({ "url": url, "signature": sig }),
            )
        })
        .collect();
    json!({
        "version": version,
        "notes": "P5-7 updater 集成测试",
        "pub_date": "2026-11-05T00:00:00Z",
        "platforms": entries,
    })
    .to_string()
}

fn check_and_download(url: &str) -> Result<(Option<String>, Result<(), String>), String> {
    let app = mock_app();
    let updater = app
        .handle()
        .updater_builder()
        .endpoints(vec![url.parse().expect("endpoint url")])
        .expect("设置 endpoint")
        .timeout(Duration::from_secs(10))
        .build()
        .expect("构建 updater");

    tauri::async_runtime::block_on(async {
        let update = match updater.check().await {
            Ok(Some(update)) => update,
            Ok(None) => return Ok((None, Ok(()))),
            Err(e) => return Err(e.to_string()),
        };
        let version = update.version.clone();
        let download = update
            .download(|_chunk, _total| {}, || {})
            .await
            .map(|bytes| {
                assert!(!bytes.is_empty(), "下载内容为空");
            })
            .map_err(|e| e.to_string());
        Ok((Some(version), download))
    })
}

/// 拒绝网络访问的 endpoint：用于确认「无更新」不需要清单里存在当前平台条目。
#[test]
fn updater_manifest_scenarios() {
    let (addr, state, shutdown, handle) = start_server();
    let base = format!("http://{addr}");
    let sig = signature();

    // 0. 确认真实配置启用签名版本绑定，且 fixture 的 trusted comment 带 version
    let conf: Value = serde_json::from_str(
        &std::fs::read_to_string(manifest_dir().join("tauri.conf.json")).expect("读取配置"),
    )
    .expect("解析配置");
    assert_eq!(
        conf["plugins"]["updater"]["requireSignedVersion"], true,
        "生产配置应开启 requireSignedVersion"
    );
    let sig_text = sig.clone();
    let decoded = common::decode_base64_text(&sig_text).expect("解码签名文本");
    assert!(
        decoded.contains(&format!("version:{NEWER_VERSION}")),
        "签名 trusted comment 应携带版本，实际: {decoded}"
    );

    // 1. 有更新：清单版本高于当前版本，check 返回版本，download 验签通过
    {
        let mut st = state.lock().unwrap();
        st.manifest_status = 200;
        st.manifest = manifest(&format!("{base}/artifact.bin"), NEWER_VERSION, &sig, vec![
            "windows-x86_64-nsis",
            "windows-x86_64",
        ]);
    }
    let result = check_and_download(&format!("{base}/latest.json")).expect("有更新场景不应报错");
    assert_eq!(result.0.as_deref(), Some(NEWER_VERSION), "应检出更新版本");
    result.1.expect("签名应通过");

    // 2. 无更新：清单版本等于当前版本，check 返回 None
    {
        let mut st = state.lock().unwrap();
        st.manifest = manifest(
            &format!("{base}/artifact.bin"),
            env!("CARGO_PKG_VERSION"),
            &sig,
            vec!["windows-x86_64"],
        );
    }
    let result = check_and_download(&format!("{base}/latest.json")).expect("无更新场景不应报错");
    assert!(result.0.is_none(), "同版本不应判定为更新");

    // 3. 签名错误：清单声明更新版本，但签名被篡改，download 必须失败
    {
        let mut st = state.lock().unwrap();
        let mut bad_sig = sig.clone();
        // 改动外层 base64 中间一个字符（仍可解码），破坏 minisign 校验
        let idx = bad_sig.len() / 2;
        let replacement = if bad_sig.as_bytes()[idx] == b'A' { 'B' } else { 'A' };
        bad_sig.replace_range(idx..idx + 1, &replacement.to_string());
        st.manifest = manifest(&format!("{base}/artifact.bin"), NEWER_VERSION, &bad_sig, vec!["windows-x86_64"]);
    }
    let result = check_and_download(&format!("{base}/latest.json")).expect("check 本身应成功");
    assert_eq!(result.0.as_deref(), Some(NEWER_VERSION));
    let err = result.1.expect_err("篡改签名必须失败");
    assert!(
        err.to_lowercase().contains("signature") || err.to_lowercase().contains("minisign"),
        "错误信息应指向签名问题，实际: {err}"
    );

    // 4. 404：更新源没有清单，check 报「无法获取有效清单」
    {
        let mut st = state.lock().unwrap();
        st.manifest_status = 404;
    }
    let result = check_and_download(&format!("{base}/latest.json")).expect_err("404 应报错");
    assert!(
        result.contains("Could not fetch a valid release JSON") || result.contains("404"),
        "404 应报清单不可用，实际: {result}"
    );

    // 5. 平台不匹配：清单只有 linux 条目（真实场景对应发错平台产物）
    {
        let mut st = state.lock().unwrap();
        st.manifest_status = 200;
        st.manifest = manifest(&format!("{base}/artifact.bin"), NEWER_VERSION, &sig, vec!["linux-x86_64"]);
    }
    let result = check_and_download(&format!("{base}/latest.json")).expect_err("平台不匹配应报错");
    assert!(
        result.contains("was not found in the response") || result.contains("fallback platforms"),
        "应报平台缺失，实际: {result}"
    );

    shutdown.store(true, Ordering::Relaxed);
    let _ = handle.join();
}
