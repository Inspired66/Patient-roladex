#!/usr/bin/env python3
"""Score the native extractor against manually verified OCR-geometry fixtures."""
import argparse
import base64
import json
import re
import subprocess
import sys
from collections import defaultdict

FIELDS = ("patientName", "dateOfBirth", "gender", "phone", "email")
SOURCE_TYPES = {
    "digitally_generated_pdf",
    "scanned_pdf",
    "photograph_skew",
    "photograph_shadows",
    "photograph_low_resolution",
    "image",
    "empty_document",
    "unsupported_file",
    "corrupted_pdf",
    "ocr_fixture",
}


def b64(value):
    return base64.b64encode((value or "").encode("utf-8")).decode("ascii")


def encoded_bounds(bounds):
    if bounds is None:
        return "-"
    return ",".join(str(bounds[key]) for key in ("left", "top", "right", "bottom"))


def fixture_events(cases):
    lines = []
    for case in cases:
        lines.extend(
            (
                "CASE\t{}\t{}".format(b64(case["id"]), b64(case["sourceType"])),
                "DOC_TEXT\t{}".format(b64(case["document"].get("text", ""))),
            )
        )
        for warning in case["document"].get("warnings", []):
            lines.append("DOC_WARNING\t{}".format(b64(warning)))
        for page in case["document"]["pages"]:
            lines.append(
                "PAGE\t{}\t{}\t{}\t{}".format(
                    page["number"], page["width"], page["height"], b64(page.get("text", ""))
                )
            )
            for line in page["lines"]:
                lines.append(
                    "LINE\t{}\t{}".format(b64(line["text"]), encoded_bounds(line.get("bounds")))
                )
                for element in line["elements"]:
                    lines.append(
                        "ELEMENT\t{}\t{}".format(
                            b64(element["text"]), encoded_bounds(element.get("bounds"))
                        )
                    )
                lines.append("ENDLINE")
            lines.append("ENDPAGE")
        lines.append("ENDCASE")
    return "\n".join(lines) + "\n"


def validate_case(case):
    if not isinstance(case.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_-]+", case["id"]):
        raise ValueError("Each case needs an opaque ID containing only letters, digits, '_' or '-'.")
    if case.get("sourceType") not in SOURCE_TYPES:
        raise ValueError("Each case needs a supported sourceType category.")
    document = case.get("document")
    if not isinstance(document, dict) or not isinstance(document.get("pages"), list):
        raise ValueError("Each case needs a document with a pages array.")
    if not isinstance(case.get("expectedRecords"), list):
        raise ValueError("Each case needs a manually verified expectedRecords array.")
    for record in case["expectedRecords"]:
        if not isinstance(record.get("sourcePage"), int) or record["sourcePage"] < 1:
            raise ValueError("Every expected record needs a positive sourcePage.")
        for field in FIELDS:
            if field not in record or (record[field] is not None and not isinstance(record[field], str)):
                raise ValueError("Expected records must state all five field values or null.")


def new_field_counts():
    return {"tp": 0, "fp": 0, "fn": 0, "exact": 0, "slots": 0}


def score_case(case, actual):
    expected_by_page = defaultdict(list)
    actual_by_page = defaultdict(list)
    for record in case["expectedRecords"]:
        expected_by_page[record["sourcePage"]].append(record)
    for record in actual:
        actual_by_page[record["sourcePage"]].append(record)

    counts = {field: new_field_counts() for field in FIELDS}
    missing = extra = association_fields = association_rows = 0
    pages = set(expected_by_page) | set(actual_by_page)
    for page in pages:
        expected_rows = expected_by_page[page]
        actual_rows = actual_by_page[page]
        paired = min(len(expected_rows), len(actual_rows))
        missing += max(0, len(expected_rows) - len(actual_rows))
        extra += max(0, len(actual_rows) - len(expected_rows))
        for index in range(paired):
            expected = expected_rows[index]
            predicted = actual_rows[index]
            wrong_for_other_patient = False
            for field in FIELDS:
                truth = expected[field]
                value = predicted[field]["value"]
                field_counts = counts[field]
                field_counts["slots"] += 1
                exact = value == truth
                field_counts["exact"] += int(exact)
                if truth is not None and exact:
                    field_counts["tp"] += 1
                elif truth is not None:
                    field_counts["fn"] += 1
                    if value is not None:
                        field_counts["fp"] += 1
                elif value is not None:
                    field_counts["fp"] += 1
                if value is not None and not exact and any(
                    other_index != index and other[field] == value
                    for other_index, other in enumerate(expected_rows)
                ):
                    association_fields += 1
                    wrong_for_other_patient = True
            association_rows += int(wrong_for_other_patient)
        for expected in expected_rows[paired:]:
            for field in FIELDS:
                counts[field]["slots"] += 1
                counts[field]["fn"] += int(expected[field] is not None)
        for predicted in actual_rows[paired:]:
            for field in FIELDS:
                counts[field]["slots"] += 1
                counts[field]["fp"] += int(predicted[field]["value"] is not None)
    return {
        "sourceType": case["sourceType"],
        "expected": len(case["expectedRecords"]),
        "actual": len(actual),
        "missed": missing,
        "extra": extra,
        "associationFields": association_fields,
        "associationRows": association_rows,
        "fields": counts,
    }


def metric(numerator, denominator):
    return numerator / denominator if denominator else None


def show_metric(value):
    return "n/a" if value is None else "{:.1%}".format(value)


def report(scores):
    print("Document results (patient field values are deliberately omitted):")
    print("| Case | Source type | Expected rows | Extracted rows | Missed | Extra | Wrong-patient fields |")
    print("|---|---|---:|---:|---:|---:|---:|")
    for index, score in enumerate(scores, start=1):
        print(
            "| {} | {} | {} | {} | {} | {} | {} |".format(
                "Case {}".format(index), score["sourceType"], score["expected"], score["actual"],
                score["missed"], score["extra"], score["associationFields"]
            )
        )
    totals = {field: new_field_counts() for field in FIELDS}
    for score in scores:
        for field in FIELDS:
            for key, value in score["fields"][field].items():
                totals[field][key] += value
    print("\nPer-field metrics (null expectations count toward exact-match accuracy, not precision/recall):")
    print("| Field | Precision | Recall | Exact match |")
    print("|---|---:|---:|---:|")
    for field in FIELDS:
        counts = totals[field]
        precision = metric(counts["tp"], counts["tp"] + counts["fp"])
        recall = metric(counts["tp"], counts["tp"] + counts["fn"])
        accuracy = metric(counts["exact"], counts["slots"])
        print("| {} | {} | {} | {} |".format(field, show_metric(precision), show_metric(recall), show_metric(accuracy)))
    print(
        "\nWrong-patient associations: {} field values across {} rows; missed patient rows: {}; extra rows: {}.".format(
            sum(score["associationFields"] for score in scores),
            sum(score["associationRows"] for score in scores),
            sum(score["missed"] for score in scores),
            sum(score["extra"] for score in scores),
        )
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fixtures", help="JSON fixture file with OCR pages and manually verified records")
    parser.add_argument("--model", required=True, help="Path to the locally bundled OpenNLP model")
    parser.add_argument("--jar", required=True, help="Path to the locally bundled OpenNLP runtime jar")
    parser.add_argument("--classes", required=True, help="Compiled Java benchmark classes directory")
    args = parser.parse_args()
    try:
        with open(args.fixtures, encoding="utf-8") as source:
            data = json.load(source)
        cases = data["cases"]
        if not cases:
            raise ValueError("The fixture file contains no cases.")
        for case in cases:
            validate_case(case)
        if len({case["id"] for case in cases}) != len(cases):
            raise ValueError("Case IDs must be unique.")
        run = subprocess.run(
            ["java", "-cp", args.classes + ":" + args.jar,
             "com.vellum.casebook.PatientExtractionBenchmark", args.model],
            input=fixture_events(cases),
            text=True,
            capture_output=True,
            check=False,
        )
        if run.returncode:
            print("The local extractor benchmark failed; fixture contents were not printed.", file=sys.stderr)
            return 1
        actual_by_id = {}
        for line in run.stdout.splitlines():
            _, encoded_id, _, encoded_result = line.split("\t", 3)
            result = json.loads(base64.b64decode(encoded_result).decode("utf-8"))
            actual_by_id[base64.b64decode(encoded_id).decode("utf-8")] = result["records"]
        if set(actual_by_id) != {case["id"] for case in cases}:
            raise ValueError("The extractor returned an unexpected number of cases.")
        report([score_case(case, actual_by_id[case["id"]]) for case in cases])
        return 0
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        print("Invalid benchmark input ({}).".format(type(error).__name__), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
