import json
from pathlib import Path
import sys

SOURCE_DEFAULT = Path(__file__).resolve().parent.parent / "smmoscaler-logs.json"
INDEX_DEFAULT = Path(__file__).resolve().parent.parent / "smmoscaler-logs.index.json"

MAX_FILE_BYTES = 100 * 1024 * 1024
TARGET_CHUNK_BYTES = 95 * 1024 * 1024


def entry_to_compact_bytes(entry):
    return json.dumps(entry, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def compact_array_size(entries):
    if not entries:
        return 2
    total = 2
    for i, e in enumerate(entries):
        total += len(entry_to_compact_bytes(e))
        if i > 0:
            total += 1  # comma separator
    return total


def write_json_array(path: Path, entries):
    path.write_text(json.dumps(entries, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def chunk_entries(entries, limit_bytes):
    chunks = []
    current = []
    current_size = 2

    for entry in entries:
        encoded = entry_to_compact_bytes(entry)
        required = len(encoded) + (1 if current else 0)

        if current and current_size + required > limit_bytes:
            chunks.append(current)
            current = [entry]
            current_size = 2 + len(encoded)
            continue

        if not current and (2 + len(encoded)) > limit_bytes:
            raise ValueError("Single entry exceeds chunk byte limit; cannot split safely.")

        current.append(entry)
        current_size += required

    if current:
        chunks.append(current)

    return chunks


def remove_old_parts(base_dir: Path):
    removed = []
    patterns = [
        "smmoscaler-logs.part*.json",
        "smmoscaler-logs-part*.json",
        "smmoscaler-logs-*.json",
        "smmoscaler-logs.*.json",
    ]
    for pattern in patterns:
        for path in base_dir.glob(pattern):
            if path.name == "smmoscaler-logs.json":
                continue
            try:
                path.unlink()
                removed.append(path.name)
            except OSError:
                pass
    return removed


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else SOURCE_DEFAULT
    index_path = Path(sys.argv[2]) if len(sys.argv) > 2 else INDEX_DEFAULT

    if not source.exists():
        raise FileNotFoundError(f"Source log file not found: {source}")

    entries = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(entries, list):
        raise ValueError("Source log file must be a JSON array.")

    source_size = source.stat().st_size
    compact_size = compact_array_size(entries)

    removed = remove_old_parts(source.parent)

    files_written = []
    if source_size <= MAX_FILE_BYTES:
        files = [source.name]
        index_path.write_text(json.dumps({"files": files}, indent=2) + "\n", encoding="utf-8")
        files_written.append(index_path.name)
        print(json.dumps({
            "source": str(source),
            "sourceBytes": source_size,
            "compactBytes": compact_size,
            "split": False,
            "index": str(index_path),
            "files": files,
            "removedOldParts": removed,
        }, indent=2))
        return

    chunks = chunk_entries(entries, TARGET_CHUNK_BYTES)
    files = []
    for idx, chunk in enumerate(chunks, start=1):
        out_name = f"smmoscaler-logs.part{idx}.json"
        out_path = source.parent / out_name
        write_json_array(out_path, chunk)
        files.append(out_name)
        files_written.append(out_name)

    write_json_array(source, chunks[0])
    files.insert(0, source.name)

    index_path.write_text(json.dumps({"files": files}, indent=2) + "\n", encoding="utf-8")
    files_written.append(index_path.name)

    sizes = {}
    for name in files:
        sizes[name] = (source.parent / name).stat().st_size

    print(json.dumps({
        "source": str(source),
        "sourceBytes": source_size,
        "compactBytes": compact_size,
        "split": True,
        "chunks": len(chunks),
        "index": str(index_path),
        "files": files,
        "sizes": sizes,
        "removedOldParts": removed,
    }, indent=2))


if __name__ == "__main__":
    main()
