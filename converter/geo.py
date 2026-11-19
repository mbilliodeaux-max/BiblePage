"""Map calibration: ties pixels on a map picture to present-day latitude / longitude.

One JSON file per picture lives in converter/geo/maps/. It lists one or more panels (a picture can hold
several maps side by side, or an inset), and for each panel a few places whose dot can be seen on the
map, with the dot's pixel position. Coordinates for those places come from the gazetteer
(converter/geo/gazetteer.json, built from OpenBible.info's Bible Geocoding Data, CC BY 4.0).

    python geo.py find Jerusalem Beersheba          look places up in the gazetteer
    python geo.py grid <src> <out.png> [x0 y0 x1 y1] picture (or part of it) with a pixel grid, for reading positions
    python geo.py fit <maps/x.json>                  fit each panel and report the error at every point, in km
    python geo.py check <maps/x.json> <out.png>      draw where the fit puts the reference and check places
    python geo.py compile                            write "NIV html/data/geo.js" from every calibration file

Calibration file:
{
  "src": "images/s100/78905976e71d6f.jpeg",      picture, as the page refers to it
  "figure": "s-100-10", "title": "Map 1: World of the Patriarchs",
  "status": "ok" | "skip",                         skip: not a map that can be located (painting, chart)
  "note": "free text",
  "panels": [{
     "box": [x0, y0, x1, y1],                      the part of the picture this panel covers, in pixels
     "label": "optional, e.g. 'inset: Jerusalem'",
     "pts":   [[x, y, "Jerusalem"], [x, y, "a1b2c3d"], [x, y, 31.77, 35.23, "Name"]],   used for the fit
     "check": [[x, y, "Hebron"], ...]              not used for the fit; the error there is reported
  }, {
     "box": [x0, y0, x1, y1], "none": true,        an area inside a bigger panel that is not part of it,
     "label": "inset: Crete"                       such as an inset too sparse to fit: clicks there give nothing
  }]
}
The smallest panel containing a click is the one used, so an inset or a "none" box overrides the map around it.
A place is a gazetteer name (it must be unambiguous), a gazetteer id, or explicit lat, lon.
"""
import glob, json, math, os, re, sys, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "NIV html")
GEO = os.path.join(HERE, "geo")
MAPS = os.path.join(GEO, "maps")
_gaz = None


def gaz():
    global _gaz
    if _gaz is None:
        _gaz = json.load(open(os.path.join(GEO, "gazetteer.json"), encoding="utf-8"))
    return _gaz


def norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def find(q):
    """Gazetteer rows for a name: exact matches on any spelling first, then names that contain it."""
    k = norm(q)
    rows = gaz()
    exact = [r for r in rows if r["id"] == q or norm(r["n"]) == k or any(norm(a) == k for a in r["alt"])]
    if exact:
        return sorted(exact, key=lambda r: (r.get("is_modern", False), -r["conf"]))
    return sorted([r for r in rows if k and (k in norm(r["n"]) or any(k in norm(a) for a in r["alt"]))],
                  key=lambda r: (len(r["n"]), -r["conf"]))[:12]


WD_CACHE = os.path.join(GEO, "wikidata.json")
_wd = None


def _read_cache():
    """The cache on disk; a damaged file yields whatever complete entries it still holds."""
    if not os.path.exists(WD_CACHE):
        return {}
    text = open(WD_CACHE, encoding="utf-8-sig").read()
    try:
        return json.loads(text)
    except ValueError:
        try:
            return json.JSONDecoder().raw_decode(text.lstrip())[0]
        except ValueError:
            return {}


def wd_cache():
    global _wd
    if _wd is None:
        _wd = _read_cache()
    return _wd


def _save_cache(new):
    """Add entries to the cache file. Several calibrations can run at once, so take a lock, merge with what
    is on disk now, and write through a temporary file of our own."""
    import time
    lock = WD_CACHE + ".lock"
    for _ in range(200):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            if time.time() - os.path.getmtime(lock) > 60:       # left behind by a crashed run
                try:
                    os.remove(lock)
                except OSError:
                    pass
            time.sleep(0.1)
    else:
        return                                                   # could not get the lock: the entry stays in memory only
    try:
        merged = _read_cache()
        merged.update(new)
        tmp = f"{WD_CACHE}.{os.getpid()}.tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(merged, f, ensure_ascii=False, indent=0, sort_keys=True)
        os.replace(tmp, WD_CACHE)
        wd_cache().update(merged)
    finally:
        os.close(fd)
        os.remove(lock)


def wd_get(url):
    """GET from the Wikidata API, waiting and retrying when it asks clients to slow down."""
    import time, urllib.error, urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "BibleMapCalibration/1.0 (personal study tool)"})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 5:
                raise
            time.sleep(float(e.headers.get("Retry-After") or 0) or 2 ** attempt * 2)
        except urllib.error.URLError:
            if attempt == 5:
                raise
            time.sleep(2 ** attempt * 2)


def wd_search(q):
    """Wikidata items called q that have coordinates: places the gazetteer lacks (Troy, Mari, Ugarit...)."""
    import urllib.parse
    base = "https://www.wikidata.org/w/api.php?format=json&"
    found = wd_get(base + urllib.parse.urlencode({"action": "wbsearchentities", "search": q, "language": "en", "limit": 10, "type": "item"}))
    ids = [s["id"] for s in found.get("search", [])]
    if not ids:
        return []
    ents = wd_get(base + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(ids), "props": "claims|labels|descriptions", "languages": "en"}))["entities"]
    out = []
    for i in ids:
        e = ents.get(i, {})
        c = e.get("claims", {}).get("P625")
        if not c:
            continue
        v = c[0]["mainsnak"].get("datavalue", {}).get("value")
        if not v:
            continue
        out.append({"id": i, "n": e.get("labels", {}).get("en", {}).get("value", q), "lat": round(v["latitude"], 5), "lon": round(v["longitude"], 5),
                    "desc": e.get("descriptions", {}).get("en", {}).get("value", "")})
    return out


def wd_place(qid):
    """Coordinates of a Wikidata item, cached in geo/wikidata.json so building needs no network."""
    c = wd_cache()
    if qid not in c:
        import urllib.parse
        ents = wd_get("https://www.wikidata.org/w/api.php?format=json&" + urllib.parse.urlencode(
            {"action": "wbgetentities", "ids": qid, "props": "claims|labels", "languages": "en"}))["entities"]
        e = ents[qid]
        v = e["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
        c[qid] = {"n": e.get("labels", {}).get("en", {}).get("value", qid), "lat": round(v["latitude"], 5), "lon": round(v["longitude"], 5)}
        _save_cache({qid: c[qid]})
    return c[qid]


def resolve(p):
    """[x, y, place] or [x, y, lat, lon, name] -> (x, y, lat, lon, label)."""
    if len(p) >= 4 and isinstance(p[2], (int, float)):
        return float(p[0]), float(p[1]), float(p[2]), float(p[3]), p[4] if len(p) > 4 else f"{p[2]},{p[3]}"
    x, y, q = p[0], p[1], p[2]
    if re.fullmatch(r"Q\d+", q):
        w = wd_place(q)
        return float(x), float(y), w["lat"], w["lon"], w["n"]
    hits = find(q)
    ancient = [h for h in hits if not h.get("is_modern")]
    main = lambda h: norm(re.sub(r"\s+\d+$", "", h["n"]))      # "Beersheba 1" -> "beersheba"
    pool = ancient or hits
    exact = [h for h in pool if h["id"] == q or main(h) == norm(q)] or \
            [h for h in pool if norm(h["n"]) == norm(q) or any(norm(a) == norm(q) for a in h["alt"])]
    if not exact:
        raise SystemExit(f"place not in gazetteer: {q!r} (try: python geo.py find {q})")
    if len(exact) > 1 and exact[0]["id"] != q:
        spread = max(km(exact[0]["lat"], exact[0]["lon"], e["lat"], e["lon"]) for e in exact)
        if spread > 5:
            raise SystemExit(f"ambiguous place {q!r}: " + "; ".join(f"{e['id']} {e['n']} ({e['modern']}) {e['lat']},{e['lon']}" for e in exact)
                             + " -- use the id instead")
    h = exact[0]
    return float(x), float(y), h["lat"], h["lon"], h["n"]


def km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(a))


# ---------------------------------------------------------------- fitting
# A panel's model: pixel -> (X, Y) is affine, and (X, Y) are the coordinates of a map projection, which is
# then undone to give latitude and longitude. Trying a few projections and keeping the one that predicts
# left-out places best lets a wide map (the Roman Empire) be as accurate as a small one.
#   "eq"  plain latitude / longitude grid, scaled at the panel's middle latitude   p = [lat0 in radians]
#   "merc" Mercator                                                                  p = []
#   "lcc" Lambert conformal conic, the usual projection for atlas maps                p = [n]  (cone constant)
# For the conic, the central meridian and the scale are rotations and scalings about the cone's apex,
# which the affine part already covers, so the cone constant n is the only thing to search for.

def project(proj, p, lat, lon):
    f, l = math.radians(lat), math.radians(lon)
    if proj == "eq":
        return l * math.cos(p[0]), f
    if proj == "merc":
        return l, math.log(math.tan(math.pi / 4 + f / 2))
    n = p[0]
    rho = 1 / math.tan(math.pi / 4 + f / 2) ** n
    return rho * math.sin(n * l), -rho * math.cos(n * l)


def unproject(proj, p, X, Y):
    if proj == "eq":
        return math.degrees(Y), math.degrees(X / math.cos(p[0]))
    if proj == "merc":
        return math.degrees(2 * math.atan(math.exp(Y)) - math.pi / 2), math.degrees(X)
    n = p[0]
    rho = math.hypot(X, Y)
    return math.degrees(2 * math.atan((1 / rho) ** (1 / n)) - math.pi / 2), math.degrees(math.atan2(X, -Y) / n)


def solve(rows, proj, p):
    """Affine pixel -> projected coordinates by least squares. rows: (u, v, lat, lon) with u, v scaled pixels."""
    import numpy as np
    A = np.array([[1, u, v] for u, v, _, _ in rows])
    XY = np.array([project(proj, p, la, lo) for _, _, la, lo in rows])
    return np.linalg.lstsq(A, XY[:, 0], rcond=None)[0].tolist() + np.linalg.lstsq(A, XY[:, 1], rcond=None)[0].tolist()


def evaluate(model, x, y):
    u, v = x / model["scale"], y / model["scale"]
    c = model["A"]
    return unproject(model["proj"], model["p"], c[0] + c[1] * u + c[2] * v, c[3] + c[4] * u + c[5] * v)


def to_pixel(model, lat, lon):
    X, Y = project(model["proj"], model["p"], lat, lon)
    c = model["A"]
    det = c[1] * c[5] - c[2] * c[4]
    dx, dy = X - c[0], Y - c[3]
    return (c[5] * dx - c[2] * dy) / det * model["scale"], (-c[4] * dx + c[1] * dy) / det * model["scale"]


def candidates(rows):
    lat0 = math.radians(sum(r[2] for r in rows) / len(rows))
    yield "eq", [lat0]
    yield "merc", []
    for k in range(2, 100, 2):
        yield "lcc", [k / 100]


_pix = {}


def snap(src, x, y, mode, radius=9):
    """Move a marked point onto the centre of the town dot nearest to it.

    mode "red": the red dots of most of these maps; "dark": black dots or squares. Returns (x, y, moved_by)
    or the point unchanged when no dot of a sensible size is close by.
    """
    import numpy as np
    if src not in _pix:
        from PIL import Image
        _pix[src] = np.asarray(Image.open(os.path.join(OUT, src)).convert("RGB"), dtype=np.int16)
    a = _pix[src]
    H, W, _ = a.shape
    x0, y0, x1, y1 = max(0, int(x - radius)), max(0, int(y - radius)), min(W, int(x + radius) + 1), min(H, int(y + radius) + 1)
    c = a[y0:y1, x0:x1]
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    if mode == "red":
        m = (r > 150) & (r - g > 70) & (r - b > 60)
    else:
        m = (r < 80) & (g < 80) & (b < 80)
    # connected pieces of the mask, flood fill
    seen = np.zeros_like(m, dtype=bool)
    best = None
    for sy, sx in zip(*np.nonzero(m)):
        if seen[sy, sx]:
            continue
        stack, cells = [(sy, sx)], []
        seen[sy, sx] = True
        while stack:
            cy, cx = stack.pop()
            cells.append((cy, cx))
            for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                if 0 <= ny < m.shape[0] and 0 <= nx < m.shape[1] and m[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    stack.append((ny, nx))
        if not 3 <= len(cells) <= 150:
            continue
        ys, xs = zip(*cells)
        if max(ys) - min(ys) > 14 or max(xs) - min(xs) > 14:        # a line or a letter, not a dot
            continue
        cx, cy = x0 + sum(xs) / len(xs) + 0.5, y0 + sum(ys) / len(ys) + 0.5
        d = math.hypot(cx - x, cy - y)
        if best is None or d < best[2]:
            best = (cx, cy, d)
    return best if best else (x, y, None)


def fit_panel(panel, src=None):
    """Fit one panel: snap the marked points if asked, then pick the projection that predicts left-out places best."""
    pts = [resolve(p) for p in panel["pts"]]
    panel["_moved"] = []
    if panel.get("snap") and src:
        snapped = []
        for x, y, la, lo, n in pts:
            sx, sy, d = snap(src, x, y, panel["snap"])
            snapped.append((sx, sy, la, lo, n))
            panel["_moved"].append(d)
        pts = snapped
    if len(pts) < 3:
        raise SystemExit(f"panel {panel.get('label', panel['box'])}: needs at least 3 places, has {len(pts)}")
    box = panel["box"]
    scale = max(box[2] - box[0], box[3] - box[1])
    rows = [(x / scale, y / scale, la, lo) for x, y, la, lo, _ in pts]

    def loo(proj, p):
        errs = []
        for i in range(len(rows)):
            m = {"proj": proj, "p": p, "A": solve(rows[:i] + rows[i + 1:], proj, p), "scale": 1}
            errs.append(km(*evaluate(m, rows[i][0], rows[i][1]), rows[i][2], rows[i][3]))
        return errs
    if len(rows) >= 4:
        held, proj, p = min(((loo(pr, pp), pr, pp) for pr, pp in candidates(rows)), key=lambda t: _rms(t[0]))
    else:
        held, proj, p = [], "eq", next(candidates(rows))[1]
    model = {"proj": proj, "p": p, "A": solve(rows, proj, p), "scale": scale}
    resid = [km(*evaluate(model, x, y), a, b) for x, y, a, b, _ in pts]
    checks = []
    for q in panel.get("check", []):
        x, y, a, b, name = resolve(q)
        if panel.get("snap") and src:
            x, y, _ = snap(src, x, y, panel["snap"])
        checks.append((name, km(*evaluate(model, x, y), a, b), x, y, a, b))
    errs = held + [c[1] for c in checks]
    err = _rms(errs) if errs else (max(resid) if resid else 0)
    return model, pts, resid, checks, held, err


def _rms(v):
    return math.sqrt(sum(e * e for e in v) / len(v)) if v else 0.0


def load_cal(path):
    return json.load(open(path, encoding="utf-8-sig"))      # -sig: a file saved by Windows PowerShell starts with a byte-order mark


def report(path):
    cal = load_cal(path)
    print(f"{os.path.basename(path)}  {cal.get('title', '')}  status={cal.get('status')}")
    if cal.get("status") != "ok":
        print("  ", cal.get("note", ""))
        return True
    good = True
    for panel in cal["panels"]:
        if panel.get("none"):
            print(f"  panel {panel.get('label', '')} box {panel['box']}  no coordinates here (an area left out of the map around it)")
            continue
        model, pts, resid, checks, held, err = fit_panel(panel, cal["src"])
        span = km(*evaluate(model, panel["box"][0], panel["box"][1]), *evaluate(model, panel["box"][2], panel["box"][3]))
        proj = model["proj"] + (f" n={model['p'][0]:.2f}" if model["proj"] == "lcc" else "")
        print(f"  panel {panel.get('label', '')} box {panel['box']}  projection {proj}  {len(pts)} places  "
              f"map diagonal {span:.0f} km  estimated error {err:.1f} km ({100 * err / max(span, 1):.1f}% of the diagonal)")
        moved = panel.get("_moved") or [None] * len(pts)
        for (x, y, la, lo, name), r, h, mv in zip(pts, resid, held or [None] * len(pts), moved):
            snapped = "" if not panel.get("snap") else ("  (no dot found: kept as marked)" if mv is None else f"  (snapped {mv:.1f} px)")
            print(f"     fit   {name:24} at ({x:6.1f},{y:6.1f})  off by {r:6.1f} km" + (f"   left-out {h:6.1f} km" if h is not None else "") + snapped)
        for name, e, x, y, _, _ in checks:
            print(f"     check {name:24} at ({x:6.1f},{y:6.1f})  off by {e:6.1f} km")
        if len(pts) < 5:
            good = False
            print("     !! use at least 5 places, spread out over the panel, so the error can be estimated")
        if err > max(0.03 * span, 2):
            good = False
            print("     !! error is more than 3% of the map: a point is probably misplaced or misidentified")
    return good


# ---------------------------------------------------------------- pictures
def _font(size):
    from PIL import ImageFont
    for f in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def grid(src, out, box=None):
    """The picture (or the box x0 y0 x1 y1 of it), enlarged, with grid lines labelled in picture pixels."""
    from PIL import Image, ImageDraw
    im = Image.open(os.path.join(OUT, src)).convert("RGB")
    x0, y0, x1, y1 = box or (0, 0, im.width, im.height)
    crop = im.crop((x0, y0, x1, y1))
    k = min(4.0, 1400 / max(crop.width, crop.height))
    big = crop.resize((round(crop.width * k), round(crop.height * k)), Image.LANCZOS)
    pad = 44
    canvas = Image.new("RGB", (big.width + 2 * pad, big.height + 2 * pad), "white")
    canvas.paste(big, (pad, pad))
    d = ImageDraw.Draw(canvas, "RGBA")
    span = max(x1 - x0, y1 - y0)
    step = next(s for s in (5, 10, 20, 25, 50, 100, 200) if span / s <= 28)
    f = _font(13)
    for gx in range((x0 // step + 1) * step if x0 % step else x0, x1 + 1, step):
        X = pad + (gx - x0) * k
        major = gx % (step * 2) == 0
        d.line([(X, pad), (X, pad + big.height)], fill=(255, 0, 200, 150 if major else 70), width=1)
        if major:
            for Y in (2, pad + big.height + 6):
                d.text((X, Y), str(gx), fill="black", font=f, anchor="ma" if Y > 2 else "ma")
    for gy in range((y0 // step + 1) * step if y0 % step else y0, y1 + 1, step):
        Y = pad + (gy - y0) * k
        major = gy % (step * 2) == 0
        d.line([(pad, Y), (pad + big.width, Y)], fill=(255, 0, 200, 150 if major else 70), width=1)
        if major:
            d.text((pad - 4, Y), str(gy), fill="black", font=f, anchor="rm")
            d.text((pad + big.width + 4, Y), str(gy), fill="black", font=f, anchor="lm")
    canvas.save(out)
    print(f"{out}: picture {im.width}x{im.height}, showing {x0},{y0}-{x1},{y1} at {k:.2f}x, grid every {step} px (labels every {2 * step})")


def check(path, out):
    """Picture with each fitted place (green ring = where its dot was marked, red cross = where the fit puts it)."""
    from PIL import Image, ImageDraw
    cal = load_cal(path)
    im = Image.open(os.path.join(OUT, cal["src"])).convert("RGB")
    k = min(3.0, 1400 / max(im.width, im.height))
    big = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    d = ImageDraw.Draw(big, "RGBA")
    f = _font(13)
    for panel in cal["panels"]:
        b = [v * k for v in panel["box"]]
        if panel.get("none"):
            d.rectangle(b, outline=(120, 120, 120, 220), width=2)
            d.line([(b[0], b[1]), (b[2], b[3])], fill=(120, 120, 120, 160), width=1)
            d.line([(b[0], b[3]), (b[2], b[1])], fill=(120, 120, 120, 160), width=1)
            continue
        model, pts, resid, checks, held, err = fit_panel(panel, cal["src"])
        d.rectangle(b, outline=(0, 120, 255, 200), width=2)
        everything = [(x, y, la, lo, n, (0, 170, 0)) for x, y, la, lo, n in pts]
        everything += [(x, y, la, lo, n, (255, 140, 0)) for n, e, x, y, la, lo in checks]
        for x, y, la, lo, name, col in everything:
            px, py = to_pixel(model, la, lo)
            X, Y, PX, PY = x * k, y * k, px * k, py * k
            d.ellipse([X - 7, Y - 7, X + 7, Y + 7], outline=col + (255,), width=2)
            d.line([(PX - 6, PY), (PX + 6, PY)], fill=(230, 0, 0, 255), width=2)
            d.line([(PX, PY - 6), (PX, PY + 6)], fill=(230, 0, 0, 255), width=2)
            d.text((X + 9, Y - 8), name, fill=col + (255,), font=f, stroke_width=2, stroke_fill="white")
    big.save(out)
    print(f"{out}: green rings = marked dots used for the fit, orange = check places, red crosses = where the fit puts them")


# ---------------------------------------------------------------- output for the app
def compile_all():
    out, skipped, bad = {}, [], []
    for path in sorted(glob.glob(os.path.join(MAPS, "*.json"))):
        cal = load_cal(path)
        if cal.get("status") != "ok":
            skipped.append(cal.get("title", os.path.basename(path)))
            continue
        panels = []
        for panel in cal["panels"]:
            if panel.get("none"):
                panels.append({"box": panel["box"], "none": 1})
                continue
            model, pts, resid, checks, held, err = fit_panel(panel, cal["src"])
            if err > 0.06 * km(*evaluate(model, *panel["box"][:2]), *evaluate(model, *panel["box"][2:])):
                bad.append(f"{os.path.basename(path)} {panel.get('label', '')}: {err:.1f} km")
            panels.append({"box": panel["box"], "proj": model["proj"], "p": [round(v, 6) for v in model["p"]],
                           "A": [round(v, 10) for v in model["A"]], "s": model["scale"], "err": round(max(err, 0.5), 1)})
        out[cal["src"]] = panels
    path = os.path.join(OUT, "data", "geo.js")
    with open(path, "w", encoding="utf-8") as f:
        f.write("NIV.geo(" + json.dumps(out, separators=(",", ":")) + ");\n")
    print(f"wrote {path}: {len(out)} calibrated pictures, {len(skipped)} skipped")
    for b in bad:
        print("  !! large error:", b)


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "find":
        for q in args:
            hits = find(q)
            print(f"{q}:" if hits else f"{q}: no match")
            for h in hits[:8]:
                print(f"   {h['id']}  {h['n']:24} {h['lat']:9.4f} {h['lon']:9.4f}  confidence {h['conf']:4}  now: {h['modern']}" + ("  (modern place)" if h.get("is_modern") else ""))
    elif cmd == "wd":
        for q in args:
            try:
                hits = wd_search(q)
            except Exception as e:                            # keep going with the other names
                print(f"{q}: lookup failed ({e}); try again in a minute")
                continue
            print(f"{q}:" if hits else f"{q}: nothing on Wikidata with coordinates")
            for h in hits[:8]:
                print(f"   {h['id']:10} {h['n']:28} {h['lat']:9.4f} {h['lon']:9.4f}  {h['desc'][:60]}")
    elif cmd == "grid":
        grid(args[0], args[1], [int(v) for v in args[2:6]] if len(args) >= 6 else None)
    elif cmd == "fit":
        ok = all([report(p) for p in args])
        sys.exit(0 if ok else 1)
    elif cmd == "check":
        check(args[0], args[1])
    elif cmd == "compile":
        compile_all()
    else:
        raise SystemExit(__doc__)
