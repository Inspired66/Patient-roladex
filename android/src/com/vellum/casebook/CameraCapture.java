package com.vellum.casebook;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

// Turns the camera app's raw photo into the file handed to the page. Runs off the UI thread.
// Every outcome is a fresh or cleaned JPEG that fits the attachment rules, or a refusal code;
// a photo that still carries location data is never returned. Nothing here logs.
final class CameraCapture {
  static final class Result {
    final File file;
    final String status;
    final String notice;

    private Result(File file, String status, String notice) {
      this.file = file;
      this.status = status;
      this.notice = notice;
    }

    static Result ok(File file, String notice) {
      return new Result(file, null, notice);
    }

    static Result refused(String status) {
      return new Result(null, status, null);
    }
  }

  private static final String[] GPS_TAGS = {
    ExifInterface.TAG_GPS_LATITUDE, ExifInterface.TAG_GPS_LATITUDE_REF,
    ExifInterface.TAG_GPS_LONGITUDE, ExifInterface.TAG_GPS_LONGITUDE_REF,
    ExifInterface.TAG_GPS_ALTITUDE, ExifInterface.TAG_GPS_ALTITUDE_REF,
    ExifInterface.TAG_GPS_TIMESTAMP, ExifInterface.TAG_GPS_DATESTAMP,
    ExifInterface.TAG_GPS_PROCESSING_METHOD, ExifInterface.TAG_GPS_AREA_INFORMATION,
    ExifInterface.TAG_GPS_SPEED, ExifInterface.TAG_GPS_SPEED_REF,
    ExifInterface.TAG_GPS_TRACK, ExifInterface.TAG_GPS_TRACK_REF,
    ExifInterface.TAG_GPS_IMG_DIRECTION, ExifInterface.TAG_GPS_IMG_DIRECTION_REF,
    ExifInterface.TAG_GPS_DEST_LATITUDE, ExifInterface.TAG_GPS_DEST_LATITUDE_REF,
    ExifInterface.TAG_GPS_DEST_LONGITUDE, ExifInterface.TAG_GPS_DEST_LONGITUDE_REF,
    ExifInterface.TAG_GPS_DEST_BEARING, ExifInterface.TAG_GPS_DEST_BEARING_REF,
    ExifInterface.TAG_GPS_DEST_DISTANCE, ExifInterface.TAG_GPS_DEST_DISTANCE_REF,
    ExifInterface.TAG_GPS_DOP, ExifInterface.TAG_GPS_MAP_DATUM, ExifInterface.TAG_GPS_SATELLITES,
    ExifInterface.TAG_GPS_STATUS, ExifInterface.TAG_GPS_MEASURE_MODE,
    ExifInterface.TAG_GPS_DIFFERENTIAL,
    ExifInterface.TAG_GPS_VERSION_ID
  };

  private CameraCapture() {}

  // On return the source file is gone unless it is the returned (cleaned, in-place) file.
  static Result process(File source, File directory, boolean shrink) {
    File keep = null;
    try {
      Result result = shrink ? shrinkThenStrip(source, directory) : stripThenShrink(source, directory);
      keep = result.file;
      return result;
    } catch (RuntimeException | OutOfMemoryError error) {
      return Result.refused(NativeCameraPolicy.FAILED);
    } finally {
      if (keep == null || !keep.equals(source)) source.delete();
    }
  }

  private static Result shrinkThenStrip(File source, File directory) {
    Result shrunk = tryShrink(source, directory, null);
    if (shrunk != null) return shrunk;
    Result stripped = tryStrip(source, NativeCameraPolicy.FALLBACK);
    return stripped != null && stripped.file != null ? stripped : Result.refused(NativeCameraPolicy.FAILED);
  }

  private static Result stripThenShrink(File source, File directory) {
    if (!NativeCameraPolicy.fitsAttachmentLimit(source.length())) {
      return source.length() <= 0
          ? Result.refused(NativeCameraPolicy.EMPTY)
          : Result.refused(NativeCameraPolicy.TOO_LARGE_ORIGINAL);
    }
    Result stripped = tryStrip(source, null);
    if (stripped != null && stripped.file != null) return stripped;
    Result shrunk = tryShrink(source, directory, NativeCameraPolicy.REENCODED);
    return shrunk != null ? shrunk : Result.refused(NativeCameraPolicy.FAILED);
  }

  // Removes GPS tags in place and checks they are gone. Null means it could not be done safely.
  private static Result tryStrip(File source, String notice) {
    try {
      if (!NativeCameraPolicy.fitsAttachmentLimit(source.length())) {
        return Result.refused(
            source.length() <= 0 ? NativeCameraPolicy.EMPTY : NativeCameraPolicy.TOO_LARGE_ORIGINAL);
      }
      ExifInterface exif = new ExifInterface(source.getAbsolutePath());
      for (String tag : GPS_TAGS) exif.setAttribute(tag, null);
      exif.saveAttributes();
      ExifInterface check = new ExifInterface(source.getAbsolutePath());
      for (String tag : GPS_TAGS) {
        if (check.getAttribute(tag) != null) return null;
      }
      if (check.getLatLong(new float[2])) return null;
      if (!NativeCameraPolicy.fitsAttachmentLimit(source.length())) return null;
      return Result.ok(source, notice);
    } catch (IOException | RuntimeException error) {
      return null;
    }
  }

  // Decode with bounds first, subsample, apply EXIF orientation, scale and write a fresh JPEG.
  // Returns null when the photo cannot be decoded or memory is short.
  private static Result tryShrink(File source, File directory, String notice) {
    Bitmap decoded = null;
    Bitmap upright = null;
    File out = null;
    try {
      BitmapFactory.Options bounds = new BitmapFactory.Options();
      bounds.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(source.getAbsolutePath(), bounds);
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;

      BitmapFactory.Options options = new BitmapFactory.Options();
      options.inSampleSize =
          NativeCameraPolicy.sampleSize(bounds.outWidth, bounds.outHeight, NativeCameraPolicy.MAX_EDGE);
      decoded = BitmapFactory.decodeFile(source.getAbsolutePath(), options);
      if (decoded == null) return null;

      int orientation = ExifInterface.ORIENTATION_NORMAL;
      try {
        orientation = new ExifInterface(source.getAbsolutePath())
            .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
      } catch (IOException | RuntimeException ignored) {
        /* no readable orientation: keep the pixels as decoded */
      }
      Matrix matrix = new Matrix();
      // Scale is computed from the original dimensions so the long edge ends at MAX_EDGE.
      float scale = NativeCameraPolicy.scaleFor(bounds.outWidth, bounds.outHeight, NativeCameraPolicy.MAX_EDGE)
          * ((float) bounds.outWidth / (float) decoded.getWidth());
      if (scale < 0.999f || scale > 1.001f) matrix.postScale(scale, scale);
      int degrees = NativeCameraPolicy.rotationDegrees(orientation);
      if (degrees != 0) matrix.postRotate(degrees);
      if (NativeCameraPolicy.mirrored(orientation)) matrix.postScale(-1f, 1f);
      upright = matrix.isIdentity()
          ? decoded
          : Bitmap.createBitmap(decoded, 0, 0, decoded.getWidth(), decoded.getHeight(), matrix, true);
      if (upright == null) return null;

      out = File.createTempFile("vellum-", ".jpg", directory);
      for (int quality = NativeCameraPolicy.QUALITY_STEPS[0]; quality > 0;
          quality = NativeCameraPolicy.nextQuality(quality)) {
        try (OutputStream stream = new FileOutputStream(out, false)) {
          if (!upright.compress(Bitmap.CompressFormat.JPEG, quality, stream)) return discard(out);
        }
        long length = out.length();
        if (length > 0 && NativeCameraPolicy.fitsAttachmentLimit(length)) {
          File done = out;
          out = null;
          return Result.ok(done, notice);
        }
      }
      return refusedAndDiscard(out);
    } catch (IOException | RuntimeException | OutOfMemoryError error) {
      return null;
    } finally {
      if (upright != null && upright != decoded) upright.recycle();
      if (decoded != null) decoded.recycle();
      if (out != null) out.delete();
    }
  }

  private static Result discard(File out) {
    out.delete();
    return null;
  }

  private static Result refusedAndDiscard(File out) {
    out.delete();
    return Result.refused(NativeCameraPolicy.TOO_LARGE);
  }
}
