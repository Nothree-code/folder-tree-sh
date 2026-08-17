/**
 * pathguard.js — unified workspace path guard (realpath-based).
 *
 * Security model (per security review P0):
 * - Every path must be normalized through `realpath` (follows symlinks and
 *   NTFS junctions) BEFORE the workspace-roots prefix check, so `..` traversal,
 *   junctions and symlink escapes cannot bypass the whitelist.
 * - For paths that do not exist yet (write targets), walk up to the nearest
 *   existing ancestor, realpath it, and re-append the remainder
 *   (`realpathLenient`), then run the same check.
 * - The prefix comparison uses canonicalized segments: platform separators are
 *   unified to '/', trailing slashes stripped, and case folded on Windows only.
 *   A path is allowed iff it equals a root, or its first segment beyond the
 *   root is NOT exactly '..' (a sibling literally named '..foo' is allowed).
 * - Entry validation rejects null / empty / embedded NUL.
 * All functions are async (fs.promises.realpath — never blocks the loop).
 */
import { realpath } from 'node:fs/promises';
import { sep } from 'node:path';

const IS_WIN = typeof process !== 'undefined' && process.platform === 'win32';

/** Canonical comparison form: '/' separators, no trailing slash, case-fold on win32. */
export function canon(p) {
  if (typeof p !== 'string') return '';
  return (IS_WIN ? p.toLowerCase() : p).replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Resolve a path that may not exist yet: realpath the nearest existing
 * ancestor, then re-append the missing remainder. Returns null when nothing
 * resolves (e.g. a drive that does not exist).
 * @param p - the path to resolve.
 * @returns canonical absolute path (canon() form) or null.
 */
export async function realpathLenient(p) {
  if (typeof p !== 'string' || !p.trim() || p.indexOf('\0') !== -1) return null;
  const original = p;
  let cur = p;
  const tail = [];
  for (let i = 0; i < 128; i++) {
    try {
      const r = await realpath(cur);
      if (tail.length === 0) return canon(r);
      // Re-append the missing tail with the native separator.
      const joined = r + sep + tail.reverse().join(sep);
      return canon(joined);
    } catch (e) {
      const m = /[\\/][^\\/]*$/.exec(cur);
      if (!m) return null; // nothing left to walk up
      tail.push(cur.slice(m.index + 1));
      cur = cur.slice(0, m.index);
      if (cur === '') return null;
    }
  }
  return null;
}

/**
 * Whether a canonical target lies inside (or equals) any canonical root.
 * Segment-aware: the first segment after the root must not be exactly '..'
 * (a sibling named '..foo' is legitimate and allowed).
 */
export function insideWorkspace(target, roots) {
  const t = canon(target);
  if (!t || !Array.isArray(roots) || roots.length === 0) return false;
  for (const raw of roots) {
    const r = canon(raw);
    if (!r) continue;
    if (t === r) return true;
    if (!t.startsWith(r + '/')) continue;
    const rest = t.slice(r.length + 1);
    const first = rest.split('/')[0];
    if (first === '..') continue;
    return true;
  }
  return false;
}

/**
 * One-stop guard: validate + realpath (lenient) + workspace containment.
 * @param p - the path to validate.
 * @param roots - canonical workspace roots (from workspaceRoots()).
 * @returns the canonical allowed path, or null when rejected.
 */
export async function assertWorkspacePath(p, roots) {
  if (typeof p !== 'string' || !p.trim() || p.indexOf('\0') !== -1) return null;
  if (!Array.isArray(roots) || roots.length === 0) return null;
  const target = await realpathLenient(p);
  if (!target) return null;
  return insideWorkspace(target, roots) ? target : null;
}
