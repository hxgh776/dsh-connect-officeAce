# 插件市场上架条目

目标仓库：[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

把下面内容存成 **`data/plugins/hxgh776__dsh-connect-officeAce.yml`** 提 PR，一个文件就是全部投稿（README 由脚本生成，不要手改）。

```yaml
url: https://github.com/hxgh776/dsh-connect-officeAce
name: hxgh776/dsh-connect-officeAce
category: model
description:
  en: Connects a locally signed-in Huawei OfficeAce desktop account to DSH as an OpenAI-compatible provider, reusing the stored login instead of an API key.
  zh: 把本机已登录的华为果办（OfficeAce）账号接入 DSH，复用本机登录态免填 API Key。
```

## 提交前逐条自查（来自 contributing.md）

| 要求 | 状态 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` |
| 根目录有 `cordis.patch.yml` | ✅ |
| 仓库是真实可用的代码，不是占位 | ✅ 69 条单测、E2E 7/7、真机跑通对话 |
| 仓库创建满 **1 天** | ⚠️ 创建于 2026-11-16，**2026-11-17 起重提才满足** |
| `category` 取值合法 | ✅ `model`（模型与账号接入） |
| description 不含未加引号的 `: ` | ✅ |

## 另一种更快的上架路径

市场索引优先收录**已发布到 npm 的插件**（README 说明：index 覆盖 npm 上带确定版本的插件）。若本机有 npm 发布凭据，可以：

```sh
npm publish --access public
```

然后在提交条目时把 `url` 换成 npm 包页面，或保留 GitHub 地址——两种市场都认。

npm 发布需要登录（`npm adduser`），当前机器没有 npm token，所以这一步没做。