"""Extract the text layer of a PDF, page by page.

Used by `cip.mjs` and `spec.mjs`. PyMuPDF is authoring-time only — nothing in
the build or in CI reads a PDF (Instruction.md Phase 9).
"""

import sys

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - environment problem
    print("PyMuPDF is not installed. `pip install pymupdf`.", file=sys.stderr)
    raise SystemExit(2)

if len(sys.argv) < 2:
    print("usage: pdftext.py <file.pdf> [max-pages]", file=sys.stderr)
    raise SystemExit(2)

limit = int(sys.argv[2]) if len(sys.argv) > 2 else 40
with fitz.open(sys.argv[1]) as document:
    for index, page in enumerate(document):
        if index >= limit:
            print(f"[... {document.page_count - limit} more page(s) not extracted]", file=sys.stderr)
            break
        sys.stdout.write(page.get_text())
