"""Render the Holy Sai Paper Correction demo sheets (app/demo_content.py) as handwritten scans.

    python -m tools.make_holy_sai_demo          # writes app/demo_sheets/<exam>-<admission no>.jpg

Run on Windows (it uses the handwriting fonts there). The images are committed, so the
service can build the demo on any host without these fonts. SAMPLE DATA, not real students.
"""

from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.demo_content import CLASS, EXAMS, SECTION

OUT = Path(__file__).resolve().parents[1] / "app" / "demo_sheets"
FONTS = Path("C:/Windows/Fonts")
W, H = 1240, 1754  # A4 at 150 dpi
LINE = 50
INKS = [(22, 36, 110), (15, 15, 25), (30, 60, 140), (40, 30, 90)]
HANDS = ["Inkfree.ttf", "segoepr.ttf", "BRADHITC.TTF", "mvboli.ttf", "LHANDW.TTF"]
NAMES = {  # the seeded Holy Sai students on these sheets
    "HS-2026-1041": "Aditya Kumar", "HS-2026-1055": "Bhavana Iyer", "HS-2026-1058": "Dinesh Selvam",
    "HS-2026-1076": "Nithya Venkatesh", "HS-2026-1082": "Reshma Chandran", "HS-2026-1085": "Surya Kumar",
}


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def hand_line(img: Image.Image, xy: tuple[int, int], text: str, f: ImageFont.FreeTypeFont, ink, rng: random.Random) -> int:
    """Writes word by word with a little wobble in height, spacing and slant, like a child's hand."""
    x, y = xy
    for word in text.split(" "):
        if not word:
            x += 14
            continue
        w = int(f.getlength(word)) + 12
        tile = Image.new("RGBA", (w + 20, f.size * 2), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((6, 4), word, font=f, fill=ink + (235,))
        tile = tile.rotate(rng.uniform(-3.5, 3.5), resample=Image.BICUBIC, expand=False)
        img.paste(tile, (x, y + rng.randint(-4, 4)), tile)
        x += w + rng.randint(4, 16)
    return x


def sheet(exam: dict, no: str, idx: int) -> Image.Image:
    rng = random.Random(f"{exam['key']}-{no}")
    img = Image.new("RGB", (W, H), (251, 250, 244))
    d = ImageDraw.Draw(img)
    for y in range(260, H - 60, LINE):
        d.line((50, y, W - 50, y), fill=(188, 203, 228), width=1)
    d.line((130, 220, 130, H - 60), fill=(228, 150, 150), width=2)
    # printed header
    d.text((W // 2, 46), "Holy Sai International School · Guduvanchery", font=font("arialbd.ttf", 30), fill="black", anchor="mm")
    d.text((W // 2, 88), f"{exam['name']} · {CLASS.split(' · ')[0]} {SECTION}", font=font("arial.ttf", 26), fill="black", anchor="mm")
    small = font("arial.ttf", 21)
    d.text((70, 140), "Name:", font=small, fill="black")
    d.text((640, 140), "Date:", font=small, fill="black")
    d.text((930, 140), f"Max marks: {sum(q['max'] for q in exam['questions'])}", font=small, fill="black")
    d.line((50, 200, W - 50, 200), fill="black", width=2)

    hand = font(HANDS[idx % len(HANDS)], rng.randint(34, 40))
    ink = INKS[idx % len(INKS)]
    hand_line(img, (140, 120), NAMES[no], hand, ink, rng)
    hand_line(img, (710, 120), "14/10/26", hand, ink, rng)

    sh = next(s for s in exam["sheets"] if s["no"] == no)
    y = 222
    for q in exam["questions"]:
        text = sh["answers"][q["number"]][0]
        hand_line(img, (70 + rng.randint(-6, 6), y), f"{q['number']}.", hand, ink, rng)
        lines = text.split("\n")
        end = 0
        for i, line in enumerate(lines):
            end = hand_line(img, (160 + rng.randint(-8, 10) + (0 if i == 0 else 20), y), line, hand, ink, rng)
            y += LINE
        if rng.random() < 0.25:  # a false start after the answer, struck through
            x0 = end + 40
            x1 = hand_line(img, (x0, y - LINE), rng.choice(["so", "is", "the", "ans"]), hand, ink, rng)
            mid = y - LINE + hand.size // 2 + 6
            d.line((x0 - 4, mid + 3, x1 - 6, mid - 2), fill=ink, width=3)
        y += LINE
    # scan look: slight skew, softness, shadow and grain
    img = img.rotate(rng.uniform(-1.2, 1.2), resample=Image.BICUBIC, fillcolor=(245, 245, 240))
    img = img.filter(ImageFilter.GaussianBlur(0.6))
    shade = Image.linear_gradient("L").resize((W, H)).point(lambda v: 255 - v // 12)
    img = Image.composite(img, Image.new("RGB", (W, H), (225, 222, 212)), shade)
    noise = Image.effect_noise((W, H), 9).convert("RGB")
    return Image.blend(img, noise, 0.04)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for exam in EXAMS:
        for i, s in enumerate(exam["sheets"]):
            path = OUT / f"{exam['key']}-{s['no']}.jpg"
            sheet(exam, s["no"], i).save(path, "JPEG", quality=72, optimize=True)
            print(path.name, path.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
