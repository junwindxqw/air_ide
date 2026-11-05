// 调试 rename 配对：长文件 + 小改动 + -M。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const dir = '/tmp/renamedbg3'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const git = (args) => execSync(`git ${args}`, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
git('init -q')
git('config user.email t@t.com')
git('config user.name t')
git('config core.autocrlf false')
const base = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n'
writeFileSync(`${dir}/old.php`, base)
git('add -A')
git('commit -qm init')
git('mv old.php new.php')
const lines = base.split('\n')
lines[4] = 'CHANGED'
writeFileSync(`${dir}/new.php`, lines.join('\n'))
git('add -A')

for (const args of [
  'diff --cached --no-color --no-ext-diff -U3 -M -- new.php',
  'diff --cached --no-color --no-ext-diff -U3 -M',
  'diff --cached --no-color --find-renames=40% -- new.php',
]) {
  try {
    const out = execSync(`git ${args}`, { cwd: dir, encoding: 'utf8' })
    console.log(`[${args}] rename:`, out.includes('rename from'), '|', JSON.stringify(out.slice(0, 90)))
  } catch (e) {
    console.log(`[${args}] ERROR`, e.stderr?.toString())
  }
}
