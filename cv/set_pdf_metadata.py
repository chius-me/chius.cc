from pathlib import Path
import sys

from pypdf import PdfReader, PdfWriter


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: set_pdf_metadata.py INPUT_PDF OUTPUT_PDF", file=sys.stderr)
        return 2

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    reader = PdfReader(input_path)
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    metadata = dict(reader.metadata or {})
    metadata.update(
        {
            "/Title": "简历 · Blogus Chii",
            "/Author": "Chius",
            "/Subject": "Chius 的个人简历",
            "/Creator": "RenderCV",
        }
    )
    writer.add_metadata(metadata)

    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")
    with temp_path.open("wb") as output_file:
        writer.write(output_file)
    temp_path.replace(output_path)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
