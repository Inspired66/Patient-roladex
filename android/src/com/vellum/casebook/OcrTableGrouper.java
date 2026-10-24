package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** Groups OCR lines into visual rows without relying on fixed page coordinates. */
final class OcrTableGrouper {
  List<Row> group(OcrDocument.Page page) {
    List<OcrDocument.Line> lines = new ArrayList<>(page.lines);
    Collections.sort(lines, Comparator.comparingInt(line -> line.bounds == null ? Integer.MAX_VALUE : line.bounds.centerY()));
    List<Row> rows = new ArrayList<>();
    int typicalHeight = typicalLineHeight(lines);
    int tolerance = Math.max(3, (int) Math.round(typicalHeight * 0.65));
    for (OcrDocument.Line line : lines) {
      List<OcrDocument.Element> elements = new ArrayList<>(line.elements);
      if (elements.isEmpty() && !line.text.trim().isEmpty()) {
        elements.add(new OcrDocument.Element(line.text, line.bounds));
      }
      if (elements.isEmpty()) continue;
      int centerY = line.bounds == null ? Integer.MAX_VALUE : line.bounds.centerY();
      Row row = findRow(rows, centerY, tolerance);
      if (row == null) {
        row = new Row(page.number, page.width);
        rows.add(row);
      }
      row.add(line, elements);
    }
    for (Row row : rows) row.sort();
    Collections.sort(rows, Comparator.comparingInt(Row::centerY));
    return rows;
  }

  private static int typicalLineHeight(List<OcrDocument.Line> lines) {
    List<Integer> heights = new ArrayList<>();
    for (OcrDocument.Line line : lines) {
      if (line.bounds != null && line.bounds.bottom > line.bounds.top) {
        heights.add(line.bounds.bottom - line.bounds.top);
      }
    }
    if (heights.isEmpty()) return 12;
    Collections.sort(heights);
    return heights.get(heights.size() / 2);
  }

  private static Row findRow(List<Row> rows, int centerY, int tolerance) {
    if (centerY == Integer.MAX_VALUE) return null;
    Row closest = null;
    int distance = Integer.MAX_VALUE;
    for (Row row : rows) {
      int candidate = Math.abs(row.centerY() - centerY);
      if (candidate <= tolerance && candidate < distance) {
        closest = row;
        distance = candidate;
      }
    }
    return closest;
  }

  static final class Row {
    final int page;
    final int pageWidth;
    final List<OcrDocument.Element> elements = new ArrayList<>();
    OcrDocument.Bounds bounds;
    String text = "";

    Row(int page, int pageWidth) {
      this.page = page;
      this.pageWidth = pageWidth;
    }

    void add(OcrDocument.Line line, List<OcrDocument.Element> values) {
      elements.addAll(values);
      bounds = OcrDocument.Bounds.union(bounds, line.bounds);
    }

    void sort() {
      Collections.sort(elements, (first, second) -> {
        if (first.bounds == null || second.bounds == null) return 0;
        return Integer.compare(first.bounds.centerX(), second.bounds.centerX());
      });
      StringBuilder joined = new StringBuilder();
      for (OcrDocument.Element element : elements) {
        String value = element.text.trim();
        if (value.isEmpty()) continue;
        if (joined.length() > 0 && !startsWithPunctuation(value)) joined.append(' ');
        joined.append(value);
        bounds = OcrDocument.Bounds.union(bounds, element.bounds);
      }
      text = joined.toString().replaceAll("\\s+([,.;:])", "$1").trim();
    }

    int centerY() {
      return bounds == null ? Integer.MAX_VALUE : bounds.centerY();
    }

    private static boolean startsWithPunctuation(String value) {
      return value.matches("^[,.;:!?%)] .*") || value.matches("^[,.;:!?%)]$");
    }
  }
}
