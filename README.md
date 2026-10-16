# Agent Harness

Agent Harness 是一款面向个人工作流的 AI 智能体协作应用，支持多模型对话、文件工作区、长期记忆、知识图谱、Skills、MCP 工具连接与定时自动化。Windows x64 桌面安装包可从 [GitHub Releases](https://github.com/Dreamboat-Rachel/agent_harness/releases/latest) 下载。

## 使用文档

### 首次使用

1. 下载并运行 Windows x64 安装包，按提示完成安装后打开 Agent Harness。
2. 进入左侧“模型与设置”，点击“新增模型”，填写模型名称、提供商、服务商给出的模型 ID、OpenAI-compatible API 地址和 API Key，启用后保存。
3. 回到“工作台”，在输入框旁选择刚启用的模型，输入任务并发送。也可以点击输入框左侧的“+”添加文件作为本轮参考资料。

模型 API Key 保存在本机应用数据中，列表不会再次显示已保存的 Key。服务商要求的 API 地址和模型 ID 应以其官方文档为准。

### 工作台与工具审批

- 每条新消息都会作为一个任务在当前会话中运行；左侧会话列表可创建、切换和搜索会话。
- Agent 需要读写工作区、运行命令或调用已连接的工具时，会按当前审批模式处理。默认“请求批准审批”会先等待你确认；在右侧“任务详情”中可以查看工具、参数和执行结果。
- 文件工具和命令工具操作的是 Agent 工作区，不是任意电脑目录。Windows 桌面版的默认工作区是 `%USERPROFILE%\AgentHarnessWorkspace`。
- “直接审批通过”会跳过确认，请只在信任当前模型、工具和任务时使用。命令仍应受沙箱能力状态限制。

### 记忆与知识图谱

- “记忆空间”用于查看和整理长期记忆。长期记忆会作为背景信息加入后续模型请求；结构化记忆可记录偏好、项目事实、决策和约束。
- “知识图谱”展示记忆中实体之间的关系。关闭自动学习后，不会再从新对话自动增加记忆；仍可手动添加。
- 记忆可能包含你主动提供的个人或项目资料。请勿保存密码、API Key 或其他敏感凭证。

### 自动化

1. 打开“自动化”，填写名称和任务描述，写清楚需要重复完成的工作。
2. 设置运行间隔（分钟），例如 `60` 表示每 60 分钟运行一次。
3. 勾选“使用当前会话”会复用当前会话上下文；取消勾选后，任务会在独立会话中运行。
4. 创建后可在任务列表查看下次运行时间，并管理已安排的任务。

自动化执行时仍遵循应用的工具审批策略；需要人工确认的操作可能会等待审批。

### 工具连接与 Skills

- 在“工具连接”下的“MCP 服务”页添加 Streamable HTTP MCP：填写服务名称和服务地址，可选填写身份验证请求头，然后保存并连接。密钥不会在页面中回显。
- 在同页的“Skills”页，可从精选目录安装、导入本机 Skill 文件夹，或提供公开 GitHub Skill 地址。任务匹配时 Agent 会读取已启用 Skill 的说明和参考文件。
- Skill 安装不会自动安装其依赖，也不会跳过工具审批。只安装可信来源的 Skill；第三方 MCP 服务会在服务提供方的环境中执行。

### 模型能力与常见问题

- “模型与设置”中的“能力设置”可以配置向量检索、联网搜索、地图能力、命令联网和审批模式。向量服务是可选项；未配置时仍可使用基础记忆检索。
- Agent 需要用 `curl`、`wget`、`pip` 或 `npm` 下载文件/依赖时，在“能力设置”开启“允许命令联网下载”。默认关闭；开启后，获准的 WSL 命令使用 WSL 自身网络，WSL 本身仍需能访问互联网。下载到 `/workspace` 的文件会保存在 Agent 工作区。
- 回复自称的模型身份不一定可靠。会话消息下方显示应用请求的模型 ID 和接口返回的模型标识，可用它们核对请求信息；这不等同于独立验证服务商的底层部署。
- 如果模型无法连接，先检查 API 地址、模型 ID、API Key 和网络；如果工具列表为空，检查对应 MCP 服务状态及其服务端配置。

### 数据与平台

- 桌面版配置和记忆保存在当前 Windows 用户的 `%APPDATA%\Agent Harness`，工作区位于 `%USERPROFILE%\AgentHarnessWorkspace`。重装或换电脑前，请备份应用数据目录与工作区。
- 不要把 `.env`、模型配置文件、API Key 或真实用户数据提交到 Git，也不要把无登录保护的本地服务直接暴露到公网。
- 当前提供 Windows x64 桌面安装包和 Linux 桌面构建目标；尚未提供原生 iOS 应用。iPhone 不能安装 Windows `.exe`。

## 开发与部署

仓库根目录包含 Agent Harness 桌面端与本地服务源码；`agent_harness/` 目录保留了独立的上游项目源码，日常使用根目录应用时无需进入该目录。

## 项目结构

```text
./                    Agent Harness 应用源码（Web 服务默认端口 4371）
./agent_harness/      独立的上游项目源码
./data/               开发模式运行数据与 Agent 工作区
```

以下命令均在仓库根目录执行。

## 从源码启动 Web 服务

要求 Node.js 24 或更高版本。命令工具的强隔离在 Windows 上使用 WSL2 + `bubblewrap`，在 Linux 上直接使用原生 `bubblewrap`；缺少它时聊天与文件工具仍可用，但命令工具会拒绝执行。首次运行先安装依赖：

```powershell
npm ci
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

默认工具策略是 `always-ask`，写文件、执行命令、修改记忆、子代理和 MCP 调用会出现在右侧“任务详情”面板等待审批。

## Windows 桌面版（EXE）

Electron 桌面版会在本机启动内置服务并自动选择空闲端口，不需要另外打开 PowerShell，也不会占用 Web 版默认的 `4371` 端口。关闭桌面窗口时，内置服务会一同安全退出。

开发调试：

```powershell
npm ci
npm run desktop:dev
```

生成 Windows x64 安装包：

```powershell
npm ci
npm run desktop:pack:win
```

安装包输出到 `desktop-dist/AgentHarness-Setup-<版本>-x64.exe`。安装时可选择目录，并会创建桌面和开始菜单快捷方式。当前安装包未做代码签名，Windows SmartScreen 可能显示“未知发布者”；正式分发时应配置可信代码签名证书。

如果所在网络无法访问 GitHub 的 Electron 构建附件，可在当前 PowerShell 窗口临时使用镜像后重新执行安装或打包：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR='https://npmmirror.com/mirrors/electron-builder-binaries/'
npm ci
npm run desktop:pack:win
```

安装版已经包含 Electron/Node 运行时，最终用户不需要另装 Node.js。`run_command` 的强隔离仍依赖 WSL2 Ubuntu 和 Ubuntu 内的 `bubblewrap`；未安装时对话、记忆、文件、联网和 MCP 功能仍可用，只有命令执行会保持关闭。

桌面版与 Web 版使用独立数据，避免相互覆盖：

| 内容 | Windows 安装版位置 |
| --- | --- |
| 模型列表及模型 Key | `%APPDATA%\Agent Harness\data\models.json` |
| SQLite、记忆、图谱、MCP 及能力设置 | `%APPDATA%\Agent Harness\data` 与 `.env` |
| 运行日志 | `%APPDATA%\Agent Harness\desktop.log` |
| Agent 文件与命令工作区 | `%USERPROFILE%\AgentHarnessWorkspace` |

首次启动后，直接在“模型与设置”中添加模型并填写模型地址、模型 ID 和 Key。需要迁移或备份桌面版时，应同时保存上表中的 `.env`、`data` 和工作区。开发模式为了便于调试会读取仓库根目录 `.env`，但运行数据仍写到当前用户的 Electron 应用目录。

还可用以下命令做打包前验证：

```powershell
npm run desktop:smoke
npm run desktop:unpacked
npm run desktop:smoke:packed
```

第一条命令验证开发模式，第二条生成无需安装的解包目录，第三条直接启动打包后的应用并在 `desktop-dist/desktop-packed-smoke.png` 留下截图。正式生成安装包前应至少执行一次打包版烟雾测试，它能发现运行依赖未被带入安装包的问题。

可用下面的接口确认服务、模型、向量检索、命令沙箱和联网搜索状态：

```powershell
Invoke-RestMethod http://127.0.0.1:4371/api/capabilities
```

## Windows 部署

### 1. 准备环境

- 安装 Node.js 24 或更高版本，并确认 `node --version` 和 `npm --version` 可用。
- 安装 WSL2 与 Ubuntu。尚未安装时，在管理员 PowerShell 中执行 `wsl --install -d Ubuntu`，按 Windows 提示重启并完成 Ubuntu 初始化。
- 在 Ubuntu 中安装命令沙箱：

```bash
sudo apt update
sudo apt install -y bubblewrap
```

Node 服务仍从 Windows PowerShell 启动，不需要把整个项目复制进 WSL。程序只会通过 WSL2 调用 `bubblewrap` 执行 `run_command`。

### 2. 安装与配置

在仓库根目录打开 PowerShell：

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
```

也可以不手动编辑 `.env`，先运行服务，再在“模型与设置”页面中填写模型、向量、高德地图和博查搜索 Key。页面保存后立即生效。

### 3. 启动与验证

```powershell
npm start
```

打开 <http://127.0.0.1:4371>，再检查运行能力：

```powershell
Invoke-RestMethod http://127.0.0.1:4371/api/capabilities
```

其中 `sandbox.available` 应为 `true`。如果为 `false`，聊天和文件工具仍能使用，但命令工具会保持关闭；优先检查 WSL 发行版名称是否与 `SANDBOX_WSL_DISTRO` 一致，以及 Ubuntu 内是否已安装 `bubblewrap`。

前台窗口关闭后服务会停止。需要长期常驻时，可使用 Windows 服务管理器（例如 WinSW/NSSM）托管 `node src/server.mjs`；服务账户必须能访问项目目录、`data` 目录和 `wsl.exe`。当前仓库未内置 Windows 服务安装脚本。

## 配置模型

在桌面版打开“模型与设置”，通过“新增模型”添加一项配置；填写名称、兼容 OpenAI Chat Completions 的接口地址、服务商提供的模型 ID 和 API Key，保存后即可选择使用。桌面版的模型列表与模型 Key 保存在当前用户应用数据目录的 `data/models.json`；从源码启动的 Web 服务使用 `PENGUIN_HOME` 指定的数据目录保存模型列表。旧式单模型环境变量仍可从项目根目录 `.env` 读取。密钥不会通过读取接口回传，`.env` 已加入 Git 忽略规则。

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
| `SANDBOX_NETWORK` | `none` | 命令沙箱网络；可在“模型与设置 → 能力设置”切换，或显式设为 `allow` |
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

`run_command` 不再直接启动宿主 PowerShell。在当前 Windows 部署中，它通过 WSL2 Ubuntu 进入 `bubblewrap`：仅把 `data/workspace` 读写挂载为 `/workspace`，Linux 运行时只读挂载，进程/PID/IPC/UTS 隔离，HOME 和临时目录使用沙箱内存目录。宿主项目目录、`.env`、用户主目录和凭据目录不会进入挂载视图。命令网络默认关闭；在“模型与设置 → 能力设置”启用后，沙箱使用 WSL 的网络，可供获准命令下载文件或依赖，但前提是 WSL 本身能够联网。沙箱探测失败时命令会 fail-closed，拒绝回退到宿主执行。

命令环境是 Linux Bash，Python 命令使用 `python3`。文件工具另外会解析真实路径并阻止通过符号链接或目录联接越出工作区。MCP 服务是独立执行边界：本地命令沙箱不会自动约束远端 MCP 服务，必须按服务自身部署权限进行隔离。

## Linux 部署

Electron 桌面包可在 Linux x64 构建：

```bash
npm ci
npm run desktop:pack:linux
```

输出包含 AppImage 和 deb，桌面版数据默认位于 `${XDG_CONFIG_HOME:-~/.config}/Agent Harness`，工作区位于 `~/AgentHarnessWorkspace`。建议在 Linux 主机或对应 CI Runner 上构建 Linux 包；原生命令沙箱仍需系统安装 `bubblewrap`。下面的部署方式适用于不带桌面窗口、需要长期运行的 Web 服务。

### 1. 前台部署

Ubuntu/Debian 可直接使用原生 `bubblewrap`，不需要 WSL：

先安装 Node.js 24 或更高版本，并用 `node --version` 确认版本。系统自带的 Node.js 如果低于 24，需要改用 NodeSource、nvm 或组织内部的软件源安装新版。

```bash
sudo apt update
sudo apt install -y bubblewrap ca-certificates
cp .env.example .env
npm ci
npm start
```

服务默认只监听 `127.0.0.1:4371`。验证命令：

```bash
curl http://127.0.0.1:4371/api/capabilities
```

Linux 内核必须允许非特权用户命名空间。若 `bubblewrap` 探测失败，命令工具会保持关闭，而不会回退到宿主 Shell。

### 2. 使用 systemd 常驻

生产环境建议把代码放在 `/opt/agent-harness`，把可写数据和 `.env` 放在 `/var/lib/agent-harness`，并使用单独的低权限账户运行。先准备目录和权限：

```bash
sudo useradd --system --create-home --home-dir /var/lib/agent-harness --shell /usr/sbin/nologin agent-harness
sudo mkdir -p /var/lib/agent-harness/data/workspace
sudo cp .env.example /var/lib/agent-harness/.env
sudo chown -R agent-harness:agent-harness /opt/agent-harness /var/lib/agent-harness
cd /opt/agent-harness
sudo -u agent-harness npm ci --omit=dev
```

创建 `/etc/systemd/system/agent-harness.service`：

```ini
[Unit]
Description=Agent Harness
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agent-harness
Group=agent-harness
WorkingDirectory=/opt/agent-harness
Environment=PENGUIN_ENV_FILE=/var/lib/agent-harness/.env
Environment=PENGUIN_HOME=/var/lib/agent-harness/data
Environment=PENGUIN_WORKSPACE=/var/lib/agent-harness/data/workspace
ExecStart=/usr/bin/node src/server.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

确认 `node` 的真实位置是 `/usr/bin/node`；若 `command -v node` 返回其他路径，应同步修改 `ExecStart`。然后启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now agent-harness
sudo systemctl status agent-harness
journalctl -u agent-harness -f
```

### 3. Nginx 反向代理

当前应用没有用户登录和权限认证。不要直接设置 `HOST=0.0.0.0` 后把 `4371` 端口暴露到公网，因为配置、会话、记忆和工具接口都会同时暴露。应保持监听 `127.0.0.1`，在 Nginx/Caddy、VPN 或零信任网关层增加 HTTPS 与访问控制。

Nginx 的核心代理配置如下；SSE 流式输出要求关闭代理缓冲：

```nginx
location / {
    proxy_pass http://127.0.0.1:4371;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

TLS 证书、Basic Auth、VPN 或身份网关需在反向代理层配置。本项目当前不会替代理层鉴权。

### 4. 备份与升级

停止服务后备份 `.env` 和整个 `data` 目录；其中包含数据库、消息、记忆、知识图谱、定时任务、MCP 配置和 Agent 工作区。升级代码后重新安装锁定依赖并启动：

```bash
sudo systemctl stop agent-harness
sudo cp -a /var/lib/agent-harness /var/lib/agent-harness.backup
cd /opt/agent-harness
sudo -u agent-harness npm ci --omit=dev
sudo systemctl start agent-harness
```

Windows 同样应备份根目录 `.env` 与 `data`。不要只备份 `harness.db`，因为长期记忆、技能、Trace、MCP 配置和工作区还包含独立文件。

### 5. 当前部署边界

- 当前服务是单机 Node.js + SQLite 应用，不要让多个进程或多台机器同时共享同一个 `data` 目录。
- 没有内置登录、TLS、限流和多租户隔离；网络开放必须由反向代理、VPN 或身份网关保护。
- `.env` 包含模型、向量、高德和博查密钥，应限制为仅运行账户可读，并且不要提交到版本库。
- 当前应用没有 Dockerfile 或 Compose 部署定义；独立的上游源码子目录自带 Docker 方案。
- macOS 可以启动 Web 服务，但当前命令沙箱依赖 Linux `bubblewrap`，因此 `run_command` 会 fail-closed，不属于完整支持的部署目标。

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
- 响应式 Web 控制台：会话、审批、多模型配置、能力设置、记忆、技能、子代理、定时任务和 MCP 状态
- Electron 桌面外壳、随机内置端口、单实例运行和 Windows/Linux 安装包构建

## 数据目录

```text
data/
  harness.db             SQLite 主数据
  models.json            已配置模型及其 API Key
  traces/*.jsonl         追加式事件记录
  memory/MEMORY.md       长期记忆
  skills/*/SKILL.md      本地技能
  skills/.registry.json  Skill 来源与启停状态
  mcp.json               MCP 服务配置
  workspace/             Agent 文件与命令工作区
```

在“工具连接”页面点击“添加 MCP 服务”，填写名称、HTTP / HTTPS 地址及可选请求头即可保存。页面支持编辑、启用、停用和删除服务，直接写入当前数据目录的 `mcp.json`（默认是 `data/mcp.json`；桌面版使用应用数据目录），保存后立即重新连接，重启后保留。编辑时地址或请求头留空会保留原配置；请求头也可以勾选清除。密钥不会在列表或编辑表单中回显。

同一页面的“Skills”分区用于管理标准 `SKILL.md` 技能包，支持从精选公开目录安装、粘贴公开 GitHub 文件夹链接安装，或导入本机完整 Skill 文件夹。导入会保留 `scripts/`、`references/`、`assets/` 等资源以及二进制文件。启用的 Skill 会出现在 Agent 的能力列表中；任务匹配时 Agent 会先读取其说明，并可通过 `read_skill_file` 读取引用文件。命令沙箱把技能目录只读挂载到 `/skills/<name>`，因此获批的命令也可以使用 Skill 自带脚本。

Skill 安装不会自动安装第三方依赖，也不会改变工具审批规则。停用后 Agent 不再自动读取该 Skill；卸载会先把目录移入本机 `skills/.trash/`，避免直接永久删除。为了避免服务端请求被滥用，从链接安装仅接受公开的 `github.com` 或 `raw.githubusercontent.com` HTTPS 地址。

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

也可以直接在“模型与设置”页填写“高德地图 MCP Key”。保存后会完成 MCP 初始化、会话 ID 维护和工具发现。高德地图 MCP 可向模型提供地理编码、逆地理编码、IP 定位、天气、路线规划、距离测量和 POI 搜索等能力。手动修改 MCP 配置文件后，可在“工具连接”页面点击“重新连接”。当前应用支持 Streamable HTTP、HTTP JSON 和 SSE 响应，不支持 stdio transport。

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

测试覆盖 SQLite 恢复和旧 Trace 迁移、知识库路径校验、LangGraph 记忆编排、向量接口、模型配置及密钥保护、事实去重、召回排序、知识图谱、敏感信息拦截、Markdown 安全渲染、MCP、博查联网查询、bubblewrap 沙箱、会话接口，以及等待审批时停止任务。
