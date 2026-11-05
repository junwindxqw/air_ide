// 验证：Discard 时把 patch 内容行转为文件的行尾（CRLF）后 apply --reverse 是否成功。
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const dir = '/tmp/crlfdbg2'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const git = (args) => execSync(`git ${args}`, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

git('init -q')
git('config user.email t@t.com')
git('config user.name t')
git('config core.autocrlf true')
writeFileSync(`${dir}/crlf.php`, 'a\r\nb\r\nc\r\n')
git('add -A')
git('commit -qm init')
writeFileSync(`${dir}/crlf.php`, 'a\r\nCHANGED\r\nc\r\n')

const diff = execSync('git diff --no-color --no-ext-diff -U3 -- crlf.php', { cwd: dir, encoding: 'binary' })
// 把内容行（' ' '+' '-' 开头）的 LF 转为 CRLF；头部/@@ 行保持 LF
const converted = diff
  .split('\n')
  .map((line) => (/^[ +-]/.test(line) ? line + '\r' : line))
  .join('\n')
writeFileSync('/tmp/p2.patch', converted)

try {
  execSync('git apply --reverse --whitespace=nowarn /tmp/p2.patch', { cwd: dir, stdio: 'pipe' })
  const after = readFileSync(`${dir}/crlf.php`, 'binary')
  console.log('REVERSE APPLY (CRLF patch): OK, file =', JSON.stringify(after))
} catch (e) {
  console.log('REVERSE APPLY FAILED:', e.stderr?.toString())
}
