"""Run this:  python3 mini_agent/demo.py     (no network, no key needed)

Six scenarios, all driven through the real Agent loop. The scripted provider
stands in for a model; everything else - validation, retries, approval,
budgeting, loop detection - is the actual production code path.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core import Agent, AgentResult  # noqa: E402
from providers import ScriptedProvider, act, call  # noqa: E402
from tools import ALL_TOOLS  # noqa: E402


def banner(title: str) -> None:
    print("\n" + "=" * 72)
    print(title)
    print("=" * 72)


def show(result: AgentResult) -> None:
    for row in result.trace:
        kind = row.get("type", "?")
        if kind == "tool_result":
            print(f"  step {row['step']}: {row['tool']}({row['arguments']}) -> ok "
                  f"({len(str(row['observation']))} chars)")
        elif kind in {"tool_invalid", "tool_unknown", "tool_error", "tool_denied"}:
            print(f"  step {row['step']}: {row['tool']} [{kind}] -> {str(row['observation'])[:110]}")
        elif kind == "final":
            print(f"  step {row['step']}: final answer")
        elif kind == "loop_detected":
            print(f"  step {row['step']}: LOOP GUARD tripped on {row['tool']}")
        elif kind == "provider_error":
            print(f"  step {row['step']}: PROVIDER ERROR {row['error']}")
    print(f"\n  stop_reason = {result.stop_reason} | steps = {result.steps}")
    print(f"  answer      = {result.answer}")


# --------------------------------------------------------------------- scenario 1
def s1_multi_tool_trip() -> None:
    banner("1) 正常多工具编排：杭州东→上海，查天气+车票+球场")
    provider = ScriptedProvider([
        act("query_high_speed_rail", {"origin": "hangzhou_east", "destination": "shanghai_hongqiao", "date": "2026-10-20"}),
        act("query_weather", {"city": "shanghai"}),
        act("find_basketball_courts", {"city": "shanghai", "indoor_only": True}),
        call("上海今天阴 21-25 度。G7501 07:12→08:04(52 分,余 12 座)最稳；G1321 余 3 座要抢。"
            "室内球场两家：徐汇 60 元/2h、杨浦 40 元/2h。下雨建议室内。"),
    ])
    show(Agent(provider, ALL_TOOLS, max_steps=8).run("帮我安排去上海：车票、天气、下雨能打的室内球场"))


# --------------------------------------------------------------------- scenario 2
def s2_bad_args_selfheal() -> None:
    banner("2) 模型传错参数：类型错 + 字段名幻觉 -> 本地校验拦下 -> 模型自我纠正")
    provider = ScriptedProvider([
        act("find_basketball_courts", {"city": "shanghai", "indoor_only": "yes"}),          # 类型错：字符串
        act("query_weather", {"City": "shanghai"}),                                          # 字段名幻觉
        act("find_basketball_courts", {"city": "shanghai", "indoor_only": True}),             # 纠正成功
        call("已纠正：室内球场 2 家（徐汇 60/2h、杨浦 40/2h）。"),
    ])
    show(Agent(provider, ALL_TOOLS, max_steps=8).run("找上海的室内球场"))


# --------------------------------------------------------------------- scenario 3
def s3_unknown_tool() -> None:
    banner("3) 模型调用不存在的工具 -> 回灌可用清单，模型改用真实工具")
    provider = ScriptedProvider([
        act("predict_train_tickets", {"from": "hz", "to": "sh"}),
        act("query_high_speed_rail", {"origin": "hangzhou_east", "destination": "shanghai_hongqiao", "date": "2026-10-20"}),
        call("G7501/G7305/G1321 三班，其中 G7305 无票。"),
    ])
    show(Agent(provider, ALL_TOOLS, max_steps=8).run("杭州东到上海虹桥有哪些车"))


# --------------------------------------------------------------------- scenario 4
def s4_approval_gate() -> None:
    banner("4) 副作用工具需要批准：用户拒绝 -> 不执行，且不允许重试")
    provider = ScriptedProvider([
        act("save_memory_note", {"text": "用户常用区间：杭州东→上海，怕冷"}),
        call("没写进长期记忆（未获批准）。答案照常给你：上海 21-25 度阴，建议带薄外套。"),
    ])
    agent = Agent(provider, ALL_TOOLS, max_steps=6, approver=lambda t, a: False)
    result = agent.run("顺便把'我怕冷'记下来，然后告诉我上海天气")
    show(result)


# --------------------------------------------------------------------- scenario 5
def s5_loop_guard() -> None:
    banner("5) 死循环熔断：模型反复发同一个调用 -> 第 3 次强制停机")
    provider = ScriptedProvider([
        act("query_weather", {"city": "changsha"}) for _ in range(6)
    ])
    show(Agent(provider, ALL_TOOLS, max_steps=12).run("长沙天气怎么样"))


# --------------------------------------------------------------------- scenario 6
def s6_budget() -> None:
    banner("6) 步数预算：模型迟迟不收口 -> max_steps 停机，不烧钱")
    provider = ScriptedProvider([
        act("query_weather", {"city": c}) for c in ["hangzhou", "shanghai", "changsha",
                                                     "hangzhou", "shanghai", "changsha"]
    ])
    show(Agent(provider, ALL_TOOLS, max_steps=5).run("把所有城市天气都查一遍再总结"))


if __name__ == "__main__":
    s1_multi_tool_trip()
    s2_bad_args_selfheal()
    s3_unknown_tool()
    s4_approval_gate()
    s5_loop_guard()
    s6_budget()
    print()
