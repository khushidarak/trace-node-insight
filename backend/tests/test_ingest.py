"""Tests for pipeline.ingest — CSV/JSON/XML parsing and validation."""

from __future__ import annotations

import json
import xml.etree.ElementTree as ET

import pytest

from pipeline.ingest import (
    IngestionError,
    load_upload,
    match_field,
    parse_csv,
    parse_json,
    parse_records,
    parse_xml,
)

VALID_ROW = {
    "timestamp": "2026-03-01T10:00:00Z",
    "src_ip": "10.0.0.1",
    "dst_ip": "10.0.0.2",
    "src_port": 8333,
    "dst_port": 8333,
    "txid": "a" * 64,
    "input_addresses": "bc1qaaa;bc1qbbb",
    "output_addresses": "bc1qccc",
    "input_amounts": "1.5;0.5",
    "output_amounts": "1.9",
    "fee": "2500",
    "script_type": "P2WPKH",
    "geo_country": "India",
    "asn": "AS4755",
}


# ---------------------------------------------------------------------------
# Alias normalisation
# ---------------------------------------------------------------------------
def test_match_field_aliases():
    assert match_field("Timestamp") == "timestamp"
    assert match_field("source_ip") == "src_ip"
    assert match_field("Transaction ID") == "txid"
    assert match_field("vin_addresses") == "input_addresses"
    assert match_field("ground_truth") == "ground_truth"
    assert match_field("not_a_real_field") is None


# ---------------------------------------------------------------------------
# Record normalisation
# ---------------------------------------------------------------------------
def test_parse_records_accepts_valid_row():
    records, reasons = parse_records([VALID_ROW])
    assert len(records) == 1
    assert reasons == [""]
    row = records[0]
    assert row["input_addresses"] == ["bc1qaaa", "bc1qbbb"]
    assert row["input_amounts"] == [1.5, 0.5]
    assert row["src_port"] == 8333
    assert row["timestamp"].endswith("+00:00")


def test_parse_records_rejects_missing_fields_with_reason():
    bad = {k: v for k, v in VALID_ROW.items() if k != "fee"}
    records, reasons = parse_records([bad])
    assert records == []
    assert "missing fields" in reasons[0]
    assert "fee" in reasons[0]


def test_parse_records_rejects_bad_timestamp_and_fee():
    bad_ts = {**VALID_ROW, "timestamp": "not-a-date"}
    bad_fee = {**VALID_ROW, "fee": "expensive"}
    records, reasons = parse_records([bad_ts, bad_fee])
    assert records == []
    assert "unparseable timestamp" in reasons[0]
    assert "invalid fee" in reasons[1]


def test_parse_records_mixed_rows_keeps_parallel_reasons():
    records, reasons = parse_records([VALID_ROW, {"junk": True}, VALID_ROW])
    assert len(records) == 2
    assert len(reasons) == 3
    assert reasons[0] == "" and reasons[2] == ""
    assert reasons[1]


def test_ground_truth_survives_normalisation():
    records, _ = parse_records([{**VALID_ROW, "ground_truth": "1"}, {**VALID_ROW, "ground_truth": "0"}])
    assert records[0]["ground_truth"] == 1
    assert records[1]["ground_truth"] == 0


# ---------------------------------------------------------------------------
# Format parsers
# ---------------------------------------------------------------------------
def test_parse_csv_json_xml_equivalent_payloads():
    csv_rows = parse_csv(
        "timestamp,src_ip,txid\n2026-03-01T10:00:00Z,10.0.0.1,abc"
    )
    assert csv_rows[0]["txid"] == "abc"

    json_text = json.dumps([{"timestamp": "2026-03-01T10:00:00Z", "src_ip": "10.0.0.1", "txid": "abc"}])
    assert parse_json(json_text)[0]["txid"] == "abc"

    wrapped = json.dumps({"data": [{"timestamp": "t", "txid": "x"}]})
    assert parse_json(wrapped)[0]["txid"] == "x"

    root = ET.Element("rows")
    row = ET.SubElement(root, "row")
    ET.SubElement(row, "txid").text = "abc"
    ET.SubElement(row, "input_addresses")
    ET.SubElement(row[-1], "address").text = "bc1q1"
    xml_text = ET.tostring(root, encoding="unicode")
    rows = parse_xml(xml_text)
    assert rows[0]["txid"] == "abc"
    assert rows[0]["input_addresses"] == ["bc1q1"]


def test_parse_json_rejects_invalid_shape():
    with pytest.raises(IngestionError):
        parse_json('{"not": "a list"}')


def test_load_upload_routes_by_extension():
    csv_bytes = (
        "timestamp,src_ip,dst_ip,src_port,dst_port,txid,input_addresses,"
        "output_addresses,input_amounts,output_amounts,fee,script_type,"
        "geo_country,asn\n" + ",".join(str(v) for v in VALID_ROW.values())
    ).encode()
    records, reasons, detected, file_type = load_upload("dataset.csv", csv_bytes)
    assert file_type == "csv"
    assert len(records) == 1
    assert "txid" in detected

    with pytest.raises(IngestionError):
        load_upload("empty.csv", b"timestamp,src_ip\n1,2")

    with pytest.raises(IngestionError):
        load_upload("huge.csv", b"a" * (60 * 1024 * 1024))
