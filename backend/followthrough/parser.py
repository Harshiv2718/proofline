"""A deliberately small, deterministic grammar; this is not an LLM or NLP model."""
import re
from dataclasses import dataclass
from datetime import date

MAX_SUGGESTIONS = 100
ACTION = re.compile(r"^\s*(?:[-*]\s*)?ACTION(?:\s*\[(?P<owner>[^\]\r\n]*)\]|\s*:)(?:\s*)(?P<body>.+?)\s*$")
DECISION = re.compile(r"^\s*(?:[-*]\s*)?DECISION\s*:\s*(?P<title>.+?)\s*$")
DUE = re.compile(r"^(?P<title>.+?)\s*\|\s*due:(?P<due>\S+)\s*$")


class InputError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedSuggestion:
    kind: str
    title: str
    owner: str
    due_date: date | None
    source_line: int
    source_quote: str


def parse_notes(notes: str) -> list[ParsedSuggestion]:
    suggestions = []
    for number, quote in enumerate(notes.splitlines(), start=1):
        action = ACTION.fullmatch(quote)
        decision = DECISION.fullmatch(quote)
        if not action and not decision:
            continue
        owner, due_date = "", None
        if action:
            kind = "ACTION"
            owner = (action.group("owner") or "").strip()
            title = action.group("body").strip()
            due_match = DUE.fullmatch(title)
            if due_match:
                title = due_match.group("title").strip()
                raw_date = due_match.group("due")
                try:
                    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
                        raise ValueError
                    due_date = date.fromisoformat(raw_date)
                except ValueError as exc:
                    raise InputError(f"Line {number}: due date must be a real YYYY-MM-DD date.") from exc
            elif "|" in title:
                raise InputError(f"Line {number}: action metadata must use | due:YYYY-MM-DD.")
        else:
            kind, title = "DECISION", decision.group("title").strip()
        if not title or len(title) > 160:
            raise InputError(f"Line {number}: suggestion title must contain 1–160 characters.")
        if len(owner) > 80:
            raise InputError(f"Line {number}: owner must contain at most 80 characters.")
        suggestions.append(ParsedSuggestion(kind, title, owner, due_date, number, quote))
        if len(suggestions) > MAX_SUGGESTIONS:
            raise InputError("A meeting can contain at most 100 marked suggestions.")
    return suggestions
