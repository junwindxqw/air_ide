// 调试 rename 在 cached diff 各形式下的表现。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const dir = '/tmp/renamedbg2'
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
const git = (args) => execSync(`git ${args}`, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
git('init -q')
git('config user.email t@t.com')
git('config user.name t')
git('config core.autocrlf false')
writeFileSync(`${dir}/old.php`, 'line1\nline2\n')
git('add -A')
git('commit -qm init')
git('mv old.php new.php')
writeFileSync(`${dir}/new.php`, 'line1\nCHANGED\n')
git('add -A')

console.log('cached -- new.php:', execSync('git diff --cached --no-color -- new.php', { cwd: dir, encoding: 'utf8' }).slice(0, 100).replace(/\n/g, '|'))
console.log('cached (no path):', execSync('git diff --cached --no-color', { cwd: dir, encoding: 'utf8' }).slice(0, 150).replace(/\n/g, '|'))
console.log('status v2:', execSync('git status --porcelain=v2', { cwd: dir, encoding: 'utf8' }).replace(/\n/g, '|'))
