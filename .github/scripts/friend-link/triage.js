/**
 * Friend-link PR triage for chius.cc.
 *
 * Env:
 *   GITHUB_TOKEN / GH_TOKEN  — required
 *   GITHUB_REPOSITORY        — owner/repo
 *   PR_NUMBER                — pull request number
 *   PR_HEAD_SHA              — head commit sha (for reading files)
 *   RUN_URL                  — optional actions run URL for footer
 *   GITHUB_WORKSPACE         — checkout root (default branch only)
 */
'use strict';

const path = require('path');
const H = require(path.join(__dirname, 'helpers.js'));

async function main() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN / GH_TOKEN is required');
  process.env.GH_TOKEN = token;
  process.env.GITHUB_TOKEN = token;

  const repoFull = process.env.GITHUB_REPOSITORY;
  if (!repoFull || !repoFull.includes('/')) {
    throw new Error('GITHUB_REPOSITORY is required (owner/repo)');
  }
  const [owner, repo] = repoFull.split('/');
  const pullNumber = Number(process.env.PR_NUMBER);
  if (!Number.isFinite(pullNumber) || pullNumber <= 0) {
    throw new Error('PR_NUMBER is required');
  }
  const headSha = process.env.PR_HEAD_SHA;
  if (!headSha) throw new Error('PR_HEAD_SHA is required');
  const runUrl = process.env.RUN_URL || '';

  const comment = (body) => H.createComment(owner, repo, pullNumber, body, runUrl);

  console.log(`Triage PR #${pullNumber} @ ${headSha}`);

  // ── 1. Scope: only friend-link file ops ──────────────────────
  const files = H.listPrFiles(owner, repo, pullNumber);
  if (!files.length) {
    await safeComment(comment, 'PR 没有任何文件变更。');
    process.exit(0);
  }

  const nonFriends = files.filter((f) => !f.filename.startsWith(H.FRIENDS_DIR));
  if (nonFriends.length) {
    // Not a friend-only PR — skip silently so normal PRs are unaffected.
    console.log(
      'Not a friends-only PR; skipping auto triage. Other paths:',
      nonFriends.map((f) => f.filename).join(', ')
    );
    process.exit(0);
  }

  H.setLabels(owner, repo, pullNumber, { add: [H.LABELS.FRIEND] });

  if (files.length !== 1) {
    await safeComment(
      comment,
      [
        '自动审批要求 **每个 PR 只新增 1 个** 友链文件。',
        '',
        `当前变更了 ${files.length} 个文件：`,
        ...files.map((f) => `- \`${f.filename}\` (${f.status})`),
        '',
        H.instructionsMarkdown(),
      ].join('\n')
    );
    process.exit(0);
  }

  const file = files[0];
  const baseName = file.filename.slice(H.FRIENDS_DIR.length);
  if (!baseName || baseName.includes('/')) {
    await safeComment(comment, `不允许的路径：\`${file.filename}\`（请直接放在 \`${H.FRIENDS_DIR}\` 下）。`);
    process.exit(0);
  }
  if (H.FORBIDDEN_FILES.has(baseName)) {
    await safeComment(comment, `不允许修改 \`${file.filename}\`。`);
    process.exit(0);
  }
  if (!baseName.endsWith('.md')) {
    await safeComment(comment, `友链文件必须以 \`.md\` 结尾：\`${file.filename}\`。`);
    process.exit(0);
  }
  if (file.status !== 'added') {
    await safeComment(
      comment,
      [
        `当前变更类型为 \`${file.status}\`，自动审批 **仅支持新增** 友链。`,
        '',
        '编辑或删除已有友链请联系站长手动处理。',
      ].join('\n')
    );
    process.exit(0);
  }

  // ── 2. Parse & validate front matter ─────────────────────────
  let raw;
  try {
    raw = H.getFileContent(owner, repo, file.filename, headSha);
  } catch (e) {
    await safeComment(comment, `无法读取 PR 文件内容：${e.message || e}`);
    process.exit(0);
  }

  const parsed = H.parseFrontMatter(raw);
  if (!parsed.ok) {
    await safeComment(
      comment,
      [`友链文件格式错误：${parsed.error}`, '', H.instructionsMarkdown()].join('\n')
    );
    process.exit(0);
  }

  const validateErr = H.validateFriendEntry(parsed.data, file.filename);
  if (validateErr) {
    await safeComment(comment, [`数据校验失败：`, '', validateErr, '', H.instructionsMarkdown()].join('\n'));
    process.exit(0);
  }

  const siteUrl = H.normalizeUrl(parsed.data.externalUrl);
  const backlinkUrl = H.normalizeUrl(parsed.data.backlink);
  const selfBase = H.SITE_BASE.replace(/\/$/, '');

  if (H.hostOf(siteUrl) === H.hostOf(H.SITE_BASE)) {
    await safeComment(comment, 'externalUrl 不能指向本站，请填写你自己的网站。');
    process.exit(0);
  }
  if (H.hostOf(backlinkUrl) === H.hostOf(H.SITE_BASE)) {
    await safeComment(comment, 'backlink 不能指向本站，请填写你自己网站的友链页。');
    process.exit(0);
  }
  if (H.hostOf(siteUrl) !== H.hostOf(backlinkUrl)) {
    await safeComment(
      comment,
      [
        '双向链接验证失败：backlink 的主域名必须与 externalUrl 一致。',
        '',
        `- externalUrl：${siteUrl}`,
        `- backlink：${backlinkUrl}`,
      ].join('\n')
    );
    process.exit(0);
  }

  // ── 3. Site reachability ─────────────────────────────────────
  console.log('Checking site:', siteUrl);
  const siteCheck = H.checkUrlReachability(siteUrl);
  if (!siteCheck.ok) {
    H.setLabels(owner, repo, pullNumber, {
      add: [H.LABELS.SITE_BAD],
      remove: [H.LABELS.SITE_OK],
    });
    const reason = siteCheck.status
      ? `HTTP ${siteCheck.status}`
      : siteCheck.error || '未知错误';
    await safeComment(
      comment,
      [
        '网站可达性检测未通过：',
        '',
        `- externalUrl：${siteUrl}（${reason}）`,
        '',
        '请确认链接可正常访问后 push 更新。',
      ].join('\n')
    );
    process.exit(0);
  }
  H.setLabels(owner, repo, pullNumber, {
    add: [H.LABELS.SITE_OK],
    remove: [H.LABELS.SITE_BAD],
  });

  // ── 4. Backlink fetch + verify ───────────────────────────────
  console.log('Checking backlink:', backlinkUrl);
  const backlinkCheck = H.checkUrlReachability(backlinkUrl);
  if (!backlinkCheck.ok) {
    H.setLabels(owner, repo, pullNumber, {
      add: [H.LABELS.BIDIR],
      remove: [H.LABELS.BIDIR_OK],
    });
    const reason = backlinkCheck.status
      ? `HTTP ${backlinkCheck.status}`
      : backlinkCheck.error || '未知错误';
    await safeComment(
      comment,
      [
        `双向链接验证失败：无法访问 backlink（${reason}）。`,
        '',
        `- backlink：${backlinkUrl}`,
        H.formatBacklinkDebug({
          finalUrl: backlinkCheck.finalUrl,
          status: backlinkCheck.status,
        }),
      ].join('\n')
    );
    process.exit(0);
  }

  const html = backlinkCheck.body || '';
  const result = H.verifyBacklink(html, selfBase);
  if (!result.found) {
    H.setLabels(owner, repo, pullNumber, {
      add: [H.LABELS.BIDIR],
      remove: [H.LABELS.BIDIR_OK],
    });
    await safeComment(
      comment,
      [
        '双向链接验证未通过：在 backlink 页面未检测到本站友链。',
        '',
        `需要添加的绝对链接：\`${H.SITE_BASE}\`（或 \`https://chius.cc\`）`,
        `backlink 页面：${backlinkUrl}`,
        '',
        H.formatBacklinkDebug({
          finalUrl: backlinkCheck.finalUrl,
          status: backlinkCheck.status,
          contentType: backlinkCheck.contentType,
          title: H.extractTitle(html),
          foundLinksCount: result.links.length,
          sampleLinks: result.links.slice(0, 5).join(', ') || '（无）',
        }),
        '',
        '请添加后 push 更新（无需评论）。',
      ].join('\n')
    );
    process.exit(0);
  }

  // ── 5. Auto-merge ────────────────────────────────────────────
  H.setLabels(owner, repo, pullNumber, {
    add: [H.LABELS.BIDIR_OK, H.LABELS.AUTO_MERGED],
    remove: [H.LABELS.BIDIR],
  });

  try {
    H.mergePr(owner, repo, pullNumber);
    await safeComment(
      comment,
      [
        '✅ 校验全部通过，已自动合并。',
        '',
        `- 站点：${parsed.data.title}`,
        `- URL：${siteUrl}`,
        `- backlink 匹配：\`${result.matchedHref}\``,
        '',
        '站点将在部署完成后更新友链列表。欢迎互访 🎉',
      ].join('\n')
    );
    console.log('Merged successfully');
  } catch (e) {
    const msg = e?.stderr?.toString?.() || e?.message || String(e);
    await safeComment(
      comment,
      [
        '校验已通过，但自动合并失败：',
        '',
        '```',
        msg.slice(0, 500),
        '```',
        '',
        '请站长手动合并，或检查仓库 Actions 写权限。',
      ].join('\n')
    );
    process.exit(1);
  }
}

function safeComment(commentFn, body) {
  try {
    commentFn(body);
  } catch (e) {
    console.error('createComment failed:', e?.message || e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
