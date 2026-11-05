// 调试 rename 检测：git mv + 改内容后 git diff 是否给 rename 头。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

for (const mode of ['true', 'false', 'input']) {
  const dir = `/tmp/renamedbg-${mode}`
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const git = (args) => execSync(`git ${args}`, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
  git('init -q')
  git('config user.email t@t.com')
  git('config user.name t')
  git(`config core.autocrlf ${mode}`)
  writeFileSync(`${dir}/old.php`, 'line1\nline2\n')
  git('add -A')
  git('commit -qm init')
  git('mv old.php new.php')
  writeFileSync(`${dir}/new.php`, 'line1\nCHANGED\n')
  const diff = execSync('git diff --no-color --no-ext-diff -U3 -- new.php', { cwd: dir, encoding: 'utf8' })
  console.log(`[${mode}] rename in diff:`, diff.includes('rename from'), '| has @@:', diff.includes('@@'))
  console.log(`[${mode}] diff head:`, JSON.stringify(diff.slice(0, 120)))
}
