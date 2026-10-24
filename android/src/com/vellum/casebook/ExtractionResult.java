package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Extraction output retains the full OCR document and field-level provenance. */
public final class ExtractionResult {
  public final OcrDocument document;
  public final List<PatientRecord> records;
  public final List<String> warnings;

  public ExtractionResult(OcrDocument document, List<PatientRecord> records, List<String> warnings) {
    this.document = document;
    this.records = Collections.unmodifiableList(new ArrayList<>(records));
    this.warnings = Collections.unmodifiableList(new ArrayList<>(warnings));
  }

  public String toJson() {
    StringBuilder json = new StringBuilder();
    json.append("{\"document\":{");
    json.append("\"text\":").append(JsonValue.quote(document.text)).append(",\"warnings\":");
    JsonValue.strings(json, document.warnings);
    json.append(",\"pages\":[");
    for (int pageIndex = 0; pageIndex < document.pages.size(); pageIndex++) {
      if (pageIndex > 0) json.append(',');
      OcrDocument.Page page = document.pages.get(pageIndex);
      json.append("{\"number\":").append(page.number)
          .append(",\"width\":").append(page.width)
          .append(",\"height\":").append(page.height)
          .append(",\"text\":").append(JsonValue.quote(page.text)).append(",\"lines\":[");
      for (int lineIndex = 0; lineIndex < page.lines.size(); lineIndex++) {
        if (lineIndex > 0) json.append(',');
        OcrDocument.Line line = page.lines.get(lineIndex);
        json.append("{\"text\":").append(JsonValue.quote(line.text)).append(",\"bounds\":");
        JsonValue.bounds(json, line.bounds);
        json.append(",\"elements\":[");
        for (int elementIndex = 0; elementIndex < line.elements.size(); elementIndex++) {
          if (elementIndex > 0) json.append(',');
          OcrDocument.Element element = line.elements.get(elementIndex);
          json.append("{\"text\":").append(JsonValue.quote(element.text)).append(",\"bounds\":");
          JsonValue.bounds(json, element.bounds);
          json.append('}');
        }
        json.append("]}");
      }
      json.append("]}");
    }
    json.append("]},\"records\":[");
    for (int index = 0; index < records.size(); index++) {
      if (index > 0) json.append(',');
      appendRecord(json, records.get(index));
    }
    json.append("],\"warnings\":");
    JsonValue.strings(json, warnings);
    return json.append('}').toString();
  }

  private static void appendRecord(StringBuilder json, PatientRecord record) {
    json.append("{\"patientName\":");
    appendField(json, record.patientName);
    json.append(",\"dateOfBirth\":");
    appendField(json, record.dateOfBirth);
    json.append(",\"gender\":");
    appendField(json, record.gender);
    json.append(",\"phone\":");
    appendField(json, record.phone);
    json.append(",\"email\":");
    appendField(json, record.email);
    json.append(",\"sourcePage\":").append(record.sourcePage).append(",\"sourceBounds\":");
    JsonValue.bounds(json, record.sourceBounds);
    json.append(",\"warnings\":");
    JsonValue.strings(json, record.warnings);
    json.append('}');
  }

  private static void appendField(StringBuilder json, PatientField field) {
    json.append("{\"value\":").append(JsonValue.nullable(field.value)).append(",\"warnings\":");
    JsonValue.strings(json, field.warnings);
    json.append(",\"candidates\":[");
    for (int index = 0; index < field.candidates.size(); index++) {
      if (index > 0) json.append(',');
      PatientField.Candidate candidate = field.candidates.get(index);
      json.append("{\"value\":").append(JsonValue.quote(candidate.value))
          .append(",\"sourceText\":").append(JsonValue.quote(candidate.sourceText))
          .append(",\"page\":").append(candidate.page)
          .append(",\"bounds\":");
      JsonValue.bounds(json, candidate.bounds);
      json.append(",\"method\":").append(JsonValue.quote(candidate.method)).append('}');
    }
    json.append("]}");
  }
}

final class JsonValue {
  private JsonValue() {}

  static String quote(String value) {
    StringBuilder json = new StringBuilder("\"");
    if (value != null) {
      for (int index = 0; index < value.length(); index++) {
        char character = value.charAt(index);
        switch (character) {
          case '"': json.append("\\\""); break;
          case '\\': json.append("\\\\"); break;
          case '\b': json.append("\\b"); break;
          case '\f': json.append("\\f"); break;
          case '\n': json.append("\\n"); break;
          case '\r': json.append("\\r"); break;
          case '\t': json.append("\\t"); break;
          default:
            if (character < 0x20) {
              json.append(String.format("\\u%04x", (int) character));
            } else {
              json.append(character);
            }
        }
      }
    }
    return json.append('"').toString();
  }

  static String nullable(String value) {
    return value == null ? "null" : quote(value);
  }

  static void strings(StringBuilder json, List<String> values) {
    json.append('[');
    for (int index = 0; index < values.size(); index++) {
      if (index > 0) json.append(',');
      json.append(quote(values.get(index)));
    }
    json.append(']');
  }

  static void bounds(StringBuilder json, OcrDocument.Bounds bounds) {
    if (bounds == null) {
      json.append("null");
      return;
    }
    json.append("{\"left\":").append(bounds.left).append(",\"top\":").append(bounds.top)
        .append(",\"right\":").append(bounds.right).append(",\"bottom\":").append(bounds.bottom).append('}');
  }
}
