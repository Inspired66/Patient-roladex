package com.vellum.casebook;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentProvider;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.ClipData;
import android.content.ContentValues;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.ParcelFileDescriptor;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayOutputStream;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class MainActivity extends Activity {
  private static final int FILE_REQ = 1001;
  private static final int CAMERA_REQ = 1004;
  private static final int MIC_REQ = 2001;
  private static final int CAM_REQ = 2002;
  private static final int SAVE_REQ = 1003;
  private static final int PICK_REQ = 1005;
  private static final int LIST_REQ = 1006;
  private static final int MAX_SAVE_CHUNK_BYTES = 48 * 1024;
  private static final long MAX_SAVE_BYTES = 64L * 1024L * 1024L;

  private WebView webView;
  private AssetServer server;
  private int localPort = -1;
  private ValueCallback<Uri[]> upload;
  private boolean micFromBridge;
  private boolean micAsked;
  private boolean micCaptureArmed;
  private boolean micCaptureActive;
  private long micRequestExpiresAt;
  private long micCaptureArmExpiresAt;
  private boolean camFromBridge;
  private boolean camAsked;
  private boolean backPending;
  private boolean photoFromJs;
  private Uri cameraOutput;
  private File cameraOutputFile;
  private boolean savePickerOpen;
  private boolean saveReady;
  private boolean saveFailed;
  private long saveBytes;
  private Uri saveTree;
  private File saveBufferFile;
  private OutputStream saveBuffer;
  private final Object saveLock = new Object();
  private final Set<String> pickerUris = Collections.synchronizedSet(new HashSet<>());
  private String saveName = "vellum.csv";
  private String saveMime = "application/octet-stream";

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    webView = new WebView(this);
    webView.setBackgroundColor(Color.parseColor("#0c0d0f"));
    getWindow().setFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE,
        android.view.WindowManager.LayoutParams.FLAG_SECURE);
    WebView.setWebContentsDebuggingEnabled(false);
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setAllowFileAccess(false);
    settings.setAllowFileAccessFromFileURLs(false);
    settings.setAllowUniversalAccessFromFileURLs(false);
    // Content access is needed for WebView's user-selected attachment URIs.
    settings.setAllowContentAccess(true);
    settings.setDatabaseEnabled(true);
    settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    webView.addJavascriptInterface(new VellumBridge(), "VellumNative");
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (isTrustedLocalOrigin(url)) return false;
        openExternal(url);
        return true;
      }

      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String scheme = url.getScheme();
        if (isTrustedLocalOrigin(url)
            || "data".equalsIgnoreCase(scheme)
            || "blob".equalsIgnoreCase(scheme)
            || isPickerUri(url)) {
          return null;
        }
        return new WebResourceResponse(
            "text/plain",
            "UTF-8",
            403,
            "Blocked",
            Collections.emptyMap(),
            new ByteArrayInputStream(new byte[0]));
      }
    });
    webView.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(PermissionRequest request) {
        runOnUiThread(() -> grantWebAudio(request));
      }

      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (upload != null) upload.onReceiveValue(null);
        upload = callback;
        try {
          launchNativeChooser();
        } catch (Exception error) {
          finishUpload(null);
        }
        return true;
      }
    });
    setContentView(webView);
    server = new AssetServer(getAssets());
    try {
      localPort = server.start();
      webView.loadUrl("http://127.0.0.1:" + localPort + "/");
    } catch (Exception error) {
      webView.loadData("<p style='font-family:sans-serif'>Could not open the casebook.</p>", "text/html", "utf-8");
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }
  }

  private void handleBack() {
    if (webView == null) {
      finish();
      return;
    }
    if (backPending) return;
    backPending = true;
    webView.evaluateJavascript(
        "(function(){try{return window.__vellumBack&&window.__vellumBack()?true:false}catch(e){return false}})()",
        value -> {
          backPending = false;
          if (!"true".equals(value)) finish();
        });
  }

  private void finishUpload(Uri[] uris) {
    ValueCallback<Uri[]> callback = upload;
    upload = null;
    if (callback != null) callback.onReceiveValue(uris);
  }

  private void dropCameraOutput() {
    if (cameraOutput != null) VellumFileProvider.delete(cameraOutput);
    cameraOutput = null;
    cameraOutputFile = null;
  }

  private Uri createCameraOutput() throws IOException {
    File directory = new File(getCacheDir(), "camera");
    if (!directory.isDirectory() && !directory.mkdirs()) {
      throw new IOException("Could not prepare private camera storage.");
    }
    File output = File.createTempFile("vellum-", ".jpg", directory);
    cameraOutputFile = output;
    cameraOutput = VellumFileProvider.register(output);
    return cameraOutput;
  }

  private boolean isTrustedLocalOrigin(Uri uri) {
    return uri != null
        && localPort > 0
        && "http".equalsIgnoreCase(uri.getScheme())
        && "127.0.0.1".equals(uri.getHost())
        && uri.getPort() == localPort
        && uri.getUserInfo() == null;
  }

  private boolean isTrustedCurrentPage() {
    String url = webView == null ? null : webView.getUrl();
    return url != null && isTrustedLocalOrigin(Uri.parse(url));
  }

  private boolean isPickerUri(Uri uri) {
    return uri != null && pickerUris.contains(uri.toString());
  }

  private void launchNativeChooser() {
    dropCameraOutput();
    try {
      createCameraOutput();
    } catch (Exception ignored) {
      dropCameraOutput();
    }
    pickerUris.clear();

    Intent files = new Intent(Intent.ACTION_GET_CONTENT);
    files.addCategory(Intent.CATEGORY_OPENABLE);
    files.setType("*/*");
    files.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
    files.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

    Intent gallery = new Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI);
    gallery.setType("image/*");

    Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
    if (cameraOutput != null) {
      camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
      camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
      camera.setClipData(ClipData.newRawUri("photo", cameraOutput));
    }

    Intent recorder = new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION);
    Intent chooser = Intent.createChooser(files, "Attach");
    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] {gallery, camera, recorder});
    try {
      startActivityForResult(chooser, FILE_REQ);
    } catch (Exception error) {
      dropCameraOutput();
      Intent plain = new Intent(Intent.ACTION_GET_CONTENT);
      plain.addCategory(Intent.CATEGORY_OPENABLE);
      plain.setType("*/*");
      plain.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      startActivityForResult(plain, FILE_REQ);
    }
  }

  private Uri saveBitmap(android.graphics.Bitmap bitmap) {
    File output = null;
    try {
      Uri dest = createCameraOutput();
      output = cameraOutputFile;
      OutputStream out = new FileOutputStream(output, false);
      try {
        if (!bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, out)) {
          throw new IOException("Could not save the camera image.");
        }
      } finally {
        out.close();
      }
      VellumFileProvider.markReady(dest);
      return dest;
    } catch (Exception error) {
      if (output != null) output.delete();
      if (cameraOutputFile == output) {
        cameraOutputFile = null;
        cameraOutput = null;
      }
      return null;
    }
  }

  private Uri[] collectPickedUris(Intent data) {
    List<Uri> uris = new ArrayList<>();
    if (data != null) {
      if (data.getClipData() != null) {
        for (int index = 0; index < data.getClipData().getItemCount(); index++) {
          Uri uri = data.getClipData().getItemAt(index).getUri();
          if (uri != null) uris.add(uri);
        }
      }
      if (uris.isEmpty() && data.getData() != null) uris.add(data.getData());
      if (uris.isEmpty() && data.getExtras() != null && data.getExtras().get("data") instanceof android.graphics.Bitmap) {
        Uri saved = saveBitmap((android.graphics.Bitmap) data.getExtras().get("data"));
        if (saved != null) uris.add(saved);
      }
    }
    Uri shot = cameraOutput;
    if (shot != null) {
      boolean listed = false;
      for (Uri uri : uris) {
        if (shot.equals(uri)) listed = true;
      }
      if (!listed && cameraOutputFile != null && cameraOutputFile.isFile() && cameraOutputFile.length() > 0) {
        uris.add(shot);
      }
      else if (!listed) {
        VellumFileProvider.delete(shot);
      }
    }
    if (uris.isEmpty()) return null;
    return uris.toArray(new Uri[0]);
  }

  private boolean launchCamera() {
    try {
      Uri dest = createCameraOutput();
      Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
      camera.putExtra(MediaStore.EXTRA_OUTPUT, dest);
      camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
      camera.setClipData(ClipData.newRawUri("photo", dest));
      startActivityForResult(camera, CAMERA_REQ);
      return true;
    } catch (Exception error) {
      dropCameraOutput();
      return false;
    }
  }

  private void grantWebAudio(PermissionRequest request) {
    Uri origin = request.getOrigin();
    if (!NativeAudioPermissionPolicy.canGrant(
        origin == null ? null : origin.getScheme(),
        origin == null ? null : origin.getHost(),
        origin == null ? -1 : origin.getPort(),
        localPort,
        request.getResources(),
        checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
        micCaptureArmed,
        micCaptureArmExpiresAt,
        SystemClock.elapsedRealtime())) {
      request.deny();
      return;
    }
    micCaptureArmed = false;
    micCaptureActive = true;
    request.grant(new String[] {PermissionRequest.RESOURCE_AUDIO_CAPTURE});
  }

  private void openPermissionSettings() {
    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    intent.setData(Uri.fromParts("package", getPackageName(), null));
    try {
      startActivity(intent);
    } catch (ActivityNotFoundException ignored) {
      /* no settings */
    }
  }

  private void signalMic(boolean granted, String reason) {
    if (webView == null) return;
    webView.evaluateJavascript("window.__vellumMic&&window.__vellumMic(" + granted + ",'" + reason + "')", null);
  }

  private void clearMicrophoneCapture() {
    micFromBridge = false;
    micCaptureArmed = false;
    micCaptureActive = false;
    micRequestExpiresAt = 0;
    micCaptureArmExpiresAt = 0;
  }

  private void signalCam(boolean granted, String reason) {
    if (webView == null) return;
    webView.evaluateJavascript("window.__vellumCam&&window.__vellumCam(" + granted + ",'" + reason + "')", null);
  }

  private void signalPhoto(boolean ok) {
    signalPickEnd(ok, ok ? "" : "");
  }

  private void signalList(boolean ok, String payloadJson, String message) {
    if (webView == null) return;
    String payload = payloadJson == null || payloadJson.length() == 0
        ? ""
        : android.util.Base64.encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
    String safe = jsString(message);
    webView.evaluateJavascript(
        "window.__vellumListDone&&window.__vellumListDone(" + ok + ",'" + payload + "','" + safe + "')",
        null);
  }

  private void readListUri(Uri uri) {
    new Thread(() -> {
      OcrDocument document;
      try {
        document = ListOcr.readDocument(this, uri);
      } catch (Exception error) {
        runOnUiThread(() -> signalList(false, "", "Google ML Kit could not read that file."));
        return;
      }
      String extractionStage = "loading the local name model";
      try {
        OpenNlpNameFinder nameFinder = new OpenNlpNameFinder(getAssets().open("opennlp/en-ner-person.bin"));
        extractionStage = "extracting patient fields";
        ExtractionResult result = new OfflinePatientFieldExtractor(nameFinder).extract(document);
        extractionStage = "preparing the local review result";
        String payload = result.toJson();
        runOnUiThread(() -> signalList(true, payload, ""));
      } catch (Exception error) {
        String message = "The offline patient-field extractor failed while "
            + extractionStage + " (" + error.getClass().getSimpleName() + ").";
        if ("loading the local name model".equals(extractionStage)
            && error.getMessage() != null && !error.getMessage().isEmpty()) {
          String detail = error.getMessage();
          if (detail.length() > 160) detail = detail.substring(0, 160);
          message = "The local name model could not be loaded ("
              + error.getClass().getSimpleName() + ": " + detail + ").";
        }
        String failureMessage = message;
        runOnUiThread(() -> signalList(false, "", failureMessage));
      }
    }, "vellum-ocr").start();
  }

  private void signalPickEnd(boolean ok, String reason) {
    if (webView == null) return;
    String safe = reason == null ? "" : reason.replace("\\", "").replace("'", "");
    webView.evaluateJavascript("window.__vellumPickEnd&&window.__vellumPickEnd(" + ok + ",'" + safe + "')", null);
  }

  private String jsString(String value) {
    if (value == null) return "";
    return value.replace("\\", "").replace("'", "").replace("\n", " ").replace("\r", " ");
  }

  private String displayName(Uri uri, String fallback) {
    Cursor cursor = null;
    try {
      cursor = getContentResolver().query(uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null);
      if (cursor != null && cursor.moveToFirst()) {
        String name = cursor.getString(0);
        if (name != null && name.length() > 0) return name;
      }
    } catch (Exception ignored) {
      /* use the fallback name */
    } finally {
      if (cursor != null) cursor.close();
    }
    return fallback;
  }

  private String appendUri(Uri uri, String fallbackName, String fallbackMime) {
    String problem = attachmentError(uri);
    if (problem != null) return problem;
    String name = jsString(displayName(uri, fallbackName));
    String mime = getContentResolver().getType(uri);
    if (mime == null || mime.isEmpty()) mime = fallbackMime;
    if (!evaluateJavascriptAndWait("window.__vellumFileStart&&window.__vellumFileStart('" + name + "','" + jsString(mime) + "')")) {
      return "The attachment could not be sent to the casebook.";
    }

    long total = 0;
    try (InputStream input = getContentResolver().openInputStream(uri)) {
      if (input == null) return "That attachment could not be opened.";
      byte[] chunk = new byte[MAX_SAVE_CHUNK_BYTES];
      int read;
      while ((read = input.read(chunk)) != -1) {
        total += read;
        if (total > NativeAttachmentPolicy.MAX_FILE_BYTES) return "Attachments must be 4 MB or smaller.";
        byte[] bounded = read == chunk.length ? chunk : Arrays.copyOf(chunk, read);
        String payload = android.util.Base64.encodeToString(bounded, android.util.Base64.NO_WRAP);
        if (!evaluateJavascriptAndWait("window.__vellumFileChunk&&window.__vellumFileChunk('" + payload + "')")) {
          return "The attachment could not be sent to the casebook.";
        }
      }
    } catch (IOException error) {
      return "That attachment could not be read.";
    }
    if (total == 0) return "That attachment was empty.";
    return evaluateJavascriptAndWait("window.__vellumFileDone&&window.__vellumFileDone()")
        ? null
        : "The attachment could not be sent to the casebook.";
  }

  private boolean evaluateJavascriptAndWait(String script) {
    WebView current = webView;
    if (current == null) return false;
    CountDownLatch completed = new CountDownLatch(1);
    boolean posted = current.post(() -> current.evaluateJavascript(script, ignored -> completed.countDown()));
    if (!posted) return false;
    try {
      return completed.await(10, TimeUnit.SECONDS);
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      return false;
    }
  }

  private void deliverUris(List<Uri> uris, String fallbackName, String fallbackMime) {
    new Thread(() -> {
      String problem = attachmentError(uris);
      if (problem == null) {
        for (Uri uri : uris) {
          problem = appendUri(uri, fallbackName, fallbackMime);
          if (problem != null) break;
        }
      }
      String result = problem;
      runOnUiThread(() -> {
        if (result != null) {
          showAttachmentError(result);
          signalPickEnd(false, "invalid");
        } else {
          signalPickEnd(true, "");
        }
      });
    }, "vellum-pick").start();
  }

  private String attachmentError(List<Uri> uris) {
    if (uris == null || !NativeAttachmentPolicy.isAllowedCount(uris.size())) {
      return "Choose between 1 and " + NativeAttachmentPolicy.MAX_FILES + " attachments.";
    }
    for (Uri uri : uris) {
      String problem = attachmentError(uri);
      if (problem != null) return problem;
    }
    return null;
  }

  private String attachmentError(Uri uri) {
    if (uri == null) return "That attachment could not be opened.";
    String name = displayName(uri, "");
    String mime = getContentResolver().getType(uri);
    if (!NativeAttachmentPolicy.isAllowedType(mime, name)) {
      return "Choose an image, audio recording, PDF, or plain-text file.";
    }
    long size = contentSize(uri);
    if (!NativeAttachmentPolicy.isAllowedSize(size)) {
      return size > NativeAttachmentPolicy.MAX_FILE_BYTES
          ? "Attachments must be 4 MB or smaller."
          : "That attachment is empty or its size could not be verified.";
    }
    return null;
  }

  private long contentSize(Uri uri) {
    Cursor cursor = null;
    try {
      cursor = getContentResolver().query(uri, new String[] {OpenableColumns.SIZE}, null, null, null);
      if (cursor != null && cursor.moveToFirst()) {
        int index = cursor.getColumnIndex(OpenableColumns.SIZE);
        if (index >= 0 && !cursor.isNull(index)) return cursor.getLong(index);
      }
    } catch (RuntimeException ignored) {
      // Fall through to the descriptor size when a provider omits metadata.
    } finally {
      if (cursor != null) cursor.close();
    }
    try (ParcelFileDescriptor descriptor = getContentResolver().openFileDescriptor(uri, "r")) {
      return descriptor == null ? -1 : descriptor.getStatSize();
    } catch (IOException | RuntimeException ignored) {
      return -1;
    }
  }

  private void showAttachmentError(String message) {
    runOnUiThread(() -> android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_LONG).show());
  }

  private void launchAttachChooser() {
    try {
      dropCameraOutput();
      createCameraOutput();
      pickerUris.clear();

      Intent files = new Intent(Intent.ACTION_GET_CONTENT);
      files.addCategory(Intent.CATEGORY_OPENABLE);
      files.setType("*/*");
      files.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/*", "audio/*", "application/pdf", "text/plain"});
      files.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      files.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

      Intent gallery = new Intent(Intent.ACTION_PICK);
      gallery.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");

      Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
      if (cameraOutput != null) {
        camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
        camera.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        camera.setClipData(ClipData.newRawUri("photo", cameraOutput));
      }

      Intent recorder = new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION);
      Intent chooser = Intent.createChooser(files, "Attach");
      chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] {gallery, camera, recorder});
      startActivityForResult(chooser, PICK_REQ);
    } catch (Exception error) {
      dropCameraOutput();
      signalPickEnd(false, "missing");
    }
  }

  private void signalPicker(boolean ok) {
    if (webView == null) return;
    webView.evaluateJavascript("window.__vellumPicker&&window.__vellumPicker(" + ok + ")", null);
  }

  private void signalSaved(boolean ok) {
    runOnUiThread(() -> {
      if (webView == null) return;
      webView.evaluateJavascript("window.__vellumSaveResult&&window.__vellumSaveResult(" + ok + ")", null);
    });
  }

  private boolean writeDocument(Uri document, File buffer) {
    try (InputStream input = new FileInputStream(buffer)) {
      OutputStream out = getContentResolver().openOutputStream(document);
      if (out == null) return false;
      try {
        byte[] chunk = new byte[8192];
        int read;
        while ((read = input.read(chunk)) != -1) {
          out.write(chunk, 0, read);
        }
        out.flush();
      } finally {
        out.close();
      }
      return true;
    } catch (Exception error) {
      return false;
    }
  }

  private void deleteSaveBuffer(File file) {
    if (file != null && file.exists()) file.delete();
  }

  private Uri findChild(Uri tree, String name) {
    Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    Cursor cursor = getContentResolver().query(
        children,
        new String[] {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME},
        null,
        null,
        null);
    if (cursor == null) return null;
    try {
      while (cursor.moveToNext()) {
        if (name.equals(cursor.getString(1))) {
          return DocumentsContract.buildDocumentUriUsingTree(tree, cursor.getString(0));
        }
      }
    } finally {
      cursor.close();
    }
    return null;
  }

  public final class VellumBridge {
    @JavascriptInterface
    public void beginMicrophoneCapture() {
      runOnUiThread(() -> {
        clearMicrophoneCapture();
        if (!isTrustedCurrentPage()) {
          signalMic(false, "denied");
          return;
        }
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
          micCaptureArmed = true;
          micCaptureArmExpiresAt = SystemClock.elapsedRealtime() + 10_000;
          signalMic(true, "granted");
          return;
        }
        if (micAsked && !shouldShowRequestPermissionRationale(android.Manifest.permission.RECORD_AUDIO)) {
          signalMic(false, "settings");
          openPermissionSettings();
          return;
        }
        micAsked = true;
        micFromBridge = true;
        micRequestExpiresAt = SystemClock.elapsedRealtime() + 60_000;
        requestPermissions(new String[] {android.Manifest.permission.RECORD_AUDIO}, MIC_REQ);
      });
    }

    @JavascriptInterface
    public void endMicrophoneCapture() {
      runOnUiThread(MainActivity.this::clearMicrophoneCapture);
    }

    @JavascriptInterface
    public void requestCamera() {
      runOnUiThread(() -> {
        if (checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
          signalCam(true, "granted");
          return;
        }
        if (camAsked && !shouldShowRequestPermissionRationale(android.Manifest.permission.CAMERA)) {
          openPermissionSettings();
          signalCam(false, "settings");
          return;
        }
        camAsked = true;
        camFromBridge = true;
        requestPermissions(new String[] {android.Manifest.permission.CAMERA}, CAM_REQ);
      });
    }

    @JavascriptInterface
    public void openCamera() {
      runOnUiThread(() -> {
        if (checkSelfPermission(android.Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
          signalPickEnd(false, "denied");
          return;
        }
        photoFromJs = true;
        if (!launchCamera()) {
          photoFromJs = false;
          signalPickEnd(false, "missing");
        }
      });
    }

    @JavascriptInterface
    public void readList() {
      runOnUiThread(() -> {
        try {
          Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          intent.setType("*/*");
          intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] {"image/*", "application/pdf"});
          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
          startActivityForResult(Intent.createChooser(intent, "Upload list"), LIST_REQ);
        } catch (ActivityNotFoundException error) {
          signalList(false, "", "This phone has no app that can open a photo or PDF.");
        }
      });
    }

    @JavascriptInterface
    public void openAttach() {
      runOnUiThread(MainActivity.this::launchAttachChooser);
    }

    @JavascriptInterface
    public void openFiles() {
      runOnUiThread(() -> {
        try {
          Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          intent.setType("*/*");
          intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
          startActivityForResult(intent, PICK_REQ);
        } catch (ActivityNotFoundException error) {
          signalPickEnd(false, "missing");
        }
      });
    }

    @JavascriptInterface
    public void openRecorder() {
      runOnUiThread(() -> {
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
          signalPickEnd(false, "denied");
          return;
        }
        try {
          Intent intent = new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION);
          startActivityForResult(intent, PICK_REQ);
        } catch (ActivityNotFoundException error) {
          signalPickEnd(false, "missing");
        }
      });
    }

    @JavascriptInterface
    public void beginSave(String filename, String mime) {
      runOnUiThread(() -> {
        if (savePickerOpen || saveReady || saveBuffer != null) {
          return;
        }
        if (!NativeSavePolicy.isAllowed(filename, mime)) {
          signalPicker(false);
          return;
        }
        savePickerOpen = true;
        saveName = filename;
        saveMime = mime;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(saveMime);
        intent.putExtra(Intent.EXTRA_TITLE, saveName);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
          startActivityForResult(intent, SAVE_REQ);
        } catch (ActivityNotFoundException error) {
          savePickerOpen = false;
          signalPicker(false);
        }
      });
    }

    @JavascriptInterface
    public void writeChunk(String base64) {
      if (base64 == null || base64.isEmpty()
          || base64.length() > (MAX_SAVE_CHUNK_BYTES * 4 / 3) + 4) {
        synchronized (saveLock) {
          if (saveReady) saveFailed = true;
        }
        return;
      }
      try {
        byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        synchronized (saveLock) {
          if (!saveReady || saveBuffer == null || saveFailed) return;
          if (bytes.length == 0 || bytes.length > MAX_SAVE_CHUNK_BYTES
              || bytes.length > MAX_SAVE_BYTES - saveBytes) {
            saveFailed = true;
            return;
          }
          saveBuffer.write(bytes);
          saveBytes += bytes.length;
        }
      } catch (IllegalArgumentException | IOException error) {
        synchronized (saveLock) {
          if (saveReady) saveFailed = true;
        }
      }
    }

    @JavascriptInterface
    public void finishSave() {
      final Uri tree;
      final File buffer;
      boolean failed;
      synchronized (saveLock) {
        if (!saveReady || saveTree == null || saveBuffer == null || saveBufferFile == null) {
          signalSaved(false);
          return;
        }
        saveReady = false;
        failed = saveFailed || saveBytes == 0;
        try {
          saveBuffer.close();
        } catch (IOException error) {
          saveFailed = true;
        }
        tree = saveTree;
        buffer = saveBufferFile;
        saveTree = null;
        saveBuffer = null;
        saveBufferFile = null;
        saveBytes = 0;
        failed = failed || saveFailed;
        saveFailed = false;
      }
      if (failed) {
        deleteSaveBuffer(buffer);
        signalSaved(false);
        return;
      }
      new Thread(() -> {
        boolean wrote = writeDocument(tree, buffer);
        deleteSaveBuffer(buffer);
        signalSaved(wrote);
      }, "vellum-save").start();
    }
  }

  private boolean openExternal(Uri uri) {
    if (uri == null) return false;
    String scheme = uri.getScheme();
    if (scheme == null) return false;
    if ("http".equals(scheme) || "https".equals(scheme)) {
      String host = uri.getHost();
      if ("127.0.0.1".equals(host) || "localhost".equals(host)) return false;
      try {
        startActivity(new Intent(Intent.ACTION_VIEW, uri));
      } catch (ActivityNotFoundException ignored) {
        /* no browser */
      }
      return true;
    }
    if ("tel".equals(scheme)) {
      try {
        startActivity(new Intent(Intent.ACTION_DIAL, uri));
      } catch (ActivityNotFoundException ignored) {
        /* no dialler */
      }
      return true;
    }
    if ("mailto".equals(scheme)) {
      try {
        startActivity(new Intent(Intent.ACTION_SENDTO, uri));
      } catch (ActivityNotFoundException ignored) {
        /* no mail app */
      }
      return true;
    }
    return false;
  }

  @Override
  public void onBackPressed() {
    handleBack();
  }

  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);
    if (requestCode == LIST_REQ) {
      if (resultCode == RESULT_OK && data != null && data.getData() != null) readListUri(data.getData());
      else signalList(false, "", "");
      return;
    }
    if (requestCode == FILE_REQ) {
      if (resultCode != RESULT_OK) {
        dropCameraOutput();
        finishUpload(null);
      } else {
        Uri[] selected = collectPickedUris(data);
        String problem = selected == null ? "Choose an attachment to continue." : attachmentError(Arrays.asList(selected));
        if (problem != null) {
          showAttachmentError(problem);
          dropCameraOutput();
          finishUpload(null);
        } else {
          for (Uri uri : selected) {
            pickerUris.add(uri.toString());
            if (VellumFileProvider.isRegistered(uri)) VellumFileProvider.markReady(uri);
          }
          finishUpload(selected);
        }
      }
      return;
    }
    if (requestCode == CAMERA_REQ) {
      Uri taken = cameraOutput;
      if (photoFromJs) {
        photoFromJs = false;
        if (resultCode == RESULT_OK && taken != null) {
          VellumFileProvider.markReady(taken);
          List<Uri> uris = new ArrayList<>();
          uris.add(taken);
          deliverUris(uris, "Photo.jpg", "image/jpeg");
        } else {
          dropCameraOutput();
          signalPickEnd(false, "");
        }
        return;
      }
      if (upload != null) {
        if (resultCode == RESULT_OK && taken != null) {
          String problem = attachmentError(taken);
          if (problem == null) {
            VellumFileProvider.markReady(taken);
            pickerUris.add(taken.toString());
            upload.onReceiveValue(new Uri[] {taken});
          } else {
            showAttachmentError(problem);
            dropCameraOutput();
            upload.onReceiveValue(null);
          }
        } else {
          dropCameraOutput();
          upload.onReceiveValue(null);
        }
        upload = null;
      }
    }
    if (requestCode == PICK_REQ) {
      if (resultCode != RESULT_OK) {
        dropCameraOutput();
        signalPickEnd(false, "");
        return;
      }
      List<Uri> uris = new ArrayList<>();
      if (data != null) {
        if (data.getClipData() != null) {
          for (int index = 0; index < data.getClipData().getItemCount(); index++) {
            uris.add(data.getClipData().getItemAt(index).getUri());
          }
        } else if (data.getData() != null) uris.add(data.getData());
      }
      Uri shot = cameraOutput;
      boolean usedShot = false;
      if (shot != null) {
        for (Uri uri : uris) {
          if (shot.equals(uri)) usedShot = true;
        }
        if (!usedShot && resultCode == RESULT_OK && cameraOutputFile != null
            && cameraOutputFile.isFile() && cameraOutputFile.length() > 0) {
          VellumFileProvider.markReady(shot);
          uris.add(shot);
          usedShot = true;
        }
        if (!usedShot) dropCameraOutput();
      }
      String problem = attachmentError(uris);
      if (problem != null) {
        showAttachmentError(problem);
        dropCameraOutput();
        signalPickEnd(false, "invalid");
      } else {
        for (Uri uri : uris) {
          if (VellumFileProvider.isRegistered(uri)) VellumFileProvider.markReady(uri);
        }
        deliverUris(uris, "Attachment", "application/octet-stream");
      }
    }
    if (requestCode == SAVE_REQ) {
      savePickerOpen = false;
      if (resultCode == RESULT_OK && data != null && data.getData() != null) {
        File bufferFile = null;
        OutputStream buffer = null;
        try {
          bufferFile = File.createTempFile("vellum-save-", ".tmp", getCacheDir());
          buffer = new FileOutputStream(bufferFile, false);
        } catch (IOException error) {
          deleteSaveBuffer(bufferFile);
          signalPicker(false);
          return;
        }
        int flags = data.getFlags()
            & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
          getContentResolver().takePersistableUriPermission(data.getData(), flags);
        } catch (SecurityException ignored) {
          /* the write can still use the one-shot grant */
        }
        synchronized (saveLock) {
          saveTree = data.getData();
          saveBufferFile = bufferFile;
          saveBuffer = buffer;
          saveBytes = 0;
          saveFailed = false;
          saveReady = true;
        }
        signalPicker(true);
      } else {
        synchronized (saveLock) {
          saveTree = null;
          saveBufferFile = null;
          saveBuffer = null;
          saveBytes = 0;
          saveFailed = false;
          saveReady = false;
        }
        signalPicker(false);
      }
    }
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode == MIC_REQ) {
      boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
      if (micFromBridge) {
        boolean userActionActive = SystemClock.elapsedRealtime() <= micRequestExpiresAt;
        micFromBridge = false;
        micRequestExpiresAt = 0;
        if (granted && userActionActive && isTrustedCurrentPage()) {
          micCaptureArmed = true;
          micCaptureArmExpiresAt = SystemClock.elapsedRealtime() + 10_000;
          signalMic(true, "granted");
        } else if (granted) {
          signalMic(false, "denied");
        } else if (!shouldShowRequestPermissionRationale(android.Manifest.permission.RECORD_AUDIO)) {
          signalMic(false, "settings");
          openPermissionSettings();
        } else signalMic(false, "denied");
      }
      return;
    }
    if (requestCode == CAM_REQ && camFromBridge) {
      camFromBridge = false;
      boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
      if (granted) signalCam(true, "granted");
      else if (!shouldShowRequestPermissionRationale(android.Manifest.permission.CAMERA)) {
        openPermissionSettings();
        signalCam(false, "settings");
      } else signalCam(false, "denied");
    }
  }

  @Override
  protected void onPause() {
    micCaptureArmed = false;
    micCaptureActive = false;
    micCaptureArmExpiresAt = 0;
    if (!micFromBridge) {
      clearMicrophoneCapture();
    }
    if (webView != null && !micFromBridge) {
      webView.evaluateJavascript(
          "window.__vellumAbortRecording&&window.__vellumAbortRecording();"
              + "window.__vellumMicPause&&window.__vellumMicPause()",
          null);
    }
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    clearMicrophoneCapture();
    if (server != null) server.stop();
    dropCameraOutput();
    synchronized (saveLock) {
      try {
        if (saveBuffer != null) saveBuffer.close();
      } catch (IOException ignored) {
        /* app is closing */
      }
      deleteSaveBuffer(saveBufferFile);
      saveBuffer = null;
      saveBufferFile = null;
      saveTree = null;
      saveReady = false;
    }
    pickerUris.clear();
    if (webView != null) webView.destroy();
    super.onDestroy();
  }

  public static final class VellumFileProvider extends ContentProvider {
    private static final String AUTHORITY = "com.vellum.casebook.fileprovider";
    private static final java.util.Map<String, File> FILES = new java.util.concurrent.ConcurrentHashMap<>();
    private static final Set<String> READY_FOR_READ =
        Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<String, Boolean>());

    static Uri register(File file) {
      Uri uri = new Uri.Builder()
          .scheme(ContentResolver.SCHEME_CONTENT)
          .authority(AUTHORITY)
          .appendPath("camera")
          .appendPath(file.getName())
          .build();
      FILES.put(uri.toString(), file);
      return uri;
    }

    static void markReady(Uri uri) {
      if (uri != null && FILES.containsKey(uri.toString())) READY_FOR_READ.add(uri.toString());
    }

    static boolean isRegistered(Uri uri) {
      return uri != null && FILES.containsKey(uri.toString());
    }

    static void delete(Uri uri) {
      if (uri == null) return;
      String key = uri.toString();
      READY_FOR_READ.remove(key);
      File file = FILES.remove(key);
      if (file != null && file.exists()) file.delete();
    }

    @Override
    public boolean onCreate() {
      return true;
    }

    @Override
    public String getType(Uri uri) {
      return isRegistered(uri) ? "image/jpeg" : null;
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
      File file = resolve(uri);
      if (file == null) return null;
      String[] columns = projection == null
          ? new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}
          : projection;
      MatrixCursor cursor = new MatrixCursor(columns, 1);
      Object[] values = new Object[columns.length];
      for (int i = 0; i < columns.length; i++) {
        if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = file.getName();
        else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = file.length();
      }
      cursor.addRow(values);
      return cursor;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
      File file = resolve(uri);
      if (file == null) throw new FileNotFoundException("Unknown camera file.");
      int flags;
      if ("r".equals(mode)) flags = ParcelFileDescriptor.MODE_READ_ONLY;
      else if ("w".equals(mode) || "wt".equals(mode)) {
        flags = ParcelFileDescriptor.MODE_WRITE_ONLY | ParcelFileDescriptor.MODE_TRUNCATE;
      } else if ("rw".equals(mode)) {
        flags = ParcelFileDescriptor.MODE_READ_WRITE | ParcelFileDescriptor.MODE_CREATE;
      } else if ("rwt".equals(mode)) {
        flags = ParcelFileDescriptor.MODE_READ_WRITE
            | ParcelFileDescriptor.MODE_CREATE
            | ParcelFileDescriptor.MODE_TRUNCATE;
      } else {
        throw new FileNotFoundException("Unsupported camera file mode.");
      }
      String key = uri.toString();
      boolean deleteAfterRead = "r".equals(mode) && READY_FOR_READ.remove(key);
      try {
        if (deleteAfterRead) {
          return ParcelFileDescriptor.open(file, flags, null, closed -> {
            FILES.remove(key);
            file.delete();
          });
        }
        return ParcelFileDescriptor.open(file, flags);
      } catch (IOException error) {
        if (deleteAfterRead) READY_FOR_READ.add(key);
        FileNotFoundException failure = new FileNotFoundException("Could not open camera file.");
        failure.initCause(error);
        throw failure;
      }
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
      throw new UnsupportedOperationException("Camera provider is read/write only.");
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
      if (!isRegistered(uri)) return 0;
      delete(uri);
      return 1;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
      throw new UnsupportedOperationException("Camera provider is read/write only.");
    }

    private File resolve(Uri uri) {
      if (uri == null
          || !ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())
          || !AUTHORITY.equals(uri.getAuthority())
          || uri.getPathSegments().size() != 2
          || !"camera".equals(uri.getPathSegments().get(0))) {
        return null;
      }
      File file = FILES.get(uri.toString());
      if (file == null || getContext() == null) return null;
      try {
        File root = new File(getContext().getCacheDir(), "camera").getCanonicalFile();
        File candidate = file.getCanonicalFile();
        return root.equals(candidate.getParentFile()) ? candidate : null;
      } catch (IOException error) {
        return null;
      }
    }
  }
}
