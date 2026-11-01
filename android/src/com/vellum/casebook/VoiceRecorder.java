package com.vellum.casebook;

import android.media.MediaRecorder;
import java.io.File;

// Thin wrapper over MediaRecorder: AAC in MPEG-4, mono, 64 kbps. The microphone is released on
// every path. Nothing here logs.
final class VoiceRecorder {
  interface Listener {
    void onLimit();

    void onError();
  }

  private MediaRecorder recorder;

  boolean start(File output, Listener listener) {
    MediaRecorder next = new MediaRecorder();
    try {
      next.setAudioSource(MediaRecorder.AudioSource.MIC);
      next.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
      next.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
      next.setAudioChannels(NativeRecorderPolicy.CHANNELS);
      next.setAudioSamplingRate(NativeRecorderPolicy.SAMPLE_RATE);
      next.setAudioEncodingBitRate(NativeRecorderPolicy.BIT_RATE);
      next.setMaxDuration((int) NativeRecorderPolicy.MAX_DURATION_MS);
      next.setMaxFileSize(NativeRecorderPolicy.MAX_FILE_BYTES);
      next.setOutputFile(output.getAbsolutePath());
      next.setOnInfoListener((mr, what, extra) -> {
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED
            || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) {
          listener.onLimit();
        }
      });
      next.setOnErrorListener((mr, what, extra) -> listener.onError());
      next.prepare();
      next.start();
      recorder = next;
      return true;
    } catch (java.io.IOException | RuntimeException error) {
      try {
        next.release();
      } catch (RuntimeException ignored) {
        /* already released */
      }
      return false;
    }
  }

  // Returns false when the recorder could not finalise the file (stop() throws for a recording
  // that is too short). The recorder is always released.
  boolean stop() {
    MediaRecorder current = recorder;
    recorder = null;
    if (current == null) return false;
    boolean clean = true;
    try {
      current.stop();
    } catch (RuntimeException error) { // includes IllegalStateException from a too-short recording
      clean = false;
    } finally {
      try {
        current.release();
      } catch (RuntimeException ignored) {
        /* nothing left to release */
      }
    }
    return clean;
  }

  boolean isActive() {
    return recorder != null;
  }
}
