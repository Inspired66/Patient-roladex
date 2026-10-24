package com.vellum.casebook;

/** Extracts reviewable patient records from structured on-device OCR output. */
public interface PatientFieldExtractor {
  ExtractionResult extract(OcrDocument document);
}
