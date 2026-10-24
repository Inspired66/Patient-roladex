package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** One proposed field value plus all source candidates retained for review. */
public final class PatientField {
  public final String value;
  public final List<Candidate> candidates;
  public final List<String> warnings;

  public PatientField(String value, List<Candidate> candidates, List<String> warnings) {
    this.value = value;
    this.candidates = Collections.unmodifiableList(new ArrayList<>(candidates));
    this.warnings = Collections.unmodifiableList(new ArrayList<>(warnings));
  }

  public static final class Candidate {
    public final String value;
    public final String sourceText;
    public final int page;
    public final OcrDocument.Bounds bounds;
    public final String method;

    public Candidate(String value, String sourceText, int page, OcrDocument.Bounds bounds, String method) {
      this.value = value;
      this.sourceText = sourceText;
      this.page = page;
      this.bounds = bounds;
      this.method = method;
    }
  }
}
