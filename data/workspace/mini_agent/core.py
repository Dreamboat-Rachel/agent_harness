"""A small, dependency-free tool-calling agent loop.

The model is *not* the hard part of an agent. The hard part is everything around
it: deciding what a tool may do, validating what the model asked for, feeding
failures back in a form the model can recover from, and stopping when it clearly
isn't converging. That is what this module implements.

Transcript shape follows the OpenAI chat spec (assistant.tool_calls + role=tool
with tool_call_id) so the same history can be replayed against a real endpoint.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol, Sequence

__all__ = ["Tool", "ToolCall", "Completion", "Agent", "AgentResult", "validate_arguments"]

_TYPE_MAP: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
}


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]          # JSON-schema subset
    fn: Callable[..., Any]
    requires_approval: bool = False     # side-effecting tools opt in

    def signature(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "parameters": self.parameters}


@dataclass(frozen=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]
    call_id: str = ""


@dataclass
class Completion:
    """Normalised model output: talk, or act, or both."""

    content: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)


class Provider(Protocol):
    def complete(self, messages: list[dict[str, Any]], tools: Sequence[dict[str, Any]]) -> Completion: ...


def validate_arguments(tool: Tool, args: Any) -> str | None:
    """Return an error string, or None if the call is well formed.

    Models hallucinate argument names and types constantly. Rejecting locally
    costs one cheap round trip; letting it through costs a broken tool and a
    confusing observation.
    """
    if not isinstance(args, dict):
        return f"arguments must be an object, got {type(args).__name__}"

    props: dict[str, Any] = tool.parameters.get("properties", {})
    required: list[str] = tool.parameters.get("required", [])

    for key in required:
        if key not in args or args[key] is None:
            return f"missing required argument '{key}'"

    for key, value in args.items():
        spec = props.get(key)
        if spec is None:
            known = ", ".join(sorted(props)) or "none"
            return f"unknown argument '{key}' (known: {known})"
        expected = _TYPE_MAP.get(spec.get("type", ""))
        if expected is None:
            continue
        if isinstance(value, bool) and expected is not bool:
            return f"argument '{key}' must be {spec['type']}, got boolean"
        if not isinstance(value, expected):
            return f"argument '{key}' must be {spec['type']}, got {type(value).__name__}"
    return None


def _canonical(name: str, args: dict[str, Any]) -> str:
    return name + "|" + json.dumps(args, sort_keys=True, ensure_ascii=False, default=str)


DEFAULT_SYSTEM_PROMPT = """You are a task agent with access to tools.

Rules:
- Call a tool when you need facts you do not already have.
- Never invent data that a tool could have supplied.
- If a tool call fails, read the error and either fix the arguments, try a
  different tool, or say plainly that you cannot complete the step.
- When you have enough information, answer without calling another tool.
"""


@dataclass
class AgentResult:
    answer: str
    stop_reason: str          # final | max_steps | loop_detected | aborted | provider_error
    steps: int
    trace: list[dict[str, Any]] = field(default_factory=list)
    observations: list[Any] = field(default_factory=list)
    messages: list[dict[str, Any]] = field(default_factory=list)

    def dump_trace(self) -> str:
        return json.dumps(self.trace, ensure_ascii=False, indent=2)


class Agent:
    def __init__(
        self,
        provider: Provider,
        tools: Sequence[Tool],
        *,
        max_steps: int = 8,
        system_prompt: str = DEFAULT_SYSTEM_PROMPT,
        approver: Callable[[Tool, dict[str, Any]], bool] | None = None,
        observation_limit: int = 4000,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.provider = provider
        self.tools = {t.name: t for t in tools}
        self.max_steps = max_steps
        self.system_prompt = system_prompt
        self.approver = approver
        self.observation_limit = observation_limit
        self.sleep = sleep

    # ------------------------------------------------------------------- public
    def run(self, goal: str) -> AgentResult:
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": goal},
        ]
        signatures: dict[str, int] = {}
        trace: list[dict[str, Any]] = []
        observations: list[Any] = []

        for step in range(1, self.max_steps + 1):
            try:
                completion = self.provider.complete(messages, [t.signature() for t in self.tools.values()])
            except Exception as exc:  # transport failure must not crash the caller
                trace.append({"step": step, "type": "provider_error", "error": repr(exc)})
                return AgentResult(f"stopped: provider failed at step {step}: {exc}",
                                   "provider_error", step, trace, observations, messages)

            if completion.tool_calls:
                # One assistant turn carrying every call this step produced,
                # then one role=tool message per result. Keeping ids aligned is
                # what lets a real endpoint continue the conversation at all.
                calls = [
                    {"id": call.call_id or f"call_{step}_{i}", "type": "function",
                     "function": {"name": call.name,
                                  "arguments": json.dumps(call.arguments, ensure_ascii=False, default=str)}}
                    for i, call in enumerate(completion.tool_calls)
                ]
                messages.append({"role": "assistant", "content": completion.content, "tool_calls": calls})

                for call, wire in zip(completion.tool_calls, calls):
                    payload, kind = self._execute(call, step)
                    observations.append(payload)
                    messages.append({"role": "tool", "tool_call_id": wire["id"],
                                     "name": call.name, "content": payload})
                    trace.append({"step": step, "type": kind, "tool": call.name,
                                  "call_id": wire["id"], "arguments": call.arguments,
                                  "observation": payload})

                    key = _canonical(call.name, call.arguments)
                    signatures[key] = signatures.get(key, 0) + 1
                    if signatures[key] >= 3:
                        trace.append({"step": step, "type": "loop_detected", "tool": call.name})
                        return AgentResult(
                            f"stopped: repeated the identical {call.name}() call three times without progress",
                            "loop_detected", step, trace, observations, messages)
                self.sleep(0)  # seam for rate limiting / backoff
                continue

            answer = (completion.content or "").strip()
            if not answer:
                trace.append({"step": step, "type": "empty_completion"})
                return AgentResult("stopped: model returned neither a tool call nor an answer.",
                                   "aborted", step, trace, observations, messages)
            messages.append({"role": "assistant", "content": answer})
            trace.append({"step": step, "type": "final", "answer": answer})
            return AgentResult(answer, "final", step, trace, observations, messages)

        trace.append({"type": "max_steps", "limit": self.max_steps})
        return AgentResult(f"stopped: hit the {self.max_steps}-step budget before converging.",
                           "max_steps", self.max_steps, trace, observations, messages)

    # ------------------------------------------------------------------ private
    def _execute(self, call: ToolCall, step: int) -> tuple[str, str]:
        tool = self.tools.get(call.name)
        if tool is None:
            known = ", ".join(sorted(self.tools))
            return f"ERROR: no tool named '{call.name}'. Available: {known}", "tool_unknown"

        error = validate_arguments(tool, call.arguments)
        if error:
            return f"ERROR: {error} for tool '{call.name}'", "tool_invalid"

        if tool.requires_approval:
            approved = self.approver(tool, call.arguments) if self.approver else False
            if not approved:
                return ("ERROR: user did not approve this action; the side effect was NOT performed. "
                        "Do not retry it; answer without it."), "tool_denied"

        try:
            result = tool.fn(**call.arguments)
        except TypeError as exc:  # signature mismatch validation could not see
            return f"ERROR: bad arguments for '{call.name}': {exc}", "tool_error"
        except Exception as exc:  # noqa: BLE001
            return f"ERROR: '{call.name}' raised {type(exc).__name__}: {exc}", "tool_error"

        text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, default=str)
        if len(text) > self.observation_limit:
            text = text[: self.observation_limit] + "…[truncated]"
        return text, "tool_result"
