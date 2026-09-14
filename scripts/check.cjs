const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
/** 递归查找项目脚本，排除依赖与隐藏目录。 */
function scripts(directory) { return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.name.startsWith('.') || entry.name === 'node_modules' ? [] : entry.isDirectory() ? scripts(path.join(directory, entry.name)) : /\.(js|cjs)$/.test(entry.name) ? [path.join(directory, entry.name)] : []); }
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3 || manifest.minimum_chrome_version !== '138') throw new Error('Manifest 版本不正确');
for (const file of [manifest.background.service_worker, manifest.action.default_popup, manifest.options_page, ...manifest.content_scripts.flatMap(item => [...item.js, ...(item.css || [])])]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error('Manifest 引用了不存在的文件：' + file);
}
if (manifest.content_scripts.some(item => item.matches.some(match => match !== 'https://www.netflix.com/*'))) throw new Error('内容脚本范围超出 Netflix');
let count = 0;
for (const file of scripts(root)) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); } count++; }
console.log('Manifest 引用、站点范围及 ' + count + ' 个脚本语法检查通过。');
