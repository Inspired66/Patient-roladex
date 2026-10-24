package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Header/row association and deterministic field parsing for local OCR documents. */
public final class OfflinePatientFieldExtractor implements PatientFieldExtractor {
  private static final Pattern EMAIL = Pattern.compile(
      "(?i)(?<![A-Z0-9._%+-])[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+");
  private static final Pattern AU_PHONE = Pattern.compile(
      "(?<![A-Z0-9])(?:\\+?61[\\s().-]*(?:[2378][\\s().-]*\\d{4}[\\s().-]*\\d{4}|4\\d{2}[\\s().-]*\\d{3}[\\s().-]*\\d{3})|\\(?0[2378]\\)?[\\s().-]*\\d{4}[\\s().-]*\\d{4}|\\(?04\\d{2}\\)?[\\s().-]*\\d{3}[\\s().-]*\\d{3})(?!\\d)",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern DMY_DATE = Pattern.compile(
      "(?<!\\d)(\\d{1,2})\\s*[/.-]\\s*(\\d{1,2})\\s*[/.-]\\s*((?:19|20)\\d{2})(?!\\d)");
  private static final Pattern YMD_DATE = Pattern.compile(
      "(?<!\\d)((?:19|20)\\d{2})\\s*[-/.]\\s*(\\d{1,2})\\s*[-/.]\\s*(\\d{1,2})(?!\\d)");
  private static final Pattern TEXT_DMY_DATE = Pattern.compile(
      "(?i)(?<![\\p{L}\\d])(\\d{1,2})\\s+([a-z]{3,9})[,]?\\s+((?:19|20)\\d{2})(?!\\d)");
  private static final Pattern TEXT_MDY_DATE = Pattern.compile(
      "(?i)(?<![\\p{L}\\d])([a-z]{3,9})\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+((?:19|20)\\d{2})(?!\\d)");
  private static final Pattern LABELED_FIELD = Pattern.compile(
      "(?i)\\b(patient\\s+name|patient|name|date\\s+of\\s+birth|birth\\s+date|birthdate|d\\s*\\.?o\\s*\\.?b\\.?|dob|sex|gender|mobile(?:\\s+(?:number|no\\.?|phone))?|telephone(?:\\s+number)?|phone(?:\\s+(?:number|no\\.?))?|tel(?:\\s+no\\.?)?|contact\\s+number|email(?:\\s+(?:address|id))?|e\\s*\\-?mail|surgeon|consultant|anaesthetist|anesthesiologist)\\s*[:=\\-]\\s*");
  private static final Set<String> NON_NAMES = new HashSet<>(Arrays.asList(
      "patient", "patients", "list", "lists", "theatre", "theater", "hospital", "ward", "surgeon", "consultant",
      "anaesthetist", "anesthesiologist", "name", "dob", "birth", "date", "unknown", "none", "n/a"));
  private final OpenNlpNameFinder nameFinder;
  private final int currentYear;
  private final OcrTableGrouper grouper = new OcrTableGrouper();

  public OfflinePatientFieldExtractor(OpenNlpNameFinder nameFinder) {
    this(nameFinder, Calendar.getInstance().get(Calendar.YEAR));
  }

  private static int coordinate(int x, int pageWidth) {
    return pageWidth > 0 ? (int) Math.round((x * 10000d) / pageWidth) : x;
  }

  OfflinePatientFieldExtractor(OpenNlpNameFinder nameFinder, int currentYear) {
    this.nameFinder = nameFinder;
    this.currentYear = currentYear;
  }

  @Override
  public ExtractionResult extract(OcrDocument document) {
    List<PatientRecord> records = new ArrayList<>();
    List<String> warnings = new ArrayList<>(document.warnings);
    List<Column> rememberedColumns = null;
    boolean sawNameHeader = false;
    boolean sawGenderHeader = false;
    boolean sawTableHeader = false;

    for (OcrDocument.Page page : document.pages) {
      List<OcrTableGrouper.Row> rows = grouper.group(page);
      List<Column> pageColumns = null;
      for (OcrTableGrouper.Row row : rows) {
        List<Column> detected = detectColumns(row);
        if (isHeader(detected)) {
          pageColumns = detected;
          rememberedColumns = detected;
          sawTableHeader = true;
          for (Column column : detected) {
            if (column.field == FieldKey.NAME) sawNameHeader = true;
            if (column.field == FieldKey.GENDER) sawGenderHeader = true;
          }
          continue;
        }
        List<Column> columns = pageColumns != null ? pageColumns : rememberedColumns;
        if (columns != null && columns.stream().anyMatch(column -> column.field == FieldKey.NAME)) {
          PatientRecord record = extractTableRow(row, columns);
          if (record != null) records.add(record);
        } else {
          PatientRecord record = extractLabeledRow(row);
          if (record != null) records.add(record);
        }
      }
    }

    if (!sawNameHeader && records.isEmpty()) {
      warnings.add("No patient-name column or explicit patient-name labels were detected. Review the OCR text and layout.");
    } else if (!sawTableHeader && !records.isEmpty()) {
      warnings.add("No supported table headings were detected; records came from explicit field labels and need review.");
    }
    if (records.isEmpty()) {
      warnings.add("No patient rows were detected. No values were inferred from the document.");
    }
    if (!sawGenderHeader && records.stream().allMatch(record -> record.gender.value == null)) {
      warnings.add("Gender/sex was not explicitly stated and was left blank.");
    }
    return new ExtractionResult(document, records, distinct(warnings));
  }

  private PatientRecord extractTableRow(OcrTableGrouper.Row row, List<Column> columns) {
    EnumMap<FieldKey, Cell> cells = mapCells(row, columns);
    Cell nameCell = cells.get(FieldKey.NAME);
    if (nameCell == null || nameCell.text.trim().isEmpty()) return null;

    CandidateMap candidates = emptyCandidates();
    String deterministicName = cleanName(nameCell.text);
    List<String> detectedNames = findNames(nameCell.text);
    if (validName(deterministicName)) {
      if (detectedNames.size() == 1 && normalize(detectedNames.get(0)).equals(normalize(deterministicName))) {
        add(candidates, FieldKey.NAME, deterministicName, nameCell, "patient-name-column+opennlp-confirmed");
      } else {
        add(candidates, FieldKey.NAME, deterministicName, nameCell, "patient-name-column");
      }
    } else {
      if (detectedNames.size() == 1 && validModelName(detectedNames.get(0))) {
        add(candidates, FieldKey.NAME, detectedNames.get(0), nameCell, "opennlp-person-name");
      } else if (detectedNames.size() > 1) {
        for (String name : detectedNames) {
          if (validModelName(name)) add(candidates, FieldKey.NAME, name, nameCell, "opennlp-person-name");
        }
      }
    }
    if (candidates.get(FieldKey.NAME).isEmpty()) return null;

    addCellCandidates(candidates, FieldKey.DOB, cells.get(FieldKey.DOB));
    addCellCandidates(candidates, FieldKey.GENDER, cells.get(FieldKey.GENDER));
    addCellCandidates(candidates, FieldKey.PHONE, cells.get(FieldKey.PHONE));
    addCellCandidates(candidates, FieldKey.EMAIL, cells.get(FieldKey.EMAIL));
    return makeRecord(candidates, row.page, row.bounds);
  }

  private PatientRecord extractLabeledRow(OcrTableGrouper.Row row) {
    CandidateMap candidates = emptyCandidates();
    Matcher matcher = LABELED_FIELD.matcher(row.text);
    List<Label> labels = new ArrayList<>();
    while (matcher.find()) {
      FieldKey key = labelKey(matcher.group(1));
      if (key != null) labels.add(new Label(key, matcher.start(), matcher.end()));
    }
    for (int index = 0; index < labels.size(); index++) {
      Label label = labels.get(index);
      int end = index + 1 < labels.size() ? labels.get(index + 1).start : row.text.length();
      String source = row.text.substring(label.end, end).replaceAll("[|;\\s]+$", "").trim();
      if (source.isEmpty()) continue;
      Cell sourceCell = cellFromRow(row, source);
      if (label.key == FieldKey.NAME) {
        String name = cleanName(source);
        if (validName(name)) {
          add(candidates, FieldKey.NAME, name, sourceCell, "explicit-patient-label");
        } else {
          List<String> names = findNames(source);
          if (names.size() == 1 && validModelName(names.get(0))) {
            add(candidates, FieldKey.NAME, names.get(0), sourceCell, "opennlp-person-name");
          }
        }
      } else if (label.key != FieldKey.IGNORE) {
        addParsedCandidates(candidates, label.key, source, sourceCell);
      }
    }
    if (candidates.get(FieldKey.NAME).isEmpty()) return null;
    return makeRecord(candidates, row.page, row.bounds);
  }

  private EnumMap<FieldKey, Cell> mapCells(OcrTableGrouper.Row row, List<Column> columns) {
    EnumMap<FieldKey, Cell> cells = new EnumMap<>(FieldKey.class);
    List<Column> positioned = new ArrayList<>();
    for (Column column : columns) if (column.x != Integer.MIN_VALUE) positioned.add(column);
    Collections.sort(positioned, Comparator.comparingInt(column -> column.x));
    for (OcrDocument.Element element : row.elements) {
      Column closest = null;
      if (element.bounds != null && !positioned.isEmpty()) {
        int width = element.bounds.right - element.bounds.left;
        int x = coordinate(element.bounds.left + Math.min(Math.max(width, 0) / 2, 12), row.pageWidth);
        int nearest = Integer.MAX_VALUE;
        for (Column column : positioned) {
          int distance = Math.abs(column.x - x);
          if (distance < nearest) {
            closest = column;
            nearest = distance;
          }
        }
      } else if (row.elements.size() == columns.size()) {
        int position = row.elements.indexOf(element);
        if (position >= 0 && position < columns.size()) closest = columns.get(position);
      }
      if (closest == null || closest.field == FieldKey.IGNORE) continue;
      Cell cell = cells.get(closest.field);
      if (cell == null) {
        cell = new Cell(row.page);
        cells.put(closest.field, cell);
      }
      cell.add(element.text, element.bounds);
    }
    for (Cell cell : cells.values()) cell.finish();
    return cells;
  }

  private void addCellCandidates(
      CandidateMap candidates, FieldKey key, Cell cell) {
    if (cell == null || cell.text.trim().isEmpty()) return;
    addParsedCandidates(candidates, key, cell.text, cell);
  }

  private void addParsedCandidates(
      CandidateMap candidates, FieldKey key, String source, Cell cell) {
    if (key == FieldKey.DOB) {
      List<String> dates = dates(source);
      for (String date : dates) add(candidates, key, date, cell, "dob-column-or-label");
      if (dates.isEmpty() && source.matches("(?s).*\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2}.*")) {
        addWarning(candidates, key, "DOB has a two-digit year; it was not interpreted.");
      } else if (dates.isEmpty() && source.matches("(?s).*\\d.*")) {
        addWarning(candidates, key, "DOB text could not be validated; it was left blank.");
      }
      return;
    }
    if (key == FieldKey.GENDER) {
      String gender = explicitGender(source);
      if (gender != null) add(candidates, key, gender, cell, "explicit-gender-column-or-label");
      else addWarning(candidates, key, "Gender/sex value was not recognised; it was left blank.");
      return;
    }
    if (key == FieldKey.PHONE) {
      Matcher matcher = AU_PHONE.matcher(source);
      boolean matched = false;
      while (matcher.find()) {
        String raw = matcher.group().trim();
        if (digits(raw).length() >= 9 && digits(raw).length() <= 12) {
          add(candidates, key, raw, cell, "australian-phone-rule");
          matched = true;
        }
      }
      if (!matched && source.matches("(?s).*\\d.*")) {
        addWarning(candidates, key, "Phone text did not match an Australian phone format; it was left blank.");
      }
      return;
    }
    if (key == FieldKey.EMAIL) {
      Matcher matcher = EMAIL.matcher(source);
      boolean matched = false;
      while (matcher.find()) {
        String email = matcher.group();
        if (email.length() <= 254 && email.indexOf("..") < 0) {
          add(candidates, key, email, cell, "email-syntax-rule");
          matched = true;
        }
      }
      if (!matched && source.contains("@")) {
        addWarning(candidates, key, "Email text did not pass syntax validation; it was left blank.");
      }
    }
  }

  private PatientRecord makeRecord(
      CandidateMap candidates, int page, OcrDocument.Bounds bounds) {
    List<String> warnings = new ArrayList<>();
    PatientField name = field(candidates, FieldKey.NAME, "Patient name", warnings, true);
    PatientField dob = field(candidates, FieldKey.DOB, "DOB", warnings, false);
    PatientField gender = field(candidates, FieldKey.GENDER, "Gender/sex", warnings, false);
    PatientField phone = field(candidates, FieldKey.PHONE, "Phone", warnings, false);
    PatientField email = field(candidates, FieldKey.EMAIL, "Email", warnings, false);
    if (dob.value == null) warnings.addAll(dob.warnings);
    if (gender.value == null) {
      if (gender.warnings.isEmpty()) warnings.add("Gender/sex was not explicitly stated for this patient.");
      else warnings.addAll(gender.warnings);
    }
    if (phone.value == null) warnings.addAll(phone.warnings);
    if (email.value == null) warnings.addAll(email.warnings);
    if (dob.value == null && dob.warnings.isEmpty()) warnings.add("DOB was not found.");
    if (phone.value == null && phone.warnings.isEmpty()) warnings.add("Phone number was not found.");
    if (email.value == null && email.warnings.isEmpty()) warnings.add("Email address was not found.");
    return new PatientRecord(name, dob, gender, phone, email, page, bounds, distinct(warnings));
  }

  private static PatientField field(
      CandidateMap fields, FieldKey key, String label, List<String> recordWarnings, boolean required) {
    List<PatientField.Candidate> values = fields.get(key);
    Set<String> unique = new HashSet<>();
    for (PatientField.Candidate candidate : values) unique.add(candidate.value.toLowerCase(Locale.ROOT));
    List<String> warnings = new ArrayList<>(fields.warnings.get(key));
    String value = null;
    if (unique.size() == 1) value = values.get(0).value;
    if (unique.size() > 1) {
      warnings.add(label + " is ambiguous; review the source values.");
      recordWarnings.add(label + " is ambiguous; review the source values.");
    }
    if (required && value == null && values.isEmpty()) {
      warnings.add("Patient name could not be validated.");
      recordWarnings.add("Patient name could not be validated.");
    }
    return new PatientField(value, values, warnings);
  }

  private List<Column> detectColumns(OcrTableGrouper.Row row) {
    List<Column> found = new ArrayList<>();
    List<OcrDocument.Element> elements = row.elements;
    for (int start = 0; start < elements.size(); start++) {
      for (int count = Math.min(4, elements.size() - start); count > 0; count--) {
        StringBuilder phrase = new StringBuilder();
        OcrDocument.Bounds bounds = null;
        for (int offset = 0; offset < count; offset++) {
          OcrDocument.Element element = elements.get(start + offset);
          if (phrase.length() > 0) phrase.append(' ');
          phrase.append(element.text);
          bounds = OcrDocument.Bounds.union(bounds, element.bounds);
        }
        FieldKey key = headerKey(phrase.toString());
        if (key != null) {
          int x = bounds == null ? Integer.MIN_VALUE : coordinate(bounds.centerX(), row.pageWidth);
          found.add(new Column(key, x));
          start += count - 1;
          break;
        }
      }
    }
    return found;
  }

  private static boolean isHeader(List<Column> columns) {
    long dataFields = columns.stream().filter(column -> column.field != FieldKey.IGNORE).count();
    return dataFields >= 2;
  }

  private static FieldKey headerKey(String raw) {
    String key = normalize(raw);
    if (key.matches("patient|(?:patient\\s*)?name|patient\\s+name|given\\s+name|family\\s+name|surname")) return FieldKey.NAME;
    if (key.matches("dob|d\\s*o\\s*b|date\\s+of\\s+birth|birth\\s+date|birthdate")) return FieldKey.DOB;
    if (key.matches("sex|gender|sex\\s+gender|gender\\s+sex")) return FieldKey.GENDER;
    if (key.matches("mobile|mobile\\s+number|mobile\\s+no|mobile\\s+phone|phone|phone\\s+number|phone\\s+no|telephone|telephone\\s+number|tel|tel\\s+no|contact\\s+number")) return FieldKey.PHONE;
    if (key.matches("email|email\\s+address|email\\s+id|e\\s+mail|e\\s+mail\\s+address")) return FieldKey.EMAIL;
    if (key.matches("surgeon|consultant|doctor|anaesthetist|anesthesiologist|provider|treating\\s+doctor")) return FieldKey.IGNORE;
    return null;
  }

  private static FieldKey labelKey(String raw) {
    String key = normalize(raw);
    if (key.equals("patient name") || key.equals("patient") || key.equals("name")) return FieldKey.NAME;
    if (key.equals("dob") || key.equals("d o b") || key.equals("date of birth") || key.equals("birth date") || key.equals("birthdate")) return FieldKey.DOB;
    if (key.equals("sex") || key.equals("gender")) return FieldKey.GENDER;
    if (key.startsWith("mobile") || key.startsWith("phone") || key.startsWith("telephone")
        || key.startsWith("tel") || key.startsWith("contact")) return FieldKey.PHONE;
    if (key.startsWith("email") || key.startsWith("e mail")) return FieldKey.EMAIL;
    return FieldKey.IGNORE;
  }

  private static String explicitGender(String source) {
    String value = normalize(source).replace('-', ' ');
    if (value.matches("(?:m|male)")) return "Male";
    if (value.matches("(?:f|female)")) return "Female";
    if (value.matches("(?:x|non binary|nonbinary)")) return value.equals("x") ? "X" : "Non-binary";
    if (value.equals("other")) return "Other";
    if (value.equals("prefer not to say")) return "Prefer not to say";
    return null;
  }

  private List<String> dates(String source) {
    String corrected = source.replaceAll("(?<=[0-9])[Oo](?=[0-9/.-])", "0")
        .replaceAll("(?<=[0-9])[Il](?=[0-9/.-])", "1");
    List<DateMatch> matches = new ArrayList<>();
    Matcher ymd = YMD_DATE.matcher(corrected);
    while (ymd.find()) {
      matches.add(new DateMatch(ymd.start(), ymd.end(), ymd.group(3), ymd.group(2), ymd.group(1)));
    }
    Matcher dmy = DMY_DATE.matcher(corrected);
    while (dmy.find()) {
      matches.add(new DateMatch(dmy.start(), dmy.end(), dmy.group(1), dmy.group(2), dmy.group(3)));
    }
    Matcher textDmy = TEXT_DMY_DATE.matcher(corrected);
    while (textDmy.find()) {
      matches.add(new DateMatch(
          textDmy.start(), textDmy.end(), textDmy.group(1), monthNumber(textDmy.group(2)), textDmy.group(3)));
    }
    Matcher textMdy = TEXT_MDY_DATE.matcher(corrected);
    while (textMdy.find()) {
      matches.add(new DateMatch(
          textMdy.start(), textMdy.end(), textMdy.group(2), monthNumber(textMdy.group(1)), textMdy.group(3)));
    }
    Collections.sort(matches, Comparator.comparingInt(match -> match.start));
    List<String> result = new ArrayList<>();
    int previousEnd = -1;
    for (DateMatch match : matches) {
      if (match.start < previousEnd) continue;
      addDate(result, parseDate(match.day, match.month, match.year));
      previousEnd = match.end;
    }
    return result;
  }

  private String parseDate(String dayText, String monthText, String yearText) {
    try {
      int day = Integer.parseInt(dayText);
      int month = Integer.parseInt(monthText);
      int year = Integer.parseInt(yearText);
      if (year < 1900 || year > currentYear || month < 1 || month > 12) return null;
      int[] days = {31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
      if (day < 1 || day > days[month - 1]) return null;
      return String.format(Locale.ROOT, "%04d-%02d-%02d", year, month, day);
    } catch (NumberFormatException ignored) {
      return null;
    }
  }

  private static boolean isLeapYear(int year) {
    return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  }

  private static String monthNumber(String text) {
    String month = text.toLowerCase(Locale.ROOT);
    if (month.startsWith("jan")) return "1";
    if (month.startsWith("feb")) return "2";
    if (month.startsWith("mar")) return "3";
    if (month.startsWith("apr")) return "4";
    if (month.startsWith("may")) return "5";
    if (month.startsWith("jun")) return "6";
    if (month.startsWith("jul")) return "7";
    if (month.startsWith("aug")) return "8";
    if (month.startsWith("sep")) return "9";
    if (month.startsWith("oct")) return "10";
    if (month.startsWith("nov")) return "11";
    if (month.startsWith("dec")) return "12";
    return "0";
  }

  private static void addDate(List<String> values, String date) {
    if (date != null) values.add(date);
  }

  private List<String> findNames(String source) {
    return nameFinder == null ? Collections.emptyList() : nameFinder.find(cleanName(source));
  }

  private static String cleanName(String source) {
    String cleaned = source.replaceAll("(?i)^\\s*(?:patient\\s+name|patient|name)\\s*[:=\\-]?\\s*", "")
        .replaceAll("\\s+", " ").trim();
    return cleaned.replaceAll("^[,;:]+|[,;:]+$", "").trim();
  }

  private static boolean validName(String value) {
    if (value == null || value.length() < 2 || value.length() > 100) return false;
    if (!value.matches("[\\p{L}][\\p{L} .,'’-]{0,99}")) return false;
    String[] words = value.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L} ]", "").trim().split("\\s+");
    if (words.length == 0 || words.length > 6) return false;
    for (String word : words) if (NON_NAMES.contains(word)) return false;
    return true;
  }

  private static boolean validModelName(String value) {
    return validName(value) && value.trim().split("\\s+").length >= 2;
  }

  private static String normalize(String value) {
    return value.toLowerCase(Locale.ROOT)
        .replaceAll("[^\\p{L}\\p{N}]+", " ")
        .replaceAll("\\s+", " ").trim();
  }

  private static String digits(String value) {
    return value.replaceAll("\\D", "");
  }

  private static void add(
      CandidateMap values,
      FieldKey key,
      String value,
      Cell source,
      String method) {
    if (value == null || value.trim().isEmpty()) return;
    values.get(key).add(new PatientField.Candidate(value, source.text.trim(), source.page, source.bounds, method));
  }

  private static CandidateMap emptyCandidates() {
    return new CandidateMap();
  }

  private static void addWarning(CandidateMap values, FieldKey key, String warning) {
    values.warnings.get(key).add(warning);
  }

  private static Cell cellFromRow(OcrTableGrouper.Row row, String text) {
    Cell cell = new Cell(row.page);
    cell.add(text, row.bounds);
    cell.finish();
    return cell;
  }

  private static List<String> distinct(List<String> values) {
    return new ArrayList<>(new java.util.LinkedHashSet<>(values));
  }

  private static final class Column {
    final FieldKey field;
    final int x;

    Column(FieldKey field, int x) {
      this.field = field;
      this.x = x;
    }
  }

  private static final class Cell {
    final int page;
    final StringBuilder value = new StringBuilder();
    OcrDocument.Bounds bounds;
    String text = "";

    Cell(int page) {
      this.page = page;
    }

    void add(String part, OcrDocument.Bounds partBounds) {
      String clean = part == null ? "" : part.trim();
      if (clean.isEmpty()) return;
      if (value.length() > 0 && !clean.matches("^[,.;:!?%)]$")) value.append(' ');
      value.append(clean);
      bounds = OcrDocument.Bounds.union(bounds, partBounds);
    }

    void finish() {
      text = value.toString().replaceAll("\\s+([,.;:])", "$1").trim();
    }
  }

  private static final class Label {
    final FieldKey key;
    final int start;
    final int end;

    Label(FieldKey key, int start, int end) {
      this.key = key;
      this.start = start;
      this.end = end;
    }
  }

  private static final class DateMatch {
    final int start;
    final int end;
    final String day;
    final String month;
    final String year;

    DateMatch(int start, int end, String day, String month, String year) {
      this.start = start;
      this.end = end;
      this.day = day;
      this.month = month;
      this.year = year;
    }
  }

  private static final class CandidateMap extends EnumMap<FieldKey, List<PatientField.Candidate>> {
    private static final long serialVersionUID = 1L;
    final EnumMap<FieldKey, List<String>> warnings = new EnumMap<>(FieldKey.class);

    CandidateMap() {
      super(FieldKey.class);
      for (FieldKey key : FieldKey.values()) {
        put(key, new ArrayList<>());
        warnings.put(key, new ArrayList<>());
      }
    }
  }

  private enum FieldKey { NAME, DOB, GENDER, PHONE, EMAIL, IGNORE }
}
