// 回归保护：清单 URL 必须与 GitHub 实际资产名一致（空格会被 GitHub 换成点）。
// 不依赖网络，`pnpm test:release` 即可运行。
import assert from 'node:assert/strict'
import test from 'node:test'

import { releaseAssetUrl, toReleaseAssetName } from './asset-names.mjs'

test('空格替换为点', () => {
  assert.equal(toReleaseAssetName('Air IDE_0.2.0_x64-setup.exe'), 'Air.IDE_0.2.0_x64-setup.exe')
})

test('连续空格逐个替换，不合并', () => {
  assert.equal(toReleaseAssetName('Air  IDE.exe'), 'Air..IDE.exe')
})

test('已有的点不受影响', () => {
  assert.equal(toReleaseAssetName('app_1.2.3_x64-setup.exe'), 'app_1.2.3_x64-setup.exe')
})

test('括号等符号保留，只处理空格', () => {
  assert.equal(toReleaseAssetName('Air IDE (x64).exe'), 'Air.IDE.(x64).exe')
})

test('无空格时原样返回', () => {
  assert.equal(toReleaseAssetName('air-ide_0.2.0_x64-setup.exe'), 'air-ide_0.2.0_x64-setup.exe')
})

test('下载地址使用实际资产名，不出现 %20', () => {
  const url = releaseAssetUrl('https://github.com/junwindxqw/air_ide/releases/download/v0.2.0', 'Air IDE_0.2.0_x64-setup.exe')
  assert.equal(url, 'https://github.com/junwindxqw/air_ide/releases/download/v0.2.0/Air.IDE_0.2.0_x64-setup.exe')
  assert.ok(!url.includes('%20'), '不应出现 %20 编码的空格')
})

test('base_url 末尾斜杠被归一化', () => {
  const url = releaseAssetUrl('https://example.com/v1/', 'Air IDE.exe')
  assert.equal(url, 'https://example.com/v1/Air.IDE.exe')
})
