"""Encode one image to WebP under a hard byte cap and a hard pixel cap.

Called by `lib/webp.mjs`. Kept in Python because Phase 8 encoded all 34 pilot
images with Pillow and the alternative is a ~30 MB native npm dependency for a
step that only ever runs at authoring time — `scripts/data/` is never run by CI
or by the build (Instruction.md Phase 9, SPEC.md §13).

The rule this file exists to enforce is FRICTION-LOG D3: **never pick a fixed
quality.** The cap is on bytes, so a busy photograph at a fixed quality misses
it while a plain one wastes half the budget. Quality is searched downward, and
only when quality alone cannot reach the cap is the image resized — in that
order, because losing pixels is worse than losing a little chroma detail on a
photograph of a machined object.

Prints one JSON object to stdout. Every diagnostic goes to stderr, so the
caller can parse stdout unconditionally.

    python webp.py <input> <output> --max-px 1600 --max-bytes 204800
"""

import argparse
import io
import json
import sys

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - environment problem, not a code path
    print(
        "Pillow is not installed. `pip install Pillow` — the image pipeline "
        "needs it to produce WebP (SPEC.md §10).",
        file=sys.stderr,
    )
    raise SystemExit(2)

# Searched in this order. 86 first because it cleared the gallery cap for 30 of
# the 34 pilot images; the tail exists because the other four needed 78 and 45.
QUALITIES = (92, 86, 80, 74, 68, 62, 56, 50, 45, 40, 35, 30)

# Applied only after every quality has failed. Each step is a fresh resize from
# the ORIGINAL, never a resize of an already-resized copy: repeated resampling
# softens an image visibly and there is no reason to accept that here.
SCALE_STEPS = (1.0, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35)


def encode(image, quality):
    buffer = io.BytesIO()
    # method=6 is the slowest and smallest setting. At one image per invocation
    # the extra second is free and it is worth 5-10% of the byte budget.
    image.save(buffer, format="WEBP", quality=quality, method=6)
    return buffer.getvalue()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("destination")
    parser.add_argument("--max-px", type=int, required=True)
    parser.add_argument("--max-bytes", type=int, required=True)
    args = parser.parse_args()

    with Image.open(args.source) as raw:
        # EXIF orientation is applied here rather than trusted: a phone-camera
        # upload on Commons will otherwise be stored rotated, and the width and
        # height written into the imageRef would describe the wrong axes.
        original = ImageOps.exif_transpose(raw)
        original = original.convert("RGBA" if "A" in original.getbands() else "RGB")

        longest = max(original.size)
        base_scale = min(1.0, args.max_px / longest)

        for step in SCALE_STEPS:
            scale = base_scale * step
            width = max(1, round(original.width * scale))
            height = max(1, round(original.height * scale))
            resized = (
                original
                if (width, height) == original.size
                else original.resize((width, height), Image.LANCZOS)
            )
            for quality in QUALITIES:
                data = encode(resized, quality)
                if len(data) <= args.max_bytes:
                    with open(args.destination, "wb") as out:
                        out.write(data)
                    print(
                        json.dumps(
                            {
                                "width": width,
                                "height": height,
                                "bytes": len(data),
                                "quality": quality,
                                "sourceWidth": original.width,
                                "sourceHeight": original.height,
                                "resized": (width, height) != original.size,
                            }
                        )
                    )
                    return

    print(
        f"could not reach {args.max_bytes} bytes for {args.source} even at "
        f"quality {QUALITIES[-1]} and {SCALE_STEPS[-1]:.0%} scale. This is almost "
        "always a photograph with heavy noise or a busy background — pick a "
        "different file rather than degrading this one further.",
        file=sys.stderr,
    )
    raise SystemExit(1)


if __name__ == "__main__":
    main()
