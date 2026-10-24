package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Reviewable patient fields; unresolved or absent values are null, never guessed. */
public final class PatientRecord {
  public final PatientField patientName;
  public final PatientField dateOfBirth;
  public final PatientField gender;
  public final PatientField phone;
  public final PatientField email;
  public final int sourcePage;
  public final OcrDocument.Bounds sourceBounds;
  public final List<String> warnings;

  public PatientRecord(
      PatientField patientName,
      PatientField dateOfBirth,
      PatientField gender,
      PatientField phone,
      PatientField email,
      int sourcePage,
      OcrDocument.Bounds sourceBounds,
      List<String> warnings) {
    this.patientName = patientName;
    this.dateOfBirth = dateOfBirth;
    this.gender = gender;
    this.phone = phone;
    this.email = email;
    this.sourcePage = sourcePage;
    this.sourceBounds = sourceBounds;
    this.warnings = Collections.unmodifiableList(new ArrayList<>(warnings));
  }
}
