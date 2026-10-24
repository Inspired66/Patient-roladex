package com.vellum.casebook;

import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

/** Synthetic OCR fixtures for offline field association and validation. */
public final class PatientFieldExtractorTest {
  private final OfflinePatientFieldExtractor extractor;

  private PatientFieldExtractorTest(String modelPath) throws Exception {
    extractor = new OfflinePatientFieldExtractor(new OpenNlpNameFinder(new FileInputStream(modelPath)), 2026);
    DocumentBuilderFactory parserFactory = DocumentBuilderFactory.newInstance();
    parserFactory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
    if (!parserFactory.getFeature(XMLConstants.FEATURE_SECURE_PROCESSING)) {
      throw new AssertionError("OpenNLP XML parser must keep secure processing enabled.");
    }
  }

  public static void main(String[] args) throws Exception {
    PatientFieldExtractorTest tests = new PatientFieldExtractorTest(args[0]);
    tests.tableWithStandardColumns();
    tests.tableWithReorderedColumns();
    tests.alternativeHeadings();
    tests.missingOptionalColumnsAndContacts();
    tests.repeatedRowsAcrossPages();
    tests.clinicianColumnDoesNotBecomePatient();
    tests.conflictingDobIsUnresolved();
    tests.textualDobFormats();
    tests.ocrErrorsAndWhitespace();
    tests.explicitLabelledList();
    tests.noPatientRows();
    tests.unsupportedLayoutDoesNotGuess();
    tests.jsonRetainsOcrGeometryAndFieldProvenance();
    System.out.println("PatientFieldExtractorTest: 13 synthetic scenarios passed");
  }

  private void tableWithStandardColumns() {
    ExtractionResult result = extract(
        new String[] {"Name", "DOB", "Gender", "Phone", "Email"},
        row("Avery Stone", "1980-02-01", "Female", "0412 345 678", "avery.stone@example.test"));
    PatientRecord patient = only(result);
    equal("Avery Stone", patient.patientName.value);
    equal("1980-02-01", patient.dateOfBirth.value);
    equal("Female", patient.gender.value);
    equal("0412 345 678", patient.phone.value);
    equal("avery.stone@example.test", patient.email.value);
    equal("australian-phone-rule", patient.phone.candidates.get(0).method);
  }

  private void tableWithReorderedColumns() {
    ExtractionResult result = extract(
        new String[] {"Email", "Mobile", "Sex", "Birth Date", "Patient Name"},
        row("blair@example.test", "+61 412 345 678", "M", "02/03/1977", "Blair Quinn"));
    PatientRecord patient = only(result);
    equal("Blair Quinn", patient.patientName.value);
    equal("1977-03-02", patient.dateOfBirth.value);
    equal("Male", patient.gender.value);
    equal("+61 412 345 678", patient.phone.value);
    equal("blair@example.test", patient.email.value);
  }

  private void alternativeHeadings() {
    ExtractionResult result = extract(
        new String[] {"Given Name", "Date of Birth", "Telephone Number", "E-mail Address"},
        row("Casey Morgan", "8/7/1975", "(03) 9000 1111", "casey@example.test"));
    PatientRecord patient = only(result);
    equal("Casey Morgan", patient.patientName.value);
    equal("1975-07-08", patient.dateOfBirth.value);
    equal(null, patient.gender.value);
    equal("(03) 9000 1111", patient.phone.value);
    equal("casey@example.test", patient.email.value);
  }

  private void missingOptionalColumnsAndContacts() {
    ExtractionResult result = extract(
        new String[] {"Patient Name", "DOB"},
        row("Drew Taylor", "1988-11-12"),
        row("Emery Lee", ""));
    equal(2, result.records.size());
    PatientRecord first = result.records.get(0);
    equal("Drew Taylor", first.patientName.value);
    equal("1988-11-12", first.dateOfBirth.value);
    equal(null, first.gender.value);
    equal(null, first.phone.value);
    equal(null, first.email.value);
    equal("Emery Lee", result.records.get(1).patientName.value);
    equal(null, result.records.get(1).dateOfBirth.value);
    equal(null, result.records.get(1).gender.value);
    equal(null, result.records.get(1).phone.value);
    equal(null, result.records.get(1).email.value);
    contains(first.warnings, "Phone number was not found.");
    contains(first.warnings, "Email address was not found.");
    contains(result.warnings, "Gender/sex was not explicitly stated and was left blank.");
  }

  private void repeatedRowsAcrossPages() {
    OcrDocument first = page(1,
        new String[] {"Patient", "DOB", "Phone", "Email"},
        row("Finley Hart", "1990-04-05", "0411 222 333", "finley@example.test"));
    OcrDocument second = page(2,
        row("Gray Ellis", "1991-05-06", "0422 333 444", "gray@example.test"));
    ExtractionResult result = extractor.extract(combine(first, second));
    equal(2, result.records.size());
    equal("Finley Hart", result.records.get(0).patientName.value);
    equal("1990-04-05", result.records.get(0).dateOfBirth.value);
    equal("0411 222 333", result.records.get(0).phone.value);
    equal("finley@example.test", result.records.get(0).email.value);
    equal(null, result.records.get(0).gender.value);
    equal("Gray Ellis", result.records.get(1).patientName.value);
    equal("1991-05-06", result.records.get(1).dateOfBirth.value);
    equal("0422 333 444", result.records.get(1).phone.value);
    equal("gray@example.test", result.records.get(1).email.value);
    equal(null, result.records.get(1).gender.value);
    equal(1, result.records.get(0).sourcePage);
    equal(2, result.records.get(1).sourcePage);
  }

  private void clinicianColumnDoesNotBecomePatient() {
    ExtractionResult result = extract(
        new String[] {"Patient Name", "DOB", "Consultant", "Phone", "Email"},
        row("Harper Lane", "1982-06-03", "Dr Surgeon Example", "0433 444 555", "harper@example.test"));
    PatientRecord patient = only(result);
    equal("Harper Lane", patient.patientName.value);
    check(!patient.patientName.value.contains("Surgeon"), "clinician text leaked into patient name");
    equal("1982-06-03", patient.dateOfBirth.value);
    equal(null, patient.gender.value);
    equal("0433 444 555", patient.phone.value);
    equal("harper@example.test", patient.email.value);
  }

  private void conflictingDobIsUnresolved() {
    ExtractionResult result = extract(
        new String[] {"Name", "DOB", "Phone"},
        row("Indigo Park", "01/02/1980 / 03/04/1981", "0400 000 001"));
    PatientRecord patient = only(result);
    equal("Indigo Park", patient.patientName.value);
    equal(null, patient.dateOfBirth.value);
    equal(2, patient.dateOfBirth.candidates.size());
    equal("1980-02-01", patient.dateOfBirth.candidates.get(0).value);
    equal("1981-04-03", patient.dateOfBirth.candidates.get(1).value);
    contains(patient.dateOfBirth.warnings, "DOB is ambiguous; review the source values.");
    equal("0400 000 001", patient.phone.value);
    equal(null, patient.gender.value);
    equal(null, patient.email.value);
  }

  private void textualDobFormats() {
    PatientRecord dmy = only(extract(
        new String[] {"Name", "Birth Date"},
        row("Morgan Vale", "5 March 1982")));
    equal("Morgan Vale", dmy.patientName.value);
    equal("1982-03-05", dmy.dateOfBirth.value);
    equal(null, dmy.gender.value);
    equal(null, dmy.phone.value);
    equal(null, dmy.email.value);

    PatientRecord mdy = only(extract(
        new String[] {"Name", "DOB"},
        row("Riley Quinn", "March 5, 1982")));
    equal("Riley Quinn", mdy.patientName.value);
    equal("1982-03-05", mdy.dateOfBirth.value);
    equal(null, mdy.gender.value);
    equal(null, mdy.phone.value);
    equal(null, mdy.email.value);
  }

  private void ocrErrorsAndWhitespace() {
    ExtractionResult result = extract(
        new String[] {"Patient   Name", "D.O.B.", "Sex", "Mobile"},
        row("  Jamie   O'Neil ", "1O/02/1980", "F", "0412 345 678"));
    PatientRecord patient = only(result);
    equal("Jamie O'Neil", patient.patientName.value);
    equal("1980-02-10", patient.dateOfBirth.value);
    equal("Female", patient.gender.value);
    equal("0412 345 678", patient.phone.value);
    equal(null, patient.email.value);
    equal(1, patient.patientName.candidates.get(0).page);
    check(patient.patientName.candidates.get(0).bounds != null, "name source bounds were lost");
  }

  private void explicitLabelledList() {
    OcrDocument document = page(1, row(
        "Patient Name: Jordan Reid | DOB: 05/06/1984 | Sex: Female | Phone: 0412 555 888 | Email: jordan@example.test"));
    PatientRecord patient = only(extractor.extract(document));
    equal("Jordan Reid", patient.patientName.value);
    equal("1984-06-05", patient.dateOfBirth.value);
    equal("Female", patient.gender.value);
    equal("0412 555 888", patient.phone.value);
    equal("jordan@example.test", patient.email.value);
  }

  private void noPatientRows() {
    ExtractionResult result = extract(
        new String[] {"Name", "DOB", "Gender"},
        row("Patient list", "", ""),
        row("Operating theatre", "", ""));
    equal(0, result.records.size());
    contains(result.warnings, "No patient rows were detected. No values were inferred from the document.");
  }

  private void unsupportedLayoutDoesNotGuess() {
    ExtractionResult result = extractor.extract(page(1,
        row("Today’s theatre list — Dr Ellis"),
        row("Anaesthetic review 09:30"),
        row("Patient information is available from reception")));
    equal(0, result.records.size());
    contains(result.warnings, "No patient-name column or explicit patient-name labels were detected. Review the OCR text and layout.");
  }

  private void jsonRetainsOcrGeometryAndFieldProvenance() {
    ExtractionResult result = extract(
        new String[] {"Name", "DOB"},
        row("Kai Rowan", "2001-09-10"));
    PatientRecord patient = only(result);
    equal("Kai Rowan", patient.patientName.value);
    equal("2001-09-10", patient.dateOfBirth.value);
    equal(null, patient.gender.value);
    equal(null, patient.phone.value);
    equal(null, patient.email.value);
    String json = result.toJson();
    contains(json, "\"elements\":[");
    contains(json, "\"bounds\":{\"left\":");
    contains(json, "\"sourceText\":\"Kai Rowan\"");
    contains(json, "\"method\":");
  }

  private ExtractionResult extract(String[] headers, String[]... rows) {
    return extractor.extract(tablePage(1, headers, rows));
  }

  private static PatientRecord only(ExtractionResult result) {
    equal(1, result.records.size());
    return result.records.get(0);
  }

  private static OcrDocument tablePage(int number, String[] headers, String[]... bodyRows) {
    List<String[]> rows = new ArrayList<>();
    rows.add(headers);
    rows.addAll(Arrays.asList(bodyRows));
    return page(number, rows.toArray(new String[0][]));
  }

  private static OcrDocument page(int number, String[]... rows) {
    List<OcrDocument.Line> lines = new ArrayList<>();
    List<String> pageText = new ArrayList<>();
    int y = 30;
    for (String[] values : rows) {
      List<OcrDocument.Element> elements = new ArrayList<>();
      StringBuilder lineText = new StringBuilder();
      OcrDocument.Bounds lineBounds = null;
      for (int column = 0; column < values.length; column++) {
        String value = values[column] == null ? "" : values[column];
        if (value.isEmpty()) continue;
        int left = 40 + column * 180;
        OcrDocument.Bounds bounds = new OcrDocument.Bounds(left, y, left + Math.max(20, value.length() * 7), y + 16);
        elements.add(new OcrDocument.Element(value, bounds));
        lineBounds = OcrDocument.Bounds.union(lineBounds, bounds);
        if (lineText.length() > 0) lineText.append(' ');
        lineText.append(value);
      }
      String text = lineText.toString();
      lines.add(new OcrDocument.Line(text, lineBounds, elements));
      if (!text.isEmpty()) pageText.add(text);
      y += 28;
    }
    String text = String.join("\n", pageText);
    OcrDocument.Page page = new OcrDocument.Page(number, 1200, 1800, text, lines);
    return new OcrDocument(text, Collections.singletonList(page), Collections.emptyList());
  }

  private static OcrDocument combine(OcrDocument... documents) {
    List<OcrDocument.Page> pages = new ArrayList<>();
    List<String> text = new ArrayList<>();
    for (OcrDocument document : documents) {
      pages.addAll(document.pages);
      text.add(document.text);
    }
    return new OcrDocument(String.join("\n", text), pages, Collections.emptyList());
  }

  private static String[] row(String... values) {
    return values;
  }

  private static void equal(Object expected, Object actual) {
    if (expected == null ? actual != null : !expected.equals(actual)) {
      throw new AssertionError("Expected <" + expected + "> but got <" + actual + ">");
    }
  }

  private static void contains(List<String> values, String expected) {
    if (!values.contains(expected)) throw new AssertionError("Expected warning: " + expected + "; got " + values);
  }

  private static void contains(String value, String expected) {
    if (!value.contains(expected)) throw new AssertionError("Expected <" + expected + "> in output");
  }

  private static void check(boolean condition, String message) {
    if (!condition) throw new AssertionError(message);
  }
}
