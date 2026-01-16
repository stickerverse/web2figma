#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import subprocess
from typing import Optional

from mcp.server.fastmcp import FastMCP


mcp = FastMCP("gemini-cli")


def _resolve_gemini_path() -> str:
    # Prefer explicit override
    override = os.environ.get("GEMINI_CLI_PATH", "").strip()
    if override:
        return override

    # Common locations / PATH lookup
    which = shutil.which("gemini")
    if which:
        return which

    # Last-resort common Homebrew default
    candidate = "/opt/homebrew/bin/gemini"
    if os.path.exists(candidate):
        return candidate

    raise RuntimeError(
        "Gemini CLI not found. Install/configure 'gemini' and ensure it's on PATH, "
        "or set GEMINI_CLI_PATH=/absolute/path/to/gemini."
    )


def _run_gemini(prompt: str, timeout_s: int = 120) -> str:
    gemini_path = _resolve_gemini_path()

    # Gemini CLI typically uses GEMINI_API_KEY from environment.
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in the MCP server environment.")

    # Use a clean-but-complete environment; preserve PATH so subprocess resolves dependencies.
    env = dict(os.environ)
    env["GEMINI_API_KEY"] = api_key
    # If users want to pin behavior, allow optional flags via env
    # e.g. GEMINI_CLI_EXTRA_ARGS="--model gemini-1.5-pro"
    extra_args = env.get("GEMINI_CLI_EXTRA_ARGS", "").strip().split() if env.get("GEMINI_CLI_EXTRA_ARGS") else []

    cmd = [gemini_path, *extra_args, prompt]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=env,
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"Gemini CLI timed out after {timeout_s}s.") from e

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    if proc.returncode != 0:
        msg = "Gemini CLI returned a non-zero exit code."
        if stderr:
            msg += f" Stderr: {stderr}"
        raise RuntimeError(msg)

    # Some Gemini CLI builds print status to stderr; if stdout is empty, surface stderr.
    return stdout if stdout else stderr


@mcp.tool()
def gemini_prompt(prompt: str, timeout_seconds: int = 120) -> str:
    """
    Execute Gemini CLI with the provided prompt and return the response text.

    Args:
      prompt: The prompt to send to Gemini CLI.
      timeout_seconds: Subprocess timeout in seconds.
    """
    prompt = (prompt or "").strip()
    if not prompt:
        raise ValueError("prompt must be a non-empty string")

    # Cap to keep accidental huge prompts from hanging the CLI
    if len(prompt) > 200_000:
        raise ValueError("prompt is too large (>200k chars). Provide a smaller prompt or chunk it.")

    return _run_gemini(prompt, timeout_s=int(timeout_seconds))


if __name__ == "__main__":
    # Stdio transport for Claude Code
    mcp.run()
