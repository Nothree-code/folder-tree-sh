window.__ModuleLoader__.load({
	id: "folder-tree-sh",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		// ======================= shared helpers =======================
		const api = (m, p, timeoutMs) => {
			const ctl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(timeoutMs || 20000) : undefined;
			return fetch("/dsh-ftree-" + m + "?" + new URLSearchParams(p || {}), ctl ? { signal: ctl } : undefined).then((r) => r.json());
		};
		// Per-process anti-CSRF token: fetched once at load, attached to every
		// mutating POST (ops + write). Host rejects mutations without it.
		let TOKEN = '';
		fetch("/dsh-ftree-token").then((r) => r.json()).then((d) => { if (d && d.token) TOKEN = d.token; }).catch(() => {});
		const apiOp = (p) => {
			const ctl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined;
			return fetch("/dsh-ftree-op", {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(Object.assign({ token: TOKEN }, p || {})),
				signal: ctl
			}).then((r) => r.json());
		};
		const log = (...args) => { try { console.log("[ftree]", ...args); } catch (e) { /* ignore */ } };
		const injectStyle = (cssText) => {
			const tag = document.createElement("style");
			tag.textContent = cssText;
			document.head.appendChild(tag);
			return () => { tag.remove(); };
		};
		const MIN_W = 280;
		const MAX_CENTER = 400;
		const PREV_MIN = 320;
		const PREV_MAX = 720;
		const IMG_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
		const TEXT_CAP = 20 * 1024 * 1024;
		const IMG_CAP = 20 * 1024 * 1024;
		const fmtSize = (n) => {
			if (n === null || n === undefined) return '';
			if (n < 1024) return n + ' B';
			if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
			return (n / (1024 * 1024)).toFixed(1) + ' MB';
		};
		const basename = (p) => {
			const parts = String(p || '').split(/[\\/]/).filter(Boolean);
			return parts.length ? parts[parts.length - 1] : '';
		};
		// ---- persistent layout prefs (localStorage) ----
		const LS = { open: 'ftree.panel.open', w: 'ftree.tree.w', pw: 'ftree.prev.w' };
		const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } };
		const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
		const dirname = (p) => {
			const idx = Math.max(String(p || '').lastIndexOf('/'), String(p || '').lastIndexOf('\\'));
			return idx >= 0 ? String(p).slice(0, idx) : '';
		};
		const dupName = (name) => {
			const idx = String(name).lastIndexOf('.');
			if (idx > 0) return String(name).slice(0, idx) + ' (副本)' + String(name).slice(idx);
			return String(name) + ' (副本)';
		};
		const extOf = (p) => {
			const m = String(p || '').match(/\.([a-zA-Z0-9]+)$/);
			return m ? ('.' + m[1]).toLowerCase() : '';
		};
		const makeEl = (tag, cls, text) => {
			const el = document.createElement(tag);
			if (cls) el.className = cls;
			if (text !== undefined) el.textContent = text;
			return el;
		};
		const apiPost = (m, p, obj) => {
			const ctl = (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) ? AbortSignal.timeout(20000) : undefined;
			return fetch("/dsh-ftree-" + m + "?" + new URLSearchParams(p || {}), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(obj || {}),
				signal: ctl
			}).then((r) => r.json());
		};

		// ---- tiny markdown renderer (escaped, safe) ----
		const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
		// Resolve a workspace-relative image src (baseDir = the md file's folder)
		// to the host raw route, so `![](assets/a.png)` renders inside the preview.
		const mdImgSrc = (src, baseDir) => {
			if (/^(https?:|data:)/i.test(src) || /^[#/\\]/.test(src)) return src;
			if (!baseDir) return src;
			const clean = String(baseDir).replace(/[\\/]+$/, '');
			const rel = String(src).split('/').join('\\');
			return '/dsh-ftree-raw?path=' + encodeURIComponent(clean + '\\' + rel);
		};
		const mdInline = (s, baseDir) => {
			const codes = [];
			s = s.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
			let out = escHtml(s);
			out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
			out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
			out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
			out = out.replace(/\[([^\]]+)\]\((https?:[^)\s]+|mailto:[^)\s]+|#[^\s)]*|\/[^\s)]*)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
			out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
				const url = mdImgSrc(src, baseDir);
				return '<img alt="' + escHtml(alt) + '" src="' + escHtml(url) + '">';
			});
			out = out.replace(/\u0000(\d+)\u0000/g, (m, i) => '<code>' + escHtml(codes[Number(i)]) + '</code>');
			return out;
		};
		const renderMd = (src, baseDir) => {
			const mi = (s) => mdInline(s, baseDir);
			const lines = String(src || '').split(/\r?\n/);
			const out = [];
			let inCode = false, codeBuf = [], codeStart = 0, listTag = null, tbl = false;
			const closeList = () => { if (listTag) { out.push('</' + listTag + '>'); listTag = null; } };
			const closeTbl = () => { if (tbl) { out.push('</tbody></table>'); tbl = false; } };
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (/^(`{3,}|~{3,})/.test(line.trim())) {
					closeList(); closeTbl();
					if (inCode) {
						const langRaw = (lines[codeStart] || '').trim().replace(/^(`{3,}|~{3,})/, '').trim().toLowerCase();
						const lang = MD_LANG_ALIAS[langRaw] || null;
						const body = codeBuf.join('\n');
						out.push('<pre class="dsh-ftree-md-pre"><code>' + (lang ? hlCode(body, lang) : escHtml(body)) + '</code></pre>');
						codeBuf = []; inCode = false;
					} else { codeStart = i; inCode = true; }
					continue;
				}
				if (inCode) { codeBuf.push(line); continue; }
				const h = line.match(/^(#{1,6})\s+(.*)$/);
				if (h) { closeList(); closeTbl(); const lv = h[1].length; out.push('<h' + lv + '>' + mi(h[2]) + '</h' + lv + '>'); continue; }
				if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { closeList(); closeTbl(); out.push('<hr>'); continue; }
				const ul = line.match(/^\s*[-*+]\s+(.*)$/);
				if (ul) {
					closeTbl();
					if (listTag !== 'ul') { closeList(); out.push('<ul>'); listTag = 'ul'; }
					const t = ul[1].match(/^\[([ xX])\]\s+(.*)$/);
					if (t) {
						const checked = t[1].toLowerCase() === 'x';
						out.push('<li class="dsh-md-task' + (checked ? ' done' : '') + '"><input type="checkbox" disabled' + (checked ? ' checked' : '') + '> ' + mi(t[2]) + '</li>');
					} else {
						out.push('<li>' + mi(ul[1]) + '</li>');
					}
					continue;
				}
				const ol = line.match(/^\s*\d+\.\s+(.*)$/);
				if (ol) { closeTbl(); if (listTag !== 'ol') { closeList(); out.push('<ol>'); listTag = 'ol'; } out.push('<li>' + mi(ol[1]) + '</li>'); continue; }
				const q = line.match(/^\s*>\s?(.*)$/);
				if (q) { closeList(); closeTbl(); out.push('<blockquote>' + mi(q[1]) + '</blockquote>'); continue; }
				if (/^\s*\|.+\|\s*$/.test(line)) {
					const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
					const next = lines[i + 1] || '';
					if (!tbl && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(next)) {
						closeList();
						out.push('<table><thead><tr>' + cells.map((c) => '<th>' + mi(c) + '</th>').join('') + '</tr></thead><tbody>');
						tbl = true;
						i += 1;
					} else if (tbl) {
						out.push('<tr>' + cells.map((c) => '<td>' + mi(c) + '</td>').join('') + '</tr>');
					} else {
						closeList(); closeTbl();
						out.push('<p>' + mi(line) + '</p>');
					}
					continue;
				}
				if (line.trim() === '') { closeList(); closeTbl(); continue; }
				closeList(); closeTbl();
				out.push('<p>' + mi(line) + '</p>');
			}
			if (inCode) {
				const langRaw = (lines[codeStart] || '').trim().replace(/^(`{3,}|~{3,})/, '').trim().toLowerCase();
				const lang = MD_LANG_ALIAS[langRaw] || null;
				const body = codeBuf.join('\n');
				out.push('<pre class="dsh-ftree-md-pre"><code>' + (lang ? hlCode(body, lang) : escHtml(body)) + '</code></pre>');
			}
			closeList(); closeTbl();
			return out.join('\n');
		};

		// ---- lightweight code syntax highlight ----
		const CODE_LANGS = {
			'.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.tsx': 'tsx', '.jsx': 'jsx',
			'.json': 'json', '.jsonc': 'json',
			'.py': 'py', '.pyw': 'py',
			'.yaml': 'yaml', '.yml': 'yaml',
			'.html': 'html', '.htm': 'html', '.xml': 'xml', '.svg': 'xml',
			'.css': 'css',
			'.sh': 'sh', '.bash': 'sh', '.ps1': 'ps1', '.psm1': 'ps1', '.sql': 'sql',
			'.java': 'java', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp', '.cs': 'cs', '.go': 'go', '.rs': 'rs', '.rb': 'rb', '.php': 'php', '.tcl': 'tcl'
		};
		// language aliases written after ``` in markdown fenced blocks
		const MD_LANG_ALIAS = {
			'js': 'js', 'javascript': 'js', 'jsx': 'jsx', 'node': 'js',
			'ts': 'ts', 'typescript': 'ts', 'tsx': 'tsx',
			'py': 'py', 'python': 'py',
			'json': 'json', 'jsonc': 'json',
			'yaml': 'yaml', 'yml': 'yaml',
			'html': 'html', 'htm': 'html', 'xml': 'xml', 'svg': 'xml',
			'css': 'css',
			'sh': 'sh', 'bash': 'sh', 'shell': 'sh', 'zsh': 'sh',
			'ps1': 'ps1', 'powershell': 'ps1', 'pwsh': 'ps1',
			'sql': 'sql',
			'java': 'java', 'c': 'c', 'h': 'c', 'cpp': 'cpp', 'c++': 'cpp', 'hpp': 'cpp',
			'cs': 'cs', 'csharp': 'cs', 'go': 'go', 'golang': 'go', 'rs': 'rs', 'rust': 'rs',
			'rb': 'rb', 'ruby': 'rb', 'php': 'php', 'tcl': 'tcl', 'tk': 'tcl'
		};
		const CODE_KEYWORDS = {
			js: 'const|let|var|function|return|if|else|for|while|do|class|import|export|from|new|delete|typeof|instanceof|in|of|this|null|undefined|true|false|async|await|try|catch|finally|throw|switch|case|break|continue|default|extends|super|static|get|set|yield',
			ts: 'const|let|var|function|return|if|else|for|while|do|class|interface|type|enum|import|export|from|new|delete|typeof|instanceof|in|of|this|null|undefined|true|false|async|await|try|catch|finally|throw|switch|case|break|continue|default|extends|implements|super|static|readonly|get|set|public|private|protected|yield|namespace|declare|abstract|as|satisfies',
			json: 'true|false|null',
			py: 'def|return|if|elif|else|for|while|import|from|class|try|except|finally|raise|with|as|lambda|pass|break|continue|global|nonlocal|yield|and|or|not|in|is|None|True|False|self|assert|del|async|await',
			yaml: 'true|false|null|yes|no|on|off',
			html: 'html|head|body|div|span|p|a|img|table|tr|td|th|ul|ol|li|h1|h2|h3|h4|h5|h6|form|input|button|script|style|link|meta|title|section|article|nav|header|footer|main|aside|strong|em|code|pre|blockquote|br|hr|iframe|select|option|textarea|label|video|audio|canvas',
			xml: 'xml|svg|path|g|rect|circle|line|text|defs|use|linearGradient|stop|filter',
			css: '',
			sh: 'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|exit|echo|export|local|read|cd|source|set|unset|test|true|false|null|in|select|shift|trap|until',
			ps1: 'function|param|if|else|elseif|for|foreach|while|do|switch|case|default|break|continue|return|exit|throw|try|catch|finally|filter|begin|process|end|in|new|class|enum|using|$true|$false|$null|where|select|import|export|from|module|scriptblock|dynamicparam|trap|until',
			sql: 'select|from|where|insert|into|values|update|set|delete|create|table|drop|alter|join|inner|left|right|outer|on|as|group|by|order|having|limit|offset|and|or|not|null|is|in|between|like|exists|union|all|distinct|primary|key|foreign|references|index|view|procedure|function|begin|end|commit|rollback|case|when|then|else|count|sum|avg|min|max|asc|desc|default|unique|constraint|if',
			java: 'public|private|protected|class|interface|enum|extends|implements|static|final|void|int|long|double|float|boolean|char|byte|short|string|new|return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|throws|import|package|this|super|null|true|false|abstract|volatile|synchronized|instanceof|default',
			c: 'int|char|float|double|void|long|short|unsigned|signed|struct|union|enum|typedef|static|const|volatile|extern|register|return|if|else|for|while|do|switch|case|break|continue|goto|sizeof|NULL|true|false|include|define|ifdef|ifndef|endif',
			cpp: 'int|char|float|double|void|long|short|unsigned|signed|struct|union|enum|class|template|typename|namespace|using|typedef|static|const|constexpr|auto|decltype|virtual|override|final|public|private|protected|new|delete|return|if|else|for|while|do|switch|case|break|continue|try|catch|throw|this|nullptr|true|false|include|define|ifdef|ifndef|endif|std',
			cs: 'public|private|protected|internal|class|interface|enum|struct|namespace|using|static|readonly|const|sealed|abstract|virtual|override|new|return|if|else|for|foreach|while|do|switch|case|break|continue|try|catch|finally|throw|this|base|null|true|false|void|int|long|double|float|bool|string|char|var|async|await|get|set|partial|event|delegate|is|as|in|out|ref|params',
			go: 'package|import|func|var|const|type|struct|interface|map|chan|go|defer|return|if|else|for|range|switch|case|break|continue|fallthrough|default|select|goto|true|false|nil|len|cap|make|new|append|copy|panic|recover|string|int|float|bool|byte|rune|error|uint|complex',
			rs: 'fn|let|mut|const|static|struct|enum|trait|impl|mod|use|pub|return|if|else|for|while|loop|match|break|continue|true|false|null|Some|None|Ok|Err|self|Self|async|await|move|ref|type|where|dyn|unsafe|extern|crate|super|in|as|Box|String|Vec',
			rb: 'def|end|if|elsif|else|unless|while|until|for|in|do|case|when|then|return|yield|class|module|require|include|extend|attr_reader|attr_writer|attr_accessor|new|self|nil|true|false|and|or|not|begin|rescue|ensure|raise|lambda|proc|break|next|redo|retry|super',
			php: 'function|return|if|else|elseif|for|foreach|while|do|switch|case|break|continue|default|class|interface|trait|extends|implements|public|private|protected|static|final|abstract|new|echo|print|require|require_once|include|include_once|namespace|use|try|catch|finally|throw|isset|empty|unset|true|false|null|this|self|parent|array|string|int|float|bool|const|global|list|as|and|or|xor|instanceof',
			tcl: 'proc|set|unset|foreach|if|else|elseif|return|package|puts|global|expr|while|for|catch|switch|exec|source|list|lappend|llength|string|array|namespace|uplevel|upvar|incr|break|continue|after|file|open|close|gets|read|write|format|scan|subst|regsub|regexp|append|join|split|concat|length|index|range|error|info|clock|time|rename|trace|variable|dict|binary|eval|apply|exit|uplevel|unknown|auto_execok|pid|env|socket|update|vwait|fconfigure|eof|flush|seek|tell|glob|pwd|cd|puts'
		};
		const hlCode = (text, lang) => {
			const kwSet = new Set((CODE_KEYWORDS[lang] || '').split('|').filter(Boolean));
			const reAll = (lang === 'py' || lang === 'yaml' || lang === 'sh' || lang === 'ps1' || lang === 'rb' || lang === 'tcl')
				? /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(#[^\n]*)/g
				: /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/g;
			const segs = [];
			let last = 0;
			let m;
			while ((m = reAll.exec(String(text))) !== null) {
				if (m.index > last) segs.push({ kind: 0, text: String(text).slice(last, m.index) });
				segs.push({ kind: m[1] ? 1 : 2, text: m[1] || m[2] });
				last = m.index + m[0].length;
			}
			if (last < String(text).length) segs.push({ kind: 0, text: String(text).slice(last) });
			let out = '';
			for (const seg of segs) {
				if (seg.kind === 1) out += '<span class="dsh-hl-str">' + escHtml(seg.text) + '</span>';
				else if (seg.kind === 2) out += '<span class="dsh-hl-com">' + escHtml(seg.text) + '</span>';
				else {
					let s = escHtml(seg.text);
					s = s.replace(/\b([A-Za-z_$][\w$]*)\b/g, (w) => kwSet.has(w) ? '<span class="dsh-hl-kw">' + w + '</span>' : w);
					s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="dsh-hl-num">$1</span>');
					out += s;
				}
			}
			return out;
		};
		const isCodeFile = (p) => !!CODE_LANGS[extOf(p)];
		const csvSep = (text) => {
			const first = String(text).split(/\r?\n/)[0] || '';
			const semis = (first.match(/;/g) || []).length;
			const commas = (first.match(/,/g) || []).length;
			const tabs = (first.match(/\t/g) || []).length;
			if (semis > commas && semis > tabs) return ';';
			if (tabs > commas && tabs > semis) return '\t';
			return ',';
		};
		const parseCsv = (text, sep) => {
			const rows = [];
			let row = [], cur = '', inQ = false;
			const s = String(text || '');
			for (let i = 0; i < s.length; i++) {
				const ch = s[i];
				if (inQ) {
					if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i += 1; } else inQ = false; }
					else cur += ch;
				} else if (ch === '"') inQ = true;
				else if (ch === sep) { row.push(cur); cur = ''; }
				else if (ch === '\n' || ch === '\r') {
					if (ch === '\r' && s[i + 1] === '\n') i += 1;
					row.push(cur); cur = '';
					if (row.some((c) => c !== '')) rows.push(row);
					row = [];
				} else cur += ch;
			}
			if (cur !== '' || row.length) { row.push(cur); if (row.some((c) => c !== '')) rows.push(row); }
			return rows;
		};
		const pvRenderCsv = () => {
			if (!prevBody || !pv) return;
			pvResetFlex();
			prevBody.innerHTML = '';
			const sep = csvSep(pv.text || '');
			const rows = parseCsv(pv.text || '', sep);
			const MAX_ROWS = 800;
			const table = makeEl('table', 'dsh-ftree-prevcol-csv');
			if (rows.length === 0) { prevBody.appendChild(makeEl('div', 'dsh-ftree-prevcol-load', '（空表格）')); return; }
			const head = makeEl('thead');
			const hr = makeEl('tr');
			rows[0].forEach((c) => { const th = makeEl('th'); th.textContent = c; hr.appendChild(th); });
			head.appendChild(hr);
			table.appendChild(head);
			const tb = makeEl('tbody');
			for (let i = 1; i < Math.min(rows.length, MAX_ROWS + 1); i++) {
				const tr = makeEl('tr');
				rows[i].forEach((c) => { const td = makeEl('td'); td.textContent = c; tr.appendChild(td); });
				tb.appendChild(tr);
			}
			table.appendChild(tb);
			prevBody.appendChild(table);
			if (rows.length > MAX_ROWS) prevBody.appendChild(makeEl('div', 'dsh-ftree-prevcol-load', '表格较大，仅显示前 ' + MAX_ROWS + ' 行（共 ' + rows.length + ' 行）'));
			else if (prevSize) prevSize.textContent = rows.length + ' 行';
		};

		// ======================= panel css (port of ftree-1) + enhancement css =======================
		const CSS = '\n/* Keep file tree, theme toggle, and Settings aligned in one footer row. */\n.hHd-Xa_footArea{display:flex!important;flex-direction:row!important;align-items:center;gap:4px;flex-wrap:nowrap!important;}\n.hHd-Xa_footerActions{display:contents!important;}\n.hHd-Xa_settingsArea{width:auto!important;min-width:auto!important;flex:none!important;display:flex!important;}\n.dsh-ftree-toggle,.dsh-ftree-theme-toggle{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:flex-start;gap:8px;height:42px;min-height:42px;margin:4px 0;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;font-family:inherit;font-size:14px;line-height:22px;white-space:nowrap;overflow:hidden;}\n.dsh-ftree-toggle:hover,.dsh-ftree-theme-toggle:hover{background:var(--dsw-alias-interactive-bg-hover);}\n.dsh-ftree-toggle:hover,.dsh-ftree-theme-toggle:hover{background:var(--dsw-alias-bg-layer-2);}\n.dsh-ftree-toggle:hover{background:var(--dsw-alias-bg-layer-2);}\n.dsh-ftree-col{position:fixed;left:280px;top:0;bottom:0;width:280px;display:flex;flex-direction:column;gap:6px;background:var(--dsw-specific-sidebar-fill);border-right:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:14px;padding:6px 12px;box-sizing:border-box;pointer-events:auto;z-index:20;overflow:hidden;}\n.dsh-ftree-col-head{display:flex;align-items:center;gap:8px;flex:none;padding:4px 2px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);}\n.dsh-ftree-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;max-width:120px;}\n.dsh-ftree-path{color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;font-size:11px;}\n.dsh-ftree-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:4px;padding:1px 6px;font-size:11px;cursor:pointer;flex:none;}\n.dsh-ftree-body{flex:1;overflow:auto;display:flex;flex-direction:column;gap:1px;padding-top:4px;}\n.dsh-ftree-row{display:flex;align-items:center;gap:4px;padding:1px 2px;border-radius:4px;white-space:nowrap;font-size:13px;}\n.dsh-ftree-row.click{cursor:pointer;}\n.dsh-ftree-row.click:hover{background:var(--dsw-alias-bg-layer-2);}\n.dsh-ftree-arrow{width:12px;color:var(--dsw-alias-label-secondary);flex:none;}\n.dsh-ftree-ic{flex:none;}\n.dsh-ftree-name{overflow:hidden;text-overflow:ellipsis;min-width:0;}\n.dsh-ftree-size{color:var(--dsw-alias-label-secondary);flex:none;margin-left:auto;padding-left:8px;font-size:11px;}\n.dsh-ftree-err{color:var(--dsw-alias-state-error-primary);}\n.dsh-ftree-load{color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-row{cursor:pointer;}\n.dsh-ftree-row.dsh-ftree-cut{opacity:.45;}\n.dsh-ftree-row:hover{background:var(--dsw-alias-interactive-bg-hover);}\n.dsh-ftree-handle{position:absolute;top:0;bottom:0;right:0;width:8px;cursor:col-resize;z-index:3;opacity:0;transition:opacity .15s;background:var(--dsw-alias-interactive-bg-hover);}\n.dsh-ftree-handle:hover,.dsh-ftree-handle:active{opacity:1;}\n.dsh-ftree-rename-input{flex:1;min-width:0;font:inherit;font-size:13px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px;outline:none;}\n.dsh-ftree-menu{position:fixed;z-index:100;min-width:170px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:4px;font-size:12px;color:var(--dsw-alias-label-primary);}\n.dsh-ftree-menu-head{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:5px 10px;color:var(--dsw-alias-label-secondary);font-size:11px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:4px;}\n.dsh-ftree-menu-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;white-space:nowrap;}\n.dsh-ftree-menu-item:hover{background:var(--dsw-alias-interactive-bg-hover);}\n.dsh-ftree-menu-sep{height:1px;background:var(--dsw-alias-border-l1);margin:4px 6px;}\n.dsh-ftree-confirm{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;}\n.dsh-ftree-confirm-card{min-width:280px;max-width:420px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:14px 16px;font-size:13px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px;}\n.dsh-ftree-confirm-text{word-break:break-all;line-height:1.5;}\n.dsh-ftree-confirm-actions{display:flex;justify-content:flex-end;gap:8px;}\n.dsh-ftree-confirm-btn{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 14px;font-size:12px;cursor:pointer;}\n.dsh-ftree-confirm-btn:hover{background:var(--dsw-alias-bg-layer-1);}\n.dsh-ftree-confirm-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}\n.dsh-ftree-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:300;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:8px 14px;font-size:12px;color:var(--dsw-alias-label-primary);max-width:70vw;}\n.dsh-ftree-cbbadge{position:fixed;left:8px;bottom:64px;z-index:150;display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-primary);max-width:280px;}\n.dsh-ftree-cbbadge-clear{cursor:pointer;border:none;background:none;color:var(--dsw-alias-label-secondary);font-size:12px;flex:none;}\n.dsh-ftree-prevcol{position:fixed;top:0;bottom:0;z-index:20;display:flex;flex-direction:column;gap:6px;background:var(--dsw-alias-bg-base);border-left:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:13px;padding:10px 12px;box-sizing:border-box;pointer-events:auto;overflow:hidden;}\n.dsh-ftree-prevcol-head{display:flex;align-items:center;gap:8px;flex:none;}\n.dsh-ftree-prevcol-close{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:4px;padding:0 7px;font-size:12px;cursor:pointer;flex:none;line-height:20px;}\n.dsh-ftree-prevcol-close:hover{background:var(--dsw-alias-bg-layer-1);}\n.dsh-ftree-prevcol-icon{flex:none;}\n.dsh-ftree-prevcol-name{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;}\n.dsh-ftree-prevcol-size{color:var(--dsw-alias-label-secondary);flex:none;font-size:11px;}\n.dsh-ftree-prevcol-path{color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:11px;flex:none;}\n.dsh-ftree-prevcol-body{flex:1;min-height:0;overflow:auto;position:relative;}\n.dsh-ftree-prevcol-pre{margin:0;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,\'Courier New\',monospace;font-size:12px;line-height:1.55;color:var(--dsw-alias-label-primary);}\n.dsh-ftree-prevcol-img{width:100%;height:auto;display:block;flex:none;}\n.dsh-ftree-prevcol-pdf{width:100%;height:100%;border:0;display:block;}\n.dsh-ftree-prevcol-zoom{position:absolute;top:8px;right:8px;background:rgba(0,0,0,.55);color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;z-index:5;pointer-events:none;}\n.dsh-ftree-prevcol-err{color:var(--dsw-alias-state-error-primary);padding:8px 0;}\n.dsh-ftree-prevcol-load{color:var(--dsw-alias-label-secondary);padding:8px 0;}\n.dsh-ftree-prevcol-handle{position:absolute;top:0;bottom:0;right:-4px;width:8px;cursor:col-resize;z-index:3;opacity:0;transition:opacity .15s;background:var(--dsw-alias-interactive-bg-hover);}\n.dsh-ftree-prevcol-handle:hover,.dsh-ftree-prevcol-handle:active{opacity:1;}\n.dsh-ftree-prevcol-tools{display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);flex:none;}\n.dsh-ftree-prevcol-tab{background:transparent;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 10px;font-size:12px;cursor:pointer;}\n.dsh-ftree-prevcol-tab.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-interactive-primary);}\n.dsh-ftree-prevcol-save{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary);}\n.dsh-ftree-prevcol-save.dirty{color:#e6a23c;}\n.dsh-ftree-prevcol-save.err{color:var(--dsw-alias-state-error-primary);}\n.dsh-ftree-prevcol-md{flex:1;overflow:auto;padding:10px 16px;font-size:13px;line-height:1.65;word-wrap:break-word;}\n.dsh-ftree-prevcol-md h1{font-size:1.5em;margin:0.7em 0 0.45em;padding:0.08em 0 0.22em 11px;position:relative;border-bottom:1px solid var(--dsw-alias-border-l1);}.dsh-ftree-prevcol-md h1::before{content:"";position:absolute;left:0;top:0.14em;bottom:0.14em;width:4px;border-radius:2px;background:linear-gradient(180deg,var(--dsw-alias-state-business-primary),var(--dsw-alias-brand-primary,#a06de0));}\n.dsh-ftree-prevcol-md h2{font-size:1.3em;margin:0.6em 0 0.4em;padding-left:9px;position:relative;color:var(--dsw-alias-state-business-primary);font-weight:700;}.dsh-ftree-prevcol-md h2::before{content:"";position:absolute;left:0;top:0.16em;bottom:0.16em;width:3px;border-radius:2px;background:var(--dsw-alias-state-business-primary);}\n.dsh-ftree-prevcol-md h3{font-size:1.15em;margin:0.5em 0 0.35em;color:var(--dsw-alias-state-business-primary);font-weight:600;}\n.dsh-ftree-prevcol-md h4{font-size:1.05em;margin:0.5em 0 0.3em;color:var(--dsw-alias-brand-primary);font-weight:600;}.dsh-ftree-prevcol-md h5{font-size:1em;margin:0.5em 0 0.3em;color:var(--dsw-alias-label-primary);font-weight:600;}.dsh-ftree-prevcol-md h6{font-size:0.95em;margin:0.5em 0 0.3em;color:var(--dsw-alias-label-secondary);font-weight:600;}\n.dsh-ftree-prevcol-md p{margin:0.4em 0;}.dsh-ftree-prevcol-md strong{color:var(--dsw-alias-state-warn-primary);font-weight:700;}\n.dsh-ftree-prevcol-md ul,.dsh-ftree-prevcol-md ol{margin:0.4em 0;padding-left:1.6em;}\n.dsh-ftree-prevcol-md li{margin:0.15em 0;}\n.dsh-ftree-prevcol-md code,.dsh-ftree-prevcol-live code{display:inline-flex;align-items:center;box-sizing:border-box;font-family:var(--ds-font-family-code,Consolas,Monaco,monospace);font-size:.875em;background-color:var(--dsw-alias-markdown-inline-code,rgba(127,127,127,.16));border-radius:5px;padding:0 5px;}\n.dsh-ftree-prevcol-md pre{background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));border-radius:8px;padding:8px 12px;overflow:auto;margin:0.5em 0;}\n.dsh-ftree-prevcol-md pre code{background:none;padding:0;}\n.dsh-ftree-prevcol-md blockquote{border-left:2px solid var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));margin:0.6em 0;padding:0.05em 0 0.05em 14px;color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-prevcol-md table{border-collapse:collapse;margin:0.5em 0;max-width:100%;}\n.dsh-ftree-prevcol-md th,.dsh-ftree-prevcol-md td{border:1px solid var(--dsw-alias-border-l1);padding:3px 10px;font-size:12px;}.dsh-ftree-prevcol-md th{background:var(--dsw-alias-bg-layer-2);font-weight:600;}\n.dsh-ftree-prevcol-md li::marker,.dsh-ftree-prevcol-live li::marker{color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-prevcol-md img{max-width:100%;}\n.dsh-ftree-prevcol-md a,.dsh-ftree-prevcol-live a{color:var(--dsw-alias-state-business-primary);transition:box-shadow var(--ds-transition-duration,.15s) var(--ds-ease-in-out,ease-in-out);position:relative;text-decoration:none;border-left:3px solid rgb(255 255 255/0);border-right:3px solid rgb(255 255 255/0);border-top:2px solid rgb(255 255 255/0);border-bottom:2px solid rgb(255 255 255/0);margin-left:-3px;margin-right:-3px;}.dsh-ftree-prevcol-md a:hover,.dsh-ftree-prevcol-md a:focus,.dsh-ftree-prevcol-live a:hover,.dsh-ftree-prevcol-live a:focus{outline:none;text-decoration:underline var(--dsw-alias-state-business-primary);}.dsh-ftree-prevcol-md a:focus-visible,.dsh-ftree-prevcol-live a:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-state-business-primary);}\n.dsh-ftree-prevcol-md .dsh-md-task,.dsh-ftree-prevcol-live .dsh-md-task{list-style:none;margin-left:-1.2em;}\n.dsh-ftree-prevcol-md .dsh-md-task input,.dsh-ftree-prevcol-live .dsh-md-task input{margin:0 8px 0 0;vertical-align:middle;accent-color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-prevcol-md .dsh-md-task.done,.dsh-ftree-prevcol-live .dsh-md-task.done{color:var(--dsw-alias-label-tertiary);text-decoration:line-through;}\n.dsh-ftree-prevcol-md hr{border:none;height:1px;background:var(--dsw-alias-border-l2);margin:1.4em 0;}\n.dsh-ftree-prevcol-ta{width:100%;height:52%;min-height:140px;resize:none;font:12px/1.55 Consolas,Monaco,monospace;padding:8px 12px;box-sizing:border-box;border:none;outline:none;background:var(--dsw-alias-bg-layer-2);color:inherit;flex:none;}\n.dsh-ftree-prevcol-live{flex:1;overflow:auto;padding:8px 14px;border-top:1px solid var(--dsw-alias-border-l1);font-size:13px;line-height:1.6;}\n.dsh-ftree-prevcol-live h1{font-size:1.4em;margin:0.55em 0 0.35em;padding:0.06em 0 0.18em 10px;position:relative;border-bottom:1px solid var(--dsw-alias-border-l1);}.dsh-ftree-prevcol-live h1::before{content:"";position:absolute;left:0;top:0.14em;bottom:0.14em;width:4px;border-radius:2px;background:linear-gradient(180deg,var(--dsw-alias-state-business-primary),var(--dsw-alias-brand-primary,#a06de0));}\n.dsh-ftree-prevcol-live h2{font-size:1.25em;margin:0.5em 0 0.3em;padding-left:8px;position:relative;color:var(--dsw-alias-state-business-primary);font-weight:700;}.dsh-ftree-prevcol-live h2::before{content:"";position:absolute;left:0;top:0.16em;bottom:0.16em;width:3px;border-radius:2px;background:var(--dsw-alias-state-business-primary);}\n.dsh-ftree-prevcol-live h3{font-size:1.1em;margin:0.4em 0 0.25em;color:var(--dsw-alias-state-business-primary);font-weight:600;}\n.dsh-ftree-prevcol-live p{margin:0.35em 0;}.dsh-ftree-prevcol-live strong{color:var(--dsw-alias-state-warn-primary);font-weight:700;}.dsh-ftree-prevcol-live h4{font-size:1em;margin:0.4em 0 0.25em;color:var(--dsw-alias-brand-primary);font-weight:600;}.dsh-ftree-prevcol-live h5{font-size:0.95em;margin:0.4em 0 0.25em;color:var(--dsw-alias-label-primary);font-weight:600;}.dsh-ftree-prevcol-live h6{font-size:0.9em;margin:0.4em 0 0.25em;color:var(--dsw-alias-label-secondary);font-weight:600;}\n.dsh-ftree-prevcol-live ul,.dsh-ftree-prevcol-live ol{margin:0.35em 0;padding-left:1.5em;}\n.dsh-ftree-prevcol-live code{display:inline-flex;align-items:center;box-sizing:border-box;font-family:var(--ds-font-family-code,Consolas,Monaco,monospace);font-size:.875em;background-color:var(--dsw-alias-markdown-inline-code,rgba(127,127,127,.16));border-radius:5px;padding:0 5px;}\n.dsh-ftree-prevcol-live pre{background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-2));border-radius:8px;padding:8px 12px;overflow:auto;margin:0.4em 0;}\n.dsh-ftree-prevcol-live pre code{background:none;padding:0;}\n.dsh-ftree-prevcol-live blockquote{border-left:2px solid var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary));margin:0.6em 0;padding:0.05em 0 0.05em 14px;color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-prevcol-live table{border-collapse:collapse;margin:0.4em 0;}\n.dsh-ftree-prevcol-live th,.dsh-ftree-prevcol-live td{border:1px solid var(--dsw-alias-border-l1);padding:2px 8px;font-size:12px;}.dsh-ftree-prevcol-live th{background:var(--dsw-alias-bg-layer-2);font-weight:600;}\n.dsh-ftree-prevcol-live img{max-width:100%;}\n.dsh-ftree-prevcol-docx{width:100%;height:100%;border:none;background:#fff;flex:1;}\n.dsh-ftree-row.active{background:var(--dsw-alias-interactive-bg-active, rgba(80,140,255,.18));box-shadow:inset 2px 0 0 var(--dsw-alias-interactive-primary);}\n.dsh-ftree-filter{width:100%;box-sizing:border-box;flex:none;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;color:var(--dsw-alias-label-primary);font-size:12px;padding:3px 8px;outline:none;}\n.dsh-ftree-filter:focus{border-color:var(--dsw-alias-interactive-primary);}\n.dsh-ftree-prevcol-pre .dsh-hl-kw{color:#c586c0;font-weight:600;}\n.dsh-ftree-prevcol-pre .dsh-hl-str{color:#ce9178;}\n.dsh-ftree-prevcol-pre .dsh-hl-com{color:#6a9955;font-style:italic;}\n.dsh-ftree-prevcol-pre .dsh-hl-num{color:#b5cea8;}\n.dsh-ftree-prevcol-csv{border-collapse:collapse;margin:8px 12px;font-size:12px;max-width:100%;}\n.dsh-ftree-prevcol-csv th,.dsh-ftree-prevcol-csv td{border:1px solid var(--dsw-alias-border-l1);padding:3px 10px;white-space:nowrap;max-width:340px;overflow:hidden;text-overflow:ellipsis;}\n.dsh-ftree-prevcol-csv th{background:var(--dsw-alias-bg-layer-2);font-weight:600;position:sticky;top:0;}\n.dsh-ftree-prevcol-csv td:first-child{font-weight:500;}\n';

		// Extra styles: multi-tab bar, git panel, sort select, mobile layout.
		const CSS_EXTRA = '\n.dsh-ftree-archive-panel{position:fixed;left:calc(var(--dsh-sidebar-width, 280px) + 8px);bottom:56px;width:320px;max-height:58vh;display:flex;flex-direction:column;gap:8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-specific-sidebar-fill);box-shadow:0 12px 34px rgba(0,0,0,.22);pointer-events:auto;z-index:40;color:var(--dsw-alias-label-primary);font-size:13px;}\n.dsh-ftree-archive-head{display:flex;align-items:center;justify-content:space-between;font-weight:600;}\n.dsh-ftree-archive-actions{display:flex;gap:6px;flex-wrap:wrap;}\n.dsh-ftree-archive-btn{border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);padding:5px 8px;cursor:pointer;font:inherit;}\n.dsh-ftree-archive-btn:hover{background:var(--dsw-alias-interactive-bg-hover);}\n.dsh-ftree-archive-list{min-height:30px;max-height:40vh;overflow:auto;display:flex;flex-direction:column;gap:4px;}\n.dsh-ftree-archive-folder{padding:7px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);}\n.dsh-ftree-archive-folder-title{display:flex;justify-content:space-between;gap:8px;font-weight:600;}\n.dsh-ftree-archive-session{padding:3px 0 0 18px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}\n.dsh-ftree-archive-note{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:17px;}\n' + '\n.dsh-ftree-prevcol-tabs{display:flex;gap:4px;flex-wrap:nowrap;overflow-x:auto;flex:none;padding:4px 6px 0;border-bottom:1px solid var(--dsw-alias-border-l1);}\n.dsh-ftree-prevcol-tab{display:inline-flex;align-items:center;gap:3px;max-width:150px;padding:2px 8px;border-radius:6px 6px 0 0;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none;}\n.dsh-ftree-prevcol-tab:hover{background:var(--dsw-alias-bg-layer-2);}\n.dsh-ftree-prevcol-tab.active{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}\n.dsh-ftree-prevcol-tab-x{padding:0 2px;border-radius:4px;color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-prevcol-tab-x:hover{background:var(--dsw-alias-state-error-primary);color:#fff;}\n.dsh-ftree-sort{flex:none;max-width:56px;font-size:11px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:4px;padding:1px 2px;}\n.dsh-ftree-btn.active{background:var(--dsw-alias-bg-layer-2);outline:1px solid var(--dsw-alias-border-l1);}\n.dsh-ftree-git-branch{font-size:12px;font-weight:600;padding:2px 2px 6px;color:var(--dsw-alias-label-primary);border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:4px;}\n.dsh-ftree-git-row{display:flex;align-items:center;gap:4px;padding:2px 2px;border-radius:4px;font-size:12px;white-space:nowrap;}\n.dsh-ftree-git-row:hover{background:var(--dsw-alias-bg-layer-2);}\n.dsh-ftree-git-row.staged{background:rgba(56,178,94,0.08);}\n.dsh-ftree-git-row.modified{background:rgba(210,153,34,0.06);}\n.dsh-ftree-git-tag{flex:none;width:16px;text-align:center;font-weight:700;font-size:11px;}\n.dsh-ftree-git-row.staged .dsh-ftree-git-tag{color:#38b25e;}\n.dsh-ftree-git-row.modified .dsh-ftree-git-tag{color:#d29922;}\n.dsh-ftree-git-row.untracked .dsh-ftree-git-tag{color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-git-name{overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;}\n.dsh-ftree-git-ops{flex:none;display:inline-flex;gap:2px;}\n.dsh-ftree-git-btn{flex:none;padding:0 4px;border-radius:4px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary);}\n.dsh-ftree-git-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}\n@media (max-width:768px){.dsh-ftree-col{max-width:62vw;width:240px!important;}.dsh-ftree-prevcol{left:0!important;right:0!important;width:auto!important;max-width:none!important;}.dsh-ftree-handle,.dsh-ftree-prevcol-handle{display:none!important;}.dsh-ftree-prevcol-tabs{max-width:70vw;}}\n/* sidebar foot actions: keep file tree, theme, and Settings on one row */\n.hHd-Xa_footArea{display:flex!important;flex-direction:row!important;align-items:center!important;gap:4px!important;flex-wrap:nowrap!important;}\n[class$="footerActions"]{display:contents!important;}\n[class$="footerActions"] .dsh-ftree-toggle,[class$="footerActions"] .dsh-ftree-theme-toggle{width:auto!important;flex:none!important;justify-content:center;}\n[class$="settingsArea"]{display:flex!important;flex:none!important;width:auto!important;min-width:auto!important;}\n.dsh-ftree-toggle,.dsh-ftree-theme-toggle{box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:flex-start!important;gap:8px!important;width:auto!important;height:42px!important;min-height:42px!important;margin:4px 0!important;padding:0 10px 0 8px!important;border:0!important;border-radius:12px!important;background:transparent!important;color:var(--dsw-alias-label-primary)!important;cursor:pointer!important;font-family:inherit!important;font-size:14px!important;line-height:22px!important;white-space:nowrap!important;overflow:hidden!important;flex-shrink:0!important;}\n.dsh-ftree-toggle:hover,.dsh-ftree-theme-toggle:hover{background:var(--dsw-alias-interactive-bg-hover)!important;}\n[class$="collapsed"] [class$="footerActions"] .dsh-ftree-toggle,[class$="collapsed"] [class$="footerActions"] .dsh-ftree-theme-toggle{width:36px!important;height:36px!important;padding:0!important;}\n';

		// ======================= panel (React slot, port of ftree-1 pkg-4) =======================
		const panelStore = { open: lsGet(LS.open, '1') === '1', listeners: new Set() };
		const panelEmit = () => { panelStore.listeners.forEach((fn) => fn()); };
		const panelSubscribe = (fn) => { panelStore.listeners.add(fn); return () => { panelStore.listeners.delete(fn); }; };
		const panelToggle = () => { panelStore.open = !panelStore.open; lsSet(LS.open, panelStore.open ? '1' : '0'); panelEmit(); };
		const loadDir = async (path, withMtime) => {
			try {
				const res = await api('list', Object.assign({ path }, withMtime ? { withMtime: '1' } : {}));
				if (res && res.error) return { entries: [], error: res.error };
				return { entries: res && res.entries ? res.entries : [], error: null };
			} catch (err) {
				return { entries: [], error: '加载失败' };
			}
		};
		const sorted = (entries, mode) => entries.slice().sort((a, b) => {
			if (a.kind === 'dir' && b.kind !== 'dir') return -1;
			if (a.kind !== 'dir' && b.kind === 'dir') return 1;
			if (mode === 'size') return (b.size || 0) - (a.size || 0);
			if (mode === 'mtime') return (b.mtime || 0) - (a.mtime || 0);
			return a.name.localeCompare(b.name);
		});

		// ======================= enhancement state =======================
		let lastW = Number(lsGet(LS.w, '0')) || 0;
		let lastPrevW = Number(lsGet(LS.pw, '0')) || 0;
		let frameEl = null;
		let sidebarEl = null;
		let centerEl = null;
		let colEl = null;
		let handleEl = null;
		let ro = null;
		let mo = null;
		let dragging = null;
		let dragging2 = null;
		let ticks = 0;
		let prevEl = null;
		let prevBody = null;
		let prevName = null;
		let prevSize = null;
		let prevHandle = null;
		let prevPath = null;
		let pv = null;
		let pvSeq = 0;
		let menuEl = null;
		let menuRow = null;
		let confirmEl = null;
		let clipboard = null;
		let cutPath = null;
		let toastEl = null;
		let cbBadge = null;
		let timer = null;
		let mdState = { mode: 'preview', dirty: false, statusEl: null };
		let mdSaveT = null;
		let mdRenderT = null;
		const previewStore = { path: null, listeners: new Set() };
		const previewEmit = () => { previewStore.listeners.forEach((fn) => fn()); };
		const previewSet = (p) => { previewStore.path = p; previewEmit(); };
		// current workspace path, kept fresh by the panel component so workspace
		// menu actions (mkdir etc.) work even when the tree panel is closed.
		let currentWsPath = null;
		// Conversation archive folders are browser-local metadata. The actual
		// conversation is archived through the native workspaces service; no
		// filesystem directory is created by this feature.
		const ARCHIVE_LS = 'ftree.conversation.archive.v1';
		const archiveLoad = () => {
			try {
				const raw = localStorage.getItem(ARCHIVE_LS);
				const value = raw ? JSON.parse(raw) : { folders: [] };
				return value && Array.isArray(value.folders) ? value : { folders: [] };
			} catch { return { folders: [] }; }
		};
		const archiveSave = (value) => { try { localStorage.setItem(ARCHIVE_LS, JSON.stringify(value)); } catch { /* ignore */ } };
		const archiveStore = { open: false, listeners: new Set() };
		const archiveEmit = () => archiveStore.listeners.forEach((fn) => fn());
		const archiveToggle = () => { archiveStore.open = !archiveStore.open; archiveEmit(); };
		const archiveSubscribe = (fn) => { archiveStore.listeners.add(fn); return () => archiveStore.listeners.delete(fn); };
		// Multi-tab preview: every tab owns a { path, pv, md } snapshot; the
		// active tab's pv/md are the live global objects below.
		let tabs = [];
		let activeTab = -1;
		let tabBarEl = null;

		const findFrame = () => document.querySelector('.pI_x6G_frame') || document.querySelector('div[style*="grid-template-columns"]');
		const findCol = () => document.querySelector('.dsh-ftree-col');
		const clampW = (w) => {
			const vw = document.documentElement.clientWidth;
			const maxW = Math.max(MIN_W, vw - MAX_CENTER);
			return Math.min(maxW, Math.max(MIN_W, Math.round(w)));
		};
		const treeW = () => {
			if (!colEl) return 0;
			const r = colEl.getBoundingClientRect();
			return r.width > 0 ? Math.round(r.width) : (lastW > 0 ? lastW : MIN_W);
		};
		const sidebarW = () => sidebarEl ? Math.round(sidebarEl.getBoundingClientRect().width) : MIN_W;
		const computePrevW = () => {
			const vw = document.documentElement.clientWidth;
			const cap = Math.min(PREV_MAX, Math.max(PREV_MIN, vw - sidebarW() - treeW() - 320));
			return Math.max(PREV_MIN, cap);
		};
		const applyLayout = () => {
			if (!frameEl) return;
			if (!sidebarEl && frameEl.children.length > 0) sidebarEl = frameEl.children[0];
			if (!centerEl && frameEl.children.length > 1) centerEl = frameEl.children[1];
			const w = sidebarW();
			if (colEl) colEl.style.left = w + 'px';
			const open = !!(colEl && colEl.isConnected);
			if (open && lastW > 0) {
				const c = clampW(lastW);
				if (c !== lastW) { lastW = c; colEl.style.width = c + 'px'; }
			}
			let margin = open ? treeW() : 0;
			if (prevEl && prevEl.isConnected) {
				const pw = Math.min(computePrevW(), Math.max(PREV_MIN, lastPrevW > 0 ? lastPrevW : computePrevW()));
				prevEl.style.width = pw + 'px';
				prevEl.style.left = (w + treeW()) + 'px';
				margin += pw;
			}
			if (centerEl) centerEl.style.marginLeft = margin + 'px';
		};
		const showToast = (msg, ms) => {
			if (toastEl) toastEl.remove();
			toastEl = makeEl('div', 'dsh-ftree-toast', msg);
			document.body.appendChild(toastEl);
			if (timer !== null) timer.timeout(() => { if (toastEl) { toastEl.remove(); toastEl = null; } }, ms || 2600);
		};
		const rowPath = (row) => {
			const nameEl = row.querySelector('.dsh-ftree-name');
			return nameEl && nameEl.title ? nameEl.title : (nameEl ? nameEl.textContent : '');
		};
		const rowIsDir = (row) => !row.querySelector('.dsh-ftree-size');
		const treeRootPath = () => {
			if (!colEl) return null;
			const el = colEl.querySelector('.dsh-ftree-path');
			return el && el.textContent ? el.textContent.trim() : null;
		};
		const updateClipboardBadge = () => {
			if (cbBadge) { cbBadge.remove(); cbBadge = null; }
			if (!clipboard) return;
			cbBadge = makeEl('div', 'dsh-ftree-cbbadge');
			cbBadge.appendChild(makeEl('span', null, (clipboard.mode === 'cut' ? '✂️ 剪切' : '📄 复制') + ': ' + basename(clipboard.path)));
			const clear = makeEl('button', 'dsh-ftree-cbbadge-clear', '✕');
			clear.title = '清除剪贴板';
			clear.addEventListener('click', () => { clipboard = null; updateClipboardBadge(); });
			cbBadge.appendChild(clear);
			document.body.appendChild(cbBadge);
		};
		const refreshTree = () => {
			if (!colEl) return;
			if (cutPath) { cutPath = null; const els = colEl.querySelectorAll('.dsh-ftree-cut'); for (const e of Array.from(els)) e.classList.remove('dsh-ftree-cut'); }
			const btn = colEl.querySelector('.dsh-ftree-col-head .dsh-ftree-btn');
			if (btn) btn.click();
		};
		const closeMenu = () => {
			if (menuEl) { menuEl.remove(); menuEl = null; }
			menuRow = null;
		};
		const menuFeedback = (item, text, ms) => {
			const old = item.textContent;
			item.textContent = text;
			if (timer !== null) timer.timeout(() => { if (menuEl && item.isConnected) item.textContent = old; }, ms || 900);
		};
		const closeConfirm = () => {
			if (confirmEl) { confirmEl.remove(); confirmEl = null; }
		};
		const showConfirm = (text, onOk) => {
			closeConfirm();
			confirmEl = makeEl('div', 'dsh-ftree-confirm');
			const card = makeEl('div', 'dsh-ftree-confirm-card');
			card.appendChild(makeEl('div', 'dsh-ftree-confirm-text', text));
			const row = makeEl('div', 'dsh-ftree-confirm-actions');
			const ok = makeEl('button', 'dsh-ftree-confirm-btn dsh-ftree-confirm-danger', '删除');
			const cancel = makeEl('button', 'dsh-ftree-confirm-btn', '取消');
			ok.addEventListener('click', () => { closeConfirm(); onOk(); });
			cancel.addEventListener('click', closeConfirm);
			row.appendChild(ok);
			row.appendChild(cancel);
			card.appendChild(row);
			confirmEl.appendChild(card);
			document.body.appendChild(confirmEl);
			cancel.focus();
		};
		// Custom modal input (window.prompt is blocked in the DSH shell).
		const promptModal = (label, def) => new Promise((resolve) => {
			closeConfirm();
			confirmEl = makeEl('div', 'dsh-ftree-confirm');
			const card = makeEl('div', 'dsh-ftree-confirm-card');
			card.appendChild(makeEl('div', 'dsh-ftree-confirm-text', label));
			const input = document.createElement('input');
			input.className = 'dsh-ftree-rename-input';
			input.value = def || '';
			input.spellcheck = false;
			input.style.cssText = 'width:100%;box-sizing:border-box;margin-top:10px;font-size:13px;padding:5px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);outline:none;';
			card.appendChild(input);
			const row = makeEl('div', 'dsh-ftree-confirm-actions');
			const ok = makeEl('button', 'dsh-ftree-confirm-btn', '确定');
			const cancel = makeEl('button', 'dsh-ftree-confirm-btn', '取消');
			const done = (val) => { closeConfirm(); resolve(val); };
			ok.addEventListener('click', () => done((input.value || '').trim() || null));
			cancel.addEventListener('click', () => done(null));
			input.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') { e.preventDefault(); done((input.value || '').trim() || null); }
				if (e.key === 'Escape') { e.preventDefault(); done(null); }
			});
			row.appendChild(ok);
			row.appendChild(cancel);
			card.appendChild(row);
			confirmEl.appendChild(card);
			document.body.appendChild(confirmEl);
			input.focus();
			input.select();
		});
		const doDelete = (path) => {
			showConfirm('确定删除「' + basename(path) + '」？此操作不可恢复。', () => {
				apiOp({ op: 'delete', path }).then((res) => {
					if (res && res.ok === true) {
						showToast('已删除「' + basename(path) + '」');
						closePreview(path);
						refreshTree();
					} else {
						showToast('删除失败：' + (res && res.error ? res.error : '未知错误'), 3500);
					}
				}).catch((e) => showToast('删除失败：' + String((e && e.message) || e), 3500));
			});
		};
		const createArchiveFolderFromMenu = async (menu) => {
			const value = await promptModal('新建对话文件夹名称', '未分类');
			if (!value) return;
			const data = archiveLoad();
			if (data.folders.some((f) => f.name === value)) { showToast('文件夹已存在：' + value, 2200); return; }
			data.folders.push({ id: 'f-' + Date.now().toString(36), name: value, sessions: [] });
			archiveSave(data); archiveEmit(); showToast('已新建对话文件夹「' + value + '」');
		};
		// Add only a browser-local conversation folder to the native workspace ... menu.
		// It deliberately never calls createDirectory or any filesystem operation.
		const enhanceWorkspaceMenu = () => {
			const menus = document.querySelectorAll('[role="menu"]');
			for (const menu of Array.from(menus)) {
				if (menu.dataset.dshFtreeArchiveFolder === '1') continue;
				const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
				const anchor = items.find((item) => (item.textContent || '').includes('删除工作区'));
				if (!anchor || !anchor.parentElement) continue;
				const wrap = anchor.parentElement.cloneNode(false);
				const item = anchor.cloneNode(true);
				item.removeAttribute('disabled');
				item.className = String(item.className || '').split(/\\s+/).filter((name) => !/danger/i.test(name)).join(' ');
				const labels = item.querySelectorAll('span');
				const label = labels.length ? labels[labels.length - 1] : item;
				label.textContent = '新建文件夹';
				item.addEventListener('click', (ev) => {
					ev.preventDefault(); ev.stopPropagation();
					menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
					queueMicrotask(() => createArchiveFolderFromMenu(menu));
				});
				wrap.appendChild(item);
				anchor.parentElement.parentElement.insertBefore(wrap, anchor.parentElement);
				menu.dataset.dshFtreeArchiveFolder = '1';
			}
		}; /*
			const menus = document.querySelectorAll('[role="menu"]');
			for (const menu of Array.from(menus)) {
				if (menu.dataset.dshFtreeChildFolder === '1') continue;
				const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
				const hasWorkspaceActions = items.some((item) => (item.textContent || '').includes('删除工作区'));
				if (!hasWorkspaceActions) continue;
				const anchor = items.find((item) => (item.textContent || '').includes('删除工作区')) || items[items.length - 1];
				if (!anchor || !anchor.parentElement) continue;
				const itemWrap = anchor.parentElement.cloneNode(false);
				const item = anchor.cloneNode(false);
				// Reuse the native menu button styles, but remove the delete/danger state.
				item.className = String(item.className || '').split(/\s+/).filter((name) => !/danger/i.test(name)).join(' ');
				item.removeAttribute('disabled');
				const iconWrap = document.createElement('span');
				const nativeIconWrap = anchor.querySelector('span');
				if (nativeIconWrap) iconWrap.className = nativeIconWrap.className;
				const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				icon.setAttribute('width', '16');
				icon.setAttribute('height', '16');
				icon.setAttribute('viewBox', '0 0 16 16');
				icon.setAttribute('fill', 'none');
				icon.setAttribute('aria-hidden', 'true');
				icon.innerHTML = '<path d="M2.918 2.952h2.278c.16 0 .304.076.389.204l.471.708c.341.512.906.82 1.531.82h4.584c.572 0 1.035.464 1.035 1.036v.655H3.779a2.41 2.41 0 0 0-1.896.919V3.987c0-.572.463-1.035 1.035-1.035ZM3.779 7.756h9.881c.302 0 .522.286.445.578l-1.054 3.97a1.38 1.38 0 0 1-1.001.97H2.917a1.035 1.035 0 0 1-1.001-1.501l.862-3.247a1.04 1.04 0 0 1 1.001-.77Z" fill="currentColor"/><path d="M8 8.25v2.5M6.75 9.5h2.5" stroke="var(--dsw-specific-menu-fill, currentColor)" stroke-width="1.25" stroke-linecap="round"/></svg>';
				const label = document.createElement('span');
				const nativeLabel = anchor.querySelectorAll('span')[1];
				if (nativeLabel) label.className = nativeLabel.className;
				label.textContent = '创建子文件夹';
				iconWrap.appendChild(icon);
				item.appendChild(iconWrap);
				item.appendChild(label);
				item.addEventListener('click', (ev) => {
					ev.preventDefault();
					ev.stopPropagation();
					try {
						const root = treeRootPath() || currentWsPath;
						if (!root) { showToast('请先打开对应工作区的文件树', 3000); return; }
						menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
						queueMicrotask(() => {
							try { doMkdir(root); } catch (err) { showToast('创建子文件夹出错：' + String((err && err.message) || err), 4000); }
						});
					} catch (err) {
						showToast('创建子文件夹出错：' + String((err && err.message) || err), 4000);
					}
				});
				itemWrap.appendChild(item);
				anchor.parentElement.parentElement.insertBefore(itemWrap, anchor.parentElement);
				menu.dataset.dshFtreeChildFolder = '1';
			}
		}; */
		const doPaste = (destDir, newName) => {
			if (!clipboard) return;
			apiOp({ op: 'paste', srcPath: clipboard.path, destDir, mode: clipboard.mode, newName: newName || '' }).then((res) => {
				if (res && res.ok === true) {
					showToast((clipboard.mode === 'cut' ? '已移动' : '已复制') + '「' + basename(clipboard.path) + '」' + (newName ? ' → ' + newName : ''));
					clipboard = null;
					updateClipboardBadge();
					refreshTree();
				} else {
					showToast('操作失败：' + (res && res.error ? res.error : '未知错误'), 3500);
				}
			}).catch((e) => showToast('操作失败：' + String((e && e.message) || e), 3500));
		};
		const doDuplicate = (path) => {
			const dest = dirname(path);
			const name = dupName(basename(path));
			apiOp({ op: 'paste', srcPath: path, destDir: dest, mode: 'copy', newName: name }).then((res) => {
				if (res && res.ok === true) {
					showToast('已创建副本「' + name + '」');
					refreshTree();
				} else {
					showToast('复制失败：' + (res && res.error ? res.error : '未知错误'), 3500);
				}
			}).catch((e) => showToast('复制失败：' + String((e && e.message) || e), 3500));
		};
		const doMkdir = (dir) => promptNew(dir, 'mkdir');
		const promptNew = (dir, op) => {
			const label = op === 'mkdir' ? '新建文件夹名称' : '新建文件名';
			const def = op === 'mkdir' ? '新建文件夹' : '新建文件.txt';
			queueMicrotask(() => promptModal(label, def).then((name) => {
				if (!name) return;
				apiOp({ op, path: dir, name }).then((res) => {
					if (res && res.ok === true) {
						showToast((op === 'mkdir' ? '已创建文件夹「' : '已创建文件「') + basename(res.newPath || name) + '」');
						refreshTree();
					} else {
						showToast('创建失败：' + (res && res.error ? res.error : '未知错误'), 3500);
					}
				}).catch((e) => showToast('创建失败：' + String((e && e.message) || e), 3500));
			}));
		};
		const doOpen = (path, select) => {
			apiOp({ op: 'open', path, select: select ? 'true' : 'false' }).then((res) => {
				if (!res || res.ok !== true) showToast('打开失败：' + (res && res.error ? res.error : '未知错误'), 3000);
			}).catch((e) => showToast('打开失败：' + String((e && e.message) || e), 3000));
		};
		const doAttachToChat = (path, item) => {
			const ext = extOf(path);
			if (IMG_EXT.indexOf(ext) === -1) {
				menuFeedback(item, '聊天仅支持图片（≤4MB）', 1500);
				return;
			}
			menuFeedback(item, '添加中…', 3000);
			api('read', { path, offset: 0 }).then((r0) => {
				if (!r0 || r0.ok !== true || r0.kind !== 'image') {
					menuFeedback(item, r0 && r0.error ? r0.error.slice(0, 16) : '读取失败', 1500);
					return;
				}
				if (r0.size > 4 * 1024 * 1024) {
					menuFeedback(item, '图片过大，无法添加', 1500);
					return;
				}
				return api('read', { path, whole: 'true' }).then((res) => {
					if (!res || res.ok !== true || res.kind !== 'image') {
						menuFeedback(item, '读取失败', 1200);
						return;
					}
					try {
						const bin = atob(res.base64);
						const bytes = new Uint8Array(bin.length);
						for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
						const file = new File([bytes], basename(path), { type: res.mime });
						const dt = new DataTransfer();
						dt.items.add(file);
						document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
						showToast('已添加到聊天：' + basename(path));
					} catch (e) {
						menuFeedback(item, '添加失败', 1200);
					}
				});
			}).catch(() => menuFeedback(item, '添加失败', 1200));
		};
		const openMenu = (row, x, y) => {
			closeMenu();
			menuRow = row;
			menuEl = makeEl('div', 'dsh-ftree-menu');
			const path = row ? rowPath(row) : null;
			const isDir = row ? rowIsDir(row) : null;
			const head = makeEl('div', 'dsh-ftree-menu-head', row ? ((isDir ? '📁 ' : '📄 ') + basename(path)) : '文件树');
			menuEl.appendChild(head);
			const addItem = (label, fn) => {
				const it = makeEl('div', 'dsh-ftree-menu-item', label);
				it.addEventListener('click', (e) => { e.stopPropagation(); fn(it); });
				menuEl.appendChild(it);
				return it;
			};
			const sep = () => menuEl.appendChild(makeEl('div', 'dsh-ftree-menu-sep'));
			if (!row) {
				const root = treeRootPath();
				if (root) {
					addItem('📁 新建文件夹', () => { closeMenu(); promptNew(root, 'mkdir'); });
					addItem('📄 新建文件', () => { closeMenu(); promptNew(root, 'newfile'); });
					if (clipboard) {
						addItem('📥 粘贴到当前文件夹 (' + (clipboard.mode === 'cut' ? '移动' : '复制') + ' ' + basename(clipboard.path) + ')', () => { closeMenu(); doPaste(root); });
					}
				}
				addItem('🔄 刷新', () => { closeMenu(); refreshTree(); });
			} else {
				addItem('📂 打开源文件夹', () => { closeMenu(); doOpen(path, true); });
				if (isDir) {
					addItem('📁 在此新建文件夹', () => { closeMenu(); promptNew(path, 'mkdir'); });
					addItem('📄 在此新建文件', () => { closeMenu(); promptNew(path, 'newfile'); });
				}
				addItem('💬 添加到聊天', (it) => doAttachToChat(path, it));
				if (!isDir) {
					addItem('⧉ 原地复制', () => { closeMenu(); doDuplicate(path); });
				}
				sep();
				addItem('📄 复制', (it) => {
					clipboard = { path, mode: 'copy' };
					updateClipboardBadge();
					menuFeedback(it, '已复制 ✓');
				});
				addItem('✂️ 剪切', (it) => {
					clipboard = { path, mode: 'cut' };
					if (cutPath) { const els = colEl ? colEl.querySelectorAll('.dsh-ftree-cut') : []; for (const e of Array.from(els)) e.classList.remove('dsh-ftree-cut'); }
					cutPath = path;
					if (row.classList) row.classList.add('dsh-ftree-cut');
					updateClipboardBadge();
					menuFeedback(it, '已剪切 ✓');
				});
				if (clipboard) {
					const dest = isDir ? path : dirname(path);
					if (dest) {
						addItem('📥 粘贴到这里 (' + (clipboard.mode === 'cut' ? '移动' : '复制') + ' ' + basename(clipboard.path) + ')', () => { closeMenu(); doPaste(dest); });
					}
				}
				sep();
				addItem('🗑️ 删除', () => { closeMenu(); doDelete(path); });
				addItem('✏️ 重命名', () => { const r = menuRow; closeMenu(); if (r) startRename(r); });
				addItem('📋 复制路径', () => { const r = menuRow; copyPath(r); });
			}
			document.body.appendChild(menuEl);
			const mw = menuEl.getBoundingClientRect().width;
			const mh = menuEl.getBoundingClientRect().height;
			const vw = document.documentElement.clientWidth;
			const vh = document.documentElement.clientHeight;
			menuEl.style.left = Math.min(x, vw - mw - 4) + 'px';
			menuEl.style.top = Math.min(y, vh - mh - 4) + 'px';
		};
		const startRename = (row) => {
			const nameEl = row.querySelector('.dsh-ftree-name');
			if (!nameEl) return;
			const oldPath = nameEl.title || '';
			const oldName = nameEl.textContent || '';
			const input = document.createElement('input');
			input.className = 'dsh-ftree-rename-input';
			input.value = oldName;
			input.spellcheck = false;
			nameEl.replaceWith(input);
			input.focus();
			input.select();
			const finish = (commit) => {
				const val = (input.value || '').trim();
				if (commit && val.length > 0 && val !== oldName) {
					apiOp({ op: 'rename', path: oldPath, newName: val }).then((res) => {
						if (res && res.ok === true) {
							showToast('已重命名为「' + val + '」');
							refreshTree();
						} else {
							showToast('重命名失败：' + (res && res.error ? res.error : '未知错误'), 3500);
							const span = makeEl('span', 'dsh-ftree-name', oldName);
							if (oldPath) span.title = oldPath;
							input.replaceWith(span);
						}
					}).catch((e) => {
						showToast('重命名失败：' + String((e && e.message) || e), 3500);
						const span = makeEl('span', 'dsh-ftree-name', oldName);
						if (oldPath) span.title = oldPath;
						input.replaceWith(span);
					});
				} else {
					const span = makeEl('span', 'dsh-ftree-name', oldName);
					if (oldPath) span.title = oldPath;
					input.replaceWith(span);
				}
			};
			const onKey = (e) => {
				if (e.key === 'Enter') { e.preventDefault(); input.removeEventListener('keydown', onKey); input.removeEventListener('blur', onBlur); finish(true); }
				else if (e.key === 'Escape') { e.preventDefault(); input.removeEventListener('keydown', onKey); input.removeEventListener('blur', onBlur); finish(false); }
			};
			const onBlur = () => {
				input.removeEventListener('keydown', onKey);
				input.removeEventListener('blur', onBlur);
				finish(true);
			};
			input.addEventListener('keydown', onKey);
			input.addEventListener('blur', onBlur);
		};
		const copyPath = (row) => {
			const path = rowPath(row);
			if (!path) return;
			const done = (ok) => {
				const items = menuEl ? menuEl.querySelectorAll('.dsh-ftree-menu-item') : [];
				for (const it of items) if (it.textContent.indexOf('复制路径') !== -1) it.textContent = ok ? '已复制 ✓' : '复制失败';
			};
			if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
				navigator.clipboard.writeText(path).then(() => done(true)).catch(() => done(false));
			} else {
				done(false);
			}
		};
		const onContextMenu = (e) => {
			const row = e.target && e.target.closest ? e.target.closest('.dsh-ftree-row') : null;
			if (!colEl) return;
			if (row && !rowPath(row)) return;
			e.preventDefault();
			openMenu(row, e.clientX, e.clientY);
		};
		const onDocClick = (e) => {
			closeMenu();
			if (confirmEl && e.target && confirmEl.contains(e.target)) return;
			closeConfirm();
		};
		const onDocKey = (e) => { if (e.key === 'Escape') { closeMenu(); closeConfirm(); } };
		const pvOnDown = (e) => {
			e.preventDefault();
			dragging2 = { x: e.clientX, w: prevEl.getBoundingClientRect().width };
			prevEl.style.userSelect = 'none';
			document.body.style.cursor = 'col-resize';
			if (prevHandle && prevHandle.setPointerCapture) prevHandle.setPointerCapture(e.pointerId);
		};
		const pvOnMove = (e) => {
			if (!dragging2) return;
			const vw = document.documentElement.clientWidth;
			const cap = Math.min(PREV_MAX, Math.max(PREV_MIN, vw - sidebarW() - treeW() - 320));
			const pw = Math.min(cap, Math.max(PREV_MIN, Math.round(dragging2.w + (e.clientX - dragging2.x))));
			lastPrevW = pw;
			prevEl.style.width = pw + 'px';
			applyLayout();
		};
		const pvOnUp = (e) => {
			if (!dragging2) return;
			dragging2 = null;
			if (prevEl) prevEl.style.userSelect = '';
			document.body.style.cursor = '';
			lsSet(LS.pw, String(lastPrevW));
			if (prevHandle && prevHandle.hasPointerCapture && prevHandle.hasPointerCapture(e.pointerId)) prevHandle.releasePointerCapture(e.pointerId);
		};
		const renderTabBar = () => {
			if (!tabBarEl) return;
			tabBarEl.innerHTML = '';
			if (tabs.length === 0) { tabBarEl.style.display = 'none'; return; }
			tabBarEl.style.display = '';
			tabs.forEach((t, i) => {
				const b = makeEl('div', 'dsh-ftree-prevcol-tab' + (i === activeTab ? ' active' : ''), basename(t.path));
				b.title = t.path;
				b.addEventListener('click', (e) => { e.stopPropagation(); if (i !== activeTab) switchTab(i); });
				const x = makeEl('span', 'dsh-ftree-prevcol-tab-x', '✕');
				x.title = '关闭';
				x.addEventListener('click', (e) => { e.stopPropagation(); closePreview(t.path); });
				b.appendChild(x);
				tabBarEl.appendChild(b);
			});
		};
		const renderFromPv = () => {
			if (!pv || !prevBody) return;
			if (pv.kind === 'image' && pv.done && pv.b64) pvFinishImg();
			else if (pv.kind === 'pdf') pvFinishPdf();
			else if (pv.kind === 'docx' || pv.kind === 'docx-html') pvFinishDocx();
			else if (pv.isMd) pvRenderMd();
			else if (pv.isCsv) pvRenderCsv();
			else if (pv.done) {
				pvResetFlex();
				prevBody.innerHTML = '';
				delete prevBody.dataset.img; delete prevBody.dataset.pdf; delete prevBody.dataset.docx;
				if (pv.text) {
					const pre = makeEl('pre', 'dsh-ftree-prevcol-pre');
					if (pv.isCode) pre.innerHTML = hlCode(pv.text, CODE_LANGS[extOf(pv.path)]);
					else pre.textContent = pv.text;
					prevBody.appendChild(pre);
				}
			} else {
				pvShow('加载中…', true);
				pvLoad(pv.loaded);
			}
		};
		const switchTab = (idx) => {
			if (idx < 0 || idx >= tabs.length || idx === activeTab) return;
			flushMdSave();
			if (activeTab >= 0 && tabs[activeTab]) { tabs[activeTab].pv = pv; tabs[activeTab].md = mdState; }
			activeTab = idx;
			const t = tabs[idx];
			pv = t.pv;
			mdState = t.md || { mode: 'preview', dirty: false, statusEl: null };
			prevPath = t.path;
			previewSet(t.path);
			if (prevName) prevName.textContent = basename(t.path);
			if (prevSize) prevSize.textContent = '';
			renderTabBar();
			renderFromPv();
		};
		const gitStatusOf = (c) => {
			if (c.x === '?' && c.y === '?') return { tag: 'U', cls: 'untracked' };
			if (c.x !== ' ' && c.x !== '?') return { tag: c.x === 'A' ? 'A' : (c.x === 'D' ? 'D' : 'M'), cls: 'staged' };
			return { tag: c.y === 'D' ? 'D' : 'M', cls: 'modified' };
		};
		const runGitOp = (wsPath, op, target, staged, untracked) => apiOp(Object.assign({ op, path: wsPath, target },
			typeof staged === 'boolean' ? { staged } : {}, untracked ? { untracked: true } : {})).then((res) => {
			if (res && res.ok === true) return true;
			showToast((res && res.error ? res.error : 'git 操作失败'), 3500);
			return false;
		}).catch((e) => { showToast('git 操作失败：' + String((e && e.message) || e), 3500); return false; });
		const showGitDiff = (text) => {
			ensurePrevCol();
			prevPath = '__git_diff__';
			pvResetFlex();
			if (!prevBody) return;
			prevBody.innerHTML = '';
			delete prevBody.dataset.img; delete prevBody.dataset.pdf; delete prevBody.dataset.docx;
			const pre = makeEl('pre', 'dsh-ftree-prevcol-pre');
			pre.textContent = text || '（无差异）';
			prevBody.appendChild(pre);
		};
		const closePreview = (path) => {
			flushMdSave();
			let idx;
			if (tabs.length === 0) idx = -1;
			else if (path !== undefined && path !== null) idx = tabs.findIndex((t) => t.path === path);
			else idx = activeTab;
			if (idx === -1 || idx >= tabs.length) {
				previewSet(null);
				if (prevEl) { prevEl.remove(); prevEl = null; }
				prevBody = null; prevName = null; prevSize = null; prevHandle = null; prevPath = null; pv = null; tabBarEl = null;
				applyLayout();
				return;
			}
			tabs.splice(idx, 1);
			if (tabs.length === 0) {
				previewSet(null);
				if (prevEl) { prevEl.remove(); prevEl = null; }
				prevBody = null; prevName = null; prevSize = null; prevHandle = null; prevPath = null; pv = null; tabBarEl = null;
				applyLayout();
				return;
			}
			activeTab = Math.max(0, Math.min(idx, tabs.length - 1));
			const t = tabs[activeTab];
			pv = t.pv;
			mdState = t.md || { mode: 'preview', dirty: false, statusEl: null };
			prevPath = t.path;
			ensurePrevCol();
			if (prevName) prevName.textContent = basename(t.path);
			if (prevSize) prevSize.textContent = '';
			previewSet(t.path);
			renderTabBar();
			renderFromPv();
		};
		const ensurePrevCol = () => {
			if (prevEl && prevEl.isConnected) return;
			prevEl = makeEl('div', 'dsh-ftree-prevcol');
			tabBarEl = makeEl('div', 'dsh-ftree-prevcol-tabs');
			prevEl.appendChild(tabBarEl);
			const head = makeEl('div', 'dsh-ftree-prevcol-head');
			const close = makeEl('button', 'dsh-ftree-prevcol-close', '✕');
			close.title = '关闭当前标签';
			close.addEventListener('click', () => closePreview());
			head.appendChild(close);
			head.appendChild(makeEl('span', 'dsh-ftree-prevcol-icon', '📄'));
			prevName = makeEl('span', 'dsh-ftree-prevcol-name');
			head.appendChild(prevName);
			prevSize = makeEl('span', 'dsh-ftree-prevcol-size');
			head.appendChild(prevSize);
			const pathEl = makeEl('div', 'dsh-ftree-prevcol-path');
			prevBody = makeEl('div', 'dsh-ftree-prevcol-body');
			prevEl.appendChild(head);
			prevEl.appendChild(pathEl);
			prevEl.appendChild(prevBody);
			prevHandle = document.createElement('div');
			prevHandle.className = 'dsh-ftree-prevcol-handle';
			prevHandle.addEventListener('pointerdown', pvOnDown);
			prevHandle.addEventListener('pointermove', pvOnMove);
			prevHandle.addEventListener('pointerup', pvOnUp);
			prevHandle.addEventListener('pointercancel', pvOnUp);
			prevEl.appendChild(prevHandle);
			document.body.appendChild(prevEl);
			prevBody.addEventListener('scroll', onPrevScroll);
			applyLayout();
		};
		const pvResetFlex = () => {
			if (!prevBody) return;
			prevBody.style.display = '';
			prevBody.style.flexDirection = '';
			prevBody.style.alignItems = '';
		};
		const pvShow = (note, pending) => {
			if (!prevBody) return;
			pvResetFlex();
			prevBody.innerHTML = '';
			delete prevBody.dataset.img;
			if (note) prevBody.appendChild(makeEl('div', pending ? 'dsh-ftree-prevcol-load dsh-ftree-prevcol-pending' : 'dsh-ftree-prevcol-load', note));
		};
		const pvErr = (msg) => {
			if (!prevBody) return;
			pvResetFlex();
			prevBody.innerHTML = '';
			delete prevBody.dataset.img;
			prevBody.appendChild(makeEl('div', 'dsh-ftree-prevcol-err', msg));
		};
		const pvAppendText = (text, more) => {
			if (!prevBody) return;
			if (prevBody.dataset.img === '1' || prevBody.dataset.pdf === '1' || prevBody.dataset.docx === '1') { pvResetFlex(); prevBody.innerHTML = ''; delete prevBody.dataset.img; delete prevBody.dataset.pdf; delete prevBody.dataset.docx; }
			const pending = prevBody.querySelector('.dsh-ftree-prevcol-pending');
			if (pending) pending.remove();
			const pre = makeEl('pre', 'dsh-ftree-prevcol-pre');
			if (pv.isCode) pre.innerHTML = hlCode(text, CODE_LANGS[extOf(pv.path)]);
			else pre.textContent = text;
			prevBody.appendChild(pre);
			if (!more) {
				const note = makeEl('div', 'dsh-ftree-prevcol-load', '已显示 ' + fmtSize(pv.loaded) + ' / ' + fmtSize(pv.total));
				prevBody.appendChild(note);
			}
		};
		const pvFinishImg = () => {
			if (!prevBody) return;
			prevBody.innerHTML = '';
			prevBody.dataset.img = '1';
			prevBody.style.display = 'flex';
			prevBody.style.flexDirection = 'column';
			prevBody.style.alignItems = 'center';
			const img = document.createElement('img');
			img.className = 'dsh-ftree-prevcol-img';
			img.src = 'data:' + (pv.mime || 'image/png') + ';base64,' + pv.b64;
			img.addEventListener('error', () => pvErr('图片渲染失败（数据损坏？）'));
			const badge = makeEl('div', 'dsh-ftree-prevcol-zoom', '100%');
			badge.style.display = 'none';
			let zoom = 1;
			const applyZoom = () => {
				img.style.width = (zoom * 100) + '%';
				badge.textContent = Math.round(zoom * 100) + '%';
				badge.style.display = zoom === 1 ? 'none' : 'block';
			};
			img.addEventListener('wheel', (e) => {
				if (!(e.ctrlKey || e.metaKey)) return;
				e.preventDefault();
				zoom = Math.min(8, Math.max(0.2, zoom + (e.deltaY < 0 ? 0.15 : -0.15)));
				applyZoom();
			}, { passive: false });
			img.addEventListener('dblclick', (e) => {
				e.preventDefault();
				zoom = 1;
				applyZoom();
			});
			prevBody.appendChild(img);
			prevBody.appendChild(badge);
		};
		const pvFinishPdf = () => {
			if (!prevBody) return;
			pvResetFlex();
			prevBody.innerHTML = '';
			prevBody.dataset.pdf = '1';
			const frame = document.createElement('iframe');
			frame.className = 'dsh-ftree-prevcol-pdf';
			frame.src = '/dsh-ftree-pdf?path=' + encodeURIComponent(pv.path);
			prevBody.appendChild(frame);
		};
		const DOCX_CSS = 'body{font-family:"Microsoft YaHei","Segoe UI",Arial,sans-serif;line-height:1.6;margin:20px 24px;color:#222;word-wrap:break-word;font-size:14px;}h1{font-size:1.55em;margin:0.8em 0 0.4em;}h2{font-size:1.3em;margin:0.7em 0 0.35em;}h3{font-size:1.12em;margin:0.6em 0 0.3em;}p{margin:0.45em 0;}ul,ol{margin:0.45em 0;padding-left:2em;}li{margin:0.2em 0;}table{border-collapse:collapse;margin:0.6em 0;}td,th{border:1px solid #999;padding:4px 10px;}img{max-width:100%;height:auto;}blockquote{border-left:3px solid #bbb;margin:0.5em 0;padding:0.15em 1em;color:#555;}a{color:#0a66c2;}hr{border:none;border-top:1px solid #ccc;margin:1em 0;}';
		const pvFinishDocx = () => {
			if (!prevBody) return;
			pvResetFlex();
			prevBody.innerHTML = '';
			prevBody.dataset.docx = '1';
			const frame = document.createElement('iframe');
			frame.className = 'dsh-ftree-prevcol-docx';
			frame.setAttribute('sandbox', 'allow-same-origin');
			frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' + DOCX_CSS + '</style></head><body>' + (pv.text || '') + '</body></html>';
			prevBody.appendChild(frame);
		};
		const mdToolsBar = () => {
			if (!prevBody) return null;
			const bar = makeEl('div', 'dsh-ftree-prevcol-tools');
			const btnPrev = makeEl('button', 'dsh-ftree-prevcol-tab' + (mdState.mode === 'preview' ? ' active' : ''), '预览');
			const btnEdit = makeEl('button', 'dsh-ftree-prevcol-tab' + (mdState.mode === 'edit' ? ' active' : ''), '编辑');
			mdState.statusEl = makeEl('span', 'dsh-ftree-prevcol-save');
			bar.appendChild(btnPrev);
			bar.appendChild(btnEdit);
			bar.appendChild(mdState.statusEl);
			btnPrev.addEventListener('click', () => {
				if (mdState.dirty) saveMd();
				pvRenderMd();
			});
			btnEdit.addEventListener('click', () => pvEnterEdit());
			return bar;
		};
		const pvRenderMd = () => {
			if (!prevBody || !pv) return;
			mdState.mode = 'preview';
			mdState.dirty = false;
			pvResetFlex();
			prevBody.innerHTML = '';
			delete prevBody.dataset.docx;
			const bar = mdToolsBar();
			if (bar) prevBody.appendChild(bar);
			const art = makeEl('div', 'dsh-ftree-prevcol-md');
			art.innerHTML = renderMd(pv.text || '', pv.path ? dirname(pv.path) : '');
			prevBody.appendChild(art);
			if (prevSize) prevSize.textContent = fmtSize((pv.text || '').length);
		};
		const pvEnterEdit = () => {
			if (!prevBody || !pv || pv.text === undefined) return;
			mdState.mode = 'edit';
			pvResetFlex();
			prevBody.innerHTML = '';
			delete prevBody.dataset.docx;
			const bar = mdToolsBar();
			if (bar) prevBody.appendChild(bar);
			const toolBar = makeEl('div', 'dsh-ftree-prevcol-tools');
			const mdTool = (label, title, wrap, tmpl) => {
				const b = makeEl('button', 'dsh-ftree-prevcol-tab', label);
				b.title = title;
				b.addEventListener('click', (ev) => {
					ev.preventDefault();
					const s = ta.selectionStart, e2 = ta.selectionEnd;
					const sel = ta.value.slice(s, e2) || '';
					let rep;
					if (wrap) rep = wrap.replace('$', sel || '文本');
					else rep = tmpl;
					ta.value = ta.value.slice(0, s) + rep + ta.value.slice(e2);
					ta.selectionStart = ta.selectionEnd = s + rep.length;
					pv.text = ta.value;
					mdState.dirty = true;
					if (mdState.statusEl) { mdState.statusEl.textContent = '编辑中…'; mdState.statusEl.className = 'dsh-ftree-prevcol-save dirty'; }
					if (mdSaveT) clearTimeout(mdSaveT);
					mdSaveT = setTimeout(saveMd, 800);
					if (live.isConnected) live.innerHTML = renderMd(ta.value, pv.path ? dirname(pv.path) : '');
					ta.focus();
				});
				toolBar.appendChild(b);
			};
			mdTool('B', '加粗 **文本**', '**$**', null);
			mdTool('I', '斜体 *文本*', '*$*', null);
			mdTool('H', '标题 ## 文本', '## $', null);
			mdTool('🔗', '链接 [文本](https://)', null, '[](https://)');
			mdTool('`', '行内代码', '`$`', null);
			mdTool('```', '代码块', null, '\n```\n\n```\n');
			mdTool('▦', '表格', null, '\n| 列1 | 列2 |\n| --- | --- |\n|  |  |\n');
			mdTool('-', '列表项', '- ', null);
			mdTool('❝', '引用', '> ', null);
			prevBody.appendChild(toolBar);
			const ta = document.createElement('textarea');
			ta.className = 'dsh-ftree-prevcol-ta';
			ta.value = pv.text;
			ta.spellcheck = false;
			const live = makeEl('div', 'dsh-ftree-prevcol-live');
			live.innerHTML = renderMd(pv.text, pv.path ? dirname(pv.path) : '');
			ta.addEventListener('input', () => {
				pv.text = ta.value;
				mdState.dirty = true;
				if (mdState.statusEl) { mdState.statusEl.textContent = '编辑中…'; mdState.statusEl.className = 'dsh-ftree-prevcol-save dirty'; }
				if (mdSaveT) clearTimeout(mdSaveT);
				mdSaveT = setTimeout(saveMd, 800);
				if (mdRenderT) clearTimeout(mdRenderT);
				mdRenderT = setTimeout(() => { if (live.isConnected) live.innerHTML = renderMd(ta.value, pv.path ? dirname(pv.path) : ''); }, 300);
			});
			ta.addEventListener('keydown', (e) => {
				if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
					e.preventDefault();
					if (mdSaveT) clearTimeout(mdSaveT);
					saveMd();
				}
			});
			prevBody.appendChild(ta);
			prevBody.appendChild(live);
			ta.focus();
		};
		const saveMd = () => {
			if (!pv || typeof pv.text !== 'string') return;
			const path = pv.path;
			const content = pv.text;
			if (!mdState.statusEl) return;
			mdState.statusEl.textContent = '保存中…';
			mdState.statusEl.className = 'dsh-ftree-prevcol-save dirty';
			apiPost('write', { path }, { content, token: TOKEN }).then((res) => {
				if (!mdState.statusEl) return;
				if (res && res.ok === true) {
					mdState.dirty = false;
					const d = new Date();
					mdState.statusEl.textContent = '已保存 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
					mdState.statusEl.className = 'dsh-ftree-prevcol-save';
				} else {
					mdState.dirty = true;
					mdState.statusEl.textContent = '保存失败：' + ((res && res.error) || '未知错误');
					mdState.statusEl.className = 'dsh-ftree-prevcol-save err';
				}
			}).catch((e) => {
				if (!mdState.statusEl) return;
				mdState.dirty = true;
				mdState.statusEl.textContent = '保存失败：' + String((e && e.message) || e);
				mdState.statusEl.className = 'dsh-ftree-prevcol-save err';
			});
		};
		const flushMdSave = () => {
			if (mdState.dirty && pv && typeof pv.text === 'string') saveMd();
		};
		const onPrevScroll = () => {
			if (!prevBody || !pv || pv.done || pv.kind === 'image') return;
			if (prevBody.scrollTop + prevBody.clientHeight > prevBody.scrollHeight - 600) {
				if (pv.loaded < pv.total) pvLoad(pv.loaded);
			}
		};
		const pvLoad = (offset, whole) => {
			const seq = pv.seq;
			const docxWait = extOf(pv.path) === '.docx' ? 60000 : undefined;
			api('read', { path: pv.path, offset, whole: whole ? 'true' : undefined }, docxWait).then((res) => {
				if (!pv || pv.seq !== seq || pv.path !== prevPath) return;
				if (!res || res.ok !== true) {
					pvErr(res && res.error ? res.error : '读取失败');
					return;
				}
				if (!pv.kind && res.kind) pv.kind = res.kind;
				if (res.mime) pv.mime = res.mime;
				if (res.kind === 'pdf') {
					pv.done = true;
					if (prevSize) prevSize.textContent = fmtSize(res.size);
					pvFinishPdf();
					return;
				}
				pv.total = res.size;
				const b64 = (res.base64 || '').replace(/=+$/, '');
				const got = res.text ? res.text.length : Math.floor(b64.length * 3 / 4);
				pv.loaded = res.done ? res.size : (res.offset + got);
				if (pv.kind === 'image') {
					pv.b64 += b64;
					if (!res.done) {
						if (pv.loaded >= IMG_CAP) {
							pv.done = true;
							pvShow('图片较大，已截断预览（共 ' + fmtSize(pv.total) + '，双击文件可用默认程序查看完整内容）');
						} else {
							pvShow('加载中 ' + fmtSize(pv.loaded) + ' / ' + fmtSize(pv.total) + '…');
							pvLoad(pv.loaded);
						}
					} else pvFinishImg();
				} else if (res.kind === 'docx-html') {
					pv.text = (pv.text || '') + (res.text || '');
					if (!res.done) pvLoad(pv.loaded, true);
					else { pv.done = true; pvFinishDocx(); }
				} else if (pv.isMd) {
					pv.text = res.text || '';
					pv.loaded = res.size;
					pv.done = true;
					pvRenderMd();
				} else if (pv.isCsv) {
					pv.text = res.text || '';
					pv.loaded = res.size;
					pv.done = true;
					pvRenderCsv();
				} else {
					if (res.text) pvAppendText(res.text, !res.done);
					if (!res.done) {
						if (pv.loaded >= TEXT_CAP) {
							pv.done = true;
							const note = makeEl('div', 'dsh-ftree-prevcol-load', '文件较大，已截断显示前 ' + fmtSize(TEXT_CAP) + '（双击文件可用默认程序查看完整内容）');
							if (prevBody) prevBody.appendChild(note);
						}
					} else {
						const note = makeEl('div', 'dsh-ftree-prevcol-load', '已显示 ' + fmtSize(pv.loaded) + ' / ' + fmtSize(pv.total));
						if (prevBody) prevBody.appendChild(note);
					}
				}
			}).catch((e) => {
				if (!pv || pv.seq !== seq) return;
				pvErr('读取失败：' + String((e && e.message) || e));
			});
		};
		const openPreview = (path) => {
			if (!colEl) return;
			flushMdSave();
			const existing = tabs.findIndex((t) => t.path === path);
			if (existing !== -1) { switchTab(existing); return; }
			prevPath = path;
			ensurePrevCol();
			if (prevName) prevName.textContent = basename(path);
			if (prevSize) prevSize.textContent = '';
			pvSeq += 1;
			const isMd = /\.(md|markdown)$/i.test(path);
			const isDocx = /\.docx$/i.test(path);
			const isCsv = /\.csv$/i.test(path);
			const isCode = isCodeFile(path);
			pv = { path, seq: pvSeq, kind: null, mime: null, total: 0, loaded: 0, done: false, b64: '', text: '', isMd, isCsv, isCode };
			mdState = { mode: 'preview', dirty: false, statusEl: null };
			tabs.push({ path, pv, md: mdState });
			activeTab = tabs.length - 1;
			renderTabBar();
			previewSet(path);
			if (isMd || isDocx || isCsv) {
				pvShow('加载中…', true);
				pvLoad(0, true);
			} else {
				pvShow('加载中…', true);
				pvLoad(0);
			}
		};
		const onClickRow = (e) => {
			const row = e.target && e.target.closest ? e.target.closest('.dsh-ftree-row') : null;
			if (!row || !colEl) return;
			if (!row.querySelector('.dsh-ftree-size')) return;
			const path = rowPath(row);
			if (!path) return;
			if (pv && pv.path === path && pv.total > 0 && pv.done) return;
			openPreview(path);
		};
		const onDblClickRow = (e) => {
			const row = e.target && e.target.closest ? e.target.closest('.dsh-ftree-row') : null;
			if (!row || !colEl) return;
			const path = rowPath(row);
			if (path) doOpen(path, false);
		};
		const onDown = (e) => {
			e.preventDefault();
			dragging = { x: e.clientX, w: treeW() };
			colEl.style.userSelect = 'none';
			document.body.style.cursor = 'col-resize';
			if (handleEl && handleEl.setPointerCapture) handleEl.setPointerCapture(e.pointerId);
		};
		const onMove = (e) => {
			if (!dragging) return;
			const w = clampW(dragging.w + (e.clientX - dragging.x));
			lastW = w;
			colEl.style.width = w + 'px';
			applyLayout();
		};
		const onUp = (e) => {
			if (!dragging) return;
			dragging = null;
			if (colEl) colEl.style.userSelect = '';
			document.body.style.cursor = '';
			lsSet(LS.w, String(lastW));
			if (handleEl && handleEl.hasPointerCapture && handleEl.hasPointerCapture(e.pointerId)) handleEl.releasePointerCapture(e.pointerId);
		};
		const attach = (col) => {
			colEl = col;
			if (lastW > 0) colEl.style.width = lastW + 'px';
			if (!colEl.querySelector('.dsh-ftree-handle')) {
				handleEl = document.createElement('div');
				handleEl.className = 'dsh-ftree-handle';
				handleEl.addEventListener('pointerdown', onDown);
				handleEl.addEventListener('pointermove', onMove);
				handleEl.addEventListener('pointerup', onUp);
				handleEl.addEventListener('pointercancel', onUp);
				colEl.appendChild(handleEl);
			}
			colEl.addEventListener('click', onClickRow);
			colEl.addEventListener('dblclick', onDblClickRow);
			colEl.addEventListener('contextmenu', onContextMenu);
			applyLayout();
		};
		const detach = () => {
			if (colEl) {
				colEl.removeEventListener('click', onClickRow);
				colEl.removeEventListener('dblclick', onDblClickRow);
				colEl.removeEventListener('contextmenu', onContextMenu);
			}
			colEl = null;
			handleEl = null;
			pv = null;
			applyLayout();
		};

		// ======================= plugin apply =======================
		function apply(ctx) {
			const slots = ctx.get('slots');
			const themeSvc = ctx.get('theme');
			const timerSvc = ctx.get('timer');
			if (timerSvc !== undefined) timer = timerSvc;
			const disposeCss = injectStyle(CSS + CSS_EXTRA);

			// stale-cache guard: if the host plugin version differs from the last
			// version this browser saw, ask for a hard refresh (old client + new
			// host is the #1 source of "it suddenly behaves weird" reports).
			api('meta').then((res) => {
				if (!res || !res.version) return;
				const last = lsGet('ftree.version', '');
				if (last && last !== res.version) showToast('插件已更新到 v' + res.version + '，请按 Ctrl+F5 刷新页面', 6000);
				lsSet('ftree.version', res.version);
			}).catch(() => { /* ignore */ });

			// ---- panel: toggle + column (React slot) ----
			let disposers = [];
			if (slots !== undefined) {
				const injectSlots = () => {
					disposers.push(slots.inject('sidebar.footer.action', () => slots.register(
						{ name: 'sidebar.footer.action', id: 'folder-tree-toggle', order: 30, label: () => '文件树' },
						(props) => {
							const [open, setOpen] = react.useState(panelStore.open);
							react.useEffect(() => panelSubscribe(() => setOpen(panelStore.open)), []);
							return react.createElement('div', { className: 'dsh-ftree-toggle', onClick: panelToggle, title: '文件树' },
								react.createElement(primitives.IconFolderOpenOutline16, { size: 16 }),
								props.wide ? react.createElement('span', null, open ? '隐藏文件树' : '显示文件树') : null
							);
						}
					)));
					/* Conversation folders are intentionally exposed from the workspace ... menu, not the sidebar footer.
					disposers.push(slots.inject('sidebar.footer.action', () => slots.register(
						{ name: 'sidebar.footer.action', id: 'conversation-archive', order: 35, label: () => '对话归档' },
						(props) => {
							const [open, setOpen] = react.useState(archiveStore.open);
							const [name, setName] = react.useState('');
							react.useEffect(() => archiveSubscribe(() => setOpen(archiveStore.open)), []);
							const data = archiveLoad();
							const currentId = props.useSessions((s) => s.current);
							const current = props.useSessions((s) => currentId ? s.byId[currentId] : undefined);
							const workspacesSvc = ctx.get('workspaces');
							const addFolder = async () => {
								const value = await promptModal('新建对话归档文件夹名称', '未分类');
								if (!value) return null;
								const latest = archiveLoad();
								if (latest.folders.some((f) => f.name === value)) { showToast('文件夹已存在', 2200); return latest.folders.find((f) => f.name === value); }
								const folder = { id: 'f-' + Date.now().toString(36), name: value, sessions: [] };
								latest.folders.push(folder); archiveSave(latest); archiveEmit(); return folder;
							};
							const archiveCurrent = async () => {
								if (!currentId || !current || current.blank) { showToast('当前没有可归档的对话', 2200); return; }
								if (!workspacesSvc || typeof workspacesSvc.archiveSession !== 'function') { showToast('当前 DSH 不支持归档会话', 2600); return; }
								let folder = data.folders.find((f) => f.name === name) || data.folders[0];
								if (!folder) folder = await addFolder();
								if (!folder) return;
								try {
									await workspacesSvc.archiveSession(currentId);
									folder.sessions = folder.sessions.filter((s) => s.id !== currentId);
									folder.sessions.push({ id: currentId, title: current.displayTitle || '未命名对话' });
									const latest = archiveLoad();
									const saved = latest.folders.find((f) => f.id === folder.id) || folder;
									saved.sessions = saved.sessions.filter((s) => s.id !== currentId);
									saved.sessions.push({ id: currentId, title: current.displayTitle || '未命名对话' });
									archiveSave(latest); setName(saved.name); archiveEmit(); showToast('已归档到「' + saved.name + '」');
								} catch (err) { showToast('归档失败：' + String((err && err.message) || err), 3200); }
							};
							const body = open ? react.createElement('div', { className: 'dsh-ftree-archive-panel' },
								react.createElement('div', { className: 'dsh-ftree-archive-head' }, react.createElement('span', null, '🗂️ 对话归档'), react.createElement('button', { className: 'dsh-ftree-archive-btn', onClick: archiveToggle }, '关闭')),
								react.createElement('div', { className: 'dsh-ftree-archive-note' }, '这里只归档左侧对话，不会在电脑磁盘创建文件夹。'),
								react.createElement('div', { className: 'dsh-ftree-archive-actions' }, react.createElement('button', { className: 'dsh-ftree-archive-btn', onClick: addFolder }, '＋新建归档文件夹'), react.createElement('button', { className: 'dsh-ftree-archive-btn', onClick: archiveCurrent }, '归档当前对话')),
								react.createElement('select', { className: 'dsh-ftree-archive-btn', value: name, onChange: (e) => setName(e.target.value) }, react.createElement('option', { value: '' }, '选择归档文件夹'), data.folders.map((f) => react.createElement('option', { key: f.id, value: f.name }, f.name))),
								react.createElement('div', { className: 'dsh-ftree-archive-list' }, data.folders.length ? data.folders.map((f) => react.createElement('div', { className: 'dsh-ftree-archive-folder', key: f.id }, react.createElement('div', { className: 'dsh-ftree-archive-folder-title' }, react.createElement('span', null, '📁 ' + f.name), react.createElement('span', null, String(f.sessions.length))), f.sessions.map((s) => react.createElement('div', { className: 'dsh-ftree-archive-session', key: s.id }, s.title)))) : react.createElement('div', { className: 'dsh-ftree-archive-note' }, '还没有归档文件夹。'))
							) : null;
							return react.createElement(react.Fragment, null, react.createElement('div', { className: 'dsh-ftree-theme-toggle', role: 'button', onClick: archiveToggle, title: '对话归档' }, react.createElement('span', null, '🗂️'), props.wide ? react.createElement('span', null, '归档') : null), body);
						}
					))); */
					if (themeSvc !== undefined) {
						disposers.push(slots.inject('sidebar.footer.action', () => slots.register(
							{ name: 'sidebar.footer.action', id: 'theme-toggle', order: 40, label: () => '切换深浅色' },
							(props) => {
								const [snapshot, setSnapshot] = react.useState(() => themeSvc.getTheme());
								react.useEffect(() => {
									const off = ctx.on('theme/change', () => setSnapshot(themeSvc.getTheme()));
									return () => { if (typeof off === 'function') off(); };
								}, []);
								const active = snapshot && snapshot.active ? snapshot.active.colorScheme : 'light';
								const next = active === 'dark' ? 'light' : 'dark';
								return react.createElement('div', { className: 'dsh-ftree-theme-toggle', role: 'button', tabIndex: 0, title: next === 'dark' ? '切换到深色' : '切换到浅色', 'aria-label': next === 'dark' ? '切换到深色' : '切换到浅色', onClick: () => themeSvc.setTheme(next), onKeyDown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); themeSvc.setTheme(next); } } },
									react.createElement(next === 'dark' ? primitives.IconDarkOutline16 : primitives.IconLightOutline16, { size: 16 }),
									props.wide ? react.createElement('span', null, next === 'dark' ? '深色' : '浅色') : null
								);
							}
						)));
					}
					disposers.push(slots.inject('shell.overlay', () => slots.register(
						{ name: 'shell.overlay', id: 'folder-tree-panel', order: 0, label: () => '文件树' },
						(props) => {
							const [open, setOpen] = react.useState(panelStore.open);
							react.useEffect(() => panelSubscribe(() => setOpen(panelStore.open)), []);
							const sesState = props.useSessions((s) => s);
							const currentId = sesState ? sesState.current : undefined;
							const currentSummary = currentId && sesState.byId ? sesState.byId[currentId] : undefined;
							const cwd = currentSummary ? currentSummary.cwd : undefined;
							const wsState = props.useWorkspaces((s) => s);
							const items = wsState && wsState.items ? wsState.items : [];
							let workspace = null;
							if (items.length > 0) {
								workspace = items.find((w) => w.sessionIds && currentId && w.sessionIds.indexOf(currentId) !== -1) || null;
								if (!workspace && cwd) workspace = items.find((w) => w.path === cwd) || null;
								if (!workspace && wsState.recentWorkspaceId) workspace = items.find((w) => w.workspaceId === wsState.recentWorkspaceId) || null;
								if (!workspace) workspace = items[0] || null;
							}
							const wsPath = workspace ? workspace.path : (cwd || null);
							const title = workspace ? workspace.title : (cwd ? basename(cwd) : '文件树');
							react.useEffect(() => { currentWsPath = wsPath; }, [wsPath]);
							const [root, setRoot] = react.useState(null);
							const [dirs, setDirs] = react.useState({});
							const [loading, setLoading] = react.useState(false);
							const [filter, setFilter] = react.useState('');
							const [previewPath, setPreviewPath] = react.useState(previewStore.path);
							const [view, setView] = react.useState('files');
							const [gitData, setGitData] = react.useState(null);
							const [gitLoading, setGitLoading] = react.useState(false);
							const [showHidden, setShowHidden] = react.useState(lsGet('ftree.hidden', '0') === '1');
							const [sortMode, setSortMode] = react.useState(lsGet('ftree.sort', 'name'));
							const dirsRef = react.useRef({});
							const setDirsSync = (fn) => setDirs((d) => { const n = typeof fn === 'function' ? fn(d) : fn; dirsRef.current = n; return n; });
							react.useEffect(() => {
								const fn = () => setPreviewPath(previewStore.path);
								previewStore.listeners.add(fn);
								return () => { previewStore.listeners.delete(fn); };
							}, []);
							const refreshGit = react.useCallback(() => {
								if (!wsPath) return;
								setGitLoading(true);
								api('git', { path: wsPath }).then((r) => { setGitData(r); setGitLoading(false); }).catch(() => { setGitLoading(false); });
							}, [wsPath]);
							react.useEffect(() => {
								if (open && view === 'git' && wsPath) refreshGit();
							}, [open, view, wsPath, refreshGit]);
							const runGit = (op, target, staged, untracked) => runGitOp(wsPath, op, target, staged, untracked).then((ok) => { if (ok) refreshGit(); });
							const runGitDiff = (target, staged) => {
								apiOp({ op: 'diff', path: wsPath, target, staged: !!staged }).then((res) => {
									showGitDiff(res && res.diff ? res.diff : '（无差异）');
								}).catch(() => showToast('获取差异失败', 3000));
							};
							react.useEffect(() => {
								if (!open || !wsPath) return;
								let cancelled = false;
								setRoot(null);
								setDirsSync({});
								setLoading(true);
								loadDir(wsPath, sortMode === 'mtime').then((r) => { if (cancelled) return; setRoot(r); setLoading(false); });
								return () => { cancelled = true; };
							}, [open, wsPath, sortMode]);
							// auto refresh root + expanded dirs every 5s
							react.useEffect(() => {
								if (!open || !wsPath || !timerSvc) return;
								const stop = timerSvc.interval(() => {
									if (view === 'git') { refreshGit(); return; }
									loadDir(wsPath, sortMode === 'mtime').then((r) => setRoot((prev) => (prev && prev.path === r.path ? r : prev)));
									Object.keys(dirsRef.current).forEach((p) => {
										const v = dirsRef.current[p];
										if (v && !v.error) loadDir(p, sortMode === 'mtime').then((r) => setDirsSync((d) => Object.assign({}, d, { [p]: r })));
									});
								}, 5000);
								return () => { if (stop) stop(); };
							}, [open, wsPath, sortMode, view, refreshGit]);
							const toggleDir = (path) => {
								const cur = dirsRef.current[path];
								if (cur) {
									setDirsSync((d) => { const n = Object.assign({}, d); delete n[path]; return n; });
									return;
								}
								setDirsSync((d) => Object.assign({}, d, { [path]: undefined }));
								loadDir(path, sortMode === 'mtime').then((r) => setDirsSync((d) => Object.assign({}, d, { [path]: r })));
							};
							const rows = [];
							const walk = (entries, depth) => {
								const list = (filter ? entries.filter((e) => e.name.toLowerCase().indexOf(filter.toLowerCase()) !== -1) : entries)
									.filter((e) => e.name.indexOf('.dshbak.') === -1)
									.filter((e) => showHidden || (e.name !== '.git' && e.name !== 'node_modules' && e.name !== '.DS_Store'));
								for (const e of sorted(list, sortMode)) {
									const pad = { paddingLeft: String(6 + depth * 14) + 'px' };
									const active = !!(e.kind === 'file' && previewPath && e.path === previewPath);
									if (e.kind === 'dir') {
										const child = dirsRef.current[e.path];
										rows.push(react.createElement('div', { key: e.path, className: 'dsh-ftree-row click', 'data-path': e.path, style: pad, onClick: () => toggleDir(e.path) },
											react.createElement('span', { className: 'dsh-ftree-arrow' }, child ? '▾' : '▸'),
											react.createElement('span', { className: 'dsh-ftree-ic' }, '📁'),
											react.createElement('span', { className: 'dsh-ftree-name', title: e.path }, e.name)
										));
										if (child && child.error) rows.push(react.createElement('div', { key: e.path + '-err', className: 'dsh-ftree-row dsh-ftree-err', style: { paddingLeft: String(20 + depth * 14) + 'px' } }, child.error));
										if (child) walk(child.entries, depth + 1);
									} else {
										rows.push(react.createElement('div', { key: e.path, className: 'dsh-ftree-row' + (active ? ' active' : ''), 'data-path': e.path, style: pad },
											react.createElement('span', { className: 'dsh-ftree-arrow' }, ''),
											react.createElement('span', { className: 'dsh-ftree-ic' }, '📄'),
											react.createElement('span', { className: 'dsh-ftree-name', title: e.path }, e.name),
											react.createElement('span', { className: 'dsh-ftree-size' }, fmtSize(e.size))
										));
									}
								}
							};
							if (open && root) walk(root.entries, 0);
							if (!open) return null;
							let gitBody = null;
							if (view === 'git') {
								if (gitLoading && !gitData) gitBody = react.createElement('div', { className: 'dsh-ftree-load' }, '加载中…');
								else if (!gitData) gitBody = react.createElement('div', { className: 'dsh-ftree-load' }, '无法获取 Git 状态');
								else if (gitData.error) gitBody = react.createElement('div', { className: 'dsh-ftree-err' }, gitData.error);
								else if (gitData.git === false) gitBody = react.createElement('div', { className: 'dsh-ftree-load' }, '不是 Git 仓库');
								else {
									const items = [react.createElement('div', { className: 'dsh-ftree-git-branch', key: 'branch' }, '🌿 ' + (gitData.branch || '(无分支)'))];
									if (gitData.changes.length === 0) items.push(react.createElement('div', { className: 'dsh-ftree-load', key: 'clean' }, '工作区干净 ✓'));
									gitData.changes.forEach((c, i) => {
										const st = gitStatusOf(c);
										const isUntracked = c.x === '?' && c.y === '?';
										const isStaged = c.x !== ' ' && c.x !== '?';
										const btn = (label, title, fn, cls) => react.createElement('span', { className: 'dsh-ftree-git-btn' + (cls ? ' ' + cls : ''), title, onClick: (ev) => { ev.stopPropagation(); fn(); } }, label);
										const ops = [];
										ops.push(btn('＋', '暂存', () => runGit('stage', c.path)));
										if (isStaged) ops.push(btn('−', '取消暂存', () => runGit('unstage', c.path)));
										ops.push(btn('👁', '查看差异', () => runGitDiff(c.path, isStaged)));
										if (isUntracked) ops.push(btn('🗑', '删除文件', () => showConfirm('确定删除未跟踪文件「' + basename(c.path) + '」？此操作不可恢复。', () => runGit('discard', c.path, false, true))));
										else ops.push(btn('⏪', '丢弃更改', () => showConfirm('确定丢弃「' + basename(c.path) + '」的更改？此操作不可恢复。', () => runGit('discard', c.path))));
										items.push(react.createElement('div', { key: i, className: 'dsh-ftree-git-row ' + st.cls, title: c.path },
											react.createElement('span', { className: 'dsh-ftree-git-tag' }, st.tag),
											react.createElement('span', { className: 'dsh-ftree-git-name' }, c.path),
											react.createElement('span', { className: 'dsh-ftree-git-ops' }, ops)
										));
									});
									gitBody = items;
								}
							}
							const head = react.createElement('div', { className: 'dsh-ftree-col-head' },
								react.createElement('span', null, view === 'git' ? '🔀' : '📁'),
								react.createElement('span', { className: 'dsh-ftree-title' }, view === 'git' ? 'Git 变更' : title),
								react.createElement('span', { className: 'dsh-ftree-btn' + (view === 'files' ? ' active' : ''), title: '文件树', onClick: (ev) => { ev.stopPropagation(); setView('files'); } }, '文件'),
								react.createElement('span', { className: 'dsh-ftree-btn' + (view === 'git' ? ' active' : ''), title: 'Git 变更', onClick: (ev) => { ev.stopPropagation(); setView('git'); } }, 'Git'),
								react.createElement('span', { className: 'dsh-ftree-btn', title: showHidden ? '隐藏 .git / node_modules / .DS_Store' : '显示 .git / node_modules / .DS_Store', onClick: (ev) => { ev.stopPropagation(); const v = !showHidden; setShowHidden(v); lsSet('ftree.hidden', v ? '1' : '0'); } }, showHidden ? '🙈' : '👁'),
								react.createElement('select', { className: 'dsh-ftree-sort', value: sortMode, title: '排序方式', onChange: (ev) => { const v = ev.target.value; setSortMode(v); lsSet('ftree.sort', v); }, onClick: (ev) => ev.stopPropagation() },
									react.createElement('option', { value: 'name' }, '名称'),
									react.createElement('option', { value: 'size' }, '大小'),
									react.createElement('option', { value: 'mtime' }, '时间')
								),
								react.createElement('span', { className: 'dsh-ftree-btn', title: '刷新', onClick: (ev) => { ev.stopPropagation(); if (view === 'git') refreshGit(); else if (wsPath) { setRoot(null); setDirsSync({}); setLoading(true); loadDir(wsPath, sortMode === 'mtime').then((r) => { setRoot(r); setLoading(false); }); } } }, '刷新')
							);
							const filterEl = react.createElement('input', {
								className: 'dsh-ftree-filter',
								placeholder: '过滤文件…',
								value: filter,
								onChange: (ev) => setFilter(ev.target.value),
								onClick: (ev) => ev.stopPropagation()
							});
							const body = view === 'git'
								? react.createElement('div', { className: 'dsh-ftree-body' }, gitBody || react.createElement('div', { className: 'dsh-ftree-load' }, '加载中…'))
								: react.createElement('div', { className: 'dsh-ftree-body' },
									!wsPath ? react.createElement('div', { className: 'dsh-ftree-load' }, '未找到当前工作区') :
									loading ? react.createElement('div', { className: 'dsh-ftree-load' }, '加载中…') :
									root && root.error ? react.createElement('div', { className: 'dsh-ftree-err' }, root.error) :
									root && rows.length === 0 ? react.createElement('div', { className: 'dsh-ftree-load' }, filter ? '（无匹配文件）' : '（空目录）') :
									rows
								);
							return react.createElement('div', { className: 'dsh-ftree-col' }, head, view === 'files' ? filterEl : null, body);
						}
					)));
				};
				injectSlots();
			}

			// ---- enhancements: layout tracking + preview + menu ----
			ctx.effect(() => {
				try {
					frameEl = findFrame();
					if (frameEl) {
						if (frameEl.children.length > 0) sidebarEl = frameEl.children[0];
						if (frameEl.children.length > 1) centerEl = frameEl.children[1];
						ro = new ResizeObserver(() => { applyLayout(); });
						if (sidebarEl) ro.observe(sidebarEl);
						ro.observe(frameEl);
					}
					const c0 = findCol();
					if (c0) attach(c0);
					document.addEventListener('click', onDocClick);
					document.addEventListener('keydown', onDocKey);
					mo = new MutationObserver(() => {
						enhanceWorkspaceMenu();
						if (!colEl || !colEl.isConnected) {
							const c = findCol();
							if (c && c !== colEl) { attach(c); }
							else if (!c && colEl) { detach(); }
						}
						if (prevEl && !prevEl.isConnected) { prevEl = null; prevBody = null; prevHandle = null; pv = null; applyLayout(); }
					});
					mo.observe(document.body, { childList: true, subtree: true });
					let iv = null;
					if (timer !== null) {
						iv = timer.interval(() => {
							ticks += 1;
							enhanceWorkspaceMenu();
							if (!frameEl) {
								frameEl = findFrame();
								if (frameEl) {
									if (frameEl.children.length > 0) sidebarEl = frameEl.children[0];
									if (frameEl.children.length > 1) centerEl = frameEl.children[1];
									if (ro) { if (sidebarEl) ro.observe(sidebarEl); ro.observe(frameEl); }
								}
							}
							if (!colEl || !colEl.isConnected) {
								const c = findCol();
								if (c && c !== colEl) { attach(c); }
								else if (!c && colEl) { detach(); }
							}
							if (prevEl && !prevEl.isConnected) { prevEl = null; prevBody = null; prevHandle = null; pv = null; applyLayout(); }
							applyLayout();
						}, 1000);
					}
					return () => {
						if (iv) iv();
						if (ro) ro.disconnect();
						if (mo) mo.disconnect();
						document.removeEventListener('click', onDocClick);
						document.removeEventListener('keydown', onDocKey);
						if (handleEl) {
							handleEl.removeEventListener('pointerdown', onDown);
							handleEl.removeEventListener('pointermove', onMove);
							handleEl.removeEventListener('pointerup', onUp);
							handleEl.removeEventListener('pointercancel', onUp);
							handleEl = null;
						}
						if (prevHandle) {
							prevHandle.removeEventListener('pointerdown', pvOnDown);
							prevHandle.removeEventListener('pointermove', pvOnMove);
							prevHandle.removeEventListener('pointerup', pvOnUp);
							prevHandle.removeEventListener('pointercancel', pvOnUp);
							prevHandle = null;
						}
						if (colEl) {
							colEl.removeEventListener('click', onClickRow);
							colEl.removeEventListener('dblclick', onDblClickRow);
							colEl.removeEventListener('contextmenu', onContextMenu);
							colEl.style.userSelect = '';
							const h = colEl.querySelector('.dsh-ftree-handle');
							if (h) h.remove();
						}
						if (prevEl) prevEl.remove();
						if (menuEl) menuEl.remove();
						if (confirmEl) confirmEl.remove();
						if (toastEl) toastEl.remove();
						if (cbBadge) cbBadge.remove();
						if (centerEl) centerEl.style.marginLeft = '';
						document.body.style.cursor = '';
					};
				} catch (err) {
					log('ftree effect error:', String((err && err.stack) || err));
				}
			});

			return () => {
				disposeCss();
				for (const d of disposers) { try { d(); } catch (e) { /* ignore */ } }
				disposers = [];
			};
		}

		exports.apply = apply;
		return module.exports;
	}
});
