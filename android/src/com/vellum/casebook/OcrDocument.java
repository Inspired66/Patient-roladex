package com.vellum.casebook;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** OCR text and its original page, line, element, and coordinate structure. */
public final class OcrDocument {
  public final String text;
  public final List<Page> pages;
  public final List<String> warnings;

  public OcrDocument(String text, List<Page> pages, List<String> warnings) {
    this.text = text == null ? "" : text;
    this.pages = Collections.unmodifiableList(new ArrayList<>(pages));
    this.warnings = Collections.unmodifiableList(new ArrayList<>(warnings));
  }

  public static final class Page {
    public final int number;
    public final int width;
    public final int height;
    public final String text;
    public final List<Line> lines;

    public Page(int number, int width, int height, String text, List<Line> lines) {
      this.number = number;
      this.width = width;
      this.height = height;
      this.text = text == null ? "" : text;
      this.lines = Collections.unmodifiableList(new ArrayList<>(lines));
    }
  }

  public static final class Line {
    public final String text;
    public final Bounds bounds;
    public final List<Element> elements;

    public Line(String text, Bounds bounds, List<Element> elements) {
      this.text = text == null ? "" : text;
      this.bounds = bounds;
      this.elements = Collections.unmodifiableList(new ArrayList<>(elements));
    }
  }

  public static final class Element {
    public final String text;
    public final Bounds bounds;

    public Element(String text, Bounds bounds) {
      this.text = text == null ? "" : text;
      this.bounds = bounds;
    }
  }

  public static final class Bounds {
    public final int left;
    public final int top;
    public final int right;
    public final int bottom;

    public Bounds(int left, int top, int right, int bottom) {
      this.left = left;
      this.top = top;
      this.right = right;
      this.bottom = bottom;
    }

    public int centerX() {
      return left + (right - left) / 2;
    }

    public int centerY() {
      return top + (bottom - top) / 2;
    }

    static Bounds union(Bounds first, Bounds second) {
      if (first == null) return second;
      if (second == null) return first;
      return new Bounds(
          Math.min(first.left, second.left),
          Math.min(first.top, second.top),
          Math.max(first.right, second.right),
          Math.max(first.bottom, second.bottom));
    }
  }
}
