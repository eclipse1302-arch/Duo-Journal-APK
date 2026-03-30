"""
Diary Companion Agent v1

A single-turn, stateless emotional response agent.
Reads its personality, behavior rules, response strategies, and style definitions
from agentconfig/ at runtime.
Changing any .md file in agentconfig/ changes the agent's behavior without touching code.

Architecture (from AGENTS.md):
  [Diary Entry] → Language Detection → Emotion Analysis → Response Generation → [Output]
"""

import os
import re
import json
import urllib.request
import urllib.error

# ── LLM backend configuration ──────────────────────────────

MODELSCOPE_API_URL = "https://api-inference.modelscope.cn/v1/chat/completions"
_env_key = os.environ.get("MODELSCOPE_API_KEY", "")
MODELSCOPE_API_KEY = _env_key if _env_key else "ms-6b6c4445-94af-4f2d-b04c-5b45989866aa"
MODEL_ID = os.environ.get("MODEL_ID", "Qwen/Qwen3-8B")

VALID_STYLES = {"Poetic", "Passionate", "Neutral"}


class DiaryCompanionAgent:
    """Diary Companion — reads agentconfig/ and serves emotional responses."""

    def __init__(self, config_dir: str = "agentconfig"):
        self.config_dir = config_dir
        self.config: dict[str, str] = {}
        self._load_config()

    # ── Config loading ──────────────────────────────────────

    def _load_config(self) -> None:
        """Read every .md file in agentconfig/ into self.config keyed by stem."""
        for fname in os.listdir(self.config_dir):
            if fname.endswith(".md"):
                path = os.path.join(self.config_dir, fname)
                with open(path, "r", encoding="utf-8") as f:
                    key = fname.replace(".md", "").lower()
                    self.config[key] = f.read()

    def reload_config(self) -> None:
        """Hot-reload: re-read agentconfig/ and rebuild all prompts."""
        self._load_config()

    # ── Style parsing ───────────────────────────────────────

    def _get_style_instructions(self, style: str) -> str:
        """Extract the section for `style` from STYLES.md content.

        Looks for a heading like ``## Poetic`` and returns everything
        until the next ``## `` heading or end of file.
        """
        styles_md = self.config.get("styles", "")
        if not styles_md:
            return ""

        pattern = rf"## {re.escape(style)}\b(.*?)(?=\n## |\Z)"
        match = re.search(pattern, styles_md, re.DOTALL)
        return match.group(1).strip() if match else ""

    # ── Prompt construction (built per-request for style) ───

    def _build_comment_prompt(self, style: str = "Neutral") -> str:
        """Construct the comment-mode system prompt from config files."""
        soul = self.config.get("soul", "")
        agents = self.config.get("agents", "")
        user = self.config.get("user", "")
        identity = self.config.get("identity", "")
        style_instructions = self._get_style_instructions(style)

        prompt = f"""You are Diary Companion, a warm and sincere emotional companion for a shared journal app.

=== YOUR SOUL ===
{soul}

=== YOUR ARCHITECTURE ===
{agents}

=== WHO YOU TALK TO ===
{user}

=== YOUR IDENTITY ===
{identity}

=== OUTPUT RULES ===
- Detect the diary's primary language. Reply in that same language.
- Output exactly THREE sentences, plain text only, no markdown or formatting.
- Follow the three-part structure: Empathy → Affirmation → Wish/Encouragement.
- Never summarise, repeat, or quote the diary entry.
- Never give advice, diagnoses, or judge right vs wrong.
- If the input is not a diary entry, politely ask for diary content in one sentence."""

        if style_instructions:
            prompt += f"""

=== RESPONSE STYLE: {style} ===
You MUST write your response in the "{style}" style described below.
Follow its tone, phrasing patterns, and constraints strictly.

{style_instructions}"""

        return prompt

    def _build_score_prompt(self, style: str = "Neutral") -> str:
        """Construct the score-mode system prompt from config files."""
        base = self._build_comment_prompt(style)
        return f"""{base}

=== ADDITIONAL: SCORING MODE ===
In addition to the three-sentence comment, assign a mood/day score from 0 to 100.
Scoring rubric:
- Default minimum: 80 (most days deserve recognition).
- 80-84: Challenges present but the person showed up.
- 85-90: Regular day with positive moments.
- 90-95: Good day with clear achievements or happiness.
- 95-100: Exceptional day with major achievements or pure joy.
- Below 80 only for genuinely difficult circumstances.

You MUST respond ONLY with valid JSON, no extra text:
{{"comment": "your three-sentence response", "score": number}}"""

    def _build_chat_prompt(self, style: str = "Neutral") -> str:
        """Construct the multi-turn chat system prompt from config files."""
        soul = self.config.get("soul", "")
        style_instructions = self._get_style_instructions(style)

        prompt = f"""You are Diary Companion, continuing a warm supportive conversation about the user's journal entry.

=== YOUR SOUL ===
{soul}

=== CHAT RULES ===
- Be understanding, encouraging, and helpful.
- Keep responses concise (2-3 sentences).
- Reply in the same language as the user.
- Empathy over advice. Never judge.
- If they ask for advice, gently offer perspective but lead with understanding."""

        if style_instructions:
            prompt += f"""

=== RESPONSE STYLE: {style} ===
Maintain the "{style}" tone in your replies.

{style_instructions}"""

        return prompt

    # ── LLM call ────────────────────────────────────────────

    def _call_llm(self, messages: list[dict]) -> str:
        """Call ModelScope API and return the assistant's text."""
        payload = json.dumps(
            {
                "model": MODEL_ID,
                "messages": messages,
                "temperature": 0.7,
                "max_tokens": 500,
                "enable_thinking": False,
            }
        ).encode()

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MODELSCOPE_API_KEY}",
        }

        req = urllib.request.Request(
            MODELSCOPE_API_URL, data=payload, headers=headers, method="POST"
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            return (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
            )

    def _validate_style(self, style: str) -> str:
        """Return the style if valid, otherwise fall back to Neutral."""
        return style if style in VALID_STYLES else "Neutral"

    # ── Public API ──────────────────────────────────────────

    def generate_comment(self, diary_text: str, style: str = "Neutral") -> dict:
        """Return {"comment": "...", "style": "..."}."""
        style = self._validate_style(style)
        messages = [
            {"role": "system", "content": self._build_comment_prompt(style)},
            {"role": "user", "content": diary_text},
        ]
        text = self._call_llm(messages)
        return {"comment": text, "style": style}

    def generate_comment_with_score(self, diary_text: str, style: str = "Neutral") -> dict:
        """Return {"comment": "...", "score": int, "style": "..."}."""
        style = self._validate_style(style)
        messages = [
            {"role": "system", "content": self._build_score_prompt(style)},
            {"role": "user", "content": diary_text},
        ]
        text = self._call_llm(messages)

        # Try to parse JSON from the response
        try:
            match = re.search(
                r'\{[\s\S]*?"comment"[\s\S]*?"score"[\s\S]*?\}', text
            )
            if match:
                parsed = json.loads(match.group(0))
                score = max(0, min(100, int(parsed.get("score", 85))))
                return {"comment": parsed.get("comment", text), "score": score, "style": style}
        except (json.JSONDecodeError, ValueError, TypeError):
            pass

        return {"comment": text, "score": 85, "style": style}

    def continue_conversation(
        self,
        diary_text: str,
        history: list[dict],
        new_message: str,
        style: str = "Neutral",
    ) -> dict:
        """Return {"reply": "...", "style": "..."}."""
        style = self._validate_style(style)
        messages = [
            {"role": "system", "content": self._build_chat_prompt(style)},
            {"role": "user", "content": f"Context — my journal entry:\n\n{diary_text}"},
            {"role": "assistant", "content": "I've read your entry. I'm here to listen."},
        ]
        for msg in history:
            messages.append(
                {"role": msg.get("role", "user"), "content": msg.get("content", "")}
            )
        messages.append({"role": "user", "content": new_message})

        text = self._call_llm(messages)
        return {"reply": text, "style": style}
