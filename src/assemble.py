"""Rebuild index.html from the source files: python3 src/assemble.py"""
from pathlib import Path
src = Path(__file__).parent
root = src.parent
shell = (src / "shell.html").read_text(encoding="utf-8")
out = (shell.replace("/*SEED*/", (src / "seed.json").read_text(encoding="utf-8"))
            .replace("/*ENGINE*/", (src / "engine.js").read_text(encoding="utf-8"))
            .replace("/*UI*/", (src / "ui.js").read_text(encoding="utf-8")))
(root / "index.html").write_text(out, encoding="utf-8")
print(f"Wrote {root / 'index.html'} ({len(out):,} bytes)")
