import json, math, os, random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
from PIL import JpegImagePlugin  # noqa: registers JPEG for PDF output

OUT = sys.argv[1]
F = "C:/Windows/Fonts/"
W, H = 1240, 1754
PAPER = (251, 250, 245)


class Hand:
    def __init__(self, font, size, ink, slant=0.0, jitter=1.2, spacing=1.0, word_rot=1.2,
                 size_var=0.05, drift=0.0, pencil=False, lh=54, seed=1):
        self.path, self.size, self.ink, self.slant = F + font, size, ink, slant
        self.jitter, self.spacing, self.word_rot, self.size_var = jitter, spacing, word_rot, size_var
        self.drift, self.pencil, self.lh = drift, pencil, lh
        self.rng = random.Random(seed)
        self._fonts = {}

    def font(self, sz):
        if sz not in self._fonts:
            self._fonts[sz] = ImageFont.truetype(self.path, sz)
        return self._fonts[sz]

    def measure(self, word, scale=1.0):
        f = self.font(round(self.size * scale))
        return sum(f.getlength(c) for c in word) * self.spacing

    def render_word(self, word, scale=1.0):
        r, size = self.rng, self.size * scale
        pad = int(size * 0.9)
        h, base = int(size * 2.4), int(size * 1.5)
        img = Image.new("L", (int(self.measure(word, scale) * 1.15 + 2 * pad), h), 0)
        d = ImageDraw.Draw(img)
        x = pad
        for c in word:
            f = self.font(max(8, round(size * (1 + r.uniform(-self.size_var, self.size_var)))))
            d.text((x, base + r.gauss(0, self.jitter)), c, font=f, fill=255, anchor="ls")
            x += f.getlength(c) * self.spacing + r.uniform(-0.6, 0.6) * self.jitter
        if self.slant:
            img = img.transform(img.size, Image.AFFINE, (1, self.slant, -self.slant * base, 0, 1, 0),
                                resample=Image.BICUBIC)
        img = img.rotate(r.gauss(0, self.word_rot), center=(pad, base), resample=Image.BICUBIC)
        if self.pencil:
            noise = Image.effect_noise(img.size, 60).point(lambda v: min(255, 120 + v))
            img = ImageChops.multiply(img, noise)
        return img, pad, base, x - pad

    def put(self, page, x, y, word, scale=1.0):
        img, pad, base, w = self.render_word(word.strip("~"), scale)
        op = self.rng.uniform(0.82, 1.0) if not self.pencil else self.rng.uniform(0.7, 0.85)
        mask = img.point(lambda v: int(v * op))
        ink = tuple(max(0, min(255, c + self.rng.randint(-12, 12))) for c in self.ink)
        page.paste(Image.new("RGB", img.size, ink), (int(x - pad), int(y - base)), mask)
        if word.startswith("~") and word.endswith("~"):   # crossed-out word
            d = ImageDraw.Draw(page)
            yy = y - self.size * 0.33
            pts = [(x - 4 + i * (w + 8) / 6, yy + self.rng.gauss(0, 1.5)) for i in range(7)]
            d.line(pts, fill=self.ink, width=3)
            d.line([(px, py + 5) for px, py in pts], fill=self.ink, width=2)
        return w

    def line_text(self, page, x, y, text, scale=1.0):
        space = self.font(round(self.size * scale)).getlength(" ")
        for word in text.split(" "):
            if word:
                x += self.put(page, x, y, word, scale)
            x += space * self.rng.uniform(0.9, 1.4)
        return x


def wobbly(d, pts, ink, width=3, rng=random):
    out = []
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        n = max(2, int(math.hypot(x2 - x1, y2 - y1) / 6))
        out += [(x1 + (x2 - x1) * t / n + rng.gauss(0, 0.6), y1 + (y2 - y1) * t / n + rng.gauss(0, 0.6))
                for t in range(n)]
    out.append(pts[-1])
    d.line(out, fill=ink, width=width, joint="curve")


def arrow(d, a, b, ink, rng):
    wobbly(d, [a, b], ink, 3, rng)
    ang = math.atan2(b[1] - a[1], b[0] - a[0])
    for s in (2.6, -2.6):
        wobbly(d, [b, (b[0] + 16 * math.cos(ang + s), b[1] + 16 * math.sin(ang + s))], ink, 3, rng)


def water_cycle(page, x, y, w, h, hand, labels):
    d, ink, r = ImageDraw.Draw(page), hand.ink, hand.rng
    # sun
    cx, cy, rad = x + 70, y + 60, 32
    wobbly(d, [(cx + rad * math.cos(t / 20 * 2 * math.pi), cy + rad * math.sin(t / 20 * 2 * math.pi))
               for t in range(21)], ink, 3, r)
    for k in range(8):
        t = k / 8 * 2 * math.pi
        wobbly(d, [(cx + 42 * math.cos(t), cy + 42 * math.sin(t)), (cx + 58 * math.cos(t), cy + 58 * math.sin(t))], ink, 2, r)
    # cloud
    bx, by = x + w * 0.45, y + 50
    for i in range(5):
        ccx, ccy, cr = bx + i * 34, by + (0 if i % 2 else 12), 28
        wobbly(d, [(ccx + cr * math.cos(t / 12 * math.pi + math.pi), ccy + cr * math.sin(t / 12 * math.pi + math.pi))
                   for t in range(13)], ink, 3, r)
    wobbly(d, [(bx - 28, by + 12), (bx + 4 * 34 + 28, by + 12)], ink, 3, r)
    # mountain + sea
    wobbly(d, [(x + w * 0.72, y + h - 40), (x + w * 0.86, y + h * 0.5), (x + w * 1.0, y + h - 40)], ink, 3, r)
    for row in range(3):
        yy = y + h - 40 + row * 14
        wobbly(d, [(x + 10 + k * 18, yy + (6 if k % 2 else 0)) for k in range(int(w * 0.55 / 18))], ink, 2, r)
    # arrows
    arrow(d, (x + w * 0.25, y + h - 60), (x + w * 0.38, y + 95), ink, r)
    arrow(d, (x + w * 0.42, y + 20), (x + w * 0.62, y + 15), ink, r)
    for k in range(5):
        xx = x + w * 0.50 + k * 18
        wobbly(d, [(xx, y + 95), (xx - 6, y + 130)], ink, 2, r)
    arrow(d, (x + w * 0.76, y + h - 52), (x + w * 0.58, y + h - 48), ink, r)
    pos = {"evaporation": (x + w * 0.05, y + h * 0.55), "condensation": (x + w * 0.36, y - 8),
           "precipitation": (x + w * 0.64, y + 122), "collection": (x + w * 0.58, y + h - 8),
           "sun": (x + 40, y + 135), "cloud": (x + w * 0.70, y + 55), "sea": (x + 30, y + h + 30)}
    for key, text in labels.items():
        hand.line_text(page, *pos[key], text, 0.8)


def printed(size, bold=False):
    return ImageFont.truetype(F + ("arialbd.ttf" if bold else "arial.ttf"), size)


class Doc:
    TOP, BOTTOM, LEFT, RIGHT = 250, 1680, 165, 1150

    def __init__(self, hand, kind, meta):
        self.hand, self.kind, self.meta, self.pages = hand, kind, meta, []
        self.new_page()

    def new_page(self):
        img = Image.new("RGB", (W, H), PAPER)
        d = ImageDraw.Draw(img)
        lh = self.hand.lh
        if self.kind == "answer":
            m = self.meta
            d.text((W / 2, 45), m["school"], font=printed(30, True), fill=(20, 20, 20), anchor="mt")
            d.text((W / 2, 88), f'{m["exam"]} · Class {m["class"]}', font=printed(23), fill=(30, 30, 30), anchor="mt")
            d.text((75, 150), "Name:", font=printed(20), fill=(30, 30, 30))
            d.text((620, 150), "Roll No:", font=printed(20), fill=(30, 30, 30))
            d.line([(55, 195), (1180, 192)], fill=(30, 30, 30), width=2)
            if not self.pages:
                self.hand.line_text(img, 160, 172, m["name"])
                self.hand.line_text(img, 725, 172, m["roll"])
            else:
                self.hand.line_text(img, 160, 172, m["name"].split()[0])
            y = self.TOP
            while y < self.BOTTOM + 10:
                d.line([(60, y + 8), (1185, y + 6)], fill=(170, 190, 225), width=1)
                y += lh
            d.line([(140, 205), (144, self.BOTTOM + 15)], fill=(235, 130, 140), width=2)
            self.y = self.TOP
        else:
            self.y = 90
        self.pages.append(img)

    def need(self, px):
        if self.y + px > self.BOTTOM:
            self.new_page()

    def write(self, text, indent=0, hang=50, center=False, scale=1.0):
        h, page = self.hand, self.pages[-1]
        lh = h.lh * max(1.0, scale)
        if center:
            self.need(lh)
            w = h.measure(text, scale) * 1.1
            h.line_text(self.pages[-1], (W - w) / 2, self.y + h.rng.gauss(0, 2), text, scale)
            self.y += lh
            return
        text, _, marks = text.partition(" | ")
        words, line, lines = text.split(" "), [], []
        limit = self.RIGHT - self.LEFT - indent - (h.measure(marks, scale) * 1.2 + 30 if marks else 0)
        space = h.font(round(h.size * scale)).getlength(" ") * 1.15
        for wd in words:
            cur = sum(h.measure(x.strip("~"), scale) + space for x in line + [wd])
            if line and cur > limit - (hang if lines else 0):
                lines.append(" ".join(line)); line = []
            line.append(wd)
        lines.append(" ".join(line))
        for i, ln in enumerate(lines):
            self.need(lh)
            page = self.pages[-1]
            x = self.LEFT + indent + (hang if i else 0) + h.rng.gauss(0, 3)
            slope = math.tan(math.radians(h.rng.gauss(h.drift, 0.35)))
            sx, base = x, self.y + h.rng.gauss(0, 2)
            space = h.font(round(h.size * scale)).getlength(" ")
            for wd in ln.split(" "):
                if wd:
                    x += h.put(page, x, base - (x - sx) * slope, wd, scale)
                x += space * h.rng.uniform(0.9, 1.45)
            if marks and i == 0:
                h.line_text(page, self.RIGHT - h.measure(marks, scale) * 1.15, base + h.rng.gauss(0, 2), marks, scale)
            self.y += lh

    def gap(self, n=1):
        self.y += self.hand.lh * n

    def diagram(self, lines, labels):
        hpx = self.hand.lh * lines
        self.need(hpx)
        water_cycle(self.pages[-1], self.LEFT + 40, self.y - 10, 820, hpx - 70, self.hand, labels)
        self.y += hpx

    def finish(self, seed):
        out, n = [], len(self.pages)
        r = random.Random(seed)
        for i, img in enumerate(self.pages):
            if self.kind == "answer":
                ImageDraw.Draw(img).text((900, 150), f"Page {i + 1} of {n}", font=printed(20), fill=(30, 30, 30))
            noise = Image.effect_noise((W, H), 9).convert("RGB")
            img = Image.blend(img, ImageChops.multiply(img, noise.point(lambda v: min(255, v + 140))), 0.25)
            shade = Image.linear_gradient("L").rotate(r.choice([90, -90, 0, 180])).resize((W, H))
            img = ImageChops.multiply(img, Image.merge("RGB", [shade.point(lambda v: 255 - v // 28)] * 3))
            img = img.filter(ImageFilter.GaussianBlur(0.45))
            img = img.rotate(r.uniform(-0.8, 0.8), resample=Image.BICUBIC, fillcolor=(228, 228, 224))
            out.append(img)
        return out


def save(pages, stem):
    for i, p in enumerate(pages, 1):
        p.save(f"{stem}_page{i}.png")
    pages[0].save(f"{stem}.pdf", save_all=True, append_images=pages[1:], resolution=150)


SCHOOL, EXAM, CLASS = "Holy Sai School", "Unit Test 2 — Science", "5"

# ---------- question paper (teacher's handwriting) ----------
teacher = Hand("segoepr.ttf", 25, (25, 25, 30), jitter=0.8, word_rot=0.6, lh=50, seed=11)
qp = Doc(teacher, "plain", {})
qp.write("Holy Sai School", center=True, scale=1.35)
qp.write("Unit Test 2 — Science", center=True, scale=1.1)
qp.write("Class: V      Max. Marks: 20      Time: 1 hour", center=True)
qp.write("Answer all the questions. Write neatly.", indent=0)
qp.gap(0.4)
qp.write("1. Fill in the blanks. | (4 x 1 = 4)")
for t in ["a) Plants make their own food by the process of ________.",
          "b) Water changes into water vapour by ________.",
          "c) The hardest part of our body is the ________ of the teeth.",
          "d) The planet closest to the Sun is ________."]:
    qp.write(t, indent=40, hang=30)
qp.gap(0.3)
qp.write("2. Write True or False. | (3 x 1 = 3)")
for t in ["a) A bat is a bird.", "b) Magnets attract iron nails.", "c) Sound travels faster than light."]:
    qp.write(t, indent=40)
qp.gap(0.3)
qp.write("3. Name the following. | (3 x 1 = 3)")
for t in ["a) The gas we breathe in to stay alive.", "b) The largest planet in our solar system.",
          "c) The organ that pumps blood in our body."]:
    qp.write(t, indent=40)
qp.gap(0.3)
qp.write("4. Why should we not waste water? Give two reasons. | (2)")
qp.write("5. Write two differences between solids and liquids. | (2)")
qp.write("6. Draw a neat diagram of the water cycle and label it. | (3)")
qp.write("7. What is a balanced diet? Name two nutrients and one food source for each. | (3)", hang=30)
qp.gap(0.6)
qp.write("*** All the best ***", center=True)
save(qp.finish(5), os.path.join(OUT, "question_paper"))

# ---------- three answer sheets ----------
students = [
    dict(adm="S5001", name="Meena R", roll="4",
         hand=Hand("Inkfree.ttf", 33, (25, 45, 140), jitter=1.0, word_rot=0.8, seed=21),
         ops=[("t", "1. a) photosynthesis"), ("i", "b) evaporation"), ("i", "c) enamel"), ("i", "d) Mercury"),
              ("g",), ("t", "2. a) False"), ("i", "b) True"), ("i", "c) False"), ("g",),
              ("t", "3. a) Oxygen"), ("i", "b) Jupiter"), ("i", "c) Heart"), ("g",),
              ("t", "4. We should not waste water because only a small amount of water on Earth is fresh and safe to drink. Also, people, plants and animals all need water to live, so if we waste it there will be shortage in future."),
              ("g",),
              ("t", "5. (i) Solids have a fixed shape but liquids take the shape of the container."),
              ("i", "(ii) Solids have a fixed volume and cannot flow, but liquids can flow easily."),
              ("g",), ("n", 8), ("t", "6. Water cycle"),
              ("d", 7, {"evaporation": "evaporation", "condensation": "condensation",
                        "precipitation": "rain (precipitation)", "collection": "collection", "sun": "Sun"}),
              ("t", "7. A balanced diet is food that has all the nutrients in the right amount which our body needs to stay healthy."),
              ("i", "Proteins - eggs, dal"), ("i", "Carbohydrates - rice, chapati")],
         answers={"1": "a) photosynthesis b) evaporation c) enamel d) Mercury", "2": "a) False b) True c) False",
                  "3": "a) Oxygen b) Jupiter c) Heart",
                  "4": "Only a small amount of water on Earth is fresh and safe to drink. People, plants and animals all need water to live, so wasting it will cause shortage in future.",
                  "5": "(i) Solids have a fixed shape but liquids take the shape of the container. (ii) Solids have a fixed volume and cannot flow, but liquids can flow easily.",
                  "6": "[Diagram: sun, sea, cloud, mountain; labels: evaporation, condensation, rain (precipitation), collection, Sun]",
                  "7": "A balanced diet is food that has all the nutrients in the right amount which our body needs to stay healthy. Proteins - eggs, dal. Carbohydrates - rice, chapati."},
         expected={"1": 4, "2": 3, "3": 3, "4": 2, "5": 2, "6": 3, "7": 3}),
    dict(adm="S5002", name="Sanjay K", roll="7",
         hand=Hand("BRADHITC.TTF", 31, (20, 20, 25), slant=0.18, jitter=1.4, word_rot=1.4, drift=0.5, seed=33),
         ops=[("t", "1. a) Photosynthesis"), ("i", "b) evaporation"), ("i", "c) ~bone~ enamel"), ("i", "d) Venus"),
              ("g",), ("t", "2. a) False"), ("i", "b) True"), ("i", "c) True"), ("g",),
              ("t", "3. a) oxygen   b) Jupiter   c) heart"), ("g",),
              ("t", "4. We should not waste water because water is very ~precius~ precious and we need it for drinking and cooking."),
              ("g",),
              ("t", "5. Solids have fixed shape. Liquids do not have fixed shape. Solids are hard and liquids can flow."),
              ("g",), ("t", "6."),
              ("d", 7, {"evaporation": "evaporation", "precipitation": "rain", "sun": "sun", "cloud": "clouds"}),
              ("t", "7. Balanced diet means eating all types of food in correct quantity."),
              ("i", "Protein - egg"), ("i", "Carbohydrate - rice")],
         answers={"1": "a) Photosynthesis b) evaporation c) enamel (bone crossed out) d) Venus",
                  "2": "a) False b) True c) True", "3": "a) oxygen b) Jupiter c) heart",
                  "4": "We should not waste water because water is very precious and we need it for drinking and cooking.",
                  "5": "Solids have fixed shape. Liquids do not have fixed shape. Solids are hard and liquids can flow.",
                  "6": "[Diagram: sun, sea, cloud, mountain; labels: evaporation, rain, sun, clouds — condensation and collection not labelled]",
                  "7": "Balanced diet means eating all types of food in correct quantity. Protein - egg. Carbohydrate - rice."},
         expected={"1": 3, "2": 2, "3": 3, "4": 1, "5": 2, "6": 2, "7": 3}),
    dict(adm="S5003", name="Harish P", roll="12",
         hand=Hand("mvboli.ttf", 28, (70, 70, 75), jitter=1.4, word_rot=1.8, size_var=0.06, drift=-0.6,
                   pencil=True, spacing=1.04, lh=56, seed=47),
         ops=[("t", "1) a. fotosynthesis"), ("i", "b. ~boil~ boiling"), ("i", "c. enamel"), ("i", "d. Mercury"),
              ("g",), ("t", "2) a. True"), ("i", "b. True"), ("i", "c. False"), ("g",),
              ("t", "3) a. oxigen"), ("i", "b. Saturn"), ("i", "c. hart"), ("g",),
              ("t", "4) we need water for drinking. water is less so dont waste"), ("g",),
              ("t", "5) solid is hard. liquid is water"), ("g",),
              ("t", "6) rain comes from clouds and goes to sea. sun makes water hot and it goes up"), ("g",),
              ("t", "7) balanced diet is good food we eat daily"), ("i", "vitamins - fruits")],
         answers={"1": "a. fotosynthesis b. boiling (boil crossed out) c. enamel d. Mercury",
                  "2": "a. True b. True c. False", "3": "a. oxigen b. Saturn c. hart",
                  "4": "we need water for drinking. water is less so dont waste",
                  "5": "solid is hard. liquid is water",
                  "6": "rain comes from clouds and goes to sea. sun makes water hot and it goes up (no diagram)",
                  "7": "balanced diet is good food we eat daily. vitamins - fruits"},
         expected={"1": 3, "2": 2, "3": 2, "4": 1, "5": 0.5, "6": 1, "7": 1}),
]

meta_base = dict(school=SCHOOL, exam=EXAM, **{"class": CLASS})
for s in students:
    doc = Doc(s["hand"], "answer", dict(meta_base, name=s["name"], roll=s["roll"]))
    for op in s["ops"]:
        if op[0] == "t": doc.write(op[1])
        elif op[0] == "i": doc.write(op[1], indent=38)
        elif op[0] == "g": doc.gap(0.5 if s["hand"].lh < 56 else 0.4)
        elif op[0] == "d": doc.diagram(op[1], op[2])
        elif op[0] == "n": doc.need(s["hand"].lh * op[1])
    save(doc.finish(int(s["adm"][1:])), os.path.join(OUT, "answer_sheets", f'{s["adm"]}_{s["name"].replace(" ", "_")}'))

questions = [
    dict(number="1", qtype="short", max_marks=4, mark_increment=1,
         text="Fill in the blanks: a) Plants make their own food by the process of ____. b) Water changes into water vapour by ____. c) The hardest part of our body is the ____ of the teeth. d) The planet closest to the Sun is ____.",
         model_answer="a) photosynthesis b) evaporation c) enamel d) Mercury"),
    dict(number="2", qtype="short", max_marks=3, mark_increment=1,
         text="Write True or False: a) A bat is a bird. b) Magnets attract iron nails. c) Sound travels faster than light.",
         model_answer="a) False b) True c) False"),
    dict(number="3", qtype="short", max_marks=3, mark_increment=1,
         text="Name the following: a) The gas we breathe in to stay alive. b) The largest planet in our solar system. c) The organ that pumps blood in our body.",
         model_answer="a) Oxygen b) Jupiter c) Heart"),
    dict(number="4", qtype="science", max_marks=2, mark_increment=0.5,
         text="Why should we not waste water? Give two reasons.",
         model_answer="Any two: very little of Earth's water is fresh/drinkable; all living things need water; wasting it causes shortage; saving water saves energy/money."),
    dict(number="5", qtype="science", max_marks=2, mark_increment=0.5,
         text="Write two differences between solids and liquids.",
         model_answer="Solids have a fixed shape, liquids take the shape of the container; solids cannot flow, liquids can flow. (1 mark each)"),
    dict(number="6", qtype="science", max_marks=3, mark_increment=0.5,
         text="Draw a neat diagram of the water cycle and label it.",
         model_answer="Diagram 1 mark; labels evaporation, condensation, precipitation, collection 0.5 each."),
    dict(number="7", qtype="science", max_marks=3, mark_increment=0.5,
         text="What is a balanced diet? Name two nutrients and one food source for each.",
         model_answer="Definition (1): food containing all nutrients in the right amounts. Two nutrients with a correct source (1 each)."),
]
key = dict(exam=dict(name=f"{EXAM} (Class 5 handwritten test)", academic_year="2026-27", class_name=CLASS,
                     section="A", subject="Science", grade_level="Class 5",
                     instructions="Answer all the questions. Write neatly."),
           questions=questions,
           students=[dict(admission_no=s["adm"], name=s["name"], roll_no=s["roll"], answers=s["answers"],
                          expected_marks=s["expected"], expected_total=sum(s["expected"].values())) for s in students])
with open(os.path.join(OUT, "answer_key.json"), "w", encoding="utf-8") as f:
    json.dump(key, f, indent=2, ensure_ascii=False)
with open(os.path.join(OUT, "students.csv"), "w") as f:
    f.write("admission_no,name,class_name,section,roll_no\n")
    for s in students:
        f.write(f'{s["adm"]},{s["name"]},{CLASS},A,{s["roll"]}\n')
print("done")
