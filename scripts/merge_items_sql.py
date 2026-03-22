import json
from datetime import datetime, timezone
from pathlib import Path
import sys

SQL_PATH = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("items_backup.sql")
LOGS_PATH = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parent.parent / "smmoscaler-logs.json"

INSERT_MARKERS = ["INSERT INTO `items` VALUES", "INSERT INTO items VALUES"]


def decode_sql_string(raw: str) -> str:
    out = []
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch != "\\":
            out.append(ch)
            i += 1
            continue

        i += 1
        if i >= len(raw):
            out.append("\\")
            break

        nxt = raw[i]
        if nxt == "0":
            out.append("\0")
        elif nxt == "b":
            out.append("\b")
        elif nxt == "n":
            out.append("\n")
        elif nxt == "r":
            out.append("\r")
        elif nxt == "t":
            out.append("\t")
        elif nxt == "Z":
            out.append(chr(26))
        else:
            out.append(nxt)
        i += 1
    return "".join(out)


def parse_sql_value(token: str):
    t = token.strip()
    if not t or t.upper() == "NULL":
        return None
    if t[0] == "'" and t[-1] == "'":
        return decode_sql_string(t[1:-1])
    try:
        if "." in t:
            return float(t)
        return int(t)
    except ValueError:
        return t


def parse_tuple_fields(tuple_text: str):
    fields = []
    buf = []
    in_quote = False
    i = 0
    while i < len(tuple_text):
        ch = tuple_text[i]
        prev = tuple_text[i - 1] if i > 0 else ""

        if ch == "'" and prev != "\\":
            in_quote = not in_quote
            buf.append(ch)
            i += 1
            continue

        if ch == "," and not in_quote:
            fields.append(parse_sql_value("".join(buf)))
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    if buf:
        fields.append(parse_sql_value("".join(buf)))
    return fields


def extract_insert_blocks(sql_text: str):
    blocks = []
    cursor = 0

    while cursor < len(sql_text):
        found_idx = -1
        found_marker = None
        for marker in INSERT_MARKERS:
            idx = sql_text.find(marker, cursor)
            if idx != -1 and (found_idx == -1 or idx < found_idx):
                found_idx = idx
                found_marker = marker

        if found_idx == -1:
            break

        i = found_idx + len(found_marker)
        in_quote = False
        escaped = False
        block_chars = []

        while i < len(sql_text):
            ch = sql_text[i]
            block_chars.append(ch)

            if escaped:
                escaped = False
                i += 1
                continue

            if ch == "\\":
                escaped = True
                i += 1
                continue

            if ch == "'":
                in_quote = not in_quote
                i += 1
                continue

            if ch == ";" and not in_quote:
                break

            i += 1

        blocks.append("".join(block_chars))
        cursor = i + 1

    return blocks


def parse_tuples_from_block(block: str):
    tuples = []
    in_quote = False
    escaped = False
    depth = 0
    start = -1

    for i, ch in enumerate(block):
        if escaped:
            escaped = False
            continue

        if ch == "\\":
            escaped = True
            continue

        if ch == "'":
            in_quote = not in_quote
            continue

        if in_quote:
            continue

        if ch == "(":
            if depth == 0:
                start = i + 1
            depth += 1
            continue

        if ch == ")":
            depth -= 1
            if depth == 0 and start != -1:
                tuples.append(block[start:i])
                start = -1

    return tuples


def to_title_case(value):
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return ""
    return " ".join(part[:1].upper() + part[1:].lower() for part in s.split())


def to_int_or_none(value):
    if value is None:
        return None
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def to_iso_or_now(updated_at, created_at, now_iso):
    source = updated_at or created_at
    if not source or not isinstance(source, str):
        return now_iso
    try:
        dt = datetime.strptime(source, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except ValueError:
        return now_iso


def build_log_entry(cols, now_iso):
    if len(cols) < 23:
        return None

    item_id = to_int_or_none(cols[0])
    if item_id is None:
        return None

    strength = to_int_or_none(cols[8])
    defence = to_int_or_none(cols[9])
    critical = to_int_or_none(cols[10])
    health = to_int_or_none(cols[11])

    stat_candidates = [("str", strength), ("def", defence), ("crit", critical), ("hp", health)]
    stat_candidates = [(k, v) for (k, v) in stat_candidates if isinstance(v, int) and v != 0]

    stat1 = stat_candidates[0] if len(stat_candidates) > 0 else None
    stat2 = stat_candidates[1] if len(stat_candidates) > 1 else None
    stat3 = stat_candidates[2] if len(stat_candidates) > 2 else None

    market_obj = {"low": 0, "high": 0}
    market_raw = cols[13]
    if isinstance(market_raw, str) and market_raw.strip():
        try:
            market_json = json.loads(market_raw)
            low = to_int_or_none(market_json.get("low"))
            high = to_int_or_none(market_json.get("high"))
            market_obj = {"low": low if low is not None else 0, "high": high if high is not None else 0}
        except json.JSONDecodeError:
            pass

    equipable = to_int_or_none(cols[18])

    level = to_int_or_none(cols[6])
    value = to_int_or_none(cols[7])
    custom_item = to_int_or_none(cols[14])
    tradable = to_int_or_none(cols[15])
    locked = to_int_or_none(cols[16])

    return {
        "id": item_id,
        "fetchedAt": to_iso_or_now(cols[22], cols[21], now_iso),
        "item": {
            "id": item_id,
            "name": str(cols[1]) if cols[1] is not None else None,
            "type": to_title_case(cols[2]),
            "description": str(cols[4]) if cols[4] is not None else "",
            "equipable": str(equipable if equipable is not None else 0),
            "level": level if level is not None else 1,
            "rarity": to_title_case(cols[3]),
            "value": value if value is not None else 0,
            "stat1": stat1[0] if stat1 else None,
            "stat1modifier": stat1[1] if stat1 else None,
            "stat2": stat2[0] if stat2 else None,
            "stat2modifier": stat2[1] if stat2 else None,
            "stat3": stat3[0] if stat3 else None,
            "stat3modifier": stat3[1] if stat3 else None,
            "custom_item": custom_item if custom_item is not None else 0,
            "tradable": tradable if tradable is not None else 0,
            "locked": locked if locked is not None else 0,
            "circulation": to_int_or_none(cols[12]),
            "market": market_obj,
            "image_url": str(cols[5]) if cols[5] is not None else None,
        },
    }


def extract_entry_id(entry):
    if not isinstance(entry, dict):
        return None
    item = entry.get("item")
    if isinstance(item, dict) and item.get("id") is not None:
        return str(item.get("id"))
    if entry.get("id") is not None:
        return str(entry.get("id"))
    return None


def main():
    if not SQL_PATH.exists():
        raise FileNotFoundError(f"SQL dump not found: {SQL_PATH}")
    if not LOGS_PATH.exists():
        raise FileNotFoundError(f"Logs file not found: {LOGS_PATH}")

    existing = json.loads(LOGS_PATH.read_text(encoding="utf-8"))
    if not isinstance(existing, list):
        raise ValueError("Existing log JSON must be an array.")

    sql_text = SQL_PATH.read_text(encoding="utf-8")
    blocks = extract_insert_blocks(sql_text)
    if not blocks:
        raise ValueError("No INSERT INTO items VALUES blocks found in SQL file.")

    merged = list(existing)
    seen = set()
    for e in existing:
        entry_id = extract_entry_id(e)
        if entry_id:
            seen.add(entry_id)

    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    parsed_rows = 0
    added_rows = 0
    bad_rows = 0

    for block_idx, block in enumerate(blocks):
        tuples = parse_tuples_from_block(block)
        for tuple_idx, tuple_text in enumerate(tuples):
            cols = parse_tuple_fields(tuple_text)
            parsed_rows += 1
            entry = build_log_entry(cols, now_iso)
            if not entry:
                bad_rows += 1
                continue

            entry_id = str(entry["id"])
            if entry_id in seen:
                continue

            seen.add(entry_id)
            merged.append(entry)
            added_rows += 1

    LOGS_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    result = {
        "sqlPath": str(SQL_PATH),
        "logsPath": str(LOGS_PATH),
        "existing": len(existing),
        "parsedRows": parsed_rows,
        "addedRows": added_rows,
        "badRows": bad_rows,
        "total": len(merged),
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
