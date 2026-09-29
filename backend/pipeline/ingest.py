"""Dataset ingestion: CSV / JSON / XML → canonical records.

Accepts uploads matching the field contract:

    timestamp, src_ip, dst_ip, src_port, dst_port, txid, input_addresses[],
    output_addresses[], input_amounts[], output_amounts[], fee, script_type,
    geo_country, asn  (+ optional ground_truth label column, used by metrics)

Records that fail validation are counted with per-row reasons and excluded
rather than crashing the pipeline; field aliases are normalised transparently.
"""

from __future__ import annotations

import csv
import io
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from .config import MAX_UPLOAD_BYTES, REQUIRED_FIELDS

# Aliases accepted for each canonical field so differently-named exports parse.
ALIASES: dict[str, tuple[str, ...]] = {
    "timestamp": ("timestamp", "time", "ts", "date_time"),
    "src_ip": ("src_ip", "source_ip", "srcip"),
    "dst_ip": ("dst_ip", "dest_ip", "destination_ip", "dstip"),
    "src_port": ("src_port", "source_port"),
    "dst_port": ("dst_port", "dest_port", "destination_port"),
    "txid": ("txid", "tx_id", "transaction_id"),
    "input_addresses": ("input_addresses", "input_address", "inputs", "vin_addresses"),
    "output_addresses": ("output_addresses", "output_address", "outputs", "vout_addresses"),
    "input_amounts": ("input_amounts", "input_amount", "input_values"),
    "output_amounts": ("output_amounts", "output_amount", "output_values"),
    "fee": ("fee", "tx_fee", "fee_sat"),
    "script_type": ("script_type", "scripttype", "scriptpubkey_type"),
    "geo_country": ("geo_country", "country", "geoip_country"),
    "asn": ("asn", "autonomous_system", "asn_number"),
}
GROUND_TRUTH_KEYS = ("ground_truth", "label", "is_illicit", "illicit")


class IngestionError(ValueError):
    """Raised when a dataset cannot be parsed at all."""


def _canonical(field: str) -> str:
    return field.strip().lower().replace(" ", "_")


def match_field(field: str) -> str | None:
    """Map a raw column name to its canonical field, or None."""
    c = _canonical(field)
    for canonical, names in ALIASES.items():
        if c in names:
            return canonical
    if c in GROUND_TRUTH_KEYS:
        return "ground_truth"
    return None


def _to_float_list(value: object) -> list[float]:
    if value is None or value == "":
        return []
    if isinstance(value, (int, float)):
        return [float(value)]
    if isinstance(value, str):
        value = value.strip().strip("[]")
        parts = [p for p in value.replace(";", ",").split(",") if p.strip()]
        return [float(p) for p in parts]
    if isinstance(value, (list, tuple)):
        out: list[float] = []
        for item in value:
            out.extend(_to_float_list(item))
        return out
    raise ValueError(f"cannot interpret {value!r} as numeric list")


def _to_str_list(value: object) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        value = value.strip().strip("[]")
        parts = [p for p in value.replace(";", ",").split(",") if p.strip()]
        return [p.strip() for p in parts]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value)]


def _parse_timestamp(value: object) -> str:
    if isinstance(value, (int, float)):
        # Heuristic: > 1e11 means milliseconds.
        seconds = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    text = str(value).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M"):
            try:
                dt = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"unparseable timestamp {value!r}") from None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _normalise(raw: dict) -> tuple[dict | None, str]:
    """Normalise one raw row. Returns (record, reason); record is None if rejected."""
    row: dict = {}
    seen: dict[str, object] = {}
    for key, value in raw.items():
        if key is None:
            continue
        canonical = match_field(str(key))
        if canonical:
            seen[canonical] = value
    missing = [f for f in REQUIRED_FIELDS if f not in seen]
    if missing:
        return None, "missing fields: " + ", ".join(missing)

    try:
        row["timestamp"] = _parse_timestamp(seen["timestamp"])
    except ValueError as exc:
        return None, str(exc)

    for field in ("src_ip", "dst_ip", "txid", "script_type", "geo_country", "asn"):
        row[field] = str(seen[field]).strip() if seen[field] is not None else ""
    for field in ("src_port", "dst_port"):
        try:
            row[field] = int(float(seen[field]))
        except (TypeError, ValueError):
            row[field] = 0
    try:
        row["fee"] = float(seen["fee"])
    except (TypeError, ValueError):
        return None, "invalid fee value"

    try:
        row["input_addresses"] = _to_str_list(seen["input_addresses"])
        row["output_addresses"] = _to_str_list(seen["output_addresses"])
        row["input_amounts"] = _to_float_list(seen["input_amounts"])
        row["output_amounts"] = _to_float_list(seen["output_amounts"])
    except (TypeError, ValueError) as exc:
        return None, f"invalid list field ({exc})"

    if not row["txid"]:
        return None, "empty txid"
    if not row["input_addresses"] or not row["output_addresses"]:
        return None, "empty input or output address list"
    if "ground_truth" in seen:
        gt = str(seen["ground_truth"]).strip().lower()
        row["ground_truth"] = 1 if gt in ("1", "true", "illicit", "yes", "suspicious") else 0
    else:
        row["ground_truth"] = None
    return row, ""


def parse_records(raw_rows: list) -> tuple[list[dict], list[str]]:
    """Normalise raw dict rows → (records, rejection_reasons).

    ``rejection_reasons`` is parallel to the input: entries are "" for accepted
    rows and a human-readable reason for rejected ones.
    """
    records: list[dict] = []
    reasons: list[str] = []
    for raw in raw_rows:
        if not isinstance(raw, dict):
            reasons.append("row is not an object")
            continue
        row, reason = _normalise(raw)
        if row is None:
            reasons.append(reason)
        else:
            records.append(row)
            reasons.append("")
    return records, reasons


def detected_fields(raw_rows: list) -> list[str]:
    """Canonical fields present in the first rows of the dataset."""
    present: set[str] = set()
    for raw in raw_rows[:50]:
        if isinstance(raw, dict):
            for key in raw:
                matched = match_field(str(key))
                if matched:
                    present.add(matched)
    return sorted(present & set(REQUIRED_FIELDS))


def parse_csv(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def parse_json(text: str) -> list[dict]:
    data = json.loads(text)
    if isinstance(data, dict):
        for key in ("data", "records", "transactions", "rows"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            raise IngestionError("JSON object must contain a data/records/transactions array")
    if not isinstance(data, list):
        raise IngestionError("JSON must be an array of records")
    return data


def parse_xml(text: str) -> list[dict]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise IngestionError(f"invalid XML: {exc}") from exc

    def flatten(el: ET.Element) -> dict:
        row: dict = {}
        row.update(el.attrib)
        for child in el:
            tag = child.tag
            if len(child) == 0 and not child.attrib:
                row[tag] = child.text
            elif len(child) > 0 and all(g.tag == "address" for g in child):
                row[tag] = [g.text for g in child]
            else:
                row[tag] = flatten(child)
        return row

    candidates = [root] + list(root)
    rows_el = None
    for cand in candidates:
        children = list(cand)
        if children and all(ch.tag in {"row", "record", "transaction"} for ch in children):
            rows_el = children
            break
    if rows_el is None:
        raise IngestionError("XML must contain <rows><row>…</row></rows> structure")
    return [flatten(el) for el in rows_el]


def load_upload(filename: str, payload: bytes) -> tuple[list[dict], list[str], list[str], str]:
    """Parse an uploaded file.

    Returns (records, rejection_reasons, detected_fields, file_type).
    Raises IngestionError when nothing usable can be parsed.
    """
    if len(payload) > MAX_UPLOAD_BYTES:
        raise IngestionError(f"file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
    lower = (filename or "").lower()
    text = payload.decode("utf-8-sig", errors="replace")
    if lower.endswith(".json"):
        raw_rows, file_type = parse_json(text), "json"
    elif lower.endswith(".xml"):
        raw_rows, file_type = parse_xml(text), "xml"
    else:
        raw_rows, file_type = parse_csv(text), "csv"
    records, reasons = parse_records(raw_rows)
    if not records:
        detail = reasons[0] if reasons and reasons[0] else "all rows invalid"
        raise IngestionError(
            f"no valid records found ({detail}) — required fields: " + ", ".join(REQUIRED_FIELDS)
        )
    return records, reasons, detected_fields(raw_rows), file_type
