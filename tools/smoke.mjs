// folder-tree-sh host smoke test — run after any host change:
//   node tools/smoke.mjs
// Verifies every HTTP route against the real filesystem + real PowerShell.
// Creates and cleans up files under a temp dir; deletion goes to the Recycle Bin.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TMP = path.join(os.tmpdir(), 'ftree-smoke-' + process.pid);
fs.mkdirSync(TMP, { recursive: true });

const mod = (await import('file:///C:/Users/SangHao/.dsh/profiles/web/node_modules/folder-tree-sh/lib/index.js')).default;

const routes = {};
const fakeFs = {
  async resolve(p) { return { displayPath: p, targetKey: p }; },
  async stat(t) { try { const s = fs.statSync(t.targetKey); return { type: s.isDirectory() ? 'directory' : 'file', size: s.size }; } catch { return undefined; } },
  async listDir(t) { const entries = fs.readdirSync(t.targetKey, { withFileTypes: true }); return entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file', size: e.isFile() ? fs.statSync(path.join(t.targetKey, e.name)).size : null, target: { displayPath: path.join(t.targetKey, e.name) } })); },
  async readBytes(t, _s, max) { const b = fs.readFileSync(t.targetKey); return new Uint8Array(b.subarray(0, max)); },
  async readText(t) { return fs.readFileSync(t.targetKey, 'utf8'); },
  async writeText(t, content) { fs.writeFileSync(t.targetKey, content, 'utf8'); return { ok: true }; }
};
const fakeShell = {
  resolve(s) { return s; },
  async run(spec) {
    const { execSync } = await import('node:child_process');
    const out = execSync('powershell.exe -NoProfile -Command "' + spec.command.replace(/"/g, '\\"') + '"', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return { exitCode: 0, stdout: { text: out }, stderr: { text: '' } };
  }
};
const fakeCtx = { get(n) { if (n === 'webServer') return { register: (r) => { routes[r.path] = r; return () => { delete routes[r.path]; }; } }; if (n === 'fs') return fakeFs; if (n === 'shell') return fakeShell; return undefined; } };
mod.apply(fakeCtx);

const mkRes = () => { const out = { status: 0, body: '', headers: {} }; out.writeHead = (c, h) => { out.status = c; out.headers = h || {}; }; out.end = (b) => { out.body = b; }; return out; };
const get = async (p, qs) => { const res = mkRes(); await routes[p].handler({ url: p + '?' + qs }, res); return JSON.parse(res.body); };
const post = async (p, qs, obj) => {
  const listeners = {};
  const req = { url: p + '?' + qs, on: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); return req; }, destroy: () => {} };
  queueMicrotask(() => { (listeners.data || []).forEach((fn) => fn(Buffer.from(JSON.stringify(obj)))); (listeners.end || []).forEach((fn) => fn()); });
  const res = mkRes();
  await routes[p].handler(req, res);
  return JSON.parse(res.body);
};

const E = (p) => encodeURIComponent(p);
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass += 1; console.log('  PASS  ' + name); } else { fail += 1; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); } };

console.log('routes:', Object.keys(routes).join(', '));
ok('meta', (await get('/dsh-ftree-meta', '')).version === '0.1.1', 'version mismatch');

// list
const dir = TMP;
fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
const list = await get('/dsh-ftree-list', 'path=' + E(dir));
ok('list', list.ok !== false && Array.isArray(list.entries) && list.entries.some((e) => e.name === 'a.txt'), JSON.stringify(list.error));

// read text
const rd = await get('/dsh-ftree-read', 'path=' + E(path.join(dir, 'a.txt')) + '&whole=true');
ok('read text', rd.ok === true && rd.text === 'hello', JSON.stringify(rd.error));

// write + backup rotation (initial file + 3 saves → bak1..3)
fs.writeFileSync(path.join(dir, 'note.md'), '# init');
for (let i = 1; i <= 3; i++) {
  const w = await post('/dsh-ftree-write', 'path=' + E(path.join(dir, 'note.md')), { content: '# v' + i });
  if (w.ok !== true) { ok('write #' + i, false, JSON.stringify(w.error)); break; }
  if (i === 3) ok('write', true, '');
}
ok('backup .1 exists', fs.existsSync(path.join(dir, 'note.md.dshbak.1')), 'no bak.1');
ok('backup .2 exists', fs.existsSync(path.join(dir, 'note.md.dshbak.2')), 'no bak.2');
ok('backup .3 exists', fs.existsSync(path.join(dir, 'note.md.dshbak.3')), 'no bak.3');

// rename conflict → copy name
fs.writeFileSync(path.join(dir, 'r1.txt'), 'x');
fs.writeFileSync(path.join(dir, 'target.txt'), 'y');
const rn = await get('/dsh-ftree-op', 'op=rename&path=' + E(path.join(dir, 'r1.txt')) + '&newName=' + E('target.txt'));
ok('rename conflict', rn.ok === true && rn.conflict === true && fs.existsSync(path.join(dir, 'target (副本).txt')), JSON.stringify(rn.error));

// delete → recycle bin
fs.writeFileSync(path.join(dir, 'del.txt'), 'x');
const del = await get('/dsh-ftree-op', 'op=delete&path=' + E(path.join(dir, 'del.txt')));
ok('delete to recycle bin', del.ok === true && del.recycle === true && !fs.existsSync(path.join(dir, 'del.txt')), JSON.stringify(del.error));

// paste conflict
fs.mkdirSync(path.join(dir, 'dst'), { recursive: true });
fs.writeFileSync(path.join(dir, 'p1.txt'), 'p');
fs.writeFileSync(path.join(dir, 'dst', 'p1.txt'), 'q');
const paste = await get('/dsh-ftree-op', 'op=paste&mode=copy&srcPath=' + E(path.join(dir, 'p1.txt')) + '&destDir=' + E(path.join(dir, 'dst')));
ok('paste conflict copy', paste.ok === true && fs.existsSync(path.join(dir, 'dst', 'p1 (副本).txt')), JSON.stringify(paste.error));

// gbk fallback
const { default: iconv } = await import('file:///C:/Users/SangHao/.dsh/profiles/web/node_modules/iconv-lite/lib/index.js');
const gbk = path.join(dir, 'gbk.txt');
fs.writeFileSync(gbk, iconv.encode('中文GBK测试', 'gbk'));
const grd = await get('/dsh-ftree-read', 'path=' + E(gbk) + '&whole=true');
ok('gbk fallback', grd.ok === true && grd.text === '中文GBK测试', JSON.stringify(grd.error));

// docx → html (via mammoth, real docx fixture)
const docxFixture = 'D:\\0_JY_data\\000-博士后\\博士后研究方向调研报告_C9高校.docx';
if (fs.existsSync(docxFixture)) {
  const drd = await get('/dsh-ftree-read', 'path=' + E(docxFixture) + '&whole=true');
  ok('docx→html', drd.ok === true && drd.kind === 'docx-html' && drd.text.indexOf('<h1') !== -1, JSON.stringify(drd.error));
} else console.log('  SKIP  docx fixture not found');

// pdf bytes
const pdfFixture = 'D:\\0_JY_data\\000-博士后\\C9高校_异构集成3D集成芯粒集成_课题组调研报告.pdf';
if (fs.existsSync(pdfFixture)) {
  const res = mkRes();
  await routes['/dsh-ftree-pdf'].handler({ url: '/dsh-ftree-pdf?path=' + E(pdfFixture) }, res);
  ok('pdf bytes', res.status === 200 && res.headers['Content-Type'] === 'application/pdf' && typeof res.body.byteLength === 'number' && res.body.byteLength > 1000, 'status=' + res.status);
} else console.log('  SKIP  pdf fixture not found');

// image chunk base64 (multiple-of-3)
const png = path.join(dir, 't.png');
fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a' + '00'.repeat(200), 'hex'));
const img = await get('/dsh-ftree-read', 'path=' + E(png));
ok('image chunk', img.ok === true && img.kind === 'image' && img.base64.length % 4 === 0, JSON.stringify(img.error));

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
