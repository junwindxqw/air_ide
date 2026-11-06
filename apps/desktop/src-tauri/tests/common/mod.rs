// 测试共享工具：Tauri 的 pubkey/signature 配置是「对 minisign 文本再 base64」，
// 这里只做还原，用于读取 trusted comment 与交给 minisign-verify 解码。

const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn decode_base64_text(s: &str) -> Result<String, String> {
    let clean: Vec<u8> = s
        .bytes()
        .filter(|b| !b.is_ascii_whitespace() && *b != b'=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;
    for byte in clean {
        let idx = TABLE
            .iter()
            .position(|c| *c == byte)
            .ok_or_else(|| format!("非法 base64 字符: {byte}"))? as u32;
        buffer = (buffer << 6) | idx;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buffer >> bits) & 0xFF) as u8);
        }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}
