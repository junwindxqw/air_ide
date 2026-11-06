# 自动更新（P5-7）

> 状态：未签名分发（D6）+ 真实 Minisign 签名校验 + GitHub Releases 更新源。
> 不购买商业代码签名证书，接受 Windows SmartScreen / Minisign 警告；但 updater 的签名校验是强制的，任何未签名或签名错误的包都不会被安装。

## 1. 密钥管理

### 1.1 生成

```powershell
# 私钥必须放在仓库外，例如 %USERPROFILE%\.air-ide\
pnpm --filter desktop exec tauri signer generate -w "$env:USERPROFILE\.air-ide\air-ide-updater.key"
```

生成后：

| 文件 | 用途 | 是否入库 |
| --- | --- | --- |
| `air-ide-updater.key` | 签名私钥 | **绝不入库**（仓库 `.gitignore` 之外单独保管） |
| `air-ide-updater.key.pub` | 对应公钥 | 否，只把内容写入 `tauri.conf.json` |

`apps/desktop/src-tauri/tauri.conf.json` 中：

```json
"plugins": {
  "updater": {
    "pubkey": "<.pub 文件内容，Base64 单行>",
    "endpoints": ["https://github.com/junwindxqw/air_ide/releases/latest/download/latest.json"],
    "requireSignedVersion": true,
    "windows": { "installMode": "passive" }
  }
}
```

`requireSignedVersion: true` 表示签名 trusted comment 中记录的版本必须与清单版本一致，防止拿旧签名冒充新版本。

### 1.2 注入（CI / 本地发布）

发布脚本和 `tauri build` 按以下优先级读取私钥：

1. `TAURI_SIGNING_PRIVATE_KEY`（私钥**内容**）
2. `--key <path>`（`release.mjs` 参数）
3. `AIR_IDE_UPDATER_KEY_PATH` / `TAURI_SIGNING_PRIVATE_KEY_PATH`（私钥文件路径）
4. 默认 `%USERPROFILE%\.air-ide\air-ide-updater.key`

CI（GitHub Actions）建议用 Secret 保存私钥内容：

```yaml
env:
  TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

> 注意：私钥内容与文件路径不能同时注入，CLI 会报 `--private-key` 与 `--private-key-path` 冲突。

### 1.3 轮换

1. 生成新密钥对，更新 `tauri.conf.json` 的 `pubkey`；
2. 旧版本客户端仍信任旧公钥，只能完成「旧公钥 → 新版本」这一次更新后才会使用新公钥；
3. 因此轮换至少需要保留一次用旧私钥签名的过渡版本，过渡版本内嵌新公钥。

## 2. 发布步骤

一条命令（仓库根目录）：

```powershell
node scripts/release/release.mjs
```

脚本会：

1. 校验签名私钥（缺失直接报错退出，**不会**产出未签名清单）；
2. 执行 `tauri build`（含前端构建、NSIS 安装包、便携 zip）；
3. 为安装包与便携 zip 生成 `.sig`，并校验签名 trusted comment 中的版本；
4. 生成 `latest.json` 与 `release-manifest.json`；
5. 打印需要上传到 GitHub Release 的资产清单（含 SHA-256）。

常用参数：

```powershell
node scripts/release/release.mjs --skip-build                 # 用已有产物，仅签名 + 生成清单
node scripts/release/release.mjs --base-url https://example.com/v0.2.0
node scripts/release/release.mjs --notes "修复若干问题"
node scripts/release/release.mjs --publish                    # gh release create/upload

# 与其它构建隔离时，脚本会跟随 CARGO_TARGET_DIR（相对路径按仓库根解析）
$env:CARGO_TARGET_DIR = "target\p5-7b"
node scripts/release/release.mjs --skip-build
```

产物位置：`$CARGO_TARGET_DIR/release/updater/v<version>/`（未设置时为 `target/release/updater/v<version>/`）。

### 2.1 GitHub Releases 资产

> GitHub 会把资产名中的空格转成点：本地产物 `Air IDE_<版本>_x64-setup.exe`，
> Release 上实际是 `Air.IDE_<版本>_x64-setup.exe`。清单里的 URL/name 必须使用点号版本，
> 否则 `releases/download/<tag>/<name>` 会 404（0.2.0 已按此规则发布）。

| 资产 | 说明 |
| --- | --- |
| `latest.json` | updater 清单（必须是 Release 的资产，endpoint 指向 `releases/latest/download/latest.json`） |
| `Air.IDE_<版本>_x64-setup.exe` | NSIS 安装包 |
| `Air.IDE_<版本>_x64-setup.exe.sig` | 安装包签名 |
| `Air.IDE_<版本>_x64-portable.zip` | 便携版（手动分发，不走应用内更新） |
| `Air.IDE_<版本>_x64-portable.zip.sig` | 便携版签名（供人工核对） |
| `release-manifest.json` | 非 updater 清单：列出安装包与便携 zip 的 URL / 大小 / SHA-256 / 签名 |

`latest.json` 结构（示例，`pub_date` 为 ISO 8601 时间）：

```json
{
  "version": "0.2.0",
  "notes": "更新说明",
  "pub_date": "<ISO 8601 时间>",
  "platforms": {
    "windows-x86_64-nsis": { "url": "<安装包 URL>", "signature": "<.sig 内容>" },
    "windows-x86_64": { "url": "<安装包 URL>", "signature": "<.sig 内容>" }
  }
}
```

- `windows-x86_64-nsis`：NSIS 安装版实际使用的条目；
- `windows-x86_64`：非 NSIS 安装类型的兜底条目，同样指向安装包（避免便携版误拿 zip 导致安装失败）；
- 便携版更新不在应用内完成，用户从 `release-manifest.json` / Releases 页面手动下载；这是刻意取舍，因为 updater 的 Windows 安装路径只支持 NSIS/MSI。

### 2.2 发布后校验

```powershell
node scripts/release/verify-updater.mjs `
  --release-manifest target\release\updater\v0.2.0\latest.json `
  --artifact "target\release\bundle\nsis\Air IDE_0.2.0_x64-setup.exe" `
  --sig "target\release\bundle\nsis\Air IDE_0.2.0_x64-setup.exe.sig"
```

该命令用 `minisign-verify`（与 `tauri-plugin-updater` 同一实现）校验真实安装包，并检查清单签名与 `.sig` 一致、trusted comment 版本与清单版本一致。

## 3. 用户端更新行为

设置页 → 「更新」：

- **当前版本**：读取应用版本；
- **启动时静默检查（不自动安装）**：默认开启。启动后等首屏空闲再请求 `latest.json`，失败只记录在设置页并写 `console.warn`，不弹窗、不阻塞启动；
- **检查更新**：手动检查；
- **发现新版本**：显示版本与更新说明，用户点「下载并安装」后才开始下载；
- **下载**：显示进度百分比（总大小未知时只显示「正在下载」）；
- **安装**：下载完成后先验签，通过后执行 NSIS 安装（passive 模式），应用退出并由安装器重启；
  安装前前端会调用后端命令 `app_clear_running_marker` 清除 `running.json`（updater 在 Windows 上直接
  `process::exit`，`RunEvent::Exit` 不触发）；命令不存在或调用失败时只记录警告，不阻塞安装；
- **失败**：明确展示分类、原始错误与处理建议，不静默吞错。

失败分类：

| 分类 | 典型原因 | 用户可见提示 | 处理 |
| --- | --- | --- | --- |
| 网络（含 404） | 无法访问 GitHub、代理错误、清单不存在/无效 | 无法访问更新源 | 检查网络/代理，或到 Releases 手动下载 |
| 签名 | 清单签名与安装包不匹配、签名被篡改、旧签名冒充新版本 | 更新包签名校验失败 | 不会安装；等待重新发布或手动下载并核对 SHA-256 |
| 平台 | `latest.json` 缺少 `windows-x86_64(-nsis)` 条目 | 更新清单缺少当前平台的产物 | 联系发布者补发正确平台产物 |
| 不支持 | 非 Tauri 桌面环境 | 当前环境不支持应用内更新 | 使用安装版 |

## 4. 验证方式

```powershell
# 后端：真实 tauri-plugin-updater + 本地静态服务器
node scripts/release/verify-updater.mjs

# 后端：用真实安装包校验发布脚本产出的 latest.json / .sig（minisign-verify）
node scripts/release/verify-updater.mjs `
  --release-manifest target\local-update\latest.json `
  --artifact "target\local-update\Air IDE_0.2.0_x64-setup.exe" `
  --sig "target\local-update\Air IDE_0.2.0_x64-setup.exe.sig"

# 前端：状态机与错误分类单测
pnpm --filter desktop test
```

`verify-updater.mjs` 覆盖：有更新、无更新、签名错误、404、平台不匹配。
它会用 `mt.exe` 给测试 exe 嵌入 comctl32 v6 清单（tauri test runtime 在 Windows 上的必需步骤），需要安装 Windows SDK。

## 5. 遗留风险

1. **未做商业代码签名**：安装包首次运行可能触发 SmartScreen；接受 D6 策略。
2. **私钥丢失**：已发布版本将无法继续接收更新，只能让用户手动重装；私钥需离线备份。
3. **GitHub 可用性**：`latest.json` 依赖 GitHub Releases 与 `releases/latest/download` 语义；国内网络可能需代理。
4. **便携版**：没有应用内更新，只能手动下载新 zip；`windows-x86_64` 兜底条目指向 NSIS 安装包，
   会把便携版转成安装版；其数据目录仍与安装版共用 `%APPDATA%\AirIDE` / `%LOCALAPPDATA%\AirIDE`。
5. **回滚**：updater 不支持降级；如需回滚，需要发布一个版本号更高的「回滚版本」。
6. **发布未 CI 化**：`.github/workflows/ci.yml` 只做检查/测试（含发布脚本单测），
   不构建安装包、不注入签名密钥、不自动上传 Release；发版仍在本机执行 `release.mjs --publish`。

## 6. 发布与密钥管理（0.2.0 现状）

> 本节记录 0.2.0 实际发布方式、密钥保管与风险；操作步骤见第 2 节。

### 6.1 私钥位置与口令

| 项 | 现状 |
|---|---|
| 私钥文件 | `%USERPROFILE%\.air-ide\air-ide-updater.key`（仓库外） |
| 公钥 | 写入 `apps/desktop/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` |
| 口令 | **当前为空口令**（未设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`） |
| 备份 | 需离线备份；丢失后已发布版本无法再接收更新，只能让用户手动重装 |

空口令风险：拿到私钥文件的人可直接为任意版本签名，已安装客户端会因为签名“有效”而接受
恶意更新（`requireSignedVersion` 只校验版本一致性，不校验发布者身份）。建议：

- 用 NTFS ACL 限制私钥文件仅发布者账号可读，避免放入网盘/同步目录/仓库；
- 发布机器与日常开发机隔离；
- 条件允许时用 `tauri signer generate` 时设置口令，并通过
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 注入，不要把口令写进脚本或仓库；
- 轮换后按第 1.3 节保留一次旧私钥签名的过渡版本。

### 6.2 密钥轮换注意事项

1. 生成新密钥对并更新 `tauri.conf.json` 的 `pubkey`；
2. 已安装的旧客户端只信任旧公钥，**无法验证**用新私钥签的新清单；
3. 必须先用旧私钥签一个「过渡版本」，该版本内嵌新公钥；用户完成这次更新后才会信任新密钥；
4. 过渡版本发布并确认覆盖率之前，不要删除旧私钥；
5. `latest.json` 必须由当前客户端仍信任的私钥签名——过渡期内用旧私钥签，
   过渡期结束后改用新私钥。

### 6.3 缺少 Authenticode 的影响

- 安装包与便携包均无代码签名证书，Windows 无法验证发布者身份，首次运行触发 SmartScreen
  「未知发布者」；企业 AppLocker/WDAC 策略可能直接拦截。
- Minisign 签名只覆盖「应用内更新」链路（清单 + 安装包），不改变初次安装的信任状态；
  手动下载安装包的用户仍需依赖 Release 页与 `release-manifest.json` 中的 SHA-256 自行核对。
- 后续若采购证书，签名密钥（Authenticode）与更新密钥（Minisign）需分别管理；
  更换 Authenticode 证书不影响已安装客户端的更新信任链。

### 6.4 0.2.0 发布资产与校验

| 资产 | 大小（字节） |
|---|---|
| `Air.IDE_0.2.0_x64-setup.exe` | 3,807,644 |
| `Air.IDE_0.2.0_x64-setup.exe.sig` | 436 |
| `Air.IDE_0.2.0_x64-portable.zip` | 5,014,081 |
| `Air.IDE_0.2.0_x64-portable.zip.sig` | 440 |
| `latest.json` | 1,314 |
| `release-manifest.json` | 1,712 |

Release：<https://github.com/junwindxqw/air_ide/releases/tag/v0.2.0>。
发布后可用 `scripts/release/verify-updater.mjs` 与 Release 页的 SHA-256 复核。
