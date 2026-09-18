"""Dataset ingestion: CSV / JSON / XML → canonical records.

Accepts uploads matching the SIH26146 field contract. Records that fail
validation are counted and excluded rather than crashing the pipeline; field
aliases (e.g. `timestamp` vs `time`) are normalised transparently.
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
    "script_type": ("script_type", "scripttype", "scriptPubKey_type"),
    "geo_country": ("geo_country", "country", "geoip_country"),
    "asn": ("asn", "autonomous_system", "asn_number"),
}


class IngestionError(ValueError):
    """Raised when a dataset cannot be parsed at all."""


def _canonical(field: str) -> str:
    return field.strip().lower().replace(" ", "_")


def _match(field: str) -> str | None:
    c = _canonical(field)
    for canonical, names in ALIASES.items():
        if c in names:
            return canonical
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


def _normalise(raw: dict) -> dict | None:
    row: dict = {}
    seen: dict[str, str] = {}
    for key, value in raw.items():
        if key is None:
            continue
        canonical = _match(str(key))
        if canonical:
            seen[canonical] = value
    missing = [f for f in REQUIRED_FIELDS if f not in seen]
    if missing:
        return None

    try:
        row["timestamp"] = _parse_timestamp(seen["timestamp"])
    except ValueError:
        return None

    for field in ("src_ip", "dst_ip", "txid", "script_type", "geo_country", "asn"):
        row[field] = str(seen[field]).strip()
    for field in ("src_port", "dst_port"):
        try:
            row[field] = int(float(seen[field]))
        except (TypeError, ValueError):
            row[field] = 0
    try:
        fee = float(seen["fee"])
    except (TypeError, ValueError):
        return None
    row["fee"] = fee

    try:
        row["input_addresses"] = _to_str_list(seen["input_addresses"])
        row["output_addresses"] = _to_str_list(seen["output_addresses"])
        row["input_amounts"] = _to_float_list(seen["input_amounts"])
        row["output_amounts"] = _to_float_list(seen["output_amounts"])
    except (TypeError, ValueError):
        return None

    if not row["txid"] or not row["input_addresses"] or not row["output_addresses"]:
        return None
    return row


def parse_records(raw_rows: list[dict]) -> tuple[list[dict], int, list[str]]:
    """Normalise raw dict rows → (records, rejected_count, missing_field_report)."""
    records: list[dict] = []
    rejected = 0
    for raw in raw_rows:
        if not isinstance(raw, dict):
            rejected += 1
            continue
        row = _normalise(raw)
        if row is None:
            rejected += 1
        else:
            records.append(row)
    present = set()
    for raw in raw_rows[:50]:
        if isinstance(raw, dict):
            for key in raw:
                matched = _match(str(key))
                if matched:
                    present.add(matched)
    missing_report = sorted(set(REQUIRED_FIELDS) - present)
    return records, rejected, missing_report


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
            elif all(grand.tag == "address" for grand in child) and child.tag.endswith("addresses"):
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


def load_upload(filename: str, payload: bytes) -> tuple[list[dict], int, list[str], str]:
    """Route an uploaded file to the right parser. Returns (records, rejected, missing, file_type)."""
    if len(payload) > MAX_UPLOAD_BYTES:
        raise IngestionError(f"file exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
    lower = filename.lower()
    text = payload.decode("utf-8-sig", errors="replace")
    if lower.endswith(".json"):
        raw_rows, file_type = parse_json(text), "json"
    elif lower.endswith(".xml"):
        raw_rows, file_type = parse_xml(text), "xml"
    else:
        raw_rows, file_type = parse_csv(text), "csv"
    records, rejected, missing = parse_records(raw_rows)
    if not records:
        raise IngestionError(
            "no valid records found — check required fields: " + ", ".join(REQUIRED_FIELDS)
        )
    return records, rejected, missing, file_type
