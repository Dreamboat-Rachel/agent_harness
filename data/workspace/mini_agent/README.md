# mini_agent

一个零依赖、能跑的 tool-calling 智能体内核。**不需要联网、不需要 API key**，直接：

```bash
python3 mini_agent/demo.py         # 六个场景，含失败路径
python3 mini_agent/test_core.py    # 21 个测试
```

## 先说清楚一件事

这台机器**没有出站网络**（`curl` 连 DNS 都解析不了），也没装 `openai/httpx/langchain`。
所以我**没法在这里跑一个真接大模型的智能体**。

`tools.py` 里的车票、天气、球场全是**假数据 fixture**——因为真数据取不到。
把它们写成"实时查询"才是骗人，标注成 fixture 才是诚实的。

真正有价值的部分是 `core.py`：**模型无关的循环本身**。模型换成谁都行，
这一层的代码是一样的。智能体难的地方从来不是调模型，而是模型外面那一圈。

## 结构

```
mini_agent/
├── core.py        # 循环 + 校验 + 批准门 + 熔断   ← 真正的东西
├── providers.py   # ScriptedProvider(测试用) / OpenAICompatProvider(接真模型)
├── tools.py       # 4 个 fixture 工具，演示工具的"形状"
├── demo.py        # 六个场景
└── test_core.py   # 21 个单测
```

`core.py` 约 200 行，只 import 标准库。循环契约只有一个：

```python
class Provider(Protocol):
    def complete(self, messages, tools) -> Completion   # Completion = content | tool_calls
```

## 核心循环干了什么

模型说"我要调工具" → **本地校验参数** → 执行 → **把结果/报错原文塞回对话** → 模型看着报错自我纠正 → 循环，直到它给出最终答案。

四个护栏，每一个都对应智能体真实的翻车方式：

| 护栏 | 不这样做会发生什么 |
|---|---|
| **参数校验**（类型/必填/未知字段） | 模型爱把 `indoor_only: "yes"` 这种错传进来，工具炸了，回一条 500，模型看不懂为什么，再试一次还是炸 |
| **报错回灌**（不抛异常） | 工具异常直接 crash 整个 run。回灌 `ERROR: unknown argument 'tpye' (known: text)` 模型**下一次就改对了**——demo 场景 2/3 就是这个 |
| **副作用批准门** | `requires_approval=True` 的工具，没批准**根本不执行**，且明确告诉模型"别重试"。没给 approver 时默认拒绝，而不是默认放行 |
| **循环熔断 + 步数预算** | 同一个 (工具+参数) 发第 3 次 → 强停。这是模型卡死的典型特征。`max_steps` 兜底，防止无限烧 token |

另外：`observation_limit` 截断超长结果（否则一次工具返回能吃掉整个上下文窗口）；
provider 抛异常被吞掉转成 `stop_reason="provider_error"`，调用方拿到结构化结果而不是 traceback。

## 想接真模型

`providers.py` 里的 `OpenAICompatProvider` 已经写好了，能连任何 OpenAI 形状的端点
（DeepSeek / Moonshot / 智谱 / 本地 Ollama / vLLM）。在有网的机器上：

```python
from core import Agent
from providers import OpenAICompatProvider
from tools import ALL_TOOLS          # 把 fixture 换成真 API 调用

agent = Agent(
    OpenAICompatProvider(base_url="https://.../v1", api_key="sk-...", model="..."),
    ALL_TOOLS, max_steps=8,
    approver=lambda tool, args: input(f"允许执行 {tool.name}？").lower() == "y",
)
print(agent.run("帮我查明天杭州东到上海虹桥的高铁").answer)
```

要换的只有两处：**工具函数体**（fixture → 真 HTTP）和 **provider 构造参数**。
`core.py` 一行不用改。这就是分层的全部意义。

## 已知边界

- 只有单轮线性循环：没有并行工具调用、没有子 agent、没有向量化长期记忆。
- 校验只覆盖 JSON-schema 子集（类型/必填/未知字段），不校验 `enum`、`min/max`、嵌套 `items`。
- `tools.py` 的数据是假的，别当真行程信息用。
