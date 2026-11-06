// P5-7：校验「发布脚本产出的 latest.json + .sig」能否被 updater 的验签逻辑接受。
// 由 scripts/release/verify-updater.mjs 设置环境变量后运行；未设置时跳过（便于普通 cargo test）。
//
// 环境变量：
//   AIR_IDE_VERIFY_MANIFEST  发布脚本产出的 latest.json
//   AIR_IDE_VERIFY_ARTIFACT  latest.json 指向的实际安装包
//   AIR_IDE_VERIFY_SIG       对应 .sig 文件

use std::path::PathBuf;

use minisign_verify::{PublicKey, Signature};
use serde_json::Value;

mod common;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn release_manifest_signature_matches_artifact() {
    let Ok(manifest_path) = std::env::var("AIR_IDE_VERIFY_MANIFEST") else {
        eprintln!("跳过：未设置 AIR_IDE_VERIFY_MANIFEST");
        return;
    };
    let artifact_path = std::env::var("AIR_IDE_VERIFY_ARTIFACT").expect("缺少 AIR_IDE_VERIFY_ARTIFACT");
    let sig_path = std::env::var("AIR_IDE_VERIFY_SIG").expect("缺少 AIR_IDE_VERIFY_SIG");

    // 公钥来自仓库配置（release build 实际使用的就是它）
    let conf: Value = serde_json::from_str(
        &std::fs::read_to_string(manifest_dir().join("tauri.conf.json")).expect("读取 tauri.conf.json"),
    )
    .expect("解析 tauri.conf.json");
    let pubkey_b64 = conf["plugins"]["updater"]["pubkey"].as_str().expect("配置缺少 pubkey");
    let pubkey_text = common::decode_base64_text(pubkey_b64).expect("解码公钥");
    let public_key = PublicKey::decode(&pubkey_text).expect("解析 minisign 公钥");

    let manifest: Value = serde_json::from_str(
        &std::fs::read_to_string(&manifest_path).expect("读取 latest.json"),
    )
    .expect("解析 latest.json");
    let expected_version = manifest["version"].as_str().expect("清单缺少 version");
    let platform = if manifest["platforms"]["windows-x86_64-nsis"].is_object() {
        "windows-x86_64-nsis"
    } else {
        "windows-x86_64"
    };
    let entry = &manifest["platforms"][platform];
    let entry_sig = entry["signature"].as_str().expect("清单缺少 signature");

    // 清单里的签名必须与 .sig 文件一致（防止清单和签名漂移）
    let file_sig_raw = std::fs::read_to_string(&sig_path).expect("读取 .sig");
    let file_sig_b64 = common::decode_base64_text(&file_sig_raw).expect("解码 .sig 文本");
    let manifest_sig_text = common::decode_base64_text(entry_sig).expect("解码清单签名");
    assert_eq!(
        manifest_sig_text.trim(),
        file_sig_b64.trim(),
        "latest.json 中的签名与 .sig 文件不一致"
    );

    // updater 的 trusted comment 里记录了版本（requireSignedVersion=true 时会校验）
    assert!(
        manifest_sig_text.contains(&format!("version:{expected_version}")),
        "签名 trusted comment 未绑定清单版本 {expected_version}: {manifest_sig_text}"
    );

    let signature = Signature::decode(&manifest_sig_text).expect("解析 minisign 签名");
    let artifact = std::fs::read(&artifact_path).expect("读取安装包");
    public_key
        .verify(&artifact, &signature, false)
        .expect("真实安装包签名校验失败");

    eprintln!(
        "签名校验通过：{} ({} bytes, v{})",
        artifact_path,
        artifact.len(),
        expected_version
    );
}
