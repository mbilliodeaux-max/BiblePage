"""Convert the NIV Zondervan Study Bible PDF into the 'NIV html' reader package.

Usage:  python -I -X utf8 converter/build.py [book ids to convert, default: gen]

Stages
  1. Global pass (cached): for every book, find its chapter / annotation / notes headings and
     extract verse text + verse positions.  Powers hover previews and scripture search
     even for books whose full content is not converted yet.
  2. Full conversion of the requested books (intro, scripture, annotations, charts, notes).
  3. Concordance.
  4. Resolve every PDF link to an anchor id (or a fallback into the split PDFs) and write
     the data/*.js files the reader loads on demand.
"""
import os, re, sys, json, html, hashlib, bisect, statistics, time
import fitz

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "The NIV Zondervan Study Bible, - Zondervan (1).pdf")
OUT = os.path.join(ROOT, "NIV html")
SPLIT_DIR = os.path.join(ROOT, "NIV books")
CACHE = os.path.join(ROOT, "converter", "cache")

# id, display name, chapter-heading prefix, chapter count, short abbreviation, aliases for search
BOOKS = [
    ("gen", "Genesis", "Genesis", 50, "Gen", "ge gn"), ("exo", "Exodus", "Exodus", 40, "Exod", "ex exo"),
    ("lev", "Leviticus", "Leviticus", 27, "Lev", "le lv"), ("num", "Numbers", "Numbers", 36, "Num", "nu nm nb"),
    ("deu", "Deuteronomy", "Deuteronomy", 34, "Deut", "dt de"), ("jos", "Joshua", "Joshua", 24, "Josh", "jos jsh"),
    ("jdg", "Judges", "Judges", 21, "Judg", "jdg jg jdgs"), ("rut", "Ruth", "Ruth", 4, "Ruth", "ru rth"),
    ("1sa", "1 Samuel", "1 Samuel", 31, "1 Sam", "1sa 1sm 1s"), ("2sa", "2 Samuel", "2 Samuel", 24, "2 Sam", "2sa 2sm 2s"),
    ("1ki", "1 Kings", "1 Kings", 22, "1 Kgs", "1ki 1kgs 1k"), ("2ki", "2 Kings", "2 Kings", 25, "2 Kgs", "2ki 2kgs 2k"),
    ("1ch", "1 Chronicles", "1 Chronicles", 29, "1 Chr", "1ch 1chr 1chron"), ("2ch", "2 Chronicles", "2 Chronicles", 36, "2 Chr", "2ch 2chr 2chron"),
    ("ezr", "Ezra", "Ezra", 10, "Ezra", "ezr"), ("neh", "Nehemiah", "Nehemiah", 13, "Neh", "ne"),
    ("est", "Esther", "Esther", 10, "Esth", "est es"), ("job", "Job", "Job", 42, "Job", "jb"),
    ("psa", "Psalms", "Psalm", 150, "Ps", "ps psa psalm pss"), ("pro", "Proverbs", "Proverbs", 31, "Prov", "pr prv"),
    ("ecc", "Ecclesiastes", "Ecclesiastes", 12, "Eccl", "ec ecc qoh"), ("sng", "Song of Songs", "Song of Songs", 8, "Song", "ss sos song songofsolomon"),
    ("isa", "Isaiah", "Isaiah", 66, "Isa", "is"), ("jer", "Jeremiah", "Jeremiah", 52, "Jer", "je jr"),
    ("lam", "Lamentations", "Lamentations", 5, "Lam", "la"), ("ezk", "Ezekiel", "Ezekiel", 48, "Ezek", "eze ezk"),
    ("dan", "Daniel", "Daniel", 12, "Dan", "da dn"), ("hos", "Hosea", "Hosea", 14, "Hos", "ho"),
    ("jol", "Joel", "Joel", 3, "Joel", "jl"), ("amo", "Amos", "Amos", 9, "Amos", "am"),
    ("oba", "Obadiah", "Obadiah", 1, "Obad", "ob"), ("jon", "Jonah", "Jonah", 4, "Jonah", "jnh jon"),
    ("mic", "Micah", "Micah", 7, "Mic", "mi"), ("nam", "Nahum", "Nahum", 3, "Nah", "na"),
    ("hab", "Habakkuk", "Habakkuk", 3, "Hab", "hb"), ("zep", "Zephaniah", "Zephaniah", 3, "Zeph", "zep zp"),
    ("hag", "Haggai", "Haggai", 2, "Hag", "hg"), ("zec", "Zechariah", "Zechariah", 14, "Zech", "zec zc"),
    ("mal", "Malachi", "Malachi", 4, "Mal", "ml"), ("mat", "Matthew", "Matthew", 28, "Matt", "mt"),
    ("mrk", "Mark", "Mark", 16, "Mark", "mk mr"), ("luk", "Luke", "Luke", 24, "Luke", "lk"),
    ("jhn", "John", "John", 21, "John", "jn jhn"), ("act", "Acts", "Acts", 28, "Acts", "ac"),
    ("rom", "Romans", "Romans", 16, "Rom", "ro rm"), ("1co", "1 Corinthians", "1 Corinthians", 16, "1 Cor", "1co"),
    ("2co", "2 Corinthians", "2 Corinthians", 13, "2 Cor", "2co"), ("gal", "Galatians", "Galatians", 6, "Gal", "ga"),
    ("eph", "Ephesians", "Ephesians", 6, "Eph", "ep"), ("php", "Philippians", "Philippians", 4, "Phil", "php pp"),
    ("col", "Colossians", "Colossians", 4, "Col", "co"), ("1th", "1 Thessalonians", "1 Thessalonians", 5, "1 Thess", "1th 1thes"),
    ("2th", "2 Thessalonians", "2 Thessalonians", 3, "2 Thess", "2th 2thes"), ("1ti", "1 Timothy", "1 Timothy", 6, "1 Tim", "1ti 1tm"),
    ("2ti", "2 Timothy", "2 Timothy", 4, "2 Tim", "2ti 2tm"), ("tit", "Titus", "Titus", 3, "Titus", "tit ti"),
    ("phm", "Philemon", "Philemon", 1, "Phlm", "phm phlm"), ("heb", "Hebrews", "Hebrews", 13, "Heb", "he"),
    ("jas", "James", "James", 5, "Jas", "jm"), ("1pe", "1 Peter", "1 Peter", 5, "1 Pet", "1pe 1pt 1p"),
    ("2pe", "2 Peter", "2 Peter", 3, "2 Pet", "2pe 2pt 2p"), ("1jn", "1 John", "1 John", 5, "1 John", "1jn 1jo"),
    ("2jn", "2 John", "2 John", 1, "2 John", "2jn 2jo"), ("3jn", "3 John", "3 John", 1, "3 John", "3jn 3jo"),
    ("jud", "Jude", "Jude", 1, "Jude", "jud jd"), ("rev", "Revelation", "Revelation", 22, "Rev", "re rv"),
]
BOOK_BY_NAME = {b[1]: b for b in BOOKS}
BOOK_IDX = {b[0]: i for i, b in enumerate(BOOKS)}

BLUE = 0x0000FF
REF_START = re.compile(r"^\s*(\d+):(\d+)[a-z]?")
RANGE = re.compile(r"(\d+):(\d+)[a-z]?(?:\s*[–—-]\s*(?:(\d+):)?(\d+)[a-z]?)?")


# ----------------------------------------------------------------------------- extraction
class Line:
    __slots__ = ("page", "x0", "y0", "x1", "y1", "runs", "size")

    def __init__(self, page, bbox, runs):
        self.page = page
        self.x0, self.y0, self.x1, self.y1 = bbox
        self.runs = runs
        sizes = [r["size"] for r in runs if r["t"].strip()]
        self.size = max(sizes) if sizes else 0

    @property
    def text(self):
        return "".join(r["t"] for r in self.runs)

    def first(self):
        for r in self.runs:
            if r["t"].strip():
                return r
        return self.runs[0]


def page_links(page):
    out = []
    for l in page.get_links():
        if l["kind"] == fitz.LINK_GOTO and l.get("page", -1) >= 0:
            to = l.get("to") or fitz.Point(0, 0)
            out.append((fitz.Rect(l["from"]), ("goto", l["page"] + 1, float(to.x), float(to.y))))
        elif l["kind"] == fitz.LINK_URI:
            out.append((fitz.Rect(l["from"]), ("uri", l["uri"])))
    return out


def extract_page(doc, pno0, raw=True, images=True):
    """Return list of items (Line or image dict) for 0-based page, sorted top-to-bottom."""
    page = doc[pno0]
    links = page_links(page) if raw else []
    flags = fitz.TEXTFLAGS_DICT if images else (fitz.TEXTFLAGS_DICT & ~fitz.TEXT_PRESERVE_IMAGES)
    d = page.get_text("rawdict" if raw else "dict", flags=flags)
    items = []
    pnum = pno0 + 1
    for b in d["blocks"]:
        if b["type"] == 1:
            x0, y0, x1, y1 = b["bbox"]
            items.append({"img": True, "page": pnum, "bbox": (x0, y0, x1, y1), "data": b["image"], "ext": b["ext"],
                          "w": b["width"], "h": b["height"], "ornament": (y1 - y0) < 25 and (x1 - x0) > 200})
            continue
        for ln in b["lines"]:
            runs = []
            for s in ln["spans"]:
                props = dict(size=round(s["size"], 1), b="Bold" in s["font"], i="Italic" in s["font"],
                             blue=s["color"] == BLUE)
                if raw:
                    for ch in s["chars"]:
                        bb = ch["bbox"]
                        cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
                        li = None
                        for k, (r, _) in enumerate(links):
                            if r.x0 - 0.5 <= cx <= r.x1 + 0.5 and r.y0 - 1 <= cy <= r.y1 + 1:
                                li = k
                                break
                        tgt = links[li][1] if li is not None else None
                        if runs and runs[-1]["_k"] == (id(s), li):
                            runs[-1]["t"] += ch["c"]
                            runs[-1]["x1"] = bb[2]
                        else:
                            runs.append(dict(props, t=ch["c"], link=tgt, _k=(id(s), li), x0=bb[0], x1=bb[2]))
                else:
                    runs.append(dict(props, t=s["text"], link=None, _k=None, x0=s["bbox"][0], x1=s["bbox"][2]))
            if not runs or not "".join(r["t"] for r in runs).strip():
                continue
            items.append(Line(pnum, ln["bbox"], runs))
    items.sort(key=lambda it: (round(it["bbox"][1] if isinstance(it, dict) else it.y0), it["bbox"][0] if isinstance(it, dict) else it.x0))
    return items


def is_line(it):
    return isinstance(it, Line)


# ----------------------------------------------------------------------------- outline helpers
def load_toc(doc):
    toc = [t for t in doc.get_toc() if t[0] == 1]
    secs = []
    for i, (_, title, start) in enumerate(toc):
        end = toc[i + 1][2] - 1 if i + 1 < len(toc) else doc.page_count
        secs.append({"num": i + 1, "title": title, "start": start, "end": end})
    files = {int(f[:3]): f for f in os.listdir(SPLIT_DIR) if f.lower().endswith(".pdf")}
    for s in secs:
        s["file"] = files.get(s["num"])
    return secs


def chapter_heading(line, prefix):
    r = line.first()
    if r["size"] < 19:
        return None
    m = re.match(r"^" + re.escape(prefix) + r"\s+(\d+)\s*$", r["t"].strip())
    return int(m.group(1)) if m else None


# ----------------------------------------------------------------------------- stage 1: global pass
def global_pass(doc, secs):
    path = os.path.join(CACHE, "global.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    os.makedirs(CACHE, exist_ok=True)
    out = {}
    t0 = time.time()
    for bid, name, prefix, nch, abbr, _ in BOOKS:
        sec = next(s for s in secs if s["title"] == name)
        regions = {"intro": [sec["start"], 0]}
        verses, anchors = {}, []
        chapter, verse, buf = None, None, []
        last_line = None

        def flush():
            if chapter is not None and verse is not None and buf:
                key = f"{chapter}:{verse}"
                verses[key] = (verses.get(key, "") + " " + join_text(buf)).strip()

        for p0 in range(sec["start"] - 1, sec["end"]):
            stop = False
            for ln in extract_page(doc, p0, raw=False, images=False):
                r0 = ln.first()
                if r0["size"] >= 19:
                    t = r0["t"].strip()
                    if t.startswith("Annotations for"):
                        flush()
                        regions["ann"] = [ln.page, ln.y0]
                        stop = True
                        break
                    c = chapter_heading(ln, prefix)
                    if c is not None:
                        flush()
                        buf = []
                        if "text" not in regions:
                            regions["text"] = [ln.page, ln.y0]
                        chapter, verse = c, 0
                        anchors.append([ln.page, round(ln.y0, 1), round(ln.x0, 1), f"c-{bid}-{c}"])
                        continue
                if chapter is None or r0["size"] >= 14 or ln.size < 11:
                    continue  # headings, parallel-passage lines
                parts = []
                for r in ln.runs:
                    t = r["t"]
                    if 9.8 <= r["size"] <= 10.6 and t.strip().isdigit():
                        if parts:
                            buf.append("".join(parts))
                            parts = []
                        flush()
                        buf = []
                        verse = int(t.strip())
                        anchors.append([ln.page, round(ln.y0, 1), round(r["x0"], 1), f"v-{bid}-{chapter}-{verse}"])
                    elif r["size"] < 9.8:
                        continue
                    else:
                        parts.append(t)
                if parts:
                    buf.append("".join(parts))
            if stop:
                break
        flush()
        chs = sorted({int(k.split(":")[0]) for k in verses})
        out[bid] = {"regions": regions, "verses": verses, "anchors": anchors}
        print(f"  {bid}: {len(chs)}/{nch} chapters, {len(verses)} verses  ({time.time() - t0:.0f}s)", flush=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return out


def join_text(parts):
    s = ""
    for p in parts:
        p = re.sub(r"\s+", " ", p)
        if not s:
            s = p.strip()
        elif s.endswith(("-", "–", "—", "/")):
            s += p.strip()
        else:
            s += " " + p.strip()
    return s.replace(" ,", ",")


# ----------------------------------------------------------------------------- paragraphs
class Para:
    def __init__(self, line):
        self.lines = [line]
        self.kind = "p"
        self.id = None

    @property
    def x0(self):
        return self.lines[0].x0

    @property
    def runs(self):
        out = []
        for i, ln in enumerate(self.lines):
            if i:
                prev = self.lines[i - 1].text.rstrip()
                if not prev.endswith(("-", "–", "—", "/")):
                    out.append(dict(self.lines[i].runs[0], t=" ", link=None, b=False, i=False, blue=False))
            for k, r in enumerate(ln.runs):
                t = r["t"]
                if k == 0 and i:
                    t = t.lstrip()
                if k == len(ln.runs) - 1:
                    t = t.rstrip() if i < len(self.lines) - 1 else t
                if t:
                    out.append(dict(r, t=t))
        return out

    @property
    def text(self):
        return "".join(r["t"] for r in self.runs)


def region_metrics(lines):
    by_size = {}
    for ln in lines:
        by_size.setdefault(round(ln.size), []).append(ln)
    right, lead = {}, {}
    for sz, lns in by_size.items():
        xs = sorted(l.x1 for l in lns)
        right[sz] = xs[int(len(xs) * 0.95)] if xs else 540
        diffs = [b.y0 - a.y0 for a, b in zip(lns, lns[1:]) if a.page == b.page and 0 < b.y0 - a.y0 < sz * 2]
        lead[sz] = statistics.median(diffs) if diffs else sz * 1.15
    return right, lead


def build_paras(lines, starts_new=None, keep_lines=False):
    """Group lines into paragraphs using short-line / indentation / gap heuristics."""
    right, lead = region_metrics(lines)
    paras, cur = [], None
    for ln in lines:
        brk = cur is None or keep_lines
        if not brk:
            prev = cur.lines[-1]
            sz = round(ln.size)
            first_word = ln.text.strip().split(" ")[0]
            w = len(first_word) * ln.size * 0.5
            short = prev.x1 + w + 4 < right.get(round(prev.size), 540)
            gap = ln.page == prev.page and (ln.y0 - prev.y0) > lead.get(sz, 14) * 1.2
            indent_change = len(cur.lines) >= 2 and abs(ln.x0 - prev.x0) > 3
            size_change = abs(ln.size - prev.size) > 1.5
            brk = short or gap or indent_change or size_change or (starts_new and starts_new(ln))
        if brk:
            cur = Para(ln)
            paras.append(cur)
        else:
            cur.lines.append(ln)
    return paras


# ----------------------------------------------------------------------------- rendering helpers
def esc(t):
    return html.escape(t, quote=False)


class Linker:
    """Resolve raw PDF link targets to anchor ids (or PDF fallbacks)."""

    def __init__(self, secs):
        self.secs = secs
        self.starts = [s["start"] for s in secs]
        self.by_page = {}       # page -> sorted [(y, x, id)]
        self.covered = []       # (start(page,y), end(page,y)) regions fully anchored
        self.unresolved = 0
        self.outside = 0
        self.misses = []

    def add(self, page, y, x, aid):
        if getattr(self, "frozen", False):
            return
        self.by_page.setdefault(page, []).append((y, x, aid))

    def cover(self, start, end):
        self.covered.append((tuple(start), tuple(end)))

    def finalize(self):
        for v in self.by_page.values():
            v.sort()

    def sec_of(self, page):
        return self.secs[bisect.bisect_right(self.starts, page) - 1]

    def pdf(self, page):
        s = self.sec_of(page)
        return f"{s['file']}#page={page - s['start'] + 1}" if s.get("file") else None

    def in_covered(self, page, y):
        return any(a <= (page, y) < b for a, b in self.covered)

    def resolve(self, tgt):
        if tgt[0] == "uri":
            return {"uri": tgt[1]}
        _, page, x, y = tgt
        res = {"pdf": self.pdf(page)}
        cands = self.by_page.get(page, [])
        best = None
        for (ay, ax, aid) in cands:
            if ay <= y + 6:
                if best is None or ay > best[0] + 1.5 or (abs(ay - best[0]) <= 1.5 and ax <= x + 3):
                    best = (ay, ax, aid)
            else:
                break
        if best is None and self.in_covered(page, y):
            for p in range(page - 1, page - 4, -1):
                if self.by_page.get(p):
                    best = self.by_page[p][-1]
                    break
        if best is not None and self.in_covered(page, y):
            res["id"] = best[2]
        elif self.in_covered(page, y):
            self.unresolved += 1
            self.misses.append((page, round(y), "no-anchor"))
        else:
            self.outside += 1   # target lies in content not converted yet -> PDF fallback
        return res


def render_runs(runs, linker, ctx=None, skip=None):
    """Render a list of runs to HTML, merging consecutive runs that share a link target."""
    out = []
    i = 0
    n = len(runs)
    while i < n:
        r = runs[i]
        if skip and skip(r):
            i += 1
            continue
        if r["link"] is not None:
            j = i
            group = []
            while j < n and (runs[j]["link"] == r["link"] or (not runs[j]["t"].strip() and j + 1 < n and runs[j + 1]["link"] == r["link"])):
                group.append(runs[j])
                j += 1
            out.append(render_link(group, r["link"], linker))
            i = j
            continue
        out.append(fmt(r))
        i += 1
    return "".join(out)


def fmt(r):
    t = esc(r["t"])
    if r.get("sup"):
        t = f"<sup>{t}</sup>"
    if r["b"]:
        t = f"<b>{t}</b>"
    if r["i"]:
        t = f"<i>{t}</i>"
    return t


def ref_end(text, start_id):
    """Given link text like '45:7–18' and a start verse id, compute end verse id for previews."""
    if not start_id or not start_id.startswith(("v-", "c-")):
        return None
    parts = start_id.split("-")
    bid = parts[1]
    t = text.replace(" ", " ")
    m = re.search(r"[–—-]\s*(?:(\d+):)?(\d+)\s*$", t)
    if not m:
        return None
    if start_id.startswith("c-"):
        return f"c-{bid}-{m.group(2)}" if not m.group(1) else f"v-{bid}-{m.group(1)}-{m.group(2)}"
    c, v = int(parts[2]), int(parts[3])
    c2 = int(m.group(1)) if m.group(1) else c
    if ":" not in t and not m.group(1):
        # "21–23" after "ver" -> verse range in same chapter
        pass
    return f"v-{bid}-{c2}-{m.group(2)}"


def render_link(group, tgt, linker):
    inner = "".join(fmt(g) for g in group)
    text = "".join(g["t"] for g in group)
    res = linker.resolve(tgt)
    if "uri" in res:
        return f'<a href="{html.escape(res["uri"])}" target="_blank" rel="noopener">{inner}</a>'
    attrs = []
    if "id" in res:
        attrs.append(f'href="#{res["id"]}"')
        end = ref_end(text, res["id"])
        if end:
            attrs.append(f'data-end="{end}"')
    elif res.get("pdf"):
        attrs.append(f'href="#pdf:{html.escape(res["pdf"])}"')
    if res.get("pdf"):
        attrs.append(f'data-pdf="{html.escape(res["pdf"])}"')
    return f'<a {" ".join(attrs)}>{inner}</a>'


# ----------------------------------------------------------------------------- images
class ImageStore:
    def __init__(self, sub):
        self.dir = os.path.join(OUT, "images", sub)
        self.sub = sub
        os.makedirs(self.dir, exist_ok=True)

    def save(self, it):
        h = hashlib.sha1(it["data"]).hexdigest()[:14]
        name = f"{h}.{it['ext']}"
        p = os.path.join(self.dir, name)
        if not os.path.exists(p):
            with open(p, "wb") as f:
                f.write(it["data"])
        return f"images/{self.sub}/{name}"

    def tag(self, it, alt=""):
        src = self.save(it)
        return f'<img src="{src}" width="{it["w"]}" height="{it["h"]}" alt="{html.escape(alt)}" loading="lazy">'


# ----------------------------------------------------------------------------- figures (charts / maps)
TRAILER = re.compile(r"Go to (Charts|Maps|Illustrations) Index")


def split_figures(items):
    """Split an item stream into flow items and figure groups (ornament-delimited)."""
    # Ornaments are dividers only (two adjacent figures share one).  A segment between ornaments is a
    # figure when it contains a terminator line ("Go to … Index" / "Go back to main text"); anything
    # after the terminator belongs to the main flow again.
    def is_term(it):
        return is_line(it) and (TRAILER.search(it.text) or it.text.strip().startswith("Go back to"))

    flow, figs = [], []
    segs, cur = [], {"items": [], "at": None}
    for it in items:
        if isinstance(it, dict) and it["ornament"]:
            segs.append(cur)
            cur = {"items": [], "at": (it["page"], it["bbox"][1], it["bbox"][0])}
            continue
        cur["items"].append(it)
    segs.append(cur)
    for s in segs:
        its = s["items"]
        last = max((k for k, it in enumerate(its) if is_term(it)), default=None)
        if s["at"] is None or last is None:
            flow.extend(its)
            continue
        figs.append({"items": its[:last + 1], "pos": len(flow), "at": s["at"]})
        flow.extend(its[last + 1:])
    return flow, figs


def render_figure(fig, linker, images, fid):
    items = fig["items"]
    kind = "chart"
    title = None
    parts = []
    lines = [it for it in items if is_line(it)]
    trailer = [l for l in lines if TRAILER.search(l.text)]
    if trailer:
        k = TRAILER.search(trailer[0].text).group(1).lower()
        kind = {"charts": "chart", "maps": "map", "illustrations": "illustration"}[k]
    body = [it for it in items if not (is_line(it) and (TRAILER.search(it.text) or it.text.strip().startswith("Go back to")))]
    # title = first large bold line
    for it in body:
        if is_line(it) and it.size >= 14:
            title = it.text.strip()
            break
    # table detection: visual rows made of 2+ column segments
    tbl_lines = [l for l in body if is_line(l) and l.size < 14]
    rows = {}
    for l in tbl_lines:
        key = (l.page, round(l.y0 / 3))
        rows[key] = rows.get(key, 0) + len(split_segments(l))
    multi = [k for k, v in rows.items() if v >= 2]
    table_html, table_set = "", set()
    if len(multi) >= 2:
        ys = sorted(multi)
        first, last = ys[0], ys[-1]
        region = [l for l in tbl_lines if first <= (l.page, round(l.y0 / 3)) <= last
                  or (l.page == last[0] and 0 < l.y0 - last[1] * 3 <= l.size * 1.4)]
        table_html = render_table(region, linker)
        table_set = {id(l) for l in region}
    emitted_table = False
    flow_lines = []

    def flush_flow():
        if flow_lines:
            for p in build_paras(flow_lines):
                cls = "fh" if p.lines[0].size >= 14 else ("small" if p.lines[0].size < 11.5 else "")
                tag = "h4" if cls == "fh" else "p"
                parts.append(f'<{tag} class="{cls}">{render_runs(p.runs, linker)}</{tag}>')
            flow_lines.clear()

    for it in body:
        if is_line(it):
            if id(it) in table_set:
                if not emitted_table:
                    flush_flow()
                    parts.append(table_html)
                    emitted_table = True
                continue
            flow_lines.append(it)
        else:
            flush_flow()
            parts.append(f'<div class="fig-img">{images.tag(it, title or "")}</div>')
    flush_flow()
    if fid in FIG_TITLES:
        title, kind = FIG_TITLES[fid]
    if not title:
        # captioned photo: first sentence of the caption
        cap = next((l for l in body if is_line(l) and l.size < 12), None)
        if cap is not None and any(not is_line(it) for it in body):
            cap_text = " ".join(p.text for p in build_paras([l for l in body if is_line(l)])[:1]).strip()
            first = re.split(r"(?<=[a-z])\.\s|,\s(?:ca\.|c\.)", cap_text)[0].strip().rstrip(".")
            title = first if len(first) <= 80 else first[:77].rsplit(" ", 1)[0] + "…"
            if not trailer:
                kind = "illustration"
    if not title:
        title = {"map": "Map", "chart": "Chart", "illustration": "Illustration"}[kind]
    return {"id": fid, "kind": kind, "title": smart_title(title), "html": "".join(parts)}


FIG_TITLES = {}


def harvest_figure_titles(doc, secs, linker):
    """The Maps / Charts / Illustrations indexes link to every figure; use their wording as titles."""
    kinds = {"Maps Index": "map", "Charts Index": "chart", "Illustrations Index": "illustration"}
    for s in secs:
        if s["title"] not in kinds:
            continue
        for p0 in range(s["start"] - 1, s["end"]):
            for ln in extract_page(doc, p0, raw=True, images=False):
                groups = {}
                for r in ln.runs:
                    if r["link"] is not None:
                        groups.setdefault(r["link"], []).append(r["t"])
                for tgt, parts in groups.items():
                    res = linker.resolve(tgt)
                    if re.match(r"f-|s-\d{3}-f\d", res.get("id", "")):
                        FIG_TITLES.setdefault(res["id"], (" ".join("".join(parts).split()), kinds[s["title"]]))


def split_segments(line, gap=10):
    """Split a PDF line into column segments wherever the horizontal gap between words is large."""
    segs, cur, last_x1 = [], [], None
    for r in line.runs:
        if r["t"].strip() and last_x1 is not None and r["x0"] - last_x1 > gap and cur:
            segs.append(cur)
            cur = []
        cur.append(r)
        if r["t"].strip():
            last_x1 = r["x1"]
    if cur:
        segs.append(cur)
    out = []
    for runs in segs:
        while runs and not runs[0]["t"].strip():
            runs = runs[1:]
        while runs and not runs[-1]["t"].strip():
            runs = runs[:-1]
        if runs:
            out.append({"page": line.page, "y": line.y0, "x": runs[0]["x0"], "runs": runs})
    return out


def render_table(lines, linker):
    segs = [s for l in lines for s in split_segments(l)]
    xs = sorted({round(s["x"]) for s in segs})
    cols = []
    for x in xs:
        if not cols or x - cols[-1] > 12:
            cols.append(x)
    # split a segment again wherever a word starts exactly on another column's left edge
    resplit = []
    for s in segs:
        cur = []
        for r in s["runs"]:
            if cur and r["t"].strip() and any(abs(r["x0"] - c) < 3 for c in cols) and abs(r["x0"] - cur[0]["x0"]) > 3:
                resplit.append(dict(s, x=cur[0]["x0"], runs=cur))
                cur = []
            if cur or r["t"].strip():
                cur.append(r)
        if cur:
            resplit.append(dict(s, x=cur[0]["x0"], runs=cur))
    segs = [dict(s, runs=[r for r in s["runs"]]) for s in resplit]
    lh = statistics.median([l.y1 - l.y0 for l in lines]) if lines else 12

    def col_of(x):
        cand = [i for i, c in enumerate(cols) if c <= x + 4]
        return cand[-1] if cand else 0

    # group segments into visual rows (same y)
    groups = []
    for s in sorted(segs, key=lambda s: (s["page"], s["y"], s["x"])):
        if groups and groups[-1][0]["page"] == s["page"] and abs(groups[-1][0]["y"] - s["y"]) < 2:
            groups[-1].append(s)
        else:
            groups.append([s])
    rows = []  # each: {col: [segments]}, plus last y per column
    for g in groups:
        cont = False
        if rows and len(g) == 1:
            ci = col_of(g[0]["x"])
            prev = rows[-1]["_last"].get(ci)
            if prev and prev[0] == g[0]["page"] and 0 < g[0]["y"] - prev[1] <= lh * 1.45:
                cont = True
        if not cont:
            rows.append({"_last": {}})
        for s in g:
            ci = col_of(s["x"])
            rows[-1].setdefault(ci, []).append(s)
            rows[-1]["_last"][ci] = (s["page"], s["y"])
    used = sorted({ci for r in rows for ci in r if ci != "_last"})
    out = ['<div class="tbl"><table>']
    for k, row in enumerate(rows):
        all_bold = all(r["b"] for ci in used for s in row.get(ci, []) for r in s["runs"] if r["t"].strip())
        tag = "th" if all_bold and k == 0 else "td"
        cells = "".join(f"<{tag}>" + " ".join(render_runs(s["runs"], linker) for s in row.get(ci, [])) + f"</{tag}>" for ci in used)
        out.append("<tr>" + cells + "</tr>")
    out.append("</table></div>")
    return "".join(out)


def render_grid(lines, linker):
    """A page laid out as a grid of separate cells (Table of Weights and Measures): one PDF line per cell.

    The left-most column holds group labels (Weights, Length, ...), which become full-width sub-headings;
    the stacked small-caps lines at the top become one header row. Cells holding a fraction sit a hair
    higher than their neighbours, so rows are matched with a tolerance rather than an exact y.
    """
    cols = []
    for x in sorted({round(l.x0) for l in lines}):
        if not cols or x - cols[-1] > 12:
            cols.append(x)

    def col_of(x):
        cand = [i for i, c in enumerate(cols) if c <= x + 4]
        return cand[-1] if cand else 0

    rows = []
    for l in sorted(lines, key=lambda l: (l.page, l.y0, l.x0)):
        if not rows or rows[-1]["page"] != l.page or l.y0 - rows[-1]["y"] > 4:
            rows.append({"page": l.page, "y": l.y0, "cells": {}})
        rows[-1]["cells"].setdefault(col_of(l.x0), []).append(l)
    plain = lambda ls: " ".join("".join(r["t"] for l in ls for r in [*l.runs, {"t": " "}]).split())
    bold = lambda row: all(r["b"] for ls in row["cells"].values() for l in ls for r in l.runs if r["t"].strip())
    head = []
    while rows and 0 not in rows[0]["cells"] and bold(rows[0]):
        head.append(rows.pop(0))
    data_cols = list(range(1, len(cols)))
    out = ['<table>']
    if head:
        out.append("<tr>" + "".join(
            "<th>" + esc(smart_title(plain([l for h in head for l in h["cells"].get(ci, [])]))) + "</th>" for ci in data_cols) + "</tr>")
    for row in rows:
        if 0 in row["cells"]:
            out.append(f'<tr><th colspan="{len(data_cols)}">' + " ".join(render_runs(l.runs, linker) for l in row["cells"][0]) + "</th></tr>")
        if any(ci in row["cells"] for ci in data_cols):
            out.append("<tr>" + "".join(
                "<td>" + " ".join(render_runs(l.runs, linker) for l in row["cells"].get(ci, [])) + "</td>" for ci in data_cols) + "</tr>")
    out.append("</table>")
    return "".join(out)


SMALL = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"}


def smart_title(t):
    if not t.isupper():
        return t
    words = t.lower().split()
    return " ".join(w if (i and w in SMALL) else w[:1].upper() + w[1:] for i, w in enumerate(words))


# ----------------------------------------------------------------------------- stage 2: a full book
def slice_items(items, start, end):
    s, e = tuple(start), tuple(end) if end else (10 ** 9, 0)
    def key(it):
        return (it["page"], it["bbox"][1]) if isinstance(it, dict) else (it.page, it.y0)
    return [it for it in items if s <= key(it) < e]


def section_items(doc, sec, key, images=True):
    """Raw page items for a whole section, cached on disk (char-level link extraction is slow)."""
    import pickle
    path = os.path.join(CACHE, "items", f"{key}.pkl")
    if os.path.exists(path):
        with open(path, "rb") as f:
            return pickle.load(f)
    items = []
    for p0 in range(sec["start"] - 1, sec["end"]):
        items.extend(extract_page(doc, p0, raw=True, images=images))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        pickle.dump(items, f, protocol=pickle.HIGHEST_PROTOCOL)
    return items


def convert_book(doc, secs, bid, gdata, linker, pending):
    b = BOOKS[BOOK_IDX[bid]]
    name, prefix = b[1], b[2]
    sec = next(s for s in secs if s["title"] == name)
    print(f"converting {name} (pages {sec['start']}-{sec['end']})", flush=True)
    items = section_items(doc, sec, f"book-{bid}")
    # region boundaries
    notes_at = None
    for it in items:
        if is_line(it) and it.first()["size"] >= 19 and it.text.strip().startswith("Notes for"):
            notes_at = (it.page, it.y0)
    reg = gdata["regions"]
    intro_items = slice_items(items, (sec["start"], 0), reg["text"])
    text_items = slice_items(items, reg["text"], reg["ann"])
    ann_items = slice_items(items, reg["ann"], notes_at)
    note_items = slice_items(items, notes_at, (sec["end"] + 1, 0)) if notes_at else []
    notes_at = notes_at or (sec["end"] + 1, 0)
    linker.cover((sec["start"], 0), (sec["end"] + 1, 0))
    images = ImageStore(bid)
    book = {"id": bid, "name": name}
    nav = {"intro": [], "chapters": {}}
    search = []
    figures = []

    # ---- intro
    flow, figs = split_figures(intro_items)
    fig_at = {}
    for f in figs:
        fig_at.setdefault(f["pos"], []).append(f)
    intro_parts = []
    pid = 0
    flow_lines = []

    def flush_intro():
        nonlocal pid
        for p in build_paras(flow_lines):
            pid += 1
            aid = f"i-{bid}-{pid}"
            linker.add(p.lines[0].page, p.lines[0].y0, p.lines[0].x0, aid)
            sz = p.lines[0].size
            txt = p.text.strip()
            if sz >= 19 or (txt == "Introduction to" and p.lines[0].first()["b"]):
                continue
            if sz >= 14:
                intro_parts.append(f'<h3 id="{aid}">{esc(txt)}</h3>')
                nav["intro"].append([aid, txt])
            else:
                cls = "ind" if p.lines[0].x0 > 80 and len(p.lines) == 1 else ""
                intro_parts.append(f'<p id="{aid}" class="{cls}">{render_runs(p.runs, linker)}</p>')
                search.append([aid, "intro", f"Introduction to {name}", txt])
        flow_lines.clear()

    for k, it in enumerate(flow + [None]):
        for f in fig_at.get(k, []):
            flush_intro()
            fid = f"f-{bid}-{len(figures) + 1}"
            fig = render_figure(f, linker, images, fid)
            linker.add(f["at"][0], f["at"][1] - 1, 0, fid)
            fig["where"] = "intro"
            figures.append(fig)
            intro_parts.append(f'<figure class="fig" id="{fid}"><figcaption>{esc(fig["title"])}</figcaption>{fig["html"]}</figure>')
            nav["intro"].append([fid, fig["title"], fig["kind"]])
        if it is None:
            break
        if is_line(it):
            flow_lines.append(it)
        else:
            flush_intro()
            intro_parts.append(f'<div class="fig-img">{images.tag(it, name)}</div>')
    flush_intro()
    book["intro"] = "".join(intro_parts)

    # ---- scripture
    lines = [it for it in text_items if is_line(it)]
    chapters = {}
    chapter, verse = None, 0
    hid = 0
    paras = build_paras(lines, starts_new=lambda ln: ln.size >= 14)
    for p in paras:
        ln0 = p.lines[0]
        c = chapter_heading(ln0, prefix)
        if c is not None:
            chapter, verse = c, 0
            chapters[c] = []
            nav["chapters"][c] = []
            linker.add(ln0.page, ln0.y0, ln0.x0, f"c-{bid}-{c}")
            continue
        if chapter is None:
            continue
        if ln0.size >= 14:
            hid += 1
            aid = f"h-{bid}-{hid}"
            linker.add(ln0.page, ln0.y0, ln0.x0, aid)
            chapters[chapter].append(f'<h3 class="sh" id="{aid}">{esc(p.text.strip())}</h3>')
            nav["chapters"][chapter].append(["h", aid, p.text.strip()])
            continue
        if ln0.size < 11:
            chapters[chapter].append(f'<p class="pp">{render_runs(p.runs, linker)}</p>')
            continue
        out = []
        open_v = False
        if verse:
            out.append(f'<span class="v" data-v="{chapter}:{verse}">')
            open_v = True
        runs = p.runs
        i = 0
        while i < len(runs):
            r = runs[i]
            t = r["t"]
            if 9.8 <= r["size"] <= 10.6 and t.strip().isdigit():
                if open_v:
                    out.append("</span>")
                verse = int(t.strip())
                vid = f"v-{bid}-{chapter}-{verse}"
                ann = ""
                if r["link"]:
                    res = linker.resolve(r["link"])
                    if res.get("id"):
                        ann = f' data-ann="{res["id"]}"'
                out.append(f'<span class="v" data-v="{chapter}:{verse}"><a class="vn" id="{vid}"{ann}>{t.strip()}</a>')
                open_v = True
                i += 1
                continue
            if r["size"] < 9.8 and len(t.strip()) > 2 and not t.strip().isdigit():
                # eBook jump link to a chart/map, e.g. "Chart: Integrated Chronology of the Patriarchs"
                j, grp = i, []
                while j < len(runs) and (runs[j]["size"] < 9.8 or not runs[j]["t"].strip()):
                    grp.append(runs[j])
                    j += 1
                tgt = next((g["link"] for g in grp if g["link"]), None)
                res = linker.resolve(tgt) if tgt else {}
                label = " ".join("".join(g["t"] for g in grp).split())
                href = f'#{res["id"]}' if res.get("id") else (f'#pdf:{res["pdf"]}' if res.get("pdf") else "#")
                out.append(f' <a class="figref" href="{href}">{esc(label)}</a> ')
                i = j
                continue
            if r["size"] < 9.8 and t.strip():
                if r["link"]:
                    res = linker.resolve(r["link"])
                    href = f'#{res["id"]}' if res.get("id") else "#"
                    cls = "fn" if t.strip().isdigit() else "xr"
                    out.append(f'<sup class="{cls}"><a href="{href}">{esc(t.strip())}</a></sup>')
                else:
                    out.append(f"<sup>{esc(t.strip())}</sup>")
                i += 1
                continue
            j = i
            while j < len(runs) and not (9.8 <= runs[j]["size"] <= 10.6 and runs[j]["t"].strip().isdigit()) and not (runs[j]["size"] < 9.8 and runs[j]["t"].strip()):
                j += 1
            out.append(render_runs(runs[i:j], linker))
            i = j
        if open_v:
            out.append("</span>")
        x = ln0.x0
        cls = "p"
        if len(p.lines) == 1 or all(l.x1 < 500 for l in p.lines):
            # poetry lines are short and indented
            if x >= 124:
                cls = "q2"
            elif 100 <= x < 106 or x >= 112:
                cls = "q1"
        body = re.sub(r'<span class="v" data-v="[^"]+">\s*</span>', "", "".join(out))
        chapters[chapter].append(f'<p class="{cls}">{body}</p>')
    book["chapters"] = [{"c": c, "html": "".join(v)} for c, v in sorted(chapters.items())]
    linker.cover(reg["text"], reg["ann"])

    # ---- annotations (+ figures inside them)
    flow, figs = split_figures(ann_items)
    flow_lines = [it for it in flow if is_line(it)]
    # map figure position (index in flow) -> figure
    fig_after = {}
    for f in figs:
        fig_after.setdefault(f["pos"], []).append(f)

    one_ch = b[3] == 1
    VREF = re.compile(r"^\s*(\d+)[a-z]?(?:\s*[–—-]\s*(\d+)[a-z]?)?\s*$")

    def ann_start(ln):
        r = ln.first()
        if not (r["b"] and r["blue"]):
            return False
        return REF_START.match(r["t"]) is not None or (one_ch and VREF.match(r["t"]) is not None)

    def parse_ref(t):
        m = RANGE.match(t)
        if m:
            c1, v1 = int(m.group(1)), int(m.group(2))
            return c1, v1, (int(m.group(3)) if m.group(3) else c1), (int(m.group(4)) if m.group(4) else v1)
        m = VREF.match(t)
        v1 = int(m.group(1))
        return 1, v1, 1, (int(m.group(2)) if m.group(2) else v1)

    # paragraphs, keeping track of flow index of first line to attach figures
    pos_of = {id(it): k for k, it in enumerate(flow)}
    paras = build_paras(flow_lines, starts_new=ann_start)
    annotations = []
    cur = None
    fig_queue = sorted(fig_after.items())
    fq = 0

    def attach_figs(upto_pos):
        nonlocal fq
        while fq < len(fig_queue) and fig_queue[fq][0] <= upto_pos:
            for f in fig_queue[fq][1]:
                fid = f"f-{bid}-{len(figures) + 1}"
                fig = render_figure(f, linker, images, fid)
                linker.add(f["at"][0], f["at"][1] - 1, 0, fid)
                fig["ann"] = cur["id"] if cur else None
                fig["c"] = cur["s"][0] if cur else 1
                figures.append(fig)
                if cur:
                    cur.setdefault("figs", []).append(fid)
            fq += 1

    for p in paras:
        attach_figs(pos_of[id(p.lines[0])])
        ln0 = p.lines[0]
        if ln0.size >= 19:
            continue
        if ann_start(ln0):
            r0 = ln0.first()
            c1, v1, c2, v2 = parse_ref(r0["t"].strip())
            aid = f"a-{bid}-{len(annotations) + 1}"
            linker.add(ln0.page, ln0.y0, ln0.x0, aid)
            # title: first italic run after the ref; else first bold lemma
            title, lemma = None, None
            rest = list(p.runs)
            while rest and not rest[0]["t"].strip():
                rest.pop(0)
            rest = rest[1:]  # drop the verse reference run
            while rest and not rest[0]["t"].strip():
                rest.pop(0)
            if rest:
                style = "i" if (rest[0]["i"] and not rest[0]["b"]) else ("b" if rest[0]["b"] else None)
                if style:
                    parts = []
                    for r in rest:
                        if r["t"].strip() and not r[style]:
                            break
                        parts.append(r["t"])
                    text = " ".join("".join(parts).split()).rstrip(".")
                    if style == "i":
                        title = text
                    else:
                        lemma = text
            cur = {"id": aid, "ref": r0["t"].strip(), "s": [c1, v1], "e": [c2, v2], "title": title, "lemma": lemma, "paras": [p]}
            annotations.append(cur)
        elif cur is not None:
            linker.add(ln0.page, ln0.y0, ln0.x0, cur["id"])
            cur["paras"].append(p)
    attach_figs(10 ** 9)
    ann_out = []
    for a in annotations:
        h = "".join(f"<p>{render_runs(p.runs, linker)}</p>" for p in a["paras"])
        text = " ".join(p.text.strip() for p in a["paras"])
        label = a["title"] or a["lemma"] or ""
        ann_out.append({"id": a["id"], "ref": a["ref"], "s": a["s"], "e": a["e"], "t": label, "big": bool(a["title"]),
                        "html": h, "figs": a.get("figs", [])})
        search.append([a["id"], "note", f"{b[4]} {a['ref']}" + (f" — {label}" if label else ""), text])
        if a["title"]:
            nav["chapters"].setdefault(a["s"][0], []).append(["a", a["id"], a["title"]])
    for f in figures:
        if f.get("where") != "intro":
            nav["chapters"].setdefault(f.get("c", 1), []).append(["f", f["id"], f["title"], f["kind"]])
        plain = re.sub(r"<[^>]+>", " ", f["html"])
        search.append([f["id"], f["kind"], f["title"], re.sub(r"\s+", " ", plain).strip()])
    book["annotations"] = ann_out
    book["figures"] = figures
    linker.cover(reg["ann"], notes_at)

    # ---- notes (cross references / footnotes)
    note_lines = [it for it in note_items if is_line(it)]

    def note_start(ln):
        r = ln.first()
        return r["size"] < 9.8 and r["t"].strip() != ""

    notes = {}
    nchap = None
    for p in build_paras(note_lines, starts_new=lambda ln: note_start(ln) or ln.size >= 14):
        ln0 = p.lines[0]
        if ln0.size >= 14:
            m = re.search(r"(\d+)\s*$", p.text.strip())
            nchap = int(m.group(1)) if m else nchap
            continue
        if not note_start(ln0):
            continue
        nid = f"n-{bid}-{len(notes) + 1}"
        linker.add(ln0.page, ln0.y0, ln0.x0, nid)
        runs = p.runs
        mark = runs[0]["t"].strip()
        notes[nid] = {"m": mark, "c": nchap, "html": render_runs(runs[1:], linker)}
    book["notes"] = notes

    pending.append((bid, book, nav, search))
    print(f"  {len(book['chapters'])} chapters, {len(ann_out)} annotations, {len(figures)} figures, {len(notes)} notes", flush=True)
    return book


# ----------------------------------------------------------------------------- stage 2b: non-book sections
NO_SEARCH = ("Index", "Table of Contents", "Title Page", "Copyright Page", "Alphabetical Order")


def section_pre(num):
    return f"s-{num:03d}"


def convert_section(doc, sec, linker, pending):
    num, title = sec["num"], sec["title"]
    pre = section_pre(num)
    print(f"section {num:03d} {title} (pages {sec['start']}-{sec['end']})", flush=True)
    items = section_items(doc, sec, f"sec-{num:03d}")
    linker.cover((sec["start"], 0), (sec["end"] + 1, 0))
    images = ImageStore(f"s{num:03d}")
    keep = title == "Index to Maps"
    grid, grid_lines = title == "Table of Weights and Measures", []   # this section's small print is a grid of cells
    searchable = not any(w in title for w in NO_SEARCH)
    flow, figs = split_figures(items)
    fig_at = {}
    for f in figs:
        fig_at.setdefault(f["pos"], []).append(f)
    parts, nav, search, figures = [], [], [], []
    state = {"k": 0, "h2": None, "h3": None, "first": True}
    flow_lines = []
    norm_title = re.sub(r"\W+", "", title).lower()

    def new_id():
        state["k"] += 1
        return f"{pre}-{state['k']}"

    def flush():
        paras = build_paras(flow_lines, starts_new=(lambda ln: ln.size < 11) if keep else None)
        i = 0
        while i < len(paras):
            p = paras[i]
            ln0 = p.lines[0]
            sz = ln0.size
            aid = new_id()
            linker.add(ln0.page, ln0.y0, ln0.x0, aid)
            txt = " ".join(p.text.split())
            if sz >= 19:
                while i + 1 < len(paras) and paras[i + 1].lines[0].size >= 19 and paras[i + 1].lines[0].page == ln0.page:
                    i += 1
                    nxt = paras[i].lines[0]
                    linker.add(nxt.page, nxt.y0, nxt.x0, aid)
                    txt += " " + " ".join(paras[i].text.split())
                if state["first"] and re.sub(r"\W+", "", txt).lower() == norm_title:
                    parts.append(f'<span id="{aid}"></span>')
                else:
                    parts.append(f'<h2 class="art" id="{aid}">{esc(txt)}</h2>')
                    nav.append([aid, txt, 2])
                    state["h2"], state["h3"] = txt, None
                state["first"] = False
            elif sz >= 14:
                state["first"] = False
                r0 = ln0.first()
                if r0["i"] and not r0["b"] and all(r["i"] for r in p.runs if r["t"].strip()):
                    parts.append(f'<p class="byline" id="{aid}">{esc(txt)}</p>')
                else:
                    parts.append(f'<h3 id="{aid}">{render_runs(p.runs, linker)}</h3>')
                    nav.append([aid, txt, 3])
                    state["h3"] = txt
                    if title == "Zondervan’s Full-Color Maps" and re.match(r"Map \d+:", txt):
                        figures.append({"id": aid, "kind": "map", "title": txt})
            else:
                state["first"] = False
                cls = ("ix" if keep else "small") if sz < 11.5 else ""
                parts.append(f'<p id="{aid}" class="{cls}">{render_runs(p.runs, linker)}</p>')
                if searchable and len(txt) > 30:
                    label = " — ".join(x for x in (title, state["h2"], state["h3"]) if x)
                    search.append([aid, "article", label, txt])
            i += 1
        flow_lines.clear()

    for k, it in enumerate(flow + [None]):
        for f in fig_at.get(k, []):
            flush()
            fid = f"{pre}-f{len(figures) + 1}"
            fig = render_figure(f, linker, images, fid)
            linker.add(f["at"][0], f["at"][1] - 1, 0, fid)
            figures.append({"id": fid, "kind": fig["kind"], "title": fig["title"]})
            parts.append(f'<figure class="fig" id="{fid}"><figcaption>{esc(fig["title"])}</figcaption>{fig["html"]}</figure>')
            nav.append([fid, fig["title"], 4, fig["kind"]])
            plain = re.sub(r"<[^>]+>", " ", fig["html"])
            search.append([fid, fig["kind"], fig["title"], re.sub(r"\s+", " ", plain).strip()])
        if grid and grid_lines and (it is None or not is_line(it) or it.size >= 11):
            aid = new_id()
            linker.add(grid_lines[0].page, grid_lines[0].y0, grid_lines[0].x0, aid)
            table = render_grid(grid_lines, linker)
            parts.append(f'<div class="tbl" id="{aid}">{table}</div>')
            if searchable:
                search.append([aid, "article", title, " ".join(re.sub(r"<[^>]+>", " ", table).split())])
            grid_lines.clear()
        if it is None:
            break
        if grid and is_line(it) and it.size < 11:
            flush()
            grid_lines.append(it)
        elif is_line(it):
            flow_lines.append(it)
        else:
            flush()
            aid = new_id()
            linker.add(it["page"], it["bbox"][1], it["bbox"][0], aid)
            parts.append(f'<div class="fig-img" id="{aid}">{images.tag(it, state["h3"] or state["h2"] or title)}</div>')
    flush()
    out, run = [], []
    for h in parts + [""]:
        if h.startswith('<p id="') and 'class="ix"' in h[:40]:
            run.append(h)
            continue
        if run:
            out.append(f'<div class="idx-cols">{"".join(run)}</div>')
            run = []
        out.append(h)
    body = "".join(out)
    pending.append({"num": num, "title": title, "html": body, "nav": nav, "search": search, "figures": figures})
    print(f"  {state['k']} blocks, {len(nav)} headings, {len(figures)} figures", flush=True)


# ----------------------------------------------------------------------------- stage 3: concordance
def convert_concordance(doc, secs, linker):
    sec = next(s for s in secs if s["title"] == "Concordance")
    print(f"concordance (pages {sec['start']}-{sec['end']})", flush=True)
    items = []
    for p0 in range(sec["start"] - 1, sec["end"]):
        items.extend(it for it in extract_page(doc, p0, raw=True, images=False) if is_line(it))
    # entries begin at first bold blue 12pt headword indented at ~84
    start = next(k for k, l in enumerate(items) if l.first()["b"] and l.first()["blue"] and 11.5 < l.first()["size"] < 12.5 and l.x0 > 80)
    intro = items[:start]
    entries = []
    cur = None
    row = None
    for l in items[start:]:
        r0 = l.first()
        if r0["b"] and 11.5 < r0["size"] < 12.5:
            word = r0["t"].strip()
            if len(word) == 1 and l.text.strip() == word:
                continue  # letter header
            cur = {"w": word, "line": l, "rows": []}
            entries.append(cur)
            row = None
            continue
        if cur is None:
            continue
        r0 = l.first()
        starts_ref = r0["blue"] and r0["link"] is not None and re.match(r"^\s*(?:[1-3]?[A-Z][a-z]+\s)?\d", r0["t"])
        if l.x0 < 88 or row is None or (starts_ref and row[-1].x1 < 470):
            row = [l]
            cur["rows"].append(row)
        else:
            row.append(l)
    for e in entries:
        l = e["line"]
        slug = re.sub(r"[^a-z0-9]+", "-", e["w"].lower().replace("’", "")).strip("-")
        base, n = slug, 2
        e["id"] = f"k-{slug}"
        linker.add(l.page, l.y0, l.x0, e["id"])
    linker.cover((items[start].page, items[start].y0), (sec["end"] + 1, 0))
    return entries, sec


def finish_concordance(entries, linker):
    by_letter = {}
    index = []
    seen = {}
    for e in entries:
        if e["id"] in seen:
            seen[e["id"]] += 1
            e["id"] = f"{e['id']}-{seen[e['id']]}"
        else:
            seen[e["id"]] = 1
        head = render_runs(e["line"].runs, linker)
        rows = []
        books = set()
        for rl in e["rows"]:
            p = Para(rl[0])
            p.lines = rl
            h = render_runs(p.runs, linker)
            bs = sorted({BOOK_IDX[m.group(1)] for m in re.finditer(r'href="#[vc]-([0-9a-z]{3})-', h) if m.group(1) in BOOK_IDX})
            books.update(bs)
            rows.append([bs, h])
        letter = e["w"][0].lower() if e["w"][0].isalpha() else "_"
        by_letter.setdefault(letter, []).append([e["id"], head, rows])
        index.append([e["id"], re.sub(r"[*†]", "", e["w"]), letter, sorted(books)])
    return by_letter, index


# ----------------------------------------------------------------------------- output
def write_js(rel, call, *args):
    path = os.path.join(OUT, "data", rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    payload = ",".join(json.dumps(a, ensure_ascii=False, separators=(",", ":")) for a in args)
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"NIV.{call}({payload});\n")
    return os.path.getsize(path)


def main():
    want = sys.argv[1:] or ["gen"]
    if want == ["all"]:
        want = [b[0] for b in BOOKS]
    doc = fitz.open(SRC)
    secs = load_toc(doc)
    print("stage 1: global verse pass", flush=True)
    g = global_pass(doc, secs)
    linker = Linker(secs)
    for bid, d in g.items():
        for page, y, x, aid in d["anchors"]:
            linker.add(page, y, x, aid)
        # scripture regions are fully anchored for every book
        linker.cover(d["regions"]["text"], d["regions"]["ann"])
    pending = []
    import traceback
    failed = []
    for bid in want:
        try:
            convert_book(doc, secs, bid, g[bid], linker, pending)
        except Exception:
            traceback.print_exc()
            failed.append(bid)
    want = [b for b in want if b not in failed]
    if failed:
        print("FAILED BOOKS:", failed, flush=True)
    other = [s for s in secs if s["title"] not in BOOK_BY_NAME and s["title"] != "Concordance"] if len(want) == len(BOOKS) else []
    spending = []
    for s in other:
        convert_section(doc, s, linker, spending)
    entries, csec = convert_concordance(doc, secs, linker)
    # the concordance's own front pages (intro + word index) are replaced by the reader's concordance view
    for pg in range(csec["start"], entries[0]["line"].page + 1):
        linker.add(pg, 0, 0, "view:conc")
    linker.cover((csec["start"], 0), (entries[0]["line"].page, entries[0]["line"].y0))
    linker.finalize()
    harvest_figure_titles(doc, secs, linker)
    print(f"figure titles from indexes: {len(FIG_TITLES)}")

    # render pass happens inside convert_book already (links resolved against anchors known so far);
    # re-run the books now that every anchor (incl. concordance + later books) is registered.
    pending.clear()
    linker.frozen = True
    linker.unresolved = linker.outside = 0
    linker.misses = []
    for bid in want:
        convert_book(doc, secs, bid, g[bid], linker, pending)
    spending.clear()
    for s in other:
        convert_section(doc, s, linker, spending)
    by_letter, cindex = finish_concordance(entries, linker)

    # ---- write data
    sizes = {}
    for bid, book, nav, search in pending:
        sizes[f"books/{bid}.js"] = write_js(f"books/{bid}.js", "book", bid, book)
        sizes[f"search/{bid}.js"] = write_js(f"search/{bid}.js", "search", bid, search)
    for bid, d in g.items():
        sizes[f"verses/{bid}.js"] = write_js(f"verses/{bid}.js", "verses", bid, d["verses"])
    sec_search = []
    for sd in spending:
        sizes[f"sections/{sd['num']:03d}.js"] = write_js(f"sections/{sd['num']:03d}.js", "section", sd["num"], {"title": sd["title"], "html": sd["html"]})
        sec_search.extend(sd["search"])
    if spending:
        sizes["search/sections.js"] = write_js("search/sections.js", "search", "sections", sec_search)
    sdone = {sd["num"]: sd for sd in spending}
    for letter, rows in by_letter.items():
        sizes[f"conc/{letter}.js"] = write_js(f"conc/{letter}.js", "conc", letter, rows)
    navs = {bid: nav for bid, _, nav, _ in pending}
    manifest = {
        "books": [{"id": b[0], "name": b[1], "abbr": b[4], "aliases": b[5], "chapters": b[3],
                   "sec": next(s["num"] for s in secs if s["title"] == b[1]),
                   "converted": b[0] in navs, "nav": navs.get(b[0])} for b in BOOKS],
        "sections": [{"num": s["num"], "title": s["title"], "file": s["file"], "start": s["start"], "end": s["end"],
                      "converted": s["num"] in sdone, "nav": sdone[s["num"]]["nav"] if s["num"] in sdone else None} for s in secs],
        "concordance": cindex,
        "figures": [[bid, f["id"], f["title"], f["kind"]] for bid, book, _, _ in pending for f in book["figures"]]
                   + [[section_pre(sd["num"]), f["id"], f["title"], f["kind"]] for sd in spending for f in sd["figures"]],
        "built": time.strftime("%Y-%m-%d %H:%M"),
    }
    sizes["manifest.js"] = write_js("manifest.js", "manifest", manifest)
    total = sum(sizes.values())
    print(f"wrote {len(sizes)} data files, {total / 1e6:.1f} MB")
    print(f"links into unconverted content (PDF fallback): {linker.outside}; unresolved inside converted content: {linker.unresolved}")
    from collections import Counter
    miss = Counter(linker.sec_of(p)["title"] for p, _, _ in linker.misses)
    print("  unresolved by section:", miss.most_common(10), linker.misses[:10])
    for k in ["manifest.js"] + [k for k in sizes if k.startswith(("books/", "search/"))]:
        print(f"  {k}: {sizes[k] / 1e3:.0f} KB")


if __name__ == "__main__":
    main()
