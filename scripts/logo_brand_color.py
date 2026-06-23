#!/usr/bin/env python3
import argparse
import binascii
import struct
import sys
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BRAND_RGB = (0x1C, 0xCC, 0xC1)
PNG_FILES = [
    ROOT / "static/favicon-16x16.png",
    ROOT / "static/favicon-32x32.png",
    ROOT / "static/apple-touch-icon.png",
    ROOT / "static/android-chrome-192x192.png",
    ROOT / "static/android-chrome-512x512.png",
]
ICO_FILE = ROOT / "static/favicon.ico"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def read_chunks(data):
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    pos = len(PNG_SIGNATURE)
    chunks = []
    while pos < len(data):
        length = struct.unpack(">I", data[pos : pos + 4])[0]
        ctype = data[pos + 4 : pos + 8]
        payload = data[pos + 8 : pos + 8 + length]
        crc = data[pos + 8 + length : pos + 12 + length]
        chunks.append((ctype, payload, crc))
        pos += 12 + length
        if ctype == b"IEND":
            break
    return chunks


def parse_png(data):
    chunks = read_chunks(data)
    ihdr = next(payload for ctype, payload, _ in chunks if ctype == b"IHDR")
    width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(
        ">IIBBBBB", ihdr
    )
    if bit_depth != 8 or color_type != 6 or compression != 0 or filter_method != 0 or interlace != 0:
        raise ValueError("only non-interlaced 8-bit RGBA PNGs are supported")

    compressed = b"".join(payload for ctype, payload, _ in chunks if ctype == b"IDAT")
    raw = zlib.decompress(compressed)
    bpp = 4
    stride = width * bpp
    rows = []
    pos = 0
    previous = bytearray(stride)

    for _ in range(height):
        filter_type = raw[pos]
        pos += 1
        row = bytearray(raw[pos : pos + stride])
        pos += stride
        for i, value in enumerate(row):
            left = row[i - bpp] if i >= bpp else 0
            up = previous[i]
            up_left = previous[i - bpp] if i >= bpp else 0
            if filter_type == 1:
                row[i] = (value + left) & 0xFF
            elif filter_type == 2:
                row[i] = (value + up) & 0xFF
            elif filter_type == 3:
                row[i] = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                row[i] = (value + paeth(left, up, up_left)) & 0xFF
            elif filter_type != 0:
                raise ValueError(f"unsupported PNG filter: {filter_type}")
        rows.append(row)
        previous = row

    return width, height, rows, chunks


def paeth(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def png_chunk(ctype, payload):
    return (
        struct.pack(">I", len(payload))
        + ctype
        + payload
        + struct.pack(">I", binascii.crc32(ctype + payload) & 0xFFFFFFFF)
    )


def encode_png(width, height, rows):
    raw = bytearray()
    for row in rows:
        raw.append(0)
        raw.extend(row)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"".join(
        [
            PNG_SIGNATURE,
            png_chunk(b"IHDR", ihdr),
            png_chunk(b"IDAT", zlib.compress(bytes(raw), level=9)),
            png_chunk(b"IEND", b""),
        ]
    )


def recolor_png(data):
    width, height, rows, _ = parse_png(data)
    for row in rows:
        for index in range(0, len(row), 4):
            if row[index + 3] == 0:
                row[index : index + 3] = b"\x00\x00\x00"
            else:
                row[index : index + 3] = bytes(BRAND_RGB)
    return encode_png(width, height, rows)


def check_png(data, label):
    width, height, rows, _ = parse_png(data)
    mismatches = 0
    visible = 0
    for row in rows:
        for index in range(0, len(row), 4):
            alpha = row[index + 3]
            if alpha == 0:
                continue
            visible += 1
            if tuple(row[index : index + 3]) != BRAND_RGB:
                mismatches += 1
    if mismatches:
        return f"{label}: {mismatches}/{visible} visible pixels are not #1CCCC1 ({width}x{height})"
    return None


def parse_ico(data):
    reserved, icon_type, count = struct.unpack_from("<HHH", data, 0)
    if reserved != 0 or icon_type != 1:
        raise ValueError("not an ICO file")
    entries = []
    pos = 6
    for _ in range(count):
        width, height, colors, reserved, planes, bit_count, size, offset = struct.unpack_from(
            "<BBBBHHII", data, pos
        )
        entries.append(
            {
                "width": 256 if width == 0 else width,
                "height": 256 if height == 0 else height,
                "colors": colors,
                "reserved": reserved,
                "planes": planes,
                "bit_count": bit_count,
                "size": size,
                "offset": offset,
            }
        )
        pos += 16
    return entries


def recolor_ico(data):
    entries = parse_ico(data)
    images = []
    for entry in entries:
        image = data[entry["offset"] : entry["offset"] + entry["size"]]
        if not image.startswith(PNG_SIGNATURE):
            raise ValueError("only PNG-backed ICO entries are supported")
        images.append(recolor_png(image))

    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = bytearray()
    for entry, image in zip(entries, images):
        width = 0 if entry["width"] == 256 else entry["width"]
        height = 0 if entry["height"] == 256 else entry["height"]
        directory.extend(
            struct.pack(
                "<BBBBHHII",
                width,
                height,
                entry["colors"],
                entry["reserved"],
                entry["planes"],
                entry["bit_count"],
                len(image),
                offset,
            )
        )
        offset += len(image)
    return header + bytes(directory) + b"".join(images)


def check_ico(data):
    errors = []
    for entry in parse_ico(data):
        image = data[entry["offset"] : entry["offset"] + entry["size"]]
        if not image.startswith(PNG_SIGNATURE):
            errors.append(f"favicon.ico: {entry['width']}x{entry['height']} entry is not PNG-backed")
            continue
        error = check_png(image, f"favicon.ico {entry['width']}x{entry['height']}")
        if error:
            errors.append(error)
    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true", help="rewrite logo files with the brand color")
    args = parser.parse_args()

    if args.write:
        for path in PNG_FILES:
            path.write_bytes(recolor_png(path.read_bytes()))
        ICO_FILE.write_bytes(recolor_ico(ICO_FILE.read_bytes()))
        return 0

    errors = []
    for path in PNG_FILES:
        error = check_png(path.read_bytes(), path.relative_to(ROOT).as_posix())
        if error:
            errors.append(error)
    errors.extend(check_ico(ICO_FILE.read_bytes()))

    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print("All logo pixels use #1CCCC1")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
