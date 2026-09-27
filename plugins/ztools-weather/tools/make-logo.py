# -*- coding: utf-8 -*-
"""生成插件 logo.png（256×256）：蓝青渐变圆角底 + 太阳与云。

纯本地生成，不依赖网络。需要 Pillow：
    python3 tools/make-logo.py
"""
import math
import os

from PIL import Image, ImageDraw

S = 256
OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "logo.png"))

img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

# 圆角底 + 竖向渐变（晴空蓝 → 青）
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / (S - 1)
    r = int(2 + 20 * t)
    g = int(132 + 40 * t)
    b = int(199 + 36 * t)
    gd.line([(0, y), (S, y)], fill=(r, g, b, 255))
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=58, fill=255)
img.paste(grad, (0, 0), mask)

d = ImageDraw.Draw(img)

# 太阳（右上，带柔光）
cx, cy, R = 168, 84, 34
for i in range(10, 0, -1):
    alpha = int(26 * (1 - i / 10.0))
    d.ellipse([cx - R - i, cy - R - i, cx + R + i, cy + R + i], fill=(255, 236, 160, alpha))
d.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(255, 224, 130, 255))
for i in range(12):
    ang = math.pi * 2 * i / 12.0
    r0, r1 = R + 12, R + 22
    d.line(
        [
            (cx + r0 * math.cos(ang), cy + r0 * math.sin(ang)),
            (cx + r1 * math.cos(ang), cy + r1 * math.sin(ang)),
        ],
        fill=(255, 240, 190, 210),
        width=5,
    )

# 云（下方，白色三圆 + 底座）
cloud = [(96, 168, 34), (140, 154, 42), (182, 170, 30)]
for (x, y, r) in cloud:
    d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 255, 255, 255))
d.rounded_rectangle([62, 166, 212, 202], radius=18, fill=(255, 255, 255, 255))

# 两滴雨
for (x, y) in ((110, 220), (152, 228), (190, 216)):
    d.ellipse([x - 7, y - 11, x + 7, y + 11], fill=(180, 235, 255, 235))

img.save(OUT)
print("logo written:", OUT, img.size)
