# Memory

Durable user preferences and reusable facts.

- **称呼：王小二**（2026-10-15 自述，明确要求记住）。直接叫他"王小二"即可。
- 用户与湖南关联密切（国庆曾回湖南，怕冷）。查询天气时若提到"湖南"，应给出长沙、张家界、衡阳等主要城市分城预报，而不是只报一个省值。常用出行区间：杭州东 → 上海。
- 工具环境：内置 `web_search`（Bocha）可用（2026-10 验证）。涉及实时信息（赛程、新闻、价格）应先尝试 web_search，不要直接声称无法联网；沙箱内 curl 出网/DNS 仍不可用。
- 搜索结果需过滤：`*.shtml` 问答/影院聚合类垃圾站常返回过期"新片推荐"（把《星际穿越》《疯狂动物城》当新片），不可引用。
- 执行环境（2026-10 实测）：不是 VM/裸机，而是 **bwrap 沙箱套在 WSL2 里面**。`/` 由 /usr 等 bind 成只读、`/etc` 只暴露白名单文件、仅 `/workspace` + `/tmp` 可写；`/home`、`/mnt/c`、Windows System32 均不存在（无法运行 .exe，binfmt_misc 未挂载）；`CapEff=0`、`NoNewPrivs=1`、无 sudo、无法 apt 装包。Python 3.14 + requests 可用，openai/httpx/langchain 未装。`/workspace` 是 9p 挂载，对应 Windows 路径 `C:\downloads\deepseek-workspace\agent_harness\data\workspace`。
- 沟通偏好：会用"为什么这个是沙箱，不是兼容 Windows 和 Linux 吗"这类追问，期望直接给出机制解释和实测证据，并顺带说明对当前任务的实际影响；不喜欢空泛回答。
- 兴趣/边界：喜欢美女（记着，但不提供跟踪、偷拍素材、搭讪话术类协助）；电影话题只是随口聊聊，**不要主动推荐电影**（2026-10-15 明确表示）。
