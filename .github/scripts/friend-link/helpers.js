/**
 * Friend-link PR helpers for chius.cc (Hugo markdown friends).
 */
'use strict';

const { execFileSync, execSync } = require('child_process');
const path = require('path');

const FRIENDS_DIR = 'content/friends/';
const SITE_BASE = 'https://chius.cc/';
const FORBIDDEN_FILES = new Set(['_index.md', '_index.zh.md', '_index.en.md']);

const LABELS = {
  FRIEND: '友链',
  SITE_OK: '网站可达',
  SITE_BAD: '网站不可达',
  BIDIR: '双向链接验证',
  BIDIR_OK: '双向链接验证通过',
  AUTO_MERGED: '自动合并',
};

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizeUrl(raw) {
  if (!isNonEmptyString(raw)) return null;
  try {
    return new URL(raw.trim()).toString();
  } catch {
    return null;
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Minimal YAML front-matter parser for friend-link files.
 * Supports flat key: value (quoted or bare) pairs only.
 */
function parseFrontMatter(text) {
  if (!isNonEmptyString(text)) {
    return { ok: false, error: '文件为空' };
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) {
    return { ok: false, error: '缺少 YAML front matter（应以 --- 开头并以 --- 结束）' };
  }
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    data[kv[1]] = val;
  }
  return { ok: true, data, body: text.slice(m[0].length) };
}

function validateFriendEntry(data, pathName) {
  const errors = [];
  if (!isNonEmptyString(data.title)) errors.push('title 必填（站点名称）');
  if (!isNonEmptyString(data.externalUrl)) errors.push('externalUrl 必填（站点地址）');
  if (!isNonEmptyString(data.backlink)) {
    errors.push('backlink 必填（你的友链页 URL，用于双向验证）');
  }
  if (isNonEmptyString(data.externalUrl) && !normalizeUrl(data.externalUrl)) {
    errors.push('externalUrl 不是合法 URL');
  }
  if (isNonEmptyString(data.backlink) && !normalizeUrl(data.backlink)) {
    errors.push('backlink 不是合法 URL');
  }
  if (errors.length) return `${pathName}: ${errors.join('、')}`;
  return null;
}

/**
 * Verify that HTML contains an <a href="..."> pointing to expected site base.
 * Trailing slashes are normalized before comparison.
 */
function verifyBacklink(html, expected) {
  if (!html || !expected) return { found: false, links: [], reason: 'empty input' };
  const target = expected.replace(/\/$/, '');
  const patterns = [/href\s*=\s*["']([^"']+)["']/gi, /href\s*=\s*([^\s>]+)/gi];
  const foundLinks = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html)) !== null) {
      const href = (m[1] || '').trim();
      if (!href.startsWith('http')) continue;
      foundLinks.push(href);
      if (href.replace(/\/$/, '') === target) {
        return { found: true, links: foundLinks, matchedHref: href };
      }
    }
  }
  // Also accept bare domain mentions as last-resort? No — require real href.
  return { found: false, links: foundLinks };
}

function extractTitle(html) {
  if (!isNonEmptyString(html)) return null;
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  return String(m[1] || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function formatBacklinkDebug(d) {
  const lines = ['调试信息：'];
  if (isNonEmptyString(d?.finalUrl)) lines.push(`- 最终 URL：${d.finalUrl}`);
  if (typeof d?.status === 'number') lines.push(`- 状态码：${d.status}`);
  if (isNonEmptyString(d?.contentType)) lines.push(`- Content-Type：${d.contentType}`);
  if (isNonEmptyString(d?.title)) lines.push(`- 标题：${d.title}`);
  if (typeof d?.foundLinksCount === 'number') {
    lines.push(`- 找到的 HTTP(S) 链接数：${d.foundLinksCount}`);
  }
  if (isNonEmptyString(d?.sampleLinks)) lines.push(`- 示例链接：${d.sampleLinks}`);
  return lines.join('\n');
}

const CHECK_URL_TIMEOUT = 120000;

function checkUrlReachability(url, scriptPath) {
  const resolvedScript =
    scriptPath ||
    path.join(
      process.env.GITHUB_WORKSPACE || process.cwd(),
      '.github',
      'scripts',
      'friend-link',
      'check-url.js'
    );

  try {
    const result = execFileSync('node', [resolvedScript, url], {
      encoding: 'utf8',
      timeout: CHECK_URL_TIMEOUT,
      maxBuffer: 10 * 1024 * 1024,
    });
    const trimmed = (result || '').trim();
    if (!trimmed) return { ok: false, error: 'Empty response from check-url script' };
    return JSON.parse(trimmed);
  } catch (e) {
    let stderr = '';
    if (e?.stderr) {
      stderr = Buffer.isBuffer(e.stderr) ? e.stderr.toString('utf8').trim() : String(e.stderr).trim();
    }
    return { ok: false, error: stderr || e?.message || String(e) };
  }
}

function buildFooter(runUrl) {
  return [
    '',
    '---',
    '该评论由 Action 自动发送，无需回复。',
    runUrl ? `🔗 [查看本次检查](${runUrl})` : '',
    '',
    '💡 修复后 **push 更新 PR** 即可重新检查；仍失败可关闭后重开 PR。',
  ]
    .filter(Boolean)
    .join('\n');
}

function instructionsMarkdown() {
  return [
    '## 友链自动审批说明',
    '',
    '请确保 PR **只新增一个** 文件：`content/friends/你的站名.md`，内容如下：',
    '',
    '```yaml',
    '---',
    'title: "你的站点名称"',
    'externalUrl: "https://example.com"',
    'description: "一句话描述"',
    'backlink: "https://example.com/friends/"',
    'showHero: false',
    '---',
    '```',
    '',
    '### 自动合并条件',
    '',
    `1. \`externalUrl\` 可正常访问`,
    `2. \`backlink\` 与 \`externalUrl\` 主域名一致`,
    `3. 在 backlink 页面中包含指向本站的绝对链接：\`${SITE_BASE}\`（\`https://chius.cc\` 亦可）`,
    '4. 校验通过后将 **squash 合并**，并触发站点部署',
    '',
    '### 注意',
    '',
    '- 不要修改 `_index.md` 或其他目录',
    '- 不要在同一 PR 里改多个文件',
    '- 编辑/删除已有友链不走自动合并，请联系站长',
  ].join('\n');
}

// ── GitHub helpers (use gh CLI + GITHUB_TOKEN) ─────────────────

function ghJson(args, input) {
  const cmd = `gh api ${args}`;
  const opts = { encoding: 'utf8', timeout: 30000 };
  if (input !== undefined) {
    return JSON.parse(
      execSync(cmd, {
        ...opts,
        input: typeof input === 'string' ? input : JSON.stringify(input),
      })
    );
  }
  const out = execSync(cmd, opts);
  return out ? JSON.parse(out) : null;
}

function createComment(owner, repo, issueNumber, body, runUrl) {
  const full = body + buildFooter(runUrl);
  execSync(
    `gh api /repos/${owner}/${repo}/issues/${issueNumber}/comments --method POST --input -`,
    {
      input: JSON.stringify({ body: full }),
      encoding: 'utf8',
      timeout: 15000,
    }
  );
}

function ensureLabel(owner, repo, name, color = '0E8A16') {
  try {
    execSync(`gh api /repos/${owner}/${repo}/labels/${encodeURIComponent(name)} --method GET --silent`, {
      encoding: 'utf8',
      timeout: 15000,
    });
  } catch {
    try {
      execSync(`gh api /repos/${owner}/${repo}/labels --method POST --input -`, {
        input: JSON.stringify({ name, color, description: '' }),
        encoding: 'utf8',
        timeout: 15000,
      });
    } catch {
      // race / already exists
    }
  }
}

function setLabels(owner, repo, issueNumber, { add = [], remove = [] }) {
  for (const name of remove) {
    try {
      execSync(
        `gh api /repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(name)} --method DELETE --silent`,
        { encoding: 'utf8', timeout: 15000 }
      );
    } catch {
      // ignore missing
    }
  }
  if (add.length) {
    for (const name of add) ensureLabel(owner, repo, name);
    execSync(`gh api /repos/${owner}/${repo}/issues/${issueNumber}/labels --method POST --input -`, {
      input: JSON.stringify({ labels: add }),
      encoding: 'utf8',
      timeout: 15000,
    });
  }
}

function listPrFiles(owner, repo, pullNumber) {
  const out = execSync(
    `gh api /repos/${owner}/${repo}/pulls/${pullNumber}/files --paginate`,
    { encoding: 'utf8', timeout: 30000 }
  );
  return JSON.parse(out);
}

function getFileContent(owner, repo, filePath, ref) {
  // encode each path segment
  const encoded = filePath
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const out = execSync(
    `gh api /repos/${owner}/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)} --jq .content`,
    { encoding: 'utf8', timeout: 15000 }
  ).trim();
  if (!out) throw new Error(`empty content for ${filePath}`);
  return Buffer.from(out, 'base64').toString('utf8');
}

function mergePr(owner, repo, pullNumber) {
  execSync(`gh api /repos/${owner}/${repo}/pulls/${pullNumber}/merge --method PUT --input -`, {
    input: JSON.stringify({
      merge_method: 'squash',
      commit_title: `friend: auto-merge #${pullNumber}`,
    }),
    encoding: 'utf8',
    timeout: 20000,
  });
}

module.exports = {
  FRIENDS_DIR,
  SITE_BASE,
  FORBIDDEN_FILES,
  LABELS,
  isNonEmptyString,
  normalizeUrl,
  hostOf,
  parseFrontMatter,
  validateFriendEntry,
  verifyBacklink,
  extractTitle,
  formatBacklinkDebug,
  checkUrlReachability,
  buildFooter,
  instructionsMarkdown,
  createComment,
  ensureLabel,
  setLabels,
  listPrFiles,
  getFileContent,
  mergePr,
};
