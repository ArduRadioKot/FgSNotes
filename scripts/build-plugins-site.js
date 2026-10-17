// Publishes the plugins from plugins-examples/ to the website: copies the files to website/plugins/ and rewrites the catalog
// (website/plugins-data.json and the copy embedded in website/plugins.html). Run after adding or changing a plugin.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const source = path.join(root, 'plugins-examples');
const site = path.join(root, 'website');
const extra = JSON.parse(fs.readFileSync(path.join(source, 'catalog.json'), 'utf8'));
const field = (header, name) => { const match = new RegExp('@' + name + '\\s+(.+)').exec(header); return match ? match[1].trim() : ''; };

fs.rmSync(path.join(site, 'plugins'), { recursive: true, force: true });
fs.mkdirSync(path.join(site, 'plugins'), { recursive: true });
const plugins = [];
for (const file of fs.readdirSync(source).filter(name => name.endsWith('.js')).sort()) {
    const id = file.replace(/\.js$/, '');
    const text = fs.readFileSync(path.join(source, file), 'utf8');
    const header = (/==FgsPlugin==([\s\S]*?)==\/FgsPlugin==/.exec(text) || [, ''])[1];
    const meta = extra[id];
    if (!meta) throw new Error(`plugins-examples/catalog.json has no entry for ${id}`);
    fs.copyFileSync(path.join(source, file), path.join(site, 'plugins', file));
    plugins.push({ id, file, name: field(header, 'name'), version: field(header, 'version'), description: field(header, 'description'), author: field(header, 'author') || 'FgSNotes', size: Buffer.byteLength(text), ...meta });
}
const data = { format: 1, categories: { sources: 'Импорт и источники', navigate: 'Поиск и связи', show: 'Рисунок и показ', plan: 'Планирование', export: 'Экспорт и перенос', edit: 'Редактирование' }, plugins };
fs.writeFileSync(path.join(site, 'plugins-data.json'), JSON.stringify(data, null, 2));
const page = path.join(site, 'plugins.html');
if (fs.existsSync(page)) {
    const html = fs.readFileSync(page, 'utf8').replace(/(<script type="application\/json" id="plugins-data">)[\s\S]*?(<\/script>)/, (m, a, b) => a + JSON.stringify(data).replace(/</g, '\\u003c') + b);
    fs.writeFileSync(page, html);
}
console.log(`Plugin catalog ready: ${plugins.length} plugins`);
