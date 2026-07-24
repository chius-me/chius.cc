---
title: "友情链接"
description: "我的朋友们"
cardView: true
orderByWeight: true
showDate: false
showAuthor: false
showReadingTime: false
showEdit: false
showPagination: false
layoutBackgroundHeaderSpace: false
---

想要交换友链？欢迎提交 [PR](https://github.com/chius-me/chius.cc/pulls)——校验通过后会**自动合并**。

<details>
<summary><strong>查看添加方式（自动审批）</strong></summary>

1. **Fork** 本仓库  
2. 在你的仓库 **`main` 分支**的 `content/friends/` 下**新建一个** Markdown 文件（文件名随意，以 `.md` 结尾）：

```yaml
---
title: "你的站点名称"
externalUrl: "https://example.com"
description: "一句话描述"
backlink: "https://example.com/friends/"
showHero: false
---
```

3. 在你自己的友链页添加本站绝对链接：`https://chius.cc/`（或 `https://chius.cc`）  
4. 提交 **Pull Request**（每个 PR 只新增 1 个友链文件）

### 自动合并条件

| 检查项 | 说明 |
|--------|------|
| 路径 | 仅允许新增 `content/friends/*.md`（不可改 `_index.md`） |
| 字段 | `title`、`externalUrl`、`backlink` 必填 |
| 可达 | `externalUrl` 可正常打开 |
| 双向 | `backlink` 页面含指向本站的 `href=https://chius.cc` |
| 域名 | `backlink` 与 `externalUrl` 主域名一致 |

通过后 Action 会 squash 合并并触发部署；失败原因会写在 PR 评论里，修好后 push 即可重试。

</details>
