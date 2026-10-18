"""Generate Hugo Desk's original fixture illustrations (requires Pillow).

All shapes are drawn here from scratch. No photographs, downloaded artwork,
reference images, or third-party fonts are embedded in the output.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / "test/fixtures/site/content/posts/assets-demo"
SCALE = 2
INK = "#244b40"
PAPER = "#f4f0e5"


def artwork(kind):
    image = Image.new("RGB", (1200 * SCALE, 900 * SCALE), PAPER)
    draw = ImageDraw.Draw(image)

    def box(bounds):
        return tuple(round(v * SCALE) for v in bounds)

    def rect(bounds, color):
        draw.rectangle(box(bounds), fill=color)

    def circle(bounds, color):
        draw.ellipse(box(bounds), fill=color)

    def polygon(points, color):
        draw.polygon([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=color)

    def line(points, color, width=3):
        draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=color, width=width * SCALE)

    rect((72, 70, 1128, 740), "#e5e2cf")
    if kind == "forest":
        circle((775, 135, 995, 355), "#d08a60")
        circle((-70, 450, 1270, 1050), "#a2ad80")
        circle((420, 540, 1510, 1120), "#6e896a")
        for x, y, height, color in [(285, 240, 400, INK), (470, 350, 300, "#3d6751"), (705, 395, 220, INK)]:
            rect((x - 9, y + height - 25, x + 9, y + height + 65), color)
            polygon([(x, y), (x - height * .32, y + height), (x + height * .32, y + height)], color)
        caption = "FOREST / 01"
    elif kind == "coast":
        circle((780, 150, 1000, 370), "#d08a60")
        rect((72, 430, 1128, 740), "#709f9b")
        polygon([(72, 240), (300, 240), (300, 340), (440, 340), (440, 520), (530, 520), (530, 740), (72, 740)], "#b77250")
        polygon([(72, 240), (300, 240), (300, 340), (440, 340), (440, 385), (270, 385), (270, 300), (72, 300)], "#d3ab7d")
        for y, start, end in [(500, 620, 1020), (570, 720, 1128), (640, 560, 960), (700, 680, 1080)]:
            line([(start, y), (end, y)], "#dce5d5", 4)
        caption = "COAST / 02"
    else:
        circle((500, 150, 700, 350), "#d08a60")
        polygon([(72, 740), (420, 230), (765, 740)], "#94a58b")
        polygon([(340, 740), (815, 280), (1128, 640), (1128, 740)], "#547a67")
        polygon([(72, 740), (420, 475), (700, 740)], INK)
        polygon([(420, 230), (337, 352), (396, 330), (431, 366), (477, 315)], "#f4f0e5")
        line([(812, 376), (864, 448), (841, 485)], "#b0bea4", 4)
        caption = "MOUNTAINS / 03"
    # Mask the landscape to the same inset rectangle on every card.
    for bounds in [(0, 0, 1200, 69), (0, 740, 1200, 900), (0, 0, 71, 900), (1129, 0, 1200, 900)]:
        rect(bounds, PAPER)
    candidates = [Path("C:/Windows/Fonts/segoeui.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")]
    font_path = next((p for p in candidates if p.exists()), None)
    font = ImageFont.truetype(str(font_path), 23 * SCALE) if font_path else ImageFont.load_default(size=23 * SCALE)
    small = ImageFont.truetype(str(font_path), 18 * SCALE) if font_path else ImageFont.load_default(size=18 * SCALE)
    draw.text((72 * SCALE, 790 * SCALE), caption, fill=INK, font=font)
    draw.text((916 * SCALE, 795 * SCALE), "HUGO DESK", fill=INK, font=small)
    return image.resize((1200, 900), Image.Resampling.LANCZOS)


if __name__ == "__main__":
    for kind, relative in [("forest", "forest.png"), ("coast", "coast.png"), ("mountains", "gallery/幾何山景.png")]:
        destination = BUNDLE / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        artwork(kind).save(destination, optimize=True)
        print(destination.relative_to(ROOT))
