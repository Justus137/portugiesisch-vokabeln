#!/usr/bin/env python3
"""Erzeugt die App-Icons (PNG) ohne externe Bibliotheken.
Motiv: brasilianische Flagge, reduziert (gruener Grund, gelbe Raute, blauer Kreis).
Aufruf: python3 tools/icon_gen.py  (aus dem Projektordner)
"""
import zlib, struct, math, os

def write_png(path, w, h, rows):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    raw = b''.join(b'\x00' + bytes(row) for row in rows)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)

def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))

def render(size):
    top = (18, 178, 98)      # Gruen hell
    bot = (4, 122, 63)       # Gruen dunkel
    yellow = (255, 214, 46)
    blue = (18, 62, 136)
    cx = cy = size / 2.0
    a = 0.385 * size         # halbe Rautenbreite
    b = 0.275 * size         # halbe Rautenhoehe
    r = 0.165 * size         # Kreisradius
    aa = 1.6                 # Kantenglaettung in Pixeln
    ss = [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]  # 2x2 Supersampling

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            for (ox, oy) in ss:
                px = x + ox
                py = y + oy
                col = lerp(top, bot, py / size)
                dx = px - cx
                dy = py - cy
                # Raute
                f = abs(dx) / a + abs(dy) / b - 1.0
                d_px = f * min(a, b)
                cov = max(0.0, min(1.0, 0.5 - d_px / aa))
                if cov > 0:
                    col = lerp(col, yellow, cov)
                # Kreis
                d = math.hypot(dx, dy) - r
                cov = max(0.0, min(1.0, 0.5 - d / aa))
                if cov > 0:
                    col = lerp(col, blue, cov)
                acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2]
            row += bytes((round(acc[0] / 4), round(acc[1] / 4), round(acc[2] / 4)))
        rows.append(row)
    return rows

def main():
    base = os.path.join(os.path.dirname(__file__), '..', 'icons')
    os.makedirs(base, exist_ok=True)
    for size in (180, 192, 512):
        rows = render(size)
        path = os.path.join(base, f'icon-{size}.png')
        write_png(path, size, size, rows)
        print(f'geschrieben: {path}')

if __name__ == '__main__':
    main()
