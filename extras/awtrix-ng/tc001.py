#!/usr/bin/env python3
"""Make the TC001's copy of the app: ShotTimer.tc001.be.

    python3 tc001.py

A TC001 takes a script of 24 KB at the most, shares 96 KB among its scripts, and compiles one
only into memory in one piece as large as its source. So the copy leaves out what the clock does
not need: comments, indentation, the settings' help texts and the header's spaces, and the
16×16 cup it never draws; string literals side by side are joined into one.
Only the Python standard library.
"""
import re


def compact(source):
    out = []
    for line in source.split("\n"):
        if line.startswith("# @"):
            line = re.sub(r' help="[^"]*"', "", line)
            out.append(re.sub(r" {2,}", " ", line))
            continue
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if '"' not in line:
            line = re.sub(r"\s+#\s.*$", "", line)     # a comment after the code
        if line.startswith('"') and out and out[-1].endswith('"') and not out[-1].endswith('",'):
            out[-1] = out[-1][:-1] + line[1:]           # literals side by side are one string
            continue
        out.append(line)
    text = "\n".join(out) + "\n"
    # 8 rows high, the small cup alone.
    text, n = re.subn(r'bytes\(height\(\) <= 8 \?\n("[0-9A-F]+") :\n"[0-9A-F]+"\)', r"bytes(\1)", text)
    assert n == 1, "the two cups are not where they were"
    return text


if __name__ == "__main__":
    source = open("ShotTimer.be", encoding="utf-8").read()
    text = compact(source)
    open("ShotTimer.tc001.be", "w", encoding="utf-8").write(text)
    print(f"ShotTimer.tc001.be: {len(text.encode())} bytes, from {len(source.encode())}")
