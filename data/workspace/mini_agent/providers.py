"""Model adapters.

The loop only ever talks to `Provider.complete(messages, tools) -> Completion`.
Swapping a scripted stub for a real HTTP-backed model is a one-class change,
which is the whole point of keeping the loop model-agnostic.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

from core import Completion, Provider, ToolCall


@dataclass
class ScriptedProvider:
    """Plays back a fixed list of Completions.

    Used for the demo and the tests, so behaviour is reproducible without a
    network or an API key. Any real provider adapter should produce exactly the
    same Completion objects from its own wire format.
    """

    replies: list[Completion]
    calls: int = 0
    label: str = "scripted"

    def complete(self, messages: list[dict[str, Any]], tools: Sequence[dict[str, Any]]) -> Completion:
        if self.calls >= len(self.replies):
            raise RuntimeError(f"{self.label}: ran out of scripted replies after {self.calls} calls")
        reply = self.replies[self.calls]
        self.calls += 1
        return reply


@dataclass
class FakeFailingProvider:
    """Simulates a transport blow-up on a chosen call index."""

    replies: list[Completion]
    fail_at: int
    calls: int = 0

    def complete(self, messages: list[dict[str, Any]], tools: Sequence[dict[str, Any]]) -> Completion:
        idx = self.calls
        self.calls += 1
        if idx == self.fail_at:
            raise ConnectionError("simulated: provider socket closed")
        return self.replies[idx]


def call(content: str | None = None, **_: Any) -> Completion:
    return Completion(content=content)


def act(name: str, args: dict[str, Any]) -> Completion:
    return Completion(tool_calls=[ToolCall(name=name, arguments=args)])


class OpenAICompatProvider:
    """Adapter for any OpenAI-shaped /chat/completions endpoint.

    Deliberately lazy: `requests` is imported inside the method and nothing is
    contacted at construction time. It cannot run in this sandbox (no DNS, no
    key), but shipping the adapter is what proves the loop is not coupled to the
    scripted stub. Fill in base_url/api_key/model and it is live.
    """

    def __init__(self, base_url: str, api_key: str, model: str, timeout: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def complete(self, messages: list[dict[str, Any]], tools: Sequence[dict[str, Any]]) -> Completion:
        import requests  # local import keeps the module importable without the dep

        payload = {
            "model": self.model,
            "messages": messages,
            "tools": [{"type": "function", "function": t} for t in tools],
            "tool_choice": "auto",
        }
        resp = requests.post(
            f"{self.base_url}/chat/completions",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=payload,
            timeout=self.timeout,
        )
        resp.raise_for_status()
        msg = resp.json()["choices"][0]["message"]

        calls = []
        for tc in msg.get("tool_calls") or []:
            raw = tc["function"].get("arguments") or "{}"
            try:
                args = json.loads(raw)
            except json.JSONDecodeError:
                # Malformed JSON is a model error, not a transport error. Hand it
                # to the loop as a bad call so validation can report it back.
                args = {"_malformed_arguments": raw}
            calls.append(ToolCall(name=tc["function"]["name"], arguments=args, call_id=tc.get("id", "")))
        return Completion(content=msg.get("content"), tool_calls=calls)
