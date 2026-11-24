"""Read and edit sim_config.txt without losing comments or layout.

Same syntax as the C++ reader (cpp/src/config.cpp):
    # comment  (also ';', allowed at end of a line)
    [section]
    key = value

Edits change only the value text of a line; alignment and inline comments are
kept. A key missing from its section is inserted, re-using a commented-out
line such as '# v_set = 30' when one exists. Saving is atomic (temporary
file + rename), so the C++ program never reads a half-written file.
"""

from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_COMMENT = re.compile(r"[#;]")
_SECTION = re.compile(r"^\s*\[([^\]]+)\]\s*$")
# commented-out key in the [runtime] style: '# v_set         = 30   # note'
_COMMENTED_KEY = re.compile(r"^\s*[#;]\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")
# choices announced at the start of a comment: '# ice | ev | both (...)'
_CHOICES = re.compile(r"^\s*([\w.]+(?:\s*\|\s*[\w.]+)+)")


@dataclass
class _Line:
    raw: str                      # full text without the trailing newline
    section: str = ""             # section the line belongs to
    key: str | None = None        # set for 'key = value' lines
    value: str | None = None      # value text (stripped)
    comment: str = ""             # inline comment text, without '#'
    header: bool = False          # True for '[section]' lines


@dataclass
class ConfigFile:
    path: Path
    lines: list[_Line] = field(default_factory=list)

    # ------------------------------------------------------------ loading
    @classmethod
    def load(cls, path: str | Path) -> "ConfigFile":
        path = Path(path)
        cfg = cls(path=path)
        cfg._parse(path.read_text(encoding="utf-8"))
        return cfg

    def _parse(self, text: str) -> None:
        self.lines = []
        section = ""
        seen: dict[tuple[str, str], int] = {}
        for n, raw in enumerate(text.splitlines(), start=1):
            m = _COMMENT.search(raw)
            body = raw[: m.start()] if m else raw
            comment = raw[m.start() + 1 :].strip() if m else ""
            stripped = body.strip()

            if not stripped:
                self.lines.append(_Line(raw, section, comment=comment))
                continue
            sm = _SECTION.match(stripped)
            if sm:
                section = sm.group(1).strip()
                self.lines.append(_Line(raw, section, header=True))
                continue
            if "=" not in stripped:
                raise ValueError(f"{self.path}:{n}: expected 'key = value', got {stripped!r}")
            key, value = (s.strip() for s in stripped.split("=", 1))
            if not key or not value:
                raise ValueError(f"{self.path}:{n}: empty key or value")
            if (section, key) in seen:
                raise ValueError(f"{self.path}:{n}: duplicate key '{section}.{key}' "
                                 f"(first at line {seen[(section, key)]})")
            seen[(section, key)] = n
            self.lines.append(_Line(raw, section, key, value, comment))

    # ------------------------------------------------------------ reading
    def sections(self) -> list[str]:
        out: list[str] = []
        for ln in self.lines:
            if ln.section and ln.section not in out:
                out.append(ln.section)
        return out

    def get(self, section: str, key: str, default: str | None = None) -> str | None:
        i = self._find(section, key)
        return self.lines[i].value if i is not None else default

    def has(self, section: str, key: str) -> bool:
        return self._find(section, key) is not None

    def to_dict(self) -> dict[str, dict[str, dict[str, Any]]]:
        """{section: {key: {value, type, comment}}} in file order (for the web form)."""
        out: dict[str, dict[str, dict[str, Any]]] = {}
        for s in self.sections():
            out[s] = {}
        for ln in self.lines:
            if ln.key is None:
                continue
            entry: dict[str, Any] = {
                "value": ln.value,
                "type": infer_type(ln.value or ""),
                "comment": ln.comment,
            }
            m = _CHOICES.match(ln.comment)
            if m:
                entry["type"] = "choice"
                entry["choices"] = [c.strip() for c in m.group(1).split("|")]
            out[ln.section][ln.key] = entry
        return out

    # ------------------------------------------------------------ editing
    def set(self, section: str, key: str, value: Any) -> None:
        text = format_value(value)
        if _COMMENT.search(text) or "\n" in text or not text.strip():
            raise ValueError(f"invalid value for {section}.{key}: {text!r}")

        i = self._find(section, key)
        if i is not None:
            self.lines[i] = self._rewrite(self.lines[i], text)
            return

        sec_range = self._section_range(section)
        if sec_range is None:                       # new section at the end
            if self.lines and self.lines[-1].raw.strip():
                self.lines.append(_Line("", ""))
            self.lines.append(_Line(f"[{section}]", section, header=True))
            self.lines.append(_Line(f"{key} = {text}", section, key, text))
            return

        start, end = sec_range
        # re-use a commented-out line '# key = ...' of this section
        for j in range(start + 1, end):
            ln = self.lines[j]
            m = _COMMENTED_KEY.match(ln.raw)
            if ln.key is None and m and m.group(1) == key:
                uncommented = re.sub(r"^\s*[#;]\s?", "", ln.raw, count=1)
                parsed = ConfigFile(self.path)
                parsed._parse(f"[{section}]\n{uncommented}")
                self.lines[j] = self._rewrite(parsed.lines[1], text)
                return
        # otherwise insert after the last key of the section
        last = start
        for j in range(start + 1, end):
            if self.lines[j].key is not None:
                last = j
        self.lines.insert(last + 1, _Line(f"{key} = {text}", section, key, text))

    def remove(self, section: str, key: str) -> bool:
        """Delete a key line. Returns False if it was not there."""
        i = self._find(section, key)
        if i is None:
            return False
        del self.lines[i]
        return True

    def update(self, changes: dict[str, dict[str, Any]]) -> None:
        """changes = {section: {key: value}}; value None removes the key."""
        for section, kv in changes.items():
            for key, value in kv.items():
                if value is None:
                    self.remove(section, key)
                else:
                    self.set(section, key, value)

    # ------------------------------------------------------------ saving
    def text(self) -> str:
        return "\n".join(ln.raw for ln in self.lines) + "\n"

    def save(self, path: str | Path | None = None) -> None:
        """Atomic write: temporary file in the same folder, then rename."""
        target = Path(path) if path else self.path
        fd, tmp = tempfile.mkstemp(prefix=".tmp_", suffix=".txt", dir=target.parent)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(self.text())
            os.replace(tmp, target)
        except BaseException:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    # ------------------------------------------------------------ internals
    def _find(self, section: str, key: str) -> int | None:
        for i, ln in enumerate(self.lines):
            if ln.key == key and ln.section == section:
                return i
        return None

    def _section_range(self, section: str) -> tuple[int, int] | None:
        """(index of the [section] header, index one past its last line).
        A comment block right before the next header belongs to the next section."""
        start = next((i for i, ln in enumerate(self.lines)
                      if ln.header and ln.section == section), None)
        if start is None:
            return None
        end = next((i for i in range(start + 1, len(self.lines)) if self.lines[i].header),
                   len(self.lines))
        if end < len(self.lines):
            while end - 1 > start and self.lines[end - 1].key is None:
                end -= 1
        return start, end

    @staticmethod
    def _rewrite(ln: _Line, text: str) -> _Line:
        """Replace the value in ln.raw, keeping alignment and the inline comment
        (which stays in its column when the new value fits)."""
        raw = ln.raw
        eq = raw.index("=")
        m = _COMMENT.search(raw, eq)
        region = raw[eq + 1 : m.start() if m else len(raw)]
        lead = region[: len(region) - len(region.lstrip())] or " "
        new_raw = raw[: eq + 1] + lead + text
        if m:
            new_raw += " " * max(1, m.start() - len(new_raw)) + raw[m.start():]
        return _Line(new_raw, ln.section, ln.key, text, ln.comment)


# ---------------------------------------------------------------- helpers
def infer_type(value: str) -> str:
    v = value.strip().lower()
    if v in ("true", "false", "yes", "no", "on", "off"):
        return "bool"
    try:
        float(v)
        return "number"
    except ValueError:
        return "string"


def format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        return repr(value) if value != int(value) or abs(value) >= 1e15 else f"{value:.1f}"
    return str(value).strip()


# ---------------------------------------------------------------- self-test
if __name__ == "__main__":
    import difflib
    import sys

    src = Path(sys.argv[1] if len(sys.argv) > 1 else "sim_config.txt")
    cfg = ConfigFile.load(src)
    original = cfg.text()
    assert original == src.read_text(encoding="utf-8").rstrip("\n") + "\n", "round trip changed text"
    print(f"loaded {src}: {len(cfg.sections())} sections, "
          f"{sum(len(v) for v in cfg.to_dict().values())} keys, round trip OK")

    cfg.update({
        "scenario": {"preset": "S5"},
        "simulation": {"realtime_factor": 2.0},
        "runtime": {"pause": True, "restart_id": 3, "v_set": 25, "leader_accel": -1.5},
        "plot": {"theme": "dark"},          # new section
    })
    cfg.remove("runtime", "stop")
    diff = difflib.unified_diff(original.splitlines(), cfg.text().splitlines(),
                                "before", "after", lineterm="", n=0)
    print("\n".join(diff))