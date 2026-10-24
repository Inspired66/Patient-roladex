package com.vellum.casebook;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.Text.Line;
import com.google.mlkit.vision.text.Text.TextBlock;
import com.google.mlkit.vision.text.Text.Element;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import android.graphics.Rect;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Reads a photo or PDF with the bundled Google ML Kit Latin text recognizer. */
public final class ListOcr {
  private ListOcr() {}

  public static String read(Context context, Uri uri) throws Exception {
    return readDocument(context, uri).text;
  }

  public static OcrDocument readDocument(Context context, Uri uri) throws Exception {
    String mime = context.getContentResolver().getType(uri);
    boolean pdf = mime != null && mime.toLowerCase().contains("pdf");
    TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
    try {
      if (pdf) return readPdf(context, recognizer, uri);
      InputImage image = InputImage.fromFilePath(context, uri);
      Text recognized = Tasks.await(recognizer.process(image));
      OcrDocument.Page page = adaptPage(1, image.getWidth(), image.getHeight(), recognized);
      return new OcrDocument(recognized.getText(), Collections.singletonList(page), Collections.emptyList());
    } finally {
      recognizer.close();
    }
  }

  private static OcrDocument readPdf(Context context, TextRecognizer recognizer, Uri uri) throws Exception {
    ParcelFileDescriptor descriptor = context.getContentResolver().openFileDescriptor(uri, "r");
    if (descriptor == null) throw new IOException("Could not open that PDF.");
    PdfRenderer renderer = new PdfRenderer(descriptor);
    StringBuilder text = new StringBuilder();
    List<OcrDocument.Page> pages = new ArrayList<>();
    List<String> warnings = new ArrayList<>();
    try {
      int count = Math.min(renderer.getPageCount(), 6);
      if (renderer.getPageCount() > count) {
        warnings.add("Only the first six PDF pages were read. Review the remaining pages manually.");
      }
      for (int index = 0; index < count; index++) {
        PdfRenderer.Page page = renderer.openPage(index);
        try {
          Bitmap bitmap = render(page);
          try {
            InputImage image = InputImage.fromBitmap(bitmap, 0);
            Text recognized = Tasks.await(recognizer.process(image));
            String pageText = recognized.getText();
            pages.add(adaptPage(index + 1, bitmap.getWidth(), bitmap.getHeight(), recognized));
            if (pageText != null && pageText.length() > 0) {
              if (text.length() > 0) text.append('\n');
              text.append(pageText);
            }
          } finally {
            bitmap.recycle();
          }
        } finally {
          page.close();
        }
      }
    } finally {
      renderer.close();
      descriptor.close();
    }
    return new OcrDocument(text.toString(), pages, warnings);
  }

  private static OcrDocument.Page adaptPage(int number, int width, int height, Text recognized) {
    List<OcrDocument.Line> lines = new ArrayList<>();
    for (TextBlock block : recognized.getTextBlocks()) {
      for (Line line : block.getLines()) {
        List<OcrDocument.Element> elements = new ArrayList<>();
        for (Element element : line.getElements()) {
          elements.add(new OcrDocument.Element(element.getText(), bounds(element.getBoundingBox())));
        }
        lines.add(new OcrDocument.Line(line.getText(), bounds(line.getBoundingBox()), elements));
      }
    }
    return new OcrDocument.Page(number, width, height, recognized.getText(), lines);
  }

  private static OcrDocument.Bounds bounds(Rect rectangle) {
    if (rectangle == null) return null;
    return new OcrDocument.Bounds(rectangle.left, rectangle.top, rectangle.right, rectangle.bottom);
  }

  private static Bitmap render(PdfRenderer.Page page) {
    int width = Math.max(page.getWidth(), 1);
    int height = Math.max(page.getHeight(), 1);
    double scale = 2;
    long pixels = (long) width * height;
    if (pixels * scale * scale > 3_000_000) scale = Math.sqrt(3_000_000d / pixels);
    int scaledWidth = Math.max(1, (int) (width * scale));
    int scaledHeight = Math.max(1, (int) (height * scale));
    Bitmap bitmap = Bitmap.createBitmap(scaledWidth, scaledHeight, Bitmap.Config.ARGB_8888);
    bitmap.eraseColor(Color.WHITE);
    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);
    return bitmap;
  }
}
