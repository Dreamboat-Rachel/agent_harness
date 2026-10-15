# PenguinHarness Replica

这是一个可独立运行的 PenguinHarness 兼容复刻，用于理解和复现 Agent Harness 的核心运行链路。它不是把官方品牌或源码重新打包成另一个产品。

仓库内同时保留了两套项目：

- 根目录：轻量独立复刻，使用 LangGraph 编排专业记忆流程，适合学习和二次开发。
- `agent_harness/`：Apache-2.0 的官方 `v0.2.13` 完整源码，固定在提交 `691ae72f423581e2be145210a942715c79a667ba`。

## 运行根目录复刻

要求 Node.js 24 或更高版本。命令工具的强隔离在 Windows 上使用 WSL2 + `bubblewrap`，在 Linux 上直接使用原生 `bubblewrap`；缺少它时聊天与文件工具仍可用，但命令工具会拒绝执行。首次运行先安装依赖：

```powershell
npm install
npm start
```

浏览器打开 <http://127.0.0.1:4371>。未配置模型时自动进入演示模式，可直接使用：

```text
读取 测试.txt
写入 notes.txt 一段测试内容
执行命令 ls -la
记住 用户喜欢简洁回答
读取记忆
读取技能 workspace-basics
子代理 分析当前任务
```

默认工具策略是 `always-ask`，写文件、执行命令、修改记忆、子代理和 MCP 调用会出现在右侧“运行”面板等待审批。

## 配置模型

打开控制台右侧的“配置”页签，填写兼容 OpenAI Chat Completions 的接口地址、模型名称和 API Key，点击保存即可立即应用。配置会写入项目根目录的 `.env`，Key 不会通过读取接口回传；`.env` 已加入 Git 忽略规则。

也可以复制 `.env.example` 为 `.env` 后编辑。启动时会读取 `.env`；若同名变量已在进程环境中设置，则进程环境优先。界面保存的配置立即对当前运行实例生效，并在下次启动时继续使用。

可用环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `4371` | HTTP 端口 |
| `PENGUIN_HOME` | `./data` | 数据目录 |
| `PENGUIN_WORKSPACE` | `./data/workspace` | 文件与命令工具的工作区 |
| `TOOL_POLICY` | `always-ask` | `always-ask` 请求批准、`assistant-approve` 助手审查、`allow-all` 直接通过；兼容旧模式 |
| `EMBEDDING_BASE_URL` | 复用 `LLM_BASE_URL` | OpenAI 接口根地址，或 DashScope/千问完整 text-embedding URL |
| `EMBEDDING_API_KEY` | 复用 `LLM_API_KEY` | 独立向量服务密钥；配置接口不会回显 |
| `EMBEDDING_MODEL` | 空 | 向量模型 ID；为空时明确降级为词法检索 |
| `EMBEDDING_DIMENSIONS` | 模型默认 | 可选的向量维度 |
| `EMBEDDING_API_FORMAT` | `auto` | `auto`、`openai` 或 `dashscope` |
| `DASHSCOPE_API_KEY` | 空 | 未设置 `EMBEDDING_API_KEY` 时可作为千问向量密钥 |
| `AMAP_MAPS_API_KEY` | 空 | 高德地图 Web 服务 Key，用于内置 `amap-maps` MCP |
| `BOCHA_API_KEY` | 空 | 博查 Web Search API Key，用于内置 `web_search` 联网查询工具 |
| `SANDBOX_WSL_DISTRO` | `Ubuntu` | 运行 bubblewrap 的 WSL2 发行版 |
| `SANDBOX_NETWORK` | `none` | `none` 隔离网络；显式设为 `allow` 才允许联网 |
| `CONTEXT_CHAR_LIMIT` | `60000` | 触发上下文压缩的近似字符数 |
| `MAX_TURNS` | `20` | 单次任务的最大模型/工具循环数 |
| `MEMORY_AUTO_LEARN` | `true` | 成功回复后自动提取稳定事实；设为 `false` 可关闭 |
| `PENGUIN_ENV_FILE` | `./.env` | 模型配置文件路径，主要用于隔离测试或自定义部署 |

运行面板和配置页都提供三种审批选项：

- 请求批准审批（`always-ask`）：工具调用等待用户确认。
- 帮我批准审批（`assistant-approve`）：助手独立审查工具是否符合当前请求，允许、拒绝或转交人工；未配置模型、审查失败或超时会转人工。审查模型没有工具执行权限。
- 直接审批通过（`allow-all`）：跳过所有工具审批，命令仍受 bubblewrap 沙箱约束；远程 MCP 在各自服务端执行。

切换模式立即作用于待审批操作，并保存至 `.env`。旧的 `workspace-write`、`read-only` 和 `deny-all` 环境配置仍兼容。模型回复通过 SSE 增量显示，阅读旧消息时不会被新内容强行拉回到底部。

## 专业记忆与知识图谱

记忆系统由四层组成：

1. 会话记忆：SQLite 保存完整消息、工具结果和会话状态。
2. 语义记忆：从对话中提取偏好、资料、项目、决策、约束和事实，并按指纹去重。
3. 知识图谱：把主体、对象和关系持久化为实体与边，可跨会话查询。
4. 策展记忆：`memory/MEMORY.md` 保存人工维护、每次请求都会注入的长期说明。

长对话还会生成上下文摘要。语义记忆在每个任务开始前召回，并和知识图谱的相关关系一起注入系统提示。学习与召回流程由真实的 `@langchain/langgraph` 状态图编排：召回依次执行语义检索、图谱扩展和上下文组装；学习依次执行提取、敏感信息校验和持久化。

语义记忆支持两种真实向量接口：OpenAI-compatible `/embeddings`，以及 DashScope/千问的 `input.texts` / `output.embeddings` 协议。千问模式会分别用 `query` 和 `document` 标记检索问题与记忆文档。向量归一化后持久化在 SQLite，并使用余弦相似度与置信度、时效、使用频率进行混排。首次启用向量模型时会为历史事实补建索引；接口故障时明确降级为词法评分，不会伪装成向量命中。

千问接口示例：

```env
EMBEDDING_BASE_URL=https://maas.qianwenaiapi.com/api/v1/services/embeddings/text-embedding/text-embedding
DASHSCOPE_API_KEY=你的密钥
EMBEDDING_MODEL=qwen3.7-text-embedding-flash
EMBEDDING_API_FORMAT=dashscope
EMBEDDING_DIMENSIONS=1024
```

自动学习只处理用户本轮提供的信息，不再将助手回复作为事实来源；自动事实置信度至少为 0.8，关系必须有对应事实支持。同一主体、关系和对象重复出现时合并，即使事实说明文字不同。图谱页可关闭自动学习、逐条删除关系；记忆页删除事实后，仅由该事实支持的关系及孤立节点会隐藏。旧数据保留供手动整理，不自动清空；不同实体别名或不同关系表述仍可能需要人工合并。

## 命令沙箱

`run_command` 不再直接启动宿主 PowerShell。在当前 Windows 部署中，它通过 WSL2 Ubuntu 进入 `bubblewrap`：仅把 `data/workspace` 读写挂载为 `/workspace`，Linux 运行时只读挂载，进程/PID/IPC/UTS 与网络命名空间隔离，HOME 和临时目录使用沙箱内存目录。宿主项目目录、`.env`、用户主目录和凭据目录不会进入挂载视图。沙箱探测失败时命令会 fail-closed，拒绝回退到宿主执行。

命令环境是 Linux Bash，Python 命令使用 `python3`。文件工具另外会解析真实路径并阻止通过符号链接或目录联接越出工作区。MCP 服务是独立执行边界：本地命令沙箱不会自动约束远端 MCP 服务，必须按服务自身部署权限进行隔离。

## Linux 部署

Ubuntu/Debian 可直接部署，不需要 WSL：

```bash
sudo apt update
sudo apt install -y bubblewrap
cp .env.example .env
npm install
npm start
```

服务仍默认只监听 `127.0.0.1:4371`。需要通过反向代理开放时，建议保持本进程监听本机地址，由 Nginx/Caddy 负责 HTTPS 和访问控制。Linux 内核必须允许非特权用户命名空间；若 `bubblewrap` 探测失败，命令工具会保持关闭，而不会在宿主 Shell 中执行。

模型可调用三个记忆工具：`search_memory`、`remember_fact` 和 `query_knowledge_graph`。管理接口包括：

- `GET /api/memory`、`GET /api/memory/stats`
- `POST /api/memory/facts`、`DELETE /api/memory/facts/:id`
- `GET /api/knowledge-graph`
- `DELETE /api/knowledge-graph/relations/:id`
- `GET /api/config/runtime`、`PUT /api/config/runtime`（审批模式与自动学习开关）

## 已实现能力

- SQLite 会话、消息、摘要、子代理和定时任务持久化
- JSONL 事件账本以及旧 Trace 自动导入
- SSE 实时消息、状态、审批和子代理事件
- OpenAI-compatible 模型调用、SSE 流式输出与流式工具调用参数组装
- 并行工具调用、三种界面审批模式及旧策略兼容
- 真实向量检索、SQLite 向量持久化、自动回填和显式词法降级
- Windows WSL2 / Linux 原生 bubblewrap 命令沙箱：工作区单独挂载、默认禁网、不可用时 fail-closed
- 真实路径校验的读文件、写文件工具，阻断符号链接逃逸
- 可停止运行中的命令与等待审批的任务
- 长期 Markdown 记忆和本地 `SKILL.md` 技能
- LangGraph 编排的语义记忆、自动学习与任务级召回
- 本地 SQLite 知识图谱、事实去重、敏感信息拦截和可视化查询
- 独立子代理上下文与结果持久化
- 自动上下文摘要，保留完整的工具调用/结果组
- SQLite 定时任务调度
- HTTP/SSE MCP 的发现与调用
- 博查 Web Search 联网查询，支持摘要、时间范围和结果数量参数
- 响应式 Web 控制台：会话、审批、模型 `.env` 配置、记忆、技能、子代理、定时任务和 MCP 状态

## 数据目录

```text
data/
  harness.db             SQLite 主数据
  traces/*.jsonl         追加式事件记录
  memory/MEMORY.md       长期记忆
  skills/*/SKILL.md      本地技能
  mcp.json               MCP 服务配置
  workspace/             Agent 文件与命令工作区
```

MCP 配置示例：

```json
{
  "servers": [
    {
      "name": "example",
      "url": "http://127.0.0.1:9000/mcp",
      "headers": { "authorization": "Bearer token" },
      "enabled": true
    }
  ]
}
```

项目已内置高德地图 Streamable HTTP MCP 模板，Key 不写入 `data/mcp.json`，而是从 `.env` 的 `AMAP_MAPS_API_KEY` 注入：

```json
{
  "name": "amap-maps",
  "url": "https://mcp.amap.com/mcp?key={{AMAP_MAPS_API_KEY}}",
  "enabled": true
}
```

也可以直接在配置页填写“高德地图 MCP Key”。保存后会完成 MCP 初始化、会话 ID 维护和工具发现。高德地图 MCP 可向模型提供地理编码、逆地理编码、IP 定位、天气、路线规划、距离测量和 POI 搜索等能力。修改其他 MCP 配置后可在界面 MCP 页签点击刷新。当前复刻支持 Streamable HTTP、HTTP JSON 和 SSE 响应，不支持 stdio transport。

联网查询使用内置博查 Web Search 工具。在配置页填写“博查搜索 Key”，或在 `.env` 中设置：

```env
BOCHA_API_KEY=你的博查API密钥
```

模型需要查询实时新闻、比赛赛程、最新网页或报告时会调用 `web_search`。工具支持 `noLimit`、一天、一周、一月和一年五种时间范围，最多返回 50 条结果，并把标题、摘要、发布日期和来源 URL 交给模型引用。

## 验证

```powershell
npm run check
npm test
```

测试覆盖 SQLite 恢复和旧 Trace 迁移、知识库路径校验、LangGraph 记忆编排、模型 `.env` 配置及密钥保护、事实去重、召回排序、知识图谱、敏感信息拦截、会话/记忆/定时任务接口，以及等待审批时停止任务。

## 与官方版的边界

根目录复刻已经覆盖核心 Agent Harness 流程，但不与官方完整版等价。尚未复刻的主要大型子系统包括：

- 多用户认证、项目与 Agent 权限模型
- 运行中 steering、持久化 follow-up 队列和 session fork
- 完整插件安装、Hook 生命周期与热重载内核
- stdio MCP transport
- PTY/WebSocket 交互终端
- benchmark/evaluation 中心
- 完整 token 统计、供应商重试与模型配置中心
- Electron 打包和桌面自动更新

需要官方完整功能时直接运行 `agent_harness/`：

```powershell
cd agent_harness
pnpm install
pnpm dev
```

官方桌面版使用 `pnpm desktop`。该源码要求 Node.js 24 和 pnpm 11。
