"""Builds her intro's close-ups in assets/capri/: her holding the screen by its edges, cut out of
their red background. What stays: her figure (everything that isn't the mane's hot red, only
what's joined to her) and a jagged burst of mane around her head; the rest is see-through, so
your desktop shows around her. Every drawing is cut the same way, so they can be swapped like
cels: `grab` is her at rest (both hands on the edges, mouth shut), the others are the same picture
with only her mouth, her eyes or her right arm changed (fx.js GRAB_FRAMES), and only that change is taken
from them (CHANGES), so nothing else shimmers when they're swapped. fx.js knows where her face,
eyes and hands are on them (GRAB): keep the framing (1672x941, her eyes in the same place) or
update it. Give `grab` along with the others.

    python tools/build-intro.py grab=rest.webp mouth1=ajar.webp mouth2=half.webp mouth3=wide.webp \\
        wave1=wave-left.webp wave2=wave-right.webp wave3=wave-up.webp smear=arm-blur.webp \\
        happy=eyes-shut.webp

writes assets/capri/intro-<name>.webp for each. Needs Pillow.
"""
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / 'assets' / 'capri'
SIZE = (1672, 941)
HEAD = (830, 330)   # the middle of her mane burst
BODY = (836, 600)   # a point on her, to keep only what's joined to her
BELLY = (980, 760)  # a point on her belly: red like the mane, but hers (see belly)
BELLY_MAX = 330     # wider than this, a run of red isn't her belly any more (it's the background)
# where each kind of drawing changes her (by the start of its name): only that is taken from it,
# the rest from `grab` (see settled). A kind not listed is taken whole.
CHANGES = {
    'mouth': (690, 360, 1020, 650),  # her mouth
    'wave': (930, 120, 1672, 941),   # her right arm, off the edge and up by her face
    'smear': (930, 120, 1672, 941),  # the same arm, a blur between the edge and her face
    'happy': (600, 180, 1060, 470),  # her eyes, shut with joy
}


def belly(fig):
    """Her belly, red like the mane behind her but walled in by her: going up and down from BELLY,
    each row's run of red that has her (black) on both sides. It stops where a run gets out to the
    background (too wide, or off the edge of the picture)."""
    w, h = fig.size
    fp = fig.load()
    out = Image.new('L', (w, h), 0)
    op = out.load()

    def span(y, x0):
        # the red run of row y around x0 (the nearest red pixel to it), walled on both sides
        x = next((x0 + d * s for d in range(0, 60) for s in (1, -1) if 0 <= x0 + d * s < w and fp[x0 + d * s, y] == 0), None)
        if x is None:
            return None
        a = b = x
        while a > 0 and fp[a - 1, y] == 0:
            a -= 1
        while b < w - 1 and fp[b + 1, y] == 0:
            b += 1
        if a == 0 or b == w - 1 or b - a > BELLY_MAX:
            return None
        return a, b

    for step in (1, -1):
        x0, y = BELLY[0], BELLY[1]
        while 0 <= y < h:
            run = span(y, x0)
            if not run:
                break
            for x in range(run[0], run[1] + 1):
                op[x, y] = 255
            x0 = (run[0] + run[1]) // 2
            y += step
    return out


def pockets(fig):
    """The red she walls in on all sides: whatever isn't her and can't reach the picture's edge."""
    w, h = fig.size
    outside = fig.copy()  # her: 255, the rest: 0, and what reaches an edge becomes 128
    op = outside.load()
    for x, y in [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]:
        if op[x, y] == 0:
            ImageDraw.floodfill(outside, (x, y), 128)
    return outside.point(lambda v: 255 if v == 0 else 0)


def unfringe(out):
    """Where she was cut out of the red, her edges kept a thin rim of it: a red line along the black,
    pink and magenta specks along the violet. Each pixel of that rim takes the colour of the nearest
    pixel well inside her, unless that one is red too (the mane, her belly: their red edge is right)."""
    w, h = out.size
    alpha = out.getchannel('A')
    rim = alpha.filter(ImageFilter.MinFilter(5)).load()     # under 255: within 2 px of the cut
    inner = alpha.filter(ImageFilter.MinFilter(9)).load()   # 255: at least 4 px inside her
    ap = alpha.load()
    px = out.load()
    near = sorted(((dx, dy) for dx in range(-6, 7) for dy in range(-6, 7) if dx or dy), key=lambda d: d[0] ** 2 + d[1] ** 2)
    fixes = []
    for y in range(h):
        for x in range(w):
            if not ap[x, y] or rim[x, y] == 255:
                continue
            for dx, dy in near:
                u, v = x + dx, y + dy
                if 0 <= u < w and 0 <= v < h and inner[u, v] == 255:
                    r, g, b, _ = px[u, v]
                    if not (r > 150 and r - max(g, b) > 60):
                        fixes.append((x, y, r, g, b))
                    break
    for x, y, r, g, b in fixes:
        px[x, y] = (r, g, b, ap[x, y])
    return out


def framed(path):
    """The picture at SIZE: the generated variants come out a pixel narrower, padded back out."""
    im = Image.open(path).convert('RGB')
    if im.size == SIZE:
        return im
    out = Image.new('RGB', SIZE)
    out.paste(im, (0, 0))
    if im.width < SIZE[0]:
        out.paste(im.crop((im.width - 1, 0, im.width, im.height)).resize((SIZE[0] - im.width, im.height)), (im.width, 0))
    return out


def cut(im):
    w, h = im.size
    px = im.load()

    # her figure: whatever isn't the hot red of the mane (black, green, white, blue, violet)
    fig = Image.new('L', (w, h), 0)
    fp = fig.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            fp[x, y] = 0 if (r > 170 and g < 140 and b < 190 and r - g > 90) else 255
    # no speckle holes, no islands (the white specks of the mane's texture)
    fig = fig.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    fig = fig.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
    ImageDraw.floodfill(fig, BODY, 128)
    fig = fig.point(lambda v: 255 if v == 128 else 0)
    # red that's hers, not background: her belly, and every pocket of red she walls in on all
    # sides (between her ribs, by the zigzags on her belly); a pixel of give so no seam shows
    fig = ImageChops.lighter(fig, ImageChops.lighter(belly(fig), pockets(fig)).filter(ImageFilter.MaxFilter(3)))

    # a burst of mane around her head: long spikes and short ones, like her shards (the same one
    # for every drawing). Its upper spikes squeezed down so they end inside the picture: a spike
    # cut flat by the picture's top edge shows as a straight line once she lets go and drops.
    random.seed(7)
    pts = []
    n = 26
    up = (HEAD[1] - 10) / 600
    for i in range(n * 2):
        a = (i / (n * 2)) * math.tau + random.uniform(-0.04, 0.04)
        r = random.uniform(430, 600) if i % 2 == 0 else random.uniform(250, 330)
        dy = math.sin(a) * r
        pts.append((HEAD[0] + math.cos(a) * r * 1.25, HEAD[1] + (dy * up if dy < 0 else dy)))
    burst = Image.new('L', (w, h), 0)
    ImageDraw.Draw(burst).polygon(pts, fill=255)

    # whatever of her reaches the picture's top edge (the spikes of her head) ends in jags instead
    top = Image.new('L', (w, h), 255)
    jags = [(x, random.uniform(6, 30)) for x in range(0, w + 40, 40)]
    ImageDraw.Draw(top).polygon([(0, 0), *jags, (w, 0)], fill=0)

    # a little softness on the cut, then hard again: clean edges, no stair steps
    alpha = ImageChops.multiply(ImageChops.lighter(fig, burst), top).filter(ImageFilter.GaussianBlur(1.2))
    alpha = alpha.point(lambda v: 0 if v < 60 else (255 if v > 190 else int((v - 60) * 255 / 130)))
    out = im.convert('RGBA')
    out.putalpha(alpha)
    return unfringe(out)


def settled(base, im, box):
    """`im` with only what really changed in it, inside `box`, kept; everything else is `base`'s.
    An AI edit redraws the whole picture, the grain of her mane and her belly a little differently
    each time: swapped like cels, that would shimmer. Its changes (a mouth, an arm) are found by
    how far they are from `base` (the grain's small differences don't count), grown a little to
    take their edges, and blended in over a soft edge so no seam shows."""
    r, g, b = (ImageChops.difference(x, y) for x, y in zip(base.split(), im.split()))
    diff = ImageChops.lighter(ImageChops.lighter(r, g), b)  # the most any of its channels moved
    changed = diff.filter(ImageFilter.GaussianBlur(2)).point(lambda v: 255 if v > 48 else 0)
    inside = Image.new('L', base.size, 0)
    ImageDraw.Draw(inside).rectangle(box, fill=255)
    changed = ImageChops.multiply(changed, inside)
    # specks of grain out, then grown over the change's own edges, then a soft border
    changed = changed.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(17)).filter(ImageFilter.GaussianBlur(5))
    return Image.composite(im, base, changed)


def main():
    pairs = [arg.split('=', 1) for arg in sys.argv[1:]]
    if not pairs or any(len(p) != 2 for p in pairs):
        sys.exit(__doc__)
    sources = {name: framed(path) for name, path in pairs}
    base = sources.get('grab')
    for name, im in sources.items():
        box = next((b for kind, b in CHANGES.items() if name.startswith(kind)), None)
        if base is not None and name != 'grab' and box:
            im = settled(base, im, box)
        target = OUT / f'intro-{name}.webp'
        cut(im).save(target, 'WEBP', quality=95, method=6)
        print('written', target)


if __name__ == '__main__':
    main()
