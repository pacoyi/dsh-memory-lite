# dsh-memory-lite

**[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的轻量跨会话记忆插件** —— 一个 `memory` 工具（save / recall / list / forget）+ 带**导入向导与导出面板**的设置页"记忆库"卡片，带作用域隔离、写入审批、审计与崩溃安全存储。

[English](README.md) | 中文

## 为什么需要它

dsh 的每个会话都是白纸开局：转录落盘是为了审计，但模型再也看不到它。这个插件给 agent 一个小巧、显式的 `memory` 工具，让那些值得跨会话保留的事实——用户偏好、项目决策、关键约束——在重启、升级、换 profile 之后依然健在。

设计目标（按优先级）：

- **零依赖** —— 只用 Node 内置模块；peerDependencies 仅两个（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`）。
- **人类可读的存储** —— 一切都在 `~/.dsh/memory-lite.json`。可以直接打开、编辑、备份、删除。没有数据库，没有索引。
- **受约束、可检视的效果** —— 作用域可见性、持久写入需审批、逐变更审计日志、模型可见内容的字节与条数预算。

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

## 隐私 —— 存敏感内容前必读

**存储文件在本地；被 recall 的内容不是仅本地的。**

- 插件自身**零网络请求**、无遥测。
- 但 `recall` / `list` 的结果是普通工具结果：会进入模型可见的会话表面、在下一个模型步骤**发送给你配置的模型提供方**，并与其他工具输出一样**持久化进 Session 日志**。
- 因此：**不要**在本存储中存放凭证、API 密钥、客户数据、私有源码或认证材料。把它当作你会粘贴进聊天的内容来对待。
- 每条被 recall 的条目在工具输出中都标注为 *untrusted evidence*（不可信证据）——可能过期的历史数据，永远不是指令来源。

## 作用域与隔离

- 记忆作用域从**宿主执行上下文**（agent 会话的工作目录）派生，绝不来自模型编写的参数。
- `recall` / `list` / `forget` 只能看到当前项目作用域 + 显式存为 `global` 的条目——一个项目读不到也删不掉另一个项目的条目。
- 设置页卡片展示全部作用域（人类主人拥有完整视野），手动记笔记时可选择归属。

## 审批、幂等与审计

- `save` 与 `forget` 请求**宿主审批**（`tools/pre-execute` → ask）。web profile 中会弹出标准审批卡片；未组装审批通道的部署会拒绝这两个操作（fail closed，安全失败）。
- 重放同一工具调用（如会话恢复后）**不会产生重复**条目——save 按调用 id 去重。
- 每次变更以**双相审计**落盘：原子发布前先写一条 `pending` 意图行，发布后再补 `committed` 行。若进程死在两行之间，下次启动的**对账**会把孤儿意图关闭为显式的 `reconciled-applied` / `reconciled-orphan` 记录——审计链能检测并命名崩溃窗口，而不是静默缺失。
- 审计记录在 `~/.dsh/.memory-lite.audit.jsonl`：时间戳、操作、存储版本号（rev）、阶段（phase）、条目 id、作用域、来源（`agent` / `user` / `import`）、结果。
- `forget` 把条目移入**回收站**（可从设置卡片恢复）；永久删除是单独的、需确认的操作。

## 存储耐久性

- 所有变更经单一进程内队列 **+** 跨进程锁（原子 `mkdir` + PID 存活检测 + 陈旧接管）串行化——共享同一 OS home 的两个 host 不会丢写。
- 写入原子发布：临时文件 → fsync → rename，前一代保留为 `.memory-lite.bak`，目录 fsync 尽力而为。
- 损坏的存储被**隔离**（`.memory-lite.corrupt.json`），所有变更**安全失败**——损坏绝不悄悄降级为空库并覆盖你唯一的副本。
- 条目 id 来自持久计数器，**永不复用**。
- 预算：笔记 ≤ 2000 字符、标签 ≤ 8 个 × 32 字符、条目 ≤ 1000 条、文件 ≤ 512 KB、渲染输出 ≤ 16000 字符。

## 使用

正常对话即可——模型自己决定何时存取（审批卡片会先问你）：

> "记住：这个项目用 pnpm，不要用 npm"
> "我之前跟你说过什么关于部署的事？"

工具参数：

| 参数 | 适用操作 | 说明 |
|---|---|---|
| `operation` | 全部 | `save` \| `recall` \| `list` \| `forget` |
| `text` | save | 要记住的内容——自包含、具体，≤ 2000 字符 |
| `tags` | save | 可选标签，如 `["preference", "project-x"]` |
| `query` | recall | 关键字，对文本和标签做大小写不敏感匹配 |
| `tag` | recall | 精确匹配携带该标签的条目 |
| `limit` | list/recall | 返回条数上限（默认 10，最大 100） |
| `id` | forget | 要移入回收站的条目 id |

## 导入向导（从其他 agent 迁移）

设置卡片内置三步向导，用于从其他编码 agent 迁移精选记忆（Claude Code `CLAUDE.md`、Codex `AGENTS.md`，或任意粘贴文本）：

1. **选择源** —— 自动探测常见文件（`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`），或直接粘贴；选择目标作用域。
2. **逐条策展** —— 源文本被切分为候选条目（markdown 列表、标题、段落；代码块跳过）。**规则样文本**（"必须"、"总是"、"must"、"always"…）会被标记且**默认不勾选**——每次必须执行的规则属于 Skill / 工作区指令，不属于语义记忆。你保留全部控制权：逐条编辑、勾选/取消、应用统一标签。
3. **原子提交** —— 一批提交走同一套加锁引擎。勾选动作即人类批准（与手动保存同等地位——导入是一次性人类决策，永远不是模型工具）。

重跑**幂等且冲突敏感**：每条导入条目携带溯源信息（源路径 + 文档/条目 digest）。重导入未变更的源会跳过已有条目；源文件*变更*后再从同路径导入会被**拒绝并报告冲突**——精选事实绝不会被静默覆盖或重复。

### 导出

同一张卡片带**导出**面板：把活跃条目（全库或单个作用域）渲染为纯 markdown 列表——只含内容与标签，不含 id/时间戳——复制到剪贴板。输出可直接粘进其他 agent 的记忆文件；粘回本插件的导入向导则是无操作：内容 digest 让"导出→导入"往返对任何来源的条目（`agent` / 手动 / 导入）都幂等。

## 设置页 UI

web 客户端在**设置页**提供"记忆库"卡片：按作用域分组展示条目（含来源与时间戳）、两击确认删除、回收站视图（恢复 / 永久删除）、以及上述导入向导与导出面板。卡片能做的一切，直接编辑 `~/.dsh/memory-lite.json` 也都能做——但仅限 host 停止时，因为并发写归插件所有。

## 开发

这是一个"双半"（two-half）dsh 插件：

- `index.js` —— **agent 半**：注册 `memory` 工具、审批门、导入向导纯函数（解析 / 规则样分类 / 批次分类）与浏览器 RPC 桥。
- `storage.js` —— 存储引擎：锁、原子发布、双相审计 + 启动对账、损坏隔离、预算、去重、批量导入。
- `client.js` —— **web 半**：由浏览器 module loader 惰性加载，用宿主提供的 React 渲染设置卡片。
- `cordis.patch.yml` —— bundle 层，插入插件行。
- `package.json` —— 在 `dsh` 键下声明 `dsh.bundle`（patch）与 `dsh.client`（inject 列表）。

跑契约测试（并发、崩溃安全、审计对账、损坏、预算、作用域隔离、导入/导出往返幂等——零依赖，`node:test`）：

```sh
npm test
```

最快的开发循环：用 `file:` 把工作目录装进 profile（同上）——修改在 profile 重启后生效。

## 许可证

[MIT](LICENSE) © pacoyi
