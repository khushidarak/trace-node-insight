"""Dataset ingestion: CSV / JSON / XML → normalized Bitcoin transaction rows."""

from __future__ import annotations

import csv
import io
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from .config import MAX_UPLOAD_BYTES

CANONICAL_FIELDS = (
    "timestamp", "src_ip", "src_port", "dst_ip", "dst_port", "txid",
    "input_wallet", "output_wallet", "amount", "fee", "script_type",
)
ALIASES: dict[str, tuple[str, ...]] = {
    "timestamp": ("timestamp", "time", "datetime", "date", "block_time", "ts", "date_time"),
    "src_ip": ("src_ip", "source_ip", "sourceip", "source_address", "srcip"),
    "src_port": ("src_port", "source_port", "sourceport"),
    "dst_ip": ("dst_ip", "destination_ip", "destinationip", "dest_ip", "destip"),
    "dst_port": ("dst_port", "destination_port", "destinationport", "dest_port"),
    "txid": ("txid", "transaction_id", "transaction_hash", "tx_hash", "tx_id"),
    "input_wallet": ("input_wallet", "input_address", "sender_wallet", "source_wallet", "input_addresses", "inputs"),
    "output_wallet": ("output_wallet", "output_address", "receiver_wallet", "destination_wallet", "output_addresses", "outputs"),
    "amount": ("amount", "value", "btc_amount", "transaction_amount", "input_amount", "output_amount"),
    "fee": ("fee", "transaction_fee", "tx_fee", "fee_sat"),
    "script_type": ("script", "script_type", "script_type_name", "scripttype", "scriptpubkey_type"),
}
_ALIAS_LOOKUP = {
    re.sub(r"[^a-z0-9]", "", alias.lower()): canonical
    for canonical, aliases in ALIASES.items()
    for alias in aliases
}
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc).isoformat()


class IngestionError(ValueError):
    """Raised when a dataset cannot be parsed or has no usable transaction rows."""


def _match(field: str) -> str | None:
    return _ALIAS_LOOKUP.get(re.sub(r"[^a-z0-9]", "", field.strip().lower()))


def _parse_timestamp(value: object) -> str:
    if isinstance(value, (int, float)):
        seconds = value / 1000 if value > 1e11 else value
        return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()
    text = str(value).strip()
    if not text:
        raise ValueError("empty timestamp")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M"):
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"unparseable timestamp {value!r}") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _to_list(value: object) -> list[object]:
    if value is None or value == "":
        return []
    if isinstance(value, (list, tuple)):
        return [item for item in value if item is not None and str(item).strip()]
    if isinstance(value, dict):
        return _to_list(value.get("address", value.get("value", "")))
    if isinstance(value, str):
        text = value.strip().strip("[]")
        if not text:
            return []
        parts = text.replace(";", ",").split(",")
        return [part.strip().strip("\"'") for part in parts if part.strip()]
    return [value]


def _normalise(raw: dict) -> dict | None:
    seen: dict[str, object] = {}
    for key, value in raw.items():
        canonical = _match(str(key))
        if canonical and value is not None and str(value).strip():
            seen[canonical] = value

    txid = str(seen.get("txid", "")).strip()
    inputs = [str(item).strip() for item in _to_list(seen.get("input_wallet")) if str(item).strip()]
    outputs = [str(item).strip() for item in _to_list(seen.get("output_wallet")) if str(item).strip()]
    # A transaction ID and at least one wallet side are the minimum useful link.
    if not txid or not (inputs or outputs):
        return None

    try:
        timestamp = _parse_timestamp(seen["timestamp"]) if "timestamp" in seen else _EPOCH
        amount_values = _to_list(seen.get("amount"))
        amounts = [float(value) for value in amount_values]
        amount = amounts[0] if amounts else 0.0
        fee = float(seen.get("fee") or 0)
        src_port = int(float(seen["src_port"])) if seen.get("src_port") not in (None, "") else None
        dst_port = int(float(seen["dst_port"])) if seen.get("dst_port") not in (None, "") else None
    except (TypeError, ValueError, OverflowError):
        return None

    src_ip = str(seen["src_ip"]).strip() if seen.get("src_ip") is not None else None
    dst_ip = str(seen["dst_ip"]).strip() if seen.get("dst_ip") is not None else None
    script_type = str(seen["script_type"]).strip() if seen.get("script_type") is not None else None
    input_wallet = inputs[0] if inputs else None
    output_wallet = outputs[0] if outputs else None

    # Keep the compact canonical record and compatibility fields consumed by the ML pipeline.
    return {
        "timestamp": timestamp,
        "src_ip": src_ip,
        "src_port": src_port,
        "dst_ip": dst_ip,
        "dst_port": dst_port,
        "txid": txid,
        "input_wallet": input_wallet,
        "output_wallet": output_wallet,
        "amount": amount,
        "fee": fee,
        "script_type": script_type,
        "input_addresses": inputs,
        "output_addresses": outputs,
        "input_amounts": amounts[:len(inputs)] or ([amount] if inputs else []),
        "output_amounts": amounts[:len(outputs)] or ([amount] if outputs else []),
        "geo_country": "Unknown",
        "asn": "Unknown",
    }


def parse_records(raw_rows: list[dict]) -> tuple[list[dict], int, list[str], list[str]]:
    records: list[dict] = []
    rejected = 0
    detected: list[str] = []
    for raw in raw_rows:
        if not isinstance(raw, dict):
            rejected += 1
            continue
        for key in raw:
            if key is not None and str(key) not in detected:
                detected.append(str(key))
        row = _normalise(raw)
        if row is None:
            rejected += 1
        else:
            records.append(row)
    present = {_match(name) for name in detected}
    missing = sorted(set(CANONICAL_FIELDS) - present)
    return records, rejected, missing, detected


def parse_csv(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text)))


def parse_json(text: str) -> list[dict]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise IngestionError(f"Invalid JSON: {exc.msg} (line {exc.lineno}, column {exc.colno}).") from exc
    if isinstance(data, dict):
        for key in ("data", "records", "transactions", "rows"):
            if isinstance(data.get(key), list):
                data = data[key]
                break
        else:
            raise IngestionError("Unsupported JSON schema: expected an array or a data/records/transactions/rows array.")
    if not isinstance(data, list):
        raise IngestionError("Unsupported JSON schema: expected an array of transaction records.")
    return data


def parse_xml(text: str) -> list[dict]:
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise IngestionError(f"Invalid XML: {exc}.") from exc

    def local(tag: str) -> str:
        return tag.rsplit("}", 1)[-1]

    def flatten(element: ET.Element) -> dict:
        result = {local(key): value for key, value in element.attrib.items()}
        for child in element:
            key = local(child.tag)
            value: object = child.text.strip() if child.text and child.text.strip() else None
            if list(child):
                value = flatten(child)
                # Accept common address/value wrappers used for transaction inputs/outputs.
                if isinstance(value, dict) and len(value) == 1:
                    value = next(iter(value.values()))
            if key in result:
                previous = result[key] if isinstance(result[key], list) else [result[key]]
                result[key] = previous + ([value] if not isinstance(value, list) else value)
            else:
                result[key] = value
        return result

    record_tags = {"row", "record", "transaction", "tx"}
    candidates = [child for child in root if local(child.tag).lower() in record_tags]
    if not candidates and local(root.tag).lower() in record_tags:
        candidates = [root]
    if not candidates:
        raise IngestionError("Unsupported XML schema: expected <rows><row>, <transactions><transaction>, or transaction records.")
    return [flatten(element) for element in candidates]


def load_upload(filename: str, payload: bytes) -> tuple[list[dict], int, list[str], str, list[str], int]:
    if len(payload) > MAX_UPLOAD_BYTES:
        raise IngestionError(f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit.")
    lower = filename.lower()
    text = payload.decode("utf-8-sig", errors="replace")
    if lower.endswith(".json"):
        raw_rows, file_type = parse_json(text), "json"
    elif lower.endswith(".xml"):
        raw_rows, file_type = parse_xml(text), "xml"
    elif lower.endswith(".csv"):
        raw_rows, file_type = parse_csv(text), "csv"
    else:
        raise IngestionError("Unsupported file type. Upload a CSV, JSON, or XML transaction dataset.")
    records, rejected, missing, detected = parse_records(raw_rows)
    if not records:
        columns = ", ".join(detected) if detected else "none detected"
        raise IngestionError(
            "Unsupported transaction schema: no valid rows found. Each record needs a transaction ID "
            "(txid / transaction_id / transaction_hash) and at least one input or output wallet. "
            f"Detected columns: {columns}."
        )
    return records, rejected, missing, file_type, detected, len(raw_rows)