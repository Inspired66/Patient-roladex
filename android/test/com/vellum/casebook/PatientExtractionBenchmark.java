package com.vellum.casebook;

import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

/** Replays de-identified OCR geometry fixtures and emits extraction results for metric scoring. */
public final class PatientExtractionBenchmark {
  private static final class PageBuilder {
    final int number;
    final int width;
    final int height;
    final String text;
    final List<OcrDocument.Line> lines = new ArrayList<>();

    PageBuilder(String[] parts) {
      number = Integer.parseInt(parts[1]);
      width = Integer.parseInt(parts[2]);
      height = Integer.parseInt(parts[3]);
      text = decode(parts[4]);
    }
  }

  private static final class LineBuilder {
    final String text;
    final OcrDocument.Bounds bounds;
    final List<OcrDocument.Element> elements = new ArrayList<>();

    LineBuilder(String[] parts) {
      text = decode(parts[1]);
      bounds = bounds(parts[2]);
    }
  }

  private PatientExtractionBenchmark() {}

  public static void main(String[] args) {
    try {
      run(args[0]);
    } catch (Exception error) {
      System.err.println("Benchmark execution failed (" + error.getClass().getSimpleName() + ").");
      System.exit(1);
    }
  }

  private static void run(String modelPath) throws Exception {
    OfflinePatientFieldExtractor extractor = new OfflinePatientFieldExtractor(
        new OpenNlpNameFinder(new FileInputStream(modelPath)));
    BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String id = null;
    String sourceType = null;
    String documentText = "";
    List<String> documentWarnings = null;
    List<OcrDocument.Page> pages = null;
    PageBuilder page = null;
    LineBuilder line = null;
    String encoded;
    while ((encoded = input.readLine()) != null) {
      String[] parts = encoded.split("\\t", -1);
      switch (parts[0]) {
        case "CASE":
          id = decode(parts[1]);
          sourceType = decode(parts[2]);
          documentText = "";
          documentWarnings = new ArrayList<>();
          pages = new ArrayList<>();
          break;
        case "DOC_TEXT":
          documentText = decode(parts[1]);
          break;
        case "DOC_WARNING":
          documentWarnings.add(decode(parts[1]));
          break;
        case "PAGE":
          page = new PageBuilder(parts);
          break;
        case "LINE":
          line = new LineBuilder(parts);
          break;
        case "ELEMENT":
          line.elements.add(new OcrDocument.Element(decode(parts[1]), bounds(parts[2])));
          break;
        case "ENDLINE":
          page.lines.add(new OcrDocument.Line(line.text, line.bounds, line.elements));
          line = null;
          break;
        case "ENDPAGE":
          pages.add(new OcrDocument.Page(page.number, page.width, page.height, page.text, page.lines));
          page = null;
          break;
        case "ENDCASE":
          ExtractionResult result = extractor.extract(
              new OcrDocument(documentText, pages, documentWarnings));
          System.out.println("RESULT\t" + encode(id) + "\t" + encode(sourceType) + "\t"
              + encode(result.toJson()));
          id = null;
          break;
        default:
          throw new IllegalArgumentException("Unknown benchmark input record.");
      }
    }
  }

  private static String decode(String text) {
    return new String(Base64.getDecoder().decode(text), StandardCharsets.UTF_8);
  }

  private static String encode(String text) {
    return Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8));
  }

  private static OcrDocument.Bounds bounds(String value) {
    if ("-".equals(value)) return null;
    String[] coordinates = value.split(",", -1);
    if (coordinates.length != 4) throw new IllegalArgumentException("Invalid OCR bounds.");
    return new OcrDocument.Bounds(
        Integer.parseInt(coordinates[0]),
        Integer.parseInt(coordinates[1]),
        Integer.parseInt(coordinates[2]),
        Integer.parseInt(coordinates[3]));
  }
}
