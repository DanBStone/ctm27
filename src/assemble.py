"""Rebuild index.html from the source files: py src/assemble.py"""
from pathlib import Path
src = Path(__file__).parent
root = src.parent
read = lambda name: (src / name).read_text(encoding="utf-8")
out = (read("shell.html")
       .replace("/*FONTS*/", read("fonts.css"))
       .replace("/*SEED*/", read("seed.json"))
       .replace("/*ENGINE*/", read("engine.js"))
       .replace("/*UI*/", read("ui.js")))
(root / "index.html").write_text(out, encoding="utf-8")
print(f"Wrote {root / 'index.html'} ({len(out):,} characters)")
