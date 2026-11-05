// CRLF apply 调试：打印 autocrlf=true 下的 diff 与 apply 结果。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
const dir = '/tmp/crlfdbg'
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
console.log('=== raw diff (escaped) ===')
console.log(JSON.stringify(diff))

writeFileSync('/tmp/p.patch', diff)
try {
  execSync('git apply --cached --whitespace=nowarn /tmp/p.patch', { cwd: dir, stdio: 'pipe' })
  console.log('APPLY --cached: OK')
} catch (e) {
  console.log('APPLY --cached FAILED:', e.stderr?.toString())
}
// 尝试 apply（工作区）
try {
  execSync('git checkout -- crlf.php', { cwd: dir, stdio: 'pipe' })
  writeFileSync(`${dir}/crlf.php`, 'a\r\nCHANGED\r\nc\r\n')
  execSync('git apply --whitespace=nowarn /tmp/p.patch', { cwd: dir, stdio: 'pipe' })
  console.log('APPLY (worktree): OK')
} catch (e) {
  console.log('APPLY (worktree) FAILED:', e.stderr?.toString())
}
