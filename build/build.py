"""Build the reader into one self-contained HTML file.

    python -I build/build.py            (run from the repository root)

Steps, all deterministic (same inputs -> byte-identical outputs):
  1. take the first N paragraphs of data/text.json (extracted from the EPUB),
  2. split them into sentences and mark which sentence breaks fall inside a quotation,
  3. locate every quote of data/scenes.json in the text; fail if a quote is missing,
     ambiguous, crosses a sentence break or overlaps another quote; the last quote of
     each picture becomes its anchor (the picture is placed after it),
  4. check data/explain.json is spoiler-safe (an entry for paragraph n may only
     point to paragraphs 1..n),
  5. ask Node to render every scene once and record its fingerprint, so the app can
     prove on any device that it drew byte-identical pictures,
  6. write index.html (standalone page, also served by GitHub Pages) and dist/reader.html
     (the same page without the document skeleton, for embedding).
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXCERPT = 9  # paragraphs p1..p9


def path(*parts):
    return os.path.join(ROOT, *parts)


def load(*parts):
    with open(path(*parts), encoding="utf-8") as f:
        return json.load(f)


def fail(msg):
    sys.exit("BUILD FAILED: " + msg)


BOUNDARY = re.compile(r"[.!?][”’)]*\s+(?=[A-Z“‘])")
ABBREV = re.compile(r"\b(Mr|Mrs|Dr|St)\.$")


def split_sentences(text):
    sentences, start = [], 0
    for m in BOUNDARY.finditer(text):
        end = m.start() + len(m.group(0).rstrip())
        if ABBREV.search(text[:end]):
            continue
        depth = text[:end].count("“") - text[:end].count("”")
        sentences.append({"a": start, "b": end, "q": depth > 0})
        start = m.end()
    sentences.append({"a": start, "b": len(text), "q": False})
    return sentences


def main():
    book = load("data", "text.json")
    scenes = load("data", "scenes.json")
    explain = load("data", "explain.json")

    paras = book["paragraphs"][:EXCERPT]
    pidx = {p["id"]: i for i, p in enumerate(paras)}
    out_paras = []
    for i, p in enumerate(paras):
        out_paras.append({"id": p["id"], "n": i + 1, "text": p["text"],
                          "sentences": split_sentences(p["text"]), "phrases": []})
    by_id = {p["id"]: p for p in out_paras}

    def sentence_of(p, a, b):
        for si, s in enumerate(p["sentences"]):
            if s["a"] <= a and b <= s["b"]:
                return si
        return None

    figures, seen_paras = [], set()
    for f in scenes["figures"]:
        if f["p"] not in by_id:
            fail(f"{f['id']}: paragraph {f['p']} is outside the excerpt")
        if f["p"] in seen_paras:
            fail(f"{f['id']}: a second picture for {f['p']} (one per paragraph)")
        if f["p"] in scenes["skips"]:
            fail(f"{f['id']}: {f['p']} is also listed as a skip")
        seen_paras.add(f["p"])
        elements = []
        for e in f["elements"]:
            pid = e.get("p", f["p"])
            p = by_id.get(pid)
            if p is None or pidx[pid] > pidx[f["p"]]:
                fail(f"{f['id']}.{e['key']}: may only quote its own or an earlier paragraph")
            count = p["text"].count(e["quote"])
            if count != 1:
                fail(f"{f['id']}.{e['key']}: quote found {count} times in {pid}: {e['quote']!r}")
            a = p["text"].index(e["quote"])
            b = a + len(e["quote"])
            si = sentence_of(p, a, b)
            if si is None:
                fail(f"{f['id']}.{e['key']}: quote crosses a sentence break: {e['quote']!r}")
            for other in p["phrases"]:
                if a < other["b"] and other["a"] < b:
                    fail(f"{f['id']}.{e['key']}: quote overlaps {other['f']}.{other['key']}")
            phrase = {"f": f["id"], "key": e["key"], "a": a, "b": b, "s": si}
            p["phrases"].append(phrase)
            elements.append({"key": e["key"], "p": pid, "quote": e["quote"], "_order": (pidx[pid], a), "_ph": phrase})
        elements.sort(key=lambda e: e["_order"])
        for num, e in enumerate(elements, 1):
            e["n"] = num
            e["_ph"]["n"] = num
            del e["_order"], e["_ph"]
        # The picture follows the last phrase it quotes from its own paragraph.
        own = [e for e in elements if e["p"] == f["p"]]
        if not own:
            fail(f"{f['id']}: must quote at least one phrase from {f['p']}")
        anchor_key = own[-1]["key"]
        a_ph = next(ph for ph in by_id[f["p"]]["phrases"] if ph["f"] == f["id"] and ph["key"] == anchor_key)
        figures.append({"id": f["id"], "p": f["p"], "scene": f["scene"], "title": f["title"],
                        "imagined": bool(f.get("imagined")), "anchor": anchor_key, "anchorSentence": a_ph["s"],
                        "params": f.get("params", {}), "elements": elements})
    for p in out_paras:
        p["phrases"].sort(key=lambda ph: ph["a"])
    figures.sort(key=lambda f: pidx[f["p"]])

    def check_refs(owner, text, label):
        limit = by_id[owner]["n"]
        for ref in re.findall(r"¶(\d+)", text):
            if int(ref) > limit:
                fail(f"{label}: mentions ¶{ref}, later than ¶{limit} (spoiler rule)")

    for pid, reason in scenes["skips"].items():
        if pid not in by_id:
            fail(f"skip {pid} is outside the excerpt")
        check_refs(pid, reason, f"skip {pid}")
    for p in out_paras:
        e = explain.get(p["id"])
        if not e:
            fail(f"no explanation for {p['id']}")
        texts = [e["gist"], e["why"], *e["context"], *(t for pair in e["terms"] for t in pair)]
        for t in texts:
            check_refs(p["id"], t, f"explain {p['id']}")

    bundle = {
        "meta": {"title": "Metamorphosis", "author": "Franz Kafka", "translator": "David Wyllie",
                 "part": book["part"], "excerpt": f"¶1–¶{EXCERPT} of Part I"},
        "paragraphs": out_paras,
        "figures": figures,
        "skips": scenes["skips"],
        "explain": {k: v for k, v in explain.items() if not k.startswith("_")},
    }

    os.makedirs(path("dist"), exist_ok=True)
    tmp = path("dist", ".figures.json")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(figures, f, ensure_ascii=False)
    node = subprocess.run(["node", path("build", "fingerprint.js"), tmp],
                          capture_output=True, text=True, encoding="utf-8")
    os.remove(tmp)
    if node.returncode != 0:
        fail("node could not render the scenes:\n" + node.stderr)
    bundle["fingerprints"] = json.loads(node.stdout)

    def read(*parts):
        with open(path(*parts), encoding="utf-8") as f:
            return f.read()

    data = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    page = (read("src", "template.html")
            .replace("/*{{CSS}}*/", read("src", "reader.css"))
            .replace("{{DATA}}", data)
            .replace("/*{{ART}}*/", read("src", "art.js"))
            .replace("/*{{READER}}*/", read("src", "reader.js")))
    with open(path("dist", "reader.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(page)
    local = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
             '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
             '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
             'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>\n'
             '</head>\n<body>\n' + page + '\n</body>\n</html>\n')
    with open(path("index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(local)

    words = sum(len(p["text"].split()) for p in out_paras)
    phrases = sum(len(p["phrases"]) for p in out_paras)
    print(f"OK  {len(out_paras)} paragraphs, {words} words, {len(figures)} pictures, "
          f"{phrases} grounded phrases, {len(bundle['explain'])} explanations")
    for f in figures:
        print(f"    {f['id']} {f['p']:<3} {f['scene']:<7} {bundle['fingerprints'][f['id']]}  {f['title']}")
    print(f"    dist/reader.html {len(page):,} bytes")


if __name__ == "__main__":
    main()
