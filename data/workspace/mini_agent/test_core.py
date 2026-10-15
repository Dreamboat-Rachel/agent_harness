"""Run this:  python3 -m unittest discover -s mini_agent   (or: python3 mini_agent/test_core.py)"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from core import Agent, Tool, ToolCall, validate_arguments  # noqa: E402
from providers import FakeFailingProvider, ScriptedProvider, act, call  # noqa: E402


def echo_tool(name="echo", requires_approval=False) -> Tool:
    return Tool(
        name=name,
        description="returns the text it was given",
        parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
        fn=lambda text: f"echo:{text}",
        requires_approval=requires_approval,
    )


def boom_tool() -> Tool:
    def _boom(text: str):
        raise ValueError("tool exploded")
    return Tool(name="boom", description="always raises",
                parameters={"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
                fn=_boom)


class ValidationTests(unittest.TestCase):
    def test_accepts_good_call(self):
        self.assertIsNone(validate_arguments(echo_tool(), {"text": "hi"}))

    def test_rejects_non_dict(self):
        self.assertIn("must be an object", validate_arguments(echo_tool(), "hi"))

    def test_rejects_missing_required(self):
        self.assertIn("missing required", validate_arguments(echo_tool(), {}))

    def test_rejects_none_required(self):
        self.assertIn("missing required", validate_arguments(echo_tool(), {"text": None}))

    def test_rejects_wrong_type(self):
        self.assertIn("must be string, got int", validate_arguments(echo_tool(), {"text": 7}))

    def test_rejects_unknown_argument(self):
        self.assertIn("unknown argument", validate_arguments(echo_tool(), {"text": "hi", "tpye": "x"}))

    def test_boolean_is_not_integer(self):
        tool = Tool("n", "d", {"type": "object", "properties": {"n": {"type": "integer"}}, "required": ["n"]},
                    fn=lambda n: n)
        self.assertIn("got boolean", validate_arguments(tool, {"n": True}))


class LoopTests(unittest.TestCase):
    def test_plain_answer_never_calls_tools(self):
        r = Agent(ScriptedProvider([call("done")]), [echo_tool()]).run("hi")
        self.assertEqual((r.stop_reason, r.steps, r.answer), ("final", 1, "done"))

    def test_happy_path_records_observation(self):
        p = ScriptedProvider([act("echo", {"text": "a"}), call("ok")])
        r = Agent(p, [echo_tool()]).run("go")
        self.assertEqual(r.stop_reason, "final")
        self.assertEqual(r.observations, ["echo:a"])

    def test_tool_errors_are_returned_not_raised(self):
        p = ScriptedProvider([act("boom", {"text": "a"}), call("recovered")])
        r = Agent(p, [echo_tool(), boom_tool()]).run("go")
        self.assertEqual(r.trace[0]["type"], "tool_error")
        self.assertIn("ValueError", r.trace[0]["observation"])
        self.assertEqual(r.answer, "recovered")

    def test_unknown_tool_gets_catalog_back(self):
        p = ScriptedProvider([act("nope", {"text": "a"}), call("fine")])
        r = Agent(p, [echo_tool()]).run("go")
        self.assertEqual(r.trace[0]["type"], "tool_unknown")
        self.assertIn("Available: echo", r.trace[0]["observation"])

    def test_loop_guard_stops_third_identical_call(self):
        p = ScriptedProvider([act("echo", {"text": "same"}) for _ in range(5)])
        r = Agent(p, [echo_tool()], max_steps=20).run("go")
        self.assertEqual(r.stop_reason, "loop_detected")
        self.assertEqual(r.steps, 3)

    def test_same_tool_different_args_is_not_a_loop(self):
        p = ScriptedProvider([act("echo", {"text": str(i)}) for i in range(4)] + [call("ok")])
        r = Agent(p, [echo_tool()], max_steps=10).run("go")
        self.assertEqual(r.stop_reason, "final")

    def test_budget_is_enforced(self):
        p = ScriptedProvider([act("echo", {"text": str(i)}) for i in range(30)])
        r = Agent(p, [echo_tool()], max_steps=4).run("go")
        self.assertEqual((r.stop_reason, r.steps), ("max_steps", 4))

    def test_empty_completion_aborts(self):
        p = ScriptedProvider([call("   ")])
        r = Agent(p, [echo_tool()]).run("go")
        self.assertEqual(r.stop_reason, "aborted")

    def test_denied_side_effect_is_not_executed(self):
        calls = []
        tool = Tool("write", "d", {"type": "object", "properties": {"text": {"type": "string"}},
                                   "required": ["text"]}, fn=lambda text: calls.append(text) or "written",
                    requires_approval=True)
        p = ScriptedProvider([act("write", {"text": "x"}), call("skipped")])
        r = Agent(p, [tool], approver=lambda t, a: False).run("go")
        self.assertEqual(r.trace[0]["type"], "tool_denied")
        self.assertEqual(calls, [], "side effect must not run without approval")

    def test_approved_side_effect_runs(self):
        calls = []
        tool = Tool("write", "d", {"type": "object", "properties": {"text": {"type": "string"}},
                                   "required": ["text"]}, fn=lambda text: calls.append(text) or "written",
                    requires_approval=True)
        p = ScriptedProvider([act("write", {"text": "x"}), call("done")])
        Agent(p, [tool], approver=lambda t, a: True).run("go")
        self.assertEqual(calls, ["x"])

    def test_side_effect_needs_explicit_approval_by_default(self):
        calls = []
        tool = Tool("write", "d", {"type": "object", "properties": {"text": {"type": "string"}},
                                   "required": ["text"]}, fn=lambda text: calls.append(text) or "written",
                    requires_approval=True)
        p = ScriptedProvider([act("write", {"text": "x"}), call("nope")])
        r = Agent(p, [tool]).run("go")          # no approver supplied
        self.assertEqual(calls, [])
        self.assertEqual(r.trace[0]["type"], "tool_denied")

    def test_provider_failure_does_not_raise(self):
        p = FakeFailingProvider([act("echo", {"text": "a"}), call("ok")], fail_at=1)
        r = Agent(p, [echo_tool()]).run("go")
        self.assertEqual(r.stop_reason, "provider_error")
        self.assertEqual(r.steps, 2)

    def test_long_observation_is_truncated(self):
        big = Tool("big", "d", {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]},
                   fn=lambda text: "x" * 10_000)
        p = ScriptedProvider([act("big", {"text": "a"}), call("ok")])
        r = Agent(p, [big], observation_limit=100).run("go")
        self.assertTrue(r.observations[0].endswith("[truncated]"))
        self.assertLess(len(r.trace[0]["observation"]), 200)

    def test_trace_is_json_serialisable(self):
        p = ScriptedProvider([act("echo", {"text": "a"}), call("ok")])
        r = Agent(p, [echo_tool()]).run("go")
        self.assertIn("tool_result", r.dump_trace())


if __name__ == "__main__":
    unittest.main(verbosity=2)
