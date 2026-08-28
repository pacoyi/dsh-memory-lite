# dsh-memory-lite

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量跨会话记忆插件** —— 一个 `memory` 工具（save / recall / list / forget）+ 设置页"记忆库"卡片，持久化到一个人类可读的 JSON 文件。

[English](README.md) | 中文

## 为什么需要它

dsh 的每个会话都是白纸开局：转录落盘是为了审计，但模型再也看不到它。这个插件给 agent 一个小巧、显式的 `memory` 工具，让那些值得跨会话保留的事实——用户偏好、项目决策、关键约束——在重启、升级、换 profile 之后依然健在。

设计目标（按优先级）：

- **零依赖** —— 只用 Node 内置模块；peerDependencies 仅两个（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`）。
- **人类可读的存储** —— 一切都在 `~/.dsh/memory-lite.json`。可以直接打开、编辑、备份、删除。没有数据库，没有索引。
- **一个工具四个操作** —— 没有模式开关，没有需要学习的配置面。

## 安装

需要 `dsh` CLI。装进某个 profile（如 `web`）：

```sh
dsh plugin --profile web add github:pacoyi/dsh-memory-lite
```

或从本地目录安装：

```sh
git clone https://github.com/pacoyi/dsh-memory-lite.git
dsh plugin --profile web add file:./dsh-memory-lite
```

重启 profile（`dsh --profile web`），`memory` 工具即生效。

## 使用

正常对话即可——模型自己决定何时存取：

> "记住：这个项目用 pnpm，不要用 npm"
> "我之前跟你说过什么关于部署的事？"

工具参数：

| 参数 | 适用操作 | 说明 |
|---|---|---|
| `operation` | 全部 | `save` \| `recall` \| `list` \| `forget` |
| `note` | save | 要记住的内容——自包含、具体 |
| `tags` | save | 可选标签，如 `["preference", "project-x"]` |
| `query` | recall | 关键字，对文本和标签做大小写不敏感匹配 |
| `tag` | recall | 精确匹配携带该标签的条目 |
| `limit` | list/recall | 返回条数上限（默认 10，最大 100） |
| `id` | forget | 要删除的条目 id |

## 设置页 UI

web 客户端在**设置页**提供"记忆库"卡片：浏览最近条目（含时间戳与标签），一键删除任意条目。卡片能做的一切，直接编辑 `~/.dsh/memory-lite.json` 也都能做。

## 数据与隐私

- 存储位置：`~/.dsh/memory-lite.json`（首次 save 时创建）
- 数据不出本机。无遥测、无网络请求。
- 卸载插件或删除该文件——即彻底清除。

## 开发

这是一个"双半"（two-half）dsh 插件：

- `index.js` —— **agent 半**：在 Node 侧注册 `memory` 工具。
- `client.js` —— **web 半**：由浏览器 module loader 惰性加载，用宿主提供的 React 渲染设置卡片。
- `cordis.patch.yml` —— bundle 层，插入插件行。
- `package.json` —— 在 `dsh` 键下声明 `dsh.bundle`（patch）与 `dsh.client`（inject 列表）。

最快的开发循环：用 `file:` 把工作目录装进 profile（同上）——`index.js` 的修改在 profile 重启后生效。

## 许可证

[MIT](LICENSE) © pacoyi
