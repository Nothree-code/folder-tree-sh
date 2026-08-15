/**
 * dsh-ftree host half: local HTTP routes for the workspace file tree.
 * Routes: /dsh-ftree-list, /dsh-ftree-read, /dsh-ftree-op, /dsh-ftree-pdf.
 * The browser client (lib/client.js) talks to these same-origin routes with fetch.
 */
const FULL = { mode: 'danger-full-access' };
const MAX_FILE = 100 * 1024 * 1024;
const CHUNK = 3 * 349526; // multiple of 3 → base64 chunk concatenation stays valid
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };
const VERSION = '0.1.2'; // keep in sync with package.json version; bumped on each release

const GUARD_ORIGIN = 'http://127.0.0.1:3080';
// Same-origin / local-only request guard (security hardening):
// - blocks cross-site simple requests (<img>/<form>/GET fetch) via
//   Sec-Fetch-Site: cross-site, and any request carrying a foreign Origin;
// - Origin can be spoofed by non-browser clients, so every MUTATING route
//   additionally requires the per-process anti-CSRF token (/dsh-ftree-token).
const allowRequest = (req) => {
  const hdrs = (req && req.headers) || {};
  const sfs = hdrs['sec-fetch-site'];
  if (sfs && sfs === 'cross-site') return false;
  const origin = hdrs['origin'];
  if (origin && origin !== GUARD_ORIGIN) return false;
  return true;
};

// mammoth (docx → HTML) and iconv-lite (GBK fallback) are optional.
let mammoth = null;
try { mammoth = (await import('mammoth')).default ?? (await import('mammoth')); } catch { mammoth = null; }
let iconv = null;
try { iconv = (await import('iconv-lite')).default ?? (await import('iconv-lite')); } catch { iconv = null; }

function bytesToBase64(bytes) {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = len % 3;
  if (rem === 1) out = out.slice(0, -2) + '==';
  else if (rem === 2) out = out.slice(0, -1) + '=';
  return out;
}

function parseQs(url) {
  const out = {};
  const q = String(url || '').split('?')[1] || '';
  for (const kv of q.split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const k = i > 0 ? kv.slice(0, i) : kv;
    const v = i > 0 ? kv.slice(i + 1) : '';
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

export default {
  inject: ['webServer', 'fs'],
  apply(ctx) {
  const webServer = ctx.get('webServer');
  const fs = ctx.get('fs');
  const shell = ctx.get('shell');
  if (webServer === undefined || fs === undefined) return;
  const token = 'ft' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const cacheMap = new Map(); // path -> { path, kind, mime, total, bytes, text } (per-path, no cross-file clobber)
  const CACHE_MAX = 64;
  const normPath = (p) => String(p).replace(/[\\/]+$/, '').toLowerCase();
  const workspaceRoots = async () => {
    // Allowlist = registered workspace roots (fallback: sandbox workspace root).
    // null means "unknown" → all paths denied (deny by default).
    try {
      const reg = ctx.get('workspaceRegistry');
      if (reg) {
        const ws = await reg.list();
        const roots = ws.map((w) => w && w.path ? w.path : null).filter(Boolean).map(normPath);
        if (roots.length) return roots;
      }
    } catch (e) {}
    try {
      const sp = ctx.get('sandboxPolicy');
      if (sp && sp.workspaceRoot) return [normPath(sp.workspaceRoot)];
    } catch (e) {}
    return null;
  };
  const pathAllowed = (p, roots) => {
    if (!p || roots === null) return false;
    const n = normPath(p);
    return roots.some((r) => n === r || n.startsWith(r + '\\') || n.startsWith(r + '/'));
  };

  const sendJson = (res, obj) => {
    try { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); } catch { /* ignore */ }
  };
  const runShell = async (script, stdoutMaxBytes) => {
    const spec = shell.resolve({ command: script, stdoutMaxBytes: stdoutMaxBytes || 16384, sandboxPolicy: FULL });
    return shell.run(spec);
  };
  const shellOk = (res) => res && (res.exitCode === null || res.exitCode === 0) && ((res.stderr && res.stderr.text) || '').trim().length === 0;
  const shellErr = (res) => ((res && res.stderr && res.stderr.text) || '').trim();
  const psq = (s) => String(s).replace(/'/g, "''");
  const readBody = (req) => new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      chunks.push(c);
      size += c.length;
      if (size > MAX_FILE + 4096) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const existsPath = async (p) => {
    try { const t = await fs.resolve(p); const st = await fs.stat(t); return !!(st && st.type); } catch { return false; }
  };
  const dupNameFor = (p, i) => {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const dir = idx >= 0 ? p.slice(0, idx) : '';
    const name = idx >= 0 ? p.slice(idx + 1) : p;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const suffix = i === 1 ? ' (副本)' : ' (副本 ' + i + ')';
    return (dir ? dir + (p.indexOf('/') !== -1 ? '/' : '\\') : '') + base + suffix + ext;
  };
  const uniquePath = async (p) => {
    let cand = p;
    let i = 1;
    while (await existsPath(cand)) { cand = dupNameFor(p, i); i += 1; }
    return cand;
  };

  const disposers = [];

  // GET /dsh-ftree-meta → { version } used by the client for stale-cache detection
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-meta',
    handler: async (req, res) => {
      if (!allowRequest(req)) { res.writeHead(403); res.end('forbidden'); return; }
      sendJson(res, { ok: true, version: VERSION })
    }
  }));

  // GET /dsh-ftree-token → { token } per-process anti-CSRF token for mutating routes
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-token',
    handler: async (req, res) => {
      if (!allowRequest(req)) { res.writeHead(403); res.end('forbidden'); return; }
      sendJson(res, { ok: true, token })
    }
  }));

  // GET /dsh-ftree-list?path= → { path, entries:[{name,kind,size,path}] } | { error }
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-list',
    handler: async (req, res) => {
      try {
        if (!allowRequest(req)) return sendJson(res, { error: 'forbidden' });
        const q = parseQs(req.url);
        const path = q.path;
        if (!path) return sendJson(res, { error: 'missing path' });
        const roots = await workspaceRoots();
        if (!pathAllowed(path, roots)) return sendJson(res, { error: '路径不在工作区内' });
        const target = await fs.resolve(path);
        const entries = await fs.listDir(target);
        sendJson(res, {
          path: target.displayPath ?? path,
          entries: entries.map((e) => ({
            name: e.name,
            kind: e.type === 'directory' ? 'dir' : e.type === 'file' ? 'file' : 'other',
            size: typeof e.size === 'number' ? e.size : null,
            path: e.target.displayPath ?? String(e.target)
          }))
        });
      } catch (e) {
        sendJson(res, { error: (e && e.message) ? String(e.message) : String(e) });
      }
    }
  }));

  // GET /dsh-ftree-read?path=&offset=&whole= → chunked content (same shape as the dynamic RPC)
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-read',
    handler: async (req, res) => {
      try {
        if (!allowRequest(req)) return sendJson(res, { error: 'forbidden' });
        const q = parseQs(req.url);
        const path = q.path;
        const offset = Number(q.offset) > 0 ? Number(q.offset) : 0;
        const whole = q.whole === 'true' || q.whole === '1';
        if (!path) return sendJson(res, { error: 'missing path' });
        const roots = await workspaceRoots();
        if (!pathAllowed(path, roots)) return sendJson(res, { error: '路径不在工作区内' });
        let c = cacheMap.get(path);
        if (!c) {
          const m = path.match(/\.([a-zA-Z0-9]+)$/);
          const lower = (m ? '.' + m[1] : '').toLowerCase();
          const target = await fs.resolve(path);
          const info = await fs.stat(target);
          const size = info && typeof info.size === 'number' ? info.size : 0;
          if (size > MAX_FILE) return sendJson(res, { error: '文件过大（超过 100MB），暂不支持预览' });
          if (MIME[lower]) {
            const bytes = await fs.readBytes(target, undefined, MAX_FILE + 1);
            c = { path, kind: 'image', mime: MIME[lower], total: bytes.length, bytes, text: null };
          } else if (lower === '.pdf') {
            c = { path, kind: 'pdf', mime: 'application/pdf', total: size, bytes: null, text: null };
          } else if (lower === '.docx') {
            const bytes = await fs.readBytes(target, undefined, MAX_FILE + 1);
            if (mammoth) {
              let html = '';
              try {
                const result = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) }, {
                  convertImage: mammoth.images.imgElement((image) =>
                    image.readAsBase64String().then((b64) => ({ src: 'data:' + image.contentType + ';base64,' + b64 })))
                });
                html = result && result.value ? String(result.value) : '';
              } catch (e) {
                return sendJson(res, { error: 'docx 转换失败：' + String((e && e.message) || e) });
              }
              if (html.length > MAX_FILE) html = html.slice(0, MAX_FILE);
              c = { path, kind: 'docx-html', mime: null, total: html.length, bytes: null, text: html };
            } else {
              if (shell === undefined) return sendJson(res, { error: 'docx 预览需要 shell 服务' });
              const script = 'Add-Type -AssemblyName System.IO.Compression.FileSystem; $p = \'' + psq(path) + '\'; $z = [System.IO.Compression.ZipFile]::OpenRead($p); try { $e = $z.GetEntry(\'word/document.xml\'); if ($e -eq $null) { Write-Output \'NO_ENTRY\'; exit 0 }; $r = New-Object System.IO.StreamReader($e.Open()); $x = $r.ReadToEnd(); $r.Close(); $t = $x -replace \'<w:p[^>]*>\', [string][char]10 -replace \'<[^>]+>\', \'\'; $t = [System.Net.WebUtility]::HtmlDecode($t); $out = Join-Path ([Environment]::GetFolderPath(\'LocalApplicationData\') + [IO.Path]::DirectorySeparatorChar + \'Temp\') (\'dsh-docx-\' + [guid]::NewGuid().ToString(\'N\') + \'.txt\'); [System.IO.File]::WriteAllText($out, $t, (New-Object System.Text.UTF8Encoding($false))); Write-Output (\'OK \' + $out) } finally { $z.Dispose() }';
              const rr = await runShell(script, 1 * 1024 * 1024);
              const out = (rr && rr.stdout && typeof rr.stdout.text === 'string' ? rr.stdout.text : '') || '';
              const m2 = out.match(/^OK (.+)$/m);
              if (!m2) return sendJson(res, { error: 'docx 提取失败' });
              const tempTarget = await fs.resolve(m2[1].trim());
              let text = await fs.readText(tempTarget);
              if (text.length > MAX_FILE) text = text.slice(0, MAX_FILE);
              c = { path, kind: 'docx', mime: null, total: text.length, bytes: null, text };
            }
          } else {
            const bytes = await fs.readBytes(target, undefined, MAX_FILE + 1);
            let text;
            try { text = new TextDecoder('utf-8').decode(bytes); } catch { return sendJson(res, { error: '无法解码文件内容' }); }
            if (text.indexOf('\u0000') !== -1) return sendJson(res, { error: '二进制文件，暂不支持预览' });
            const repl = (text.match(/\uFFFD/g) || []).length;
            if (bytes.length > 0 && repl / bytes.length > 0.02) {
              // UTF-8 decode failed → try GBK (common on Chinese Windows for txt/md)
              let gbkText = null;
              if (iconv) {
                try {
                  const gbk = iconv.decode(Buffer.from(bytes), 'gbk');
                  const gbkRepl = (gbk.match(/\uFFFD/g) || []).length;
                  const ctrl = (gbk.match(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
                  if (gbk.indexOf('\u0000') === -1 && gbk.length > 0 && gbkRepl / gbk.length <= 0.01 && ctrl / gbk.length < 0.05) gbkText = gbk;
                } catch { gbkText = null; }
              }
              if (gbkText === null) return sendJson(res, { error: '二进制文件，暂不支持预览' });
              text = gbkText;
            }
            c = { path, kind: 'text', mime: null, total: text.length, bytes: null, text };
          }
          cacheMap.set(path, c);
          if (cacheMap.size > CACHE_MAX) cacheMap.clear();
        }
        if (c.kind === 'pdf') return sendJson(res, { ok: true, kind: 'pdf', size: c.total, page: 1, pages: 1 });
        if (whole) {
          if (c.kind === 'image') return sendJson(res, { ok: true, kind: 'image', mime: c.mime, size: c.total, offset: 0, done: true, base64: bytesToBase64(c.bytes) });
          return sendJson(res, { ok: true, kind: c.kind, size: c.total, offset: 0, done: true, text: c.text });
        }
        if (c.kind === 'image') {
          const start = Math.min(offset, c.total);
          const end = Math.min(c.total, start + CHUNK);
          return sendJson(res, { ok: true, kind: 'image', mime: c.mime, size: c.total, offset: start, done: end >= c.total, base64: bytesToBase64(c.bytes.subarray(start, end)) });
        }
        const start = Math.min(offset, c.total);
        const end = Math.min(c.total, start + CHUNK);
        sendJson(res, { ok: true, kind: c.kind, size: c.total, offset: start, done: end >= c.total, text: c.text.slice(start, end) });
      } catch (e) {
        sendJson(res, { error: (e && e.message) ? String(e.message) : String(e) });
      }
    }
  }));

  // POST /dsh-ftree-op  body: { token, op, ...args } → rename|delete|paste|open
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-op',
    handler: async (req, res) => {
      try {
        if (!allowRequest(req)) return sendJson(res, { error: 'forbidden' });
        if (req.method !== 'POST') return sendJson(res, { error: 'method not allowed' });
        const body = await readBody(req);
        let q = {};
        try { q = JSON.parse(body || '{}'); } catch { return sendJson(res, { error: 'invalid body' }); }
        if (!q.token || q.token !== token) return sendJson(res, { error: 'forbidden' });
        const op = q.op;
        if (shell === undefined) return sendJson(res, { error: '需要 shell 服务' });
        const roots = await workspaceRoots();
        const involved = [q.path, q.srcPath, q.destDir].filter(Boolean);
        if (involved.some((p) => !pathAllowed(p, roots))) return sendJson(res, { error: '路径不在工作区内' });
        if (op === 'rename') {
          const path = q.path;
          const newName = (q.newName || '').trim();
          if (!path) return sendJson(res, { error: 'missing path' });
          if (newName.length === 0 || newName.length > 200) return sendJson(res, { error: '无效的文件名' });
          if (/[\\/:*?"<>|]/.test(newName)) return sendJson(res, { error: '文件名包含非法字符' });
          const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
          const dir = idx >= 0 ? path.slice(0, idx) : '';
          const newPath = (dir ? dir + (path.indexOf('/') !== -1 ? '/' : '\\') : '') + newName;
          const finalPath = await uniquePath(newPath);
          const finalName = finalPath.slice(Math.max(finalPath.lastIndexOf('/'), finalPath.lastIndexOf('\\')) + 1);
          const r = await runShell("Rename-Item -LiteralPath '" + psq(path) + "' -NewName '" + psq(finalName) + "' -ErrorAction Stop");
          if (!shellOk(r)) return sendJson(res, { error: '重命名失败：' + (shellErr(r).slice(0, 200) || '未知错误') });
          return sendJson(res, { ok: true, newPath: finalPath, conflict: finalPath !== newPath });
        }
        if (op === 'delete') {
          const path = q.path;
          if (!path) return sendJson(res, { error: 'missing path' });
          // Send to Recycle Bin (recoverable) instead of permanent Remove-Item.
          const script = 'Add-Type -AssemblyName Microsoft.VisualBasic; $p = \'' + psq(path) + '\'; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, \'OnlyErrorDialogs\', \'SendToRecycleBin\', \'DoNothing\') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, \'OnlyErrorDialogs\', \'SendToRecycleBin\', \'DoNothing\') }';
          const r = await runShell(script);
          if (!shellOk(r)) return sendJson(res, { error: '删除失败：' + (shellErr(r).slice(0, 200) || '未知错误') });
          return sendJson(res, { ok: true, recycle: true });
        }
        if (op === 'paste') {
          const srcPath = q.srcPath;
          const destDir = q.destDir;
          const mode = q.mode === 'cut' ? 'cut' : 'copy';
          const newName = q.newName || null;
          if (!srcPath || !destDir) return sendJson(res, { error: 'missing args' });
          if (mode === 'cut' && !newName) {
            const idx = Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\'));
            const srcDir = idx >= 0 ? srcPath.slice(0, idx) : '';
            if (srcDir === destDir) return sendJson(res, { error: '文件已在该文件夹' });
          }
          const verb = mode === 'cut' ? 'Move-Item' : 'Copy-Item';
          const sep = destDir.indexOf('/') !== -1 ? '/' : '\\';
          const leaf = newName || srcPath.slice(Math.max(srcPath.lastIndexOf('/'), srcPath.lastIndexOf('\\')) + 1);
          const dst = await uniquePath(destDir + (destDir.endsWith('/') || destDir.endsWith('\\') ? '' : sep) + leaf);
          const finalLeaf = dst.slice(Math.max(dst.lastIndexOf('/'), dst.lastIndexOf('\\')) + 1);
          const script = "$src = '" + psq(srcPath) + "'; $dstDir = '" + psq(destDir) + "'; $dst = Join-Path $dstDir '" + psq(finalLeaf) + "'; " + verb + " -LiteralPath $src -Destination $dst -Recurse -Force -ErrorAction Stop";
          const r = await runShell(script);
          if (!shellOk(r)) return sendJson(res, { error: '粘贴失败：' + (shellErr(r).slice(0, 200) || '未知错误') });
          return sendJson(res, { ok: true, newPath: dst, conflict: dst !== destDir + (destDir.endsWith('/') || destDir.endsWith('\\') ? '' : sep) + leaf });
        }
        if (op === 'open') {
          const path = q.path;
          if (!path) return sendJson(res, { error: 'missing path' });
          const script = q.select === 'true'
            ? "[System.Diagnostics.Process]::Start('explorer.exe', '/select,\"" + psq(path) + "\"')"
            : "[System.Diagnostics.Process]::Start('" + psq(path) + "')";
          const r = await runShell(script);
          if (!shellOk(r)) return sendJson(res, { error: '打开失败：' + (shellErr(r).slice(0, 200) || '未知错误') });
          return sendJson(res, { ok: true });
        }
        sendJson(res, { error: 'unknown op' });
      } catch (e) {
        sendJson(res, { error: (e && e.message) ? String(e.message) : String(e) });
      }
    }
  }));

  // POST /dsh-ftree-write?path=  body: {"content": "..."} → save text file (md editor autosave)
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-write',
    handler: async (req, res) => {
      try {
        if (!allowRequest(req)) return sendJson(res, { error: 'forbidden' });
        const q = parseQs(req.url);
        const path = q.path;
        if (!path) return sendJson(res, { error: 'missing path' });
        const roots = await workspaceRoots();
        if (!pathAllowed(path, roots)) return sendJson(res, { error: '路径不在工作区内' });
        const body = await readBody(req);
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch { return sendJson(res, { error: 'invalid body' }); }
        if (!parsed.token || parsed.token !== token) return sendJson(res, { error: 'forbidden' });
        const content = parsed.content;
        if (typeof content !== 'string') return sendJson(res, { error: 'invalid content' });
        if (content.length > MAX_FILE) return sendJson(res, { error: '内容过大（超过 100MB）' });
        const target = await fs.resolve(path);
        // Keep rolling backups (.dshbak.1 newest, .3 oldest) before overwriting.
        // Backup failure must NEVER block the actual save.
        if (shell !== undefined) {
          try {
            const bscript = '$f = \'' + psq(path) + '\'; if (Test-Path -LiteralPath $f) { $n = [IO.Path]::GetFileName($f); $d = [IO.Path]::GetDirectoryName($f); $p3 = Join-Path $d ($n + \'.dshbak.3\'); $p2 = Join-Path $d ($n + \'.dshbak.2\'); $p1 = Join-Path $d ($n + \'.dshbak.1\'); if (Test-Path -LiteralPath $p3) { Remove-Item -LiteralPath $p3 -Force }; if (Test-Path -LiteralPath $p2) { Move-Item -LiteralPath $p2 -Destination $p3 -Force }; if (Test-Path -LiteralPath $p1) { Move-Item -LiteralPath $p1 -Destination $p2 -Force }; Copy-Item -LiteralPath $f -Destination $p1 -Force }';
            await runShell(bscript);
          } catch { /* backup is best-effort only */ }
        }
        await fs.writeText(target, content, undefined, undefined, FULL);
        sendJson(res, { ok: true, size: content.length });
      } catch (e) {
        sendJson(res, { error: (e && e.message) ? String(e.message) : String(e) });
      }
    }
  }));

  // GET /dsh-ftree-pdf?path= → PDF bytes (browser-native viewer)
  disposers.push(webServer.register({
    kind: 'exact',
    path: '/dsh-ftree-pdf',
    handler: async (req, res) => {
      try {
        if (!allowRequest(req)) { res.writeHead(403); res.end('forbidden'); return; }
        const q = parseQs(req.url);
        if (!q.path) { res.writeHead(400); res.end('missing path'); return; }
        const roots = await workspaceRoots();
        if (!pathAllowed(q.path, roots)) { res.writeHead(403); res.end('forbidden'); return; }
        const target = await fs.resolve(q.path);
        const bytes = await fs.readBytes(target, undefined, MAX_FILE + 1);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': bytes.length, 'Content-Disposition': 'inline' });
        res.end(bytes);
      } catch (e) {
        res.writeHead(500);
        res.end((e && e.message) ? String(e.message) : String(e));
      }
    }
  }));

  return () => { for (const d of disposers) d(); };
  }
};
