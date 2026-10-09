"""Pull the opening paragraphs of Metamorphosis Part I out of the EPUB into data/text.json.

Deterministic: same EPUB in, same paragraph ids out (p1, p2, ...).
Usage: python -I build/extract.py <book.epub> <out.json>
Only the first EXCERPT paragraphs are kept: that is all the app uses.
"""
import html
import json
import re
import sys
import zipfile

EXCERPT = 9
epub_path, out_path = sys.argv[1], sys.argv[2]

with zipfile.ZipFile(epub_path) as z:
    raw = z.read("OEBPS/ch1.xhtml").decode("utf-8")
    colophon = z.read("OEBPS/colophon.xhtml").decode("utf-8")

title_m = re.search(r"<h[12][^>]*>(.*?)</h[12]>", raw, re.S)
heading = re.sub(r"<[^>]+>", "", title_m.group(1)).strip() if title_m else "I"

paras = []
for m in re.finditer(r"<p\b[^>]*>(.*?)</p>", raw, re.S):
    text = re.sub(r"<[^>]+>", "", m.group(1))
    text = html.unescape(re.sub(r"\s+", " ", text)).strip()
    if text:
        paras.append(text)

data = {
    "book": "Metamorphosis",
    "author": "Franz Kafka",
    "translator": "David Wyllie",
    "part": heading,
    "paragraphs": [{"id": f"p{i}", "text": t} for i, t in enumerate(paras[:EXCERPT], 1)],
}

with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)

words = sum(len(p.split()) for p in paras)
print(f"{len(paras)} paragraphs, {words} words, heading={heading!r}")
print("colophon:", re.sub(r"<[^>]+>", " ", colophon).split())
