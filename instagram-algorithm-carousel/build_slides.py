#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_slides.py — ساخت نسخه نهایی اسلایدهای اینستاگرام (۱۰۸۰×۱۰۰)

آرت سه‌بعدی هر اسلاید + تایپوگرافی فارسیِ واقعی (Vazirmatn + reshaper + bidi).
متن‌ها در slides.json است؛ بعد از هر ویرایش این فایل را دوباره اجرا کنید.

    python3 build_slides.py

خروجی در هر پوشه اسلاید:
    slide-N-post.png   آماده آپلود در اینستاگرام (۱۰۸۰×۱۰۸)
    slide-N-post.jpg   نسخه سبک برای پیش‌نمایش وب
"""
import json
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

ROOT = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(ROOT, "slides.json"), encoding="utf-8"))

W = H = int(CFG.get("canvas", 1080))
PAD = int(W * 0.070)
FOOT = int(H * .062)                 # فضای رزرو شده برای خط پایین

CYAN = (94, 230, 240)
MAGENTA = (255, 79, 163)
VIOLET = (168, 154, 255)
WHITE = (255, 255, 255)
DIM = (208, 202, 238)
FAINT = (162, 156, 200)

PER_DIGIT0, PER_THOUSANDS, PER_PERCENT, ZWNJ = 0x06F0, "\u060c", "\u066a", "\u200c"
_fonts = {}


def localize(s):
    out = []
    for ch in str(s):
        if ch.isdigit() and ch.isascii():
            out.append(chr(PER_DIGIT0 + int(ch)))
        elif ch == ",":
            out.append(PER_THOUSANDS)
        elif ch == "%":
            out.append(PER_PERCENT)
        else:
            out.append(ch)
    return "".join(out)


def font(weight, size):
    key = (weight, int(size))
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(
            os.path.join(ROOT, "fonts", f"Vazirmatn-{weight}.ttf"), int(size))
    return _fonts[key]


def shape(text):
    """ارقام فارسی + اتصال حروف + ترتیب بصری راست‌به‌چپ."""
    return get_display(arabic_reshaper.reshape(localize(text)).replace(ZWNJ, ""))


def tw(weight, size, text):
    return font(weight, size).getlength(shape(text))


def fit_one_line(text, weight, size, max_w, min_size):
    while size > min_size and tw(weight, size, text) > max_w:
        size -= 1
    return text, size


def wrap(text, weight, size, max_w):
    out = []
    for para in str(text).split("\n"):
        line = ""
        for wd in para.split(" "):
            trial = (line + " " + wd).strip()
            if tw(weight, size, trial) <= max_w or not line:
                line = trial
            else:
                out.append(line)
                line = wd
        out.append(line)
    return out


def mix(c1, c2, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c1, c2))


def cover_fit(img, w, h, zoom=1.0, fy=0.5):
    r = max(w / img.width, h / img.height) * zoom
    big = img.resize((round(img.width * r), round(img.height * r)), Image.LANCZOS)
    top = int(round((big.height - h) * fy))
    left = (big.width - w) // 2
    return big.crop((left, top, left + w, top + h))


def fade_mask(hold, end):
    """ماسک عمودی آرت: تا `hold` کاملاً پیداست، در `end` ناپدید می‌شود."""
    m = Image.new("L", (W, H), 255)
    d = ImageDraw.Draw(m)
    h0 = max(0, hold)
    for y in range(h0, H):
        t = min(1.0, max(0.0, (y - h0) / max(1, end - h0)))
        d.line([(0, y), (W, y)], fill=int(255 * (1 - t)))
    return m


def vgrad_image(top, bottom):
    img = Image.new("RGB", (W, H), top)
    d = ImageDraw.Draw(img)
    for y in range(H):
        t = max(0.0, (y - H * .45) / (H * .55))
        d.line([(0, y), (W, y)], fill=mix(top, bottom, t))
    return img


# --------------------------------------------------------------- layers
class Canvas:
    """سه لایه: پس‌زمینه توپر → شکل‌های نیمه‌شفاف (fx) → متن (tx).

    ImageDraw روی تصاویر RGBA ترکیب رنگی انجام نمی‌دهد؛ پس هر چیز
    نیمه‌شفاف روی لایه جداکش نقش می‌بندد و در پایان alpha_composite می‌شود.
    """

    def __init__(self, base_rgb):
        self.base = base_rgb.convert("RGBA")
        self.dbase = ImageDraw.Draw(self.base)
        self.fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.tx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        self.dfx = ImageDraw.Draw(self.fx)
        self.dtx = ImageDraw.Draw(self.tx)

    def rounded(self, box, rad, fill=None, outline=None, width=1, soft=True):
        d = self.dfx if soft else self.dtx
        d.rounded_rectangle(box, radius=rad, fill=fill, outline=outline, width=width)

    def line(self, pts, fill, width=1, joint=None, soft=False):
        (self.dfx if soft else self.dtx).line(pts, fill=fill, width=width, joint=joint)

    def ellipse(self, box, fill, soft=False):
        (self.dfx if soft else self.dtx).ellipse(box, fill=fill)

    def polygon(self, pts, fill, soft=False):
        (self.dfx if soft else self.dtx).polygon(pts, fill=fill)

    def rows(self, y0, y1, color_fn, layer="fx"):
        d = {"fx": self.dfx, "tx": self.dtx, "base": self.dbase}[layer]
        for y in range(max(0, y0), min(H, y1)):
            d.line([(0, y), (W, y)], fill=color_fn(y))

    def blit(self, img, mask=None, pos=(0, 0)):
        self.base.paste(img, pos, mask)

    def result(self):
        self.base.alpha_composite(self.fx)
        self.base.alpha_composite(self.tx)
        return self.base.convert("RGB")


def rtext(c, xy, text, weight, size, fill):
    c.dtx.text((xy[0], xy[1]), shape(text), font=font(weight, size), fill=fill, anchor="ra")


def ltext(c, xy, text, weight, size, fill):
    c.dtx.text((xy[0], xy[1]), shape(text), font=font(weight, size), fill=fill, anchor="la")


def mtext(c, xy, text, weight, size, fill):
    c.dtx.text((xy[0], xy[1]), shape(text), font=font(weight, size), fill=fill, anchor="rm")


def cttext(c, xy, text, weight, size, fill):
    c.dtx.text((xy[0], xy[1]), shape(text), font=font(weight, size), fill=fill, anchor="mm")


# --------------------------------------------------------------- widgets
def pill(c, x_right, y, label, size=26, fg=CYAN, bg=(255, 255, 255, 30)):
    h = int(W * .048)
    wpx = tw("SemiBold", size, label) + 2 * int(W * .024)
    c.rounded([x_right - wpx, y, x_right, y + h], h / 2, fill=bg)
    cttext(c, (x_right - wpx / 2, y + h / 2), label, "SemiBold", size, fg)
    return h


def gradient_bar(c, box, frac, track=(255, 255, 255, 34)):
    x0, y0, x1, y1 = box
    hh = y1 - y0
    c.rounded(box, hh / 2, fill=track)
    fx = x0 + max(hh, int((x1 - x0) * frac))
    for i in range(max(1, fx - x0)):
        col = mix(CYAN, MAGENTA, i / max(1, fx - x0)) + (255,)
        c.line([(x0 + i, y0 + 1), (x0 + i, y1 - 1)], col, 1)


def check_box(c, box, on=True):
    x0, y0, x1, y1 = box
    s = x1 - x0
    c.rounded(box, s * .30, fill=(CYAN + (46,) if on else (255, 255, 255, 20)),
              outline=None if on else (255, 255, 255, 70), width=2)
    if on:
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        c.line([(cx - s * .21, cy), (cx - s * .04, cy + s * .17), (cx + s * .24, cy - s * .17)],
               CYAN + (255,), max(3, int(s * .12)), joint="curve")


def chip(c, x_left, cy, label, color=CYAN, size=24):
    padx, pady = 18, 9
    wpx = tw("SemiBold", size, label) + 2 * padx
    hpx = size + 2 * pady
    c.rounded([x_left, cy - hpx / 2, x_left + wpx, cy + hpx / 2], hpx / 2, outline=color, width=2)
    cttext(c, (x_left + wpx / 2, cy), label, "SemiBold", size, color)
    return wpx


def panel_tones(art_rgb):
    strip = art_rgb.crop((0, int(art_rgb.height * .80), art_rgb.width, art_rgb.height)).resize((1, 1))
    base = strip.getpixel((0, 0))[:3]
    return mix(base, (11, 8, 30), .52), mix(base, (4, 3, 14), .86)


# ------------------------------------------------------------------ cover
def build_cover(sl):
    art = cover_fit(Image.open(os.path.join(ROOT, sl["art"])).convert("RGB"), W, H,
                    zoom=sl.get("art_zoom", 1.0), fy=sl.get("art_focus", .5))
    c = Canvas(art)
    dark = (8, 5, 26)
    h_scrim = int(H * sl.get("scrim", .74))
    c.rows(0, h_scrim, lambda y: dark + (int(246 * (1 - y / h_scrim) ** 1.15),))

    xr = W - PAD
    y = int(H * .058)
    ts = sl.get("title_size", 76)
    ss = int(sl.get("sub_size", 28))
    head_h = int(W * .048) + 34 + len(wrap(sl["title"], "Bold", ts, W - 2 * PAD)) * int(ts * 1.18) \
        + 16 + len(wrap(sl["sub"], "Medium", ss, int(W * .88))) * int(ss * 1.5)
    c.rounded([PAD - 14, y - 18, W - PAD + 14, y + head_h + 16], 30, fill=(11, 7, 34, 148))
    c.fx = c.fx.filter(ImageFilter.GaussianBlur(15))   # شیشه مات پشت تیتر
    c.dfx = ImageDraw.Draw(c.fx)

    y += pill(c, xr, y, sl["kicker"], size=27, bg=(255, 255, 255, 44)) + 34
    for ln in wrap(sl["title"], "Bold", ts, W - 2 * PAD):
        rtext(c, (xr, y), ln, "Bold", ts, WHITE)
        y += int(ts * 1.18)
    y += 16
    for ln in wrap(sl["sub"], "Medium", ss, int(W * .88)):
        rtext(c, (xr, y), ln, "Medium", ss, DIM)
        y += int(ss * 1.5)

    cy = int(H * .905)
    label = sl.get("hint", "بکشید")
    lw = tw("Bold", 27, label)
    x1, x0 = W - PAD, W - PAD - lw - 96
    c.rounded([x0, cy - 34, x1, cy + 34], 34, fill=(255, 255, 255, 242))
    mtext(c, (x1 - 28, cy), label, "Bold", 27, (14, 9, 40))
    ax = x0 + 26
    c.polygon([(ax + 16, cy - 13), (ax, cy), (ax + 16, cy + 13)], (14, 9, 40, 255))
    c.line([(ax + 10, cy), (ax + 36, cy)], (14, 9, 40, 255), 5)
    ltext(c, (PAD, int(H * .912)), f"{sl['id']} از {len(CFG['slides'])}", "Medium", 26,
          (255, 255, 255, 215))
    return c.result()


# ------------------------------------------------------------------ panel
ROW_H = {"grid": 78, "meter": 62, "tier": 106, "check": 58}


def mode_of(sl):
    return ("grid" if sl.get("grid") else "tier" if sl.get("tier")
            else "check" if sl.get("check") else "meter")


def n_rows(sl):
    rows = sl.get("rows", [])
    return -(-len(rows) // sl["grid"]) if sl.get("grid") else len(rows)


def measure_block(sl, scale, maxw):
    ts = max(30, int(sl.get("title_size", 54) * scale))
    rh = max(44, int(ROW_H[mode_of(sl)] * scale))
    h = int(W * .048) + 22 + len(wrap(sl["title"], "Bold", ts, maxw)) * int(ts * 1.20) + 22
    if mode_of(sl) == "meter" and sl.get("meter_title"):
        h += 32
    h += n_rows(sl) * rh
    if sl.get("note"):
        h += 18 + len(wrap(sl["note"], "Medium", max(21, int(27 * scale)), maxw - 40)) * 40
    if sl.get("cta"):
        h += 18 + 66
    return h, ts, rh


def build_panel(sl):
    art = cover_fit(Image.open(os.path.join(ROOT, sl["art"])).convert("RGB"), W, H,
                    zoom=sl.get("art_zoom", 1.0), fy=sl.get("art_focus", .5))
    top, bottom = panel_tones(art)
    floor_ = int(sl.get("panel_floor", 430))
    ceil_ = int(sl.get("panel_top", int(H * .62)))
    xr, maxw = W - PAD, W - 2 * PAD

    scale, ts, rh, panel_top = 1.0, 44, 60, ceil_
    for scale in (1.0, .95, .9, .85, .8, .75, .7):
        need, ts, rh = measure_block(sl, scale, maxw)
        fit = H - FOOT - need - 42
        if fit >= floor_:
            panel_top = max(floor_, min(int(fit), ceil_))
            break
    else:
        panel_top = floor_

    # پس‌زمینه پنل از رنگ خودِ آرت مشتق می‌شود؛ آرت با محوی نرم در پنل آب می‌رود
    c = Canvas(vgrad_image(top, bottom))
    c.blit(art, fade_mask(panel_top - int(H * .075), panel_top + int(H * .055)))

    y = panel_top + 42
    y += pill(c, xr, y, sl["kicker"], size=max(20, int(26 * scale))) + 24
    for ln in wrap(sl["title"], "Bold", ts, maxw):
        rtext(c, (xr, y), ln, "Bold", ts, WHITE)
        y += int(ts * 1.20)
    y += 24

    mode, rows = mode_of(sl), sl.get("rows", [])

    if mode == "grid":
        per, cols = n_rows(sl), sl["grid"]
        colw = (maxw - 40) / cols
        lsz = max(21, int(33 * scale))
        for i, r in enumerate(rows):
            col, row = divmod(i, per)
            cxr = xr - col * (colw + 40)
            cy = y + row * rh
            lab = fit_one_line(r["label"], "SemiBold", lsz, colw - 30, 18)[0]
            rtext(c, (cxr - 26, cy), lab, "SemiBold", lsz, WHITE)
            c.rounded([cxr - 14, cy + int(lsz * .30), cxr - 2, cy + int(lsz * .30) + 12],
                      3, fill=CYAN + (255,), soft=False)
            meta, msz = fit_one_line(r["meta"], "Medium", max(19, int(25 * scale)), colw - 26, 16)
            rtext(c, (cxr - 26, cy + int(rh * .50)), meta, "Medium", msz, FAINT)
        y += per * rh

    elif mode == "meter":
        if sl.get("meter_title"):
            rtext(c, (xr, y - 12), sl["meter_title"], "Medium", max(19, int(25 * scale)), FAINT)
            y += 34
        barw = int(W * .185)
        for r in rows:
            cy = y + rh // 2
            gradient_bar(c, [PAD, cy - 8, PAD + barw, cy + 8], r["bar"])
            ltext(c, (PAD + barw + 22, cy), r["meta"], "Medium", max(19, int(26 * scale)), CYAN)
            used = PAD + barw + 22 + tw("Medium", 26, r["meta"]) + 40
            lab, lsz = fit_one_line(r["label"], "SemiBold", max(22, int(33 * scale)),
                                    maxw - used, 18)
            mtext(c, (xr, cy), lab, "SemiBold", lsz, WHITE)
            y += rh

    elif mode == "tier":
        for r in rows:
            box = [PAD, y, W - PAD, y + rh - 12]
            c.rounded(box, 22, fill=(255, 255, 255, 22))
            c.line([(W - PAD - 4, box[1] + 14), (W - PAD - 4, box[3] - 14)], CYAN + (255,), 4)
            lab, lsz = fit_one_line(r["label"], "SemiBold", max(24, int(33 * scale)), maxw - 260, 20)
            rtext(c, (W - PAD - 30, box[1] + 16), lab, "SemiBold", lsz, WHITE)
            meta, msz = fit_one_line(r["meta"], "Medium", max(21, int(26 * scale)), maxw - 300, 17)
            rtext(c, (W - PAD - 30, box[1] + 16 + lsz + 14), meta, "Medium", msz, DIM)
            chip(c, PAD + 24, box[1] + int(rh * .36), r["chip"],
                 color=MAGENTA if r.get("chip") == "پیک" else CYAN, size=max(19, int(25 * scale)))
            y += rh

    elif mode == "check":
        for i, r in enumerate(rows):
            cy = y + rh // 2
            sq = int(rh * .50)
            check_box(c, [xr - sq, cy - sq / 2, xr, cy + sq / 2], on=i < int(sl.get("checked", 4)))
            lab, lsz = fit_one_line(r["label"], "Medium", max(22, int(31 * scale)),
                                    maxw - sq - 30, 18)
            mtext(c, (xr - sq - 26, cy), lab, "Medium", lsz, WHITE)
            y += rh

    if sl.get("note"):
        y += 20
        ns = max(21, int(27 * scale))
        for ln in wrap(sl["note"], "Medium", ns, maxw - 40):
            c.ellipse([xr - 12, y + int(ns * .40), xr, y + int(ns * .40) + 12], VIOLET + (255,))
            rtext(c, (xr - 28, y), ln, "Medium", ns, FAINT)
            y += int(ns * 1.42)

    if sl.get("cta"):
        y += 20
        size = max(23, int(31 * scale))
        wpx = tw("Bold", size, sl["cta"]) + 2 * int(W * .036)
        hgt = 66
        x0 = W - PAD - wpx
        c.rounded([x0, y, W - PAD, y + hgt], hgt / 2, fill=CYAN + (255,), soft=False)
        cttext(c, (x0 + wpx / 2, y + hgt / 2), sl["cta"], "Bold", size, (12, 8, 34, 255))
        y += hgt

    ltext(c, (PAD, H - FOOT + 14), f"{sl['id']} از {len(CFG['slides'])} · {CFG['footer']}",
          "Regular", 23, (255, 255, 255, 140))
    return c.result()


# ----------------------------------------------------------------- runner
def main():
    for sl in CFG["slides"]:
        folder = os.path.dirname(os.path.join(ROOT, sl["art"]))
        img = build_cover(sl) if sl["layout"] == "cover" else build_panel(sl)
        png = os.path.join(folder, f"slide-{sl['id']}-post.png")
        jpg = os.path.join(folder, f"slide-{sl['id']}-post.jpg")
        img.save(png, "PNG", optimize=True)
        img.save(jpg, "JPEG", quality=90, optimize=True, progressive=True)
        print(f"✓ slide-{sl['id']}-post  {img.width}×{img.height}  "
              f"{os.path.getsize(png) // 1024}KB png · {os.path.getsize(jpg) // 1024}KB jpg")


if __name__ == "__main__":
    main()
