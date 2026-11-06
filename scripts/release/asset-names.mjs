// GitHub Releases 会把上传资产名中的空格替换成点：`Air IDE_0.2.0_x64-setup.exe`
// 上传后实际是 `Air.IDE_0.2.0_x64-setup.exe`。清单里的 name/url 必须使用这个实际名字，
// 否则 `releases/download/<tag>/<name>` 会 404（浏览器下载地址不接受 %20 形式）。

/** 本地文件名 → GitHub Release 上的实际资产名（空格转点，其余字符保持不变）。 */
export function toReleaseAssetName(fileName) {
  return String(fileName).replace(/ /g, '.')
}

/** 用实际资产名拼下载地址；只对非 URL 安全字符做百分号编码，不再把空格编码成 %20。 */
export function releaseAssetUrl(baseUrl, fileName) {
  const base = String(baseUrl).replace(/\/$/, '')
  return `${base}/${encodeURIComponent(toReleaseAssetName(fileName))}`
}
