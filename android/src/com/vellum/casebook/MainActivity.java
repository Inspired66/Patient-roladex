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
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebStorage;
import android.window.OnBackInvokedDispatcher;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
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
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
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
  private static final int RESTORE_FILE_REQ = 1007;
  private static final int MAX_SAVE_CHUNK_BYTES = 48 * 1024;
  private static final long MAX_SAVE_BYTES = NativeRestorePickerPolicy.MAX_FILE_BYTES;
  private static final long MAX_MIGRATION_ARCHIVE_BYTES = 512L * 1024L * 1024L;
  private static final int MAX_MIGRATION_CHUNK_BYTES = 48 * 1024;
  private static final String ASSET_HOST = "appassets.androidplatform.net";
  private static final String MIGRATION_DIR = "vellum-migration";
  private static final Pattern MIGRATION_FILE = Pattern.compile("migration-(\\d+)\\.vellum");

  private WebView webView;
  private AssetServer server;
  private AssetServer migrationServer;
  private WebViewAssetLoader assetLoader;
  private int migrationPort = -1;
  private boolean messageListenerInstalled;
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
  private final NativeRestorePickerPolicy.Arm restorePickerArm = new NativeRestorePickerPolicy.Arm();
  private final NativeAttachmentPickerPolicy.Arm attachmentPickerArm =
      new NativeAttachmentPickerPolicy.Arm();
  private int attachmentPickerMaxItems = NativeAttachmentPolicy.MAX_FILES;
  private String saveName = "vellum.csv";
  private NativeOpenPolicy.Transfer openTransfer;
  private Uri openUri;
  private String saveMime = "application/octet-stream";
  private final Map<String, JavaScriptReplyProxy> pendingReplies = new HashMap<>();
  private final Set<Integer> completedMigrationPorts = new HashSet<>();
  private String pendingMicRequestId;
  private String pendingCameraRequestId;
  private String pendingSavePickerRequestId;
  private String pendingSaveFinishRequestId;
  private String pendingListRequestId;
  private File migrationTempFile;
  private OutputStream migrationOutput;
  private long migrationExpectedBytes;
  private long migrationWrittenBytes;
  private int migrationWritePort = -1;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    openTransfer = new NativeOpenPolicy.Transfer(openRoot());
    dropOpenCopies();
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
    assetLoader = new WebViewAssetLoader.Builder()
        .setDomain(ASSET_HOST)
        .addPathHandler("/", new BundledAssetPathHandler(getAssets()))
        .build();
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      showStartupError("This Android System WebView is too old to open the secure casebook.");
      setContentView(webView);
      return;
    }
    Set<String> allowedBridgeOrigins = new HashSet<>();
    allowedBridgeOrigins.add("https://" + ASSET_HOST);
    installNativeMessageListener(allowedBridgeOrigins);
    webView.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (isTrustedAssetOrigin(url) || isTrustedMigrationOrigin(url)) return false;
        openExternal(url);
        return true;
      }

      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        String scheme = url.getScheme();
        if (isTrustedAssetOrigin(url)) return assetLoader.shouldInterceptRequest(url);
        if (isTrustedMigrationOrigin(url)
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
        if (!isTrustedCurrentPage()) {
          callback.onReceiveValue(null);
          return true;
        }
        if (upload != null) upload.onReceiveValue(null);
        upload = callback;
        try {
          if (restorePickerArm.consume(SystemClock.elapsedRealtime())) launchRestoreChooser();
          else {
            NativeAttachmentPickerPolicy.Request request =
                attachmentPickerArm.consume(SystemClock.elapsedRealtime());
            if (request == null) launchNativeChooser();
            else launchAttachmentPicker(request);
          }
        } catch (Exception error) {
          finishUpload(null);
        }
        return true;
      }
    });
    setContentView(webView);
    webView.loadUrl("https://" + ASSET_HOST + "/");
    completedMigrationPorts.addAll(readCompletedMigrationPorts());
    discardInterruptedMigrationFiles();
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
    }
  }

  private void showStartupError(String message) {
    webView.loadData(
        "<main style='font:16px sans-serif;padding:24px;color:#f4f1e8;background:#0c0d0f'>"
            + "<h1>Vellum could not open</h1><p>" + message + "</p></main>",
        "text/html",
        "utf-8");
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

  private boolean isTrustedAssetOrigin(Uri uri) {
    return uri != null
        && NativeOriginPolicy.isTrusted(uri.getScheme(), uri.getHost(), uri.getPort())
        && uri.getUserInfo() == null;
  }

  private boolean isTrustedMigrationOrigin(Uri uri) {
    return uri != null
        && migrationPort > 0
        && "http".equalsIgnoreCase(uri.getScheme())
        && "127.0.0.1".equals(uri.getHost())
        && uri.getPort() == migrationPort
        && uri.getUserInfo() == null;
  }

  private boolean isTrustedBridgeOrigin(Uri uri) {
    if (isTrustedAssetOrigin(uri)) return true;
    return isTrustedMigrationOrigin(uri) && isTrustedMigrationPage();
  }

  private void installNativeMessageListener(Set<String> allowedOrigins) {
    if (messageListenerInstalled) {
      WebViewCompat.removeWebMessageListener(webView, "VellumNative");
    }
    WebViewCompat.addWebMessageListener(
        webView,
        "VellumNative",
        allowedOrigins,
        new WebViewCompat.WebMessageListener() {
          @Override
          public void onPostMessage(
              WebView view,
              WebMessageCompat message,
              Uri sourceOrigin,
              boolean isMainFrame,
              JavaScriptReplyProxy replyProxy) {
            if (!isMainFrame || !isTrustedBridgeOrigin(sourceOrigin)) return;
            handleNativeMessage(message.getData(), replyProxy);
          }
        });
    messageListenerInstalled = true;
  }

  private void installSecureMessageListener() {
    Set<String> allowedOrigins = new HashSet<>();
    allowedOrigins.add("https://" + ASSET_HOST);
    installNativeMessageListener(allowedOrigins);
  }

  private boolean isTrustedMigrationPage() {
    String url = webView == null ? null : webView.getUrl();
    if (url == null) return false;
    Uri uri = Uri.parse(url);
    return isTrustedMigrationOrigin(uri)
        && "/".equals(uri.getPath())
        && "source".equals(uri.getQueryParameter("migration"))
        && Integer.toString(migrationPort).equals(uri.getQueryParameter("port"));
  }

  private boolean isTrustedCurrentPage() {
    String url = webView == null ? null : webView.getUrl();
    return url != null && isTrustedAssetOrigin(Uri.parse(url));
  }

  private boolean isPickerUri(Uri uri) {
    return uri != null && pickerUris.contains(uri.toString());
  }

  private void handleNativeMessage(String raw, JavaScriptReplyProxy replyProxy) {
    try {
      JSONObject request = new JSONObject(raw);
      String id = request.optString("id", "");
      String action = request.optString("action", "");
      JSONObject payload = request.optJSONObject("payload");
      if (id.isEmpty() || id.length() > 96 || action.isEmpty()) return;
      if (!isActionAllowed(action)) {
        sendNativeError(replyProxy, id, "That phone action is not allowed from this page.");
        return;
      }
      if (pendingReplies.containsKey(id)) {
        sendNativeError(replyProxy, id, "That request is already in progress.");
        return;
      }
      pendingReplies.put(id, replyProxy);
      switch (action) {
        case "beginMicrophoneCapture":
          beginMicrophoneCapture(id);
          break;
        case "endMicrophoneCapture":
          clearMicrophoneCapture();
          sendNativeResult(id, new JSONObject());
          break;
        case "requestCamera":
          requestCamera(id);
          break;
        case "armRestorePicker":
          armRestorePicker(id, payload);
          break;
        case "armAttachmentPicker":
          armAttachmentPicker(id, payload);
          break;
        case "readList":
          readList(id);
          break;
        case "beginSave":
          beginSave(id, payload);
          break;
        case "beginOpenFile":
          beginOpenFile(id, payload);
          break;
        case "writeOpenChunk":
          writeOpenChunk(id, payload);
          break;
        case "finishOpenFile":
          finishOpenFile(id, payload);
          break;
        case "cancelOpenFile":
          openTransfer.cancel();
          sendNativeResult(id, new JSONObject());
          break;
        case "writeChunk":
          writeChunk(id, payload);
          break;
        case "finishSave":
          finishSave(id);
          break;
        case "migrationStatus":
          migrationStatus(id);
          break;
        case "beginLegacyMigration":
          beginLegacyMigration(id, payload);
          break;
        case "beginMigrationArchive":
          beginMigrationArchive(id, payload);
          break;
        case "writeMigrationChunk":
          writeMigrationChunk(id, payload);
          break;
        case "finishMigrationArchive":
          finishMigrationArchive(id, payload);
          break;
        case "migrationArchiveInfo":
          migrationArchiveInfo(id, payload);
          break;
        case "readMigrationChunk":
          readMigrationChunk(id, payload);
          break;
        case "completeMigration":
          completeMigration(id, payload);
          break;
        case "cancelMigration":
          cancelMigration(id);
          break;
        default:
          sendNativeError(id, "That phone action is not available.");
      }
    } catch (JSONException error) {
      sendNativeError(replyProxy, "", "The phone could not read that request.");
    }
  }

  private void sendNativeResult(String id, JSONObject result) {
    JavaScriptReplyProxy proxy = pendingReplies.remove(id);
    if (proxy == null) return;
    sendNativeResult(proxy, id, result);
  }

  private void sendNativeResult(JavaScriptReplyProxy proxy, String id, JSONObject result) {
    JSONObject response = new JSONObject();
    try {
      response.put("id", id);
      response.put("ok", true);
      response.put("result", result == null ? JSONObject.NULL : result);
      proxy.postMessage(response.toString());
    } catch (JSONException ignored) {
      sendNativeError(proxy, id, "The phone could not prepare that response.");
    }
  }

  private void sendNativeError(String id, String message) {
    JavaScriptReplyProxy proxy = pendingReplies.remove(id);
    if (proxy != null) sendNativeError(proxy, id, message);
  }

  private void sendNativeError(JavaScriptReplyProxy proxy, String id, String message) {
    JSONObject response = new JSONObject();
    try {
      response.put("id", id);
      response.put("ok", false);
      response.put("error", message);
      proxy.postMessage(response.toString());
    } catch (JSONException ignored) {
      // A fixed error object cannot fail JSON encoding.
    }
  }

  private boolean isActionAllowed(String action) {
    switch (action) {
      case "beginMicrophoneCapture":
      case "endMicrophoneCapture":
      case "requestCamera":
      case "armRestorePicker":
      case "armAttachmentPicker":
      case "readList":
      case "beginSave":
      case "writeChunk":
      case "finishSave":
      case "beginOpenFile":
      case "writeOpenChunk":
      case "finishOpenFile":
      case "cancelOpenFile":
      case "migrationStatus":
      case "beginLegacyMigration":
      case "migrationArchiveInfo":
      case "readMigrationChunk":
      case "completeMigration":
        return isTrustedCurrentPage();
      case "beginMigrationArchive":
      case "writeMigrationChunk":
      case "finishMigrationArchive":
      case "cancelMigration":
        return isTrustedMigrationPage();
      default:
        return false;
    }
  }

  private JSONObject statusResult(String key, Object value) {
    JSONObject result = new JSONObject();
    try {
      result.put(key, value);
    } catch (JSONException ignored) {
      // The fixed fields and scalar values are always encodable.
    }
    return result;
  }

  private void armRestorePicker(String requestId, JSONObject payload) {
    if (!NativeRestorePickerPolicy.isValidPayload(
        payload == null ? 0 : payload.length(),
        payload != null && payload.has("purpose"),
        payload == null ? null : payload.opt("purpose"))) {
      sendNativeError(requestId, "That restore picker request is invalid.");
      return;
    }
    Uri page = Uri.parse(webView.getUrl());
    String purpose = payload.optString("purpose", null);
    if (!restorePickerArm.arm(
        purpose,
        page.getScheme(),
        page.getHost(),
        page.getPort(),
        SystemClock.elapsedRealtime())) {
      sendNativeError(requestId, "That restore picker request is invalid or already active.");
      return;
    }
    sendNativeResult(requestId, statusResult("armed", true));
  }

  private void beginMicrophoneCapture(String requestId) {
    if (pendingMicRequestId != null) {
      sendNativeError(requestId, "A microphone request is already in progress.");
      return;
    }
    clearMicrophoneCapture();
    if (!isTrustedCurrentPage()) {
      sendNativeResult(requestId, statusResult("status", "denied"));
      return;
    }
    if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      micCaptureArmed = true;
      micCaptureArmExpiresAt = SystemClock.elapsedRealtime() + 10_000;
      pendingMicRequestId = requestId;
      signalMic(true, "granted");
      return;
    }
    if (micAsked && !shouldShowRequestPermissionRationale(android.Manifest.permission.RECORD_AUDIO)) {
      pendingMicRequestId = requestId;
      signalMic(false, "settings");
      openPermissionSettings();
      return;
    }
    pendingMicRequestId = requestId;
    micAsked = true;
    micFromBridge = true;
    micRequestExpiresAt = SystemClock.elapsedRealtime() + 60_000;
    requestPermissions(new String[] {android.Manifest.permission.RECORD_AUDIO}, MIC_REQ);
  }

  private void requestCamera(String requestId) {
    if (!isTrustedCurrentPage()) {
      sendNativeResult(requestId, statusResult("status", "denied"));
      return;
    }
    if (checkSelfPermission(android.Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      sendNativeResult(requestId, statusResult("status", "granted"));
      return;
    }
    pendingCameraRequestId = requestId;
    if (camAsked && !shouldShowRequestPermissionRationale(android.Manifest.permission.CAMERA)) {
      openPermissionSettings();
      signalCam(false, "settings");
      return;
    }
    camAsked = true;
    camFromBridge = true;
    requestPermissions(new String[] {android.Manifest.permission.CAMERA}, CAM_REQ);
  }

  private void readList(String requestId) {
    pendingListRequestId = requestId;
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
  }

  private void beginSave(String requestId, JSONObject payload) {
    String filename = payload == null ? null : payload.optString("filename", null);
    String mime = payload == null ? null : payload.optString("mime", null);
    if (savePickerOpen || saveReady || saveBuffer != null) {
      sendNativeError(requestId, "Another file save is already in progress.");
      return;
    }
    if (!NativeSavePolicy.isAllowed(filename, mime)) {
      sendNativeResult(requestId, new JSONObject());
      return;
    }
    pendingSavePickerRequestId = requestId;
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
  }

  private File openRoot() {
    return new File(getCacheDir(), NativeOpenPolicy.DIR);
  }

  // Ends any earlier hand-off: revokes its grant and removes every temporary copy.
  private void dropOpenCopies() {
    releaseOpenGrant();
    if (openTransfer != null) openTransfer.cancel();
    NativeOpenPolicy.purge(openRoot(), System.currentTimeMillis(), 0);
  }

  private void releaseOpenGrant() {
    Uri uri = openUri;
    openUri = null;
    if (uri == null) return;
    try {
      revokeUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
    } catch (RuntimeException ignored) {
      // The copy is deleted below whether or not the grant could be revoked.
    }
    VellumFileProvider.delete(uri);
  }

  private JSONObject openReply(String reason) {
    JSONObject result = statusResult("accepted", reason == null);
    if (reason != null) {
      try {
        result.put("reason", reason);
      } catch (JSONException ignored) {
        // A fixed key and a fixed reason cannot fail JSON encoding.
      }
    }
    return result;
  }

  private void beginOpenFile(String requestId, JSONObject payload) {
    if (payload == null
        || !NativeOpenPolicy.isValidBeginPayload(
            payload.length(), payload.opt("transferId"), payload.opt("mime"), payload.opt("size"))) {
      sendNativeResult(requestId, openReply(NativeOpenPolicy.REASON_PAYLOAD));
      return;
    }
    Uri page = Uri.parse(webView.getUrl());
    if (!NativeOpenPolicy.isRequestAllowed(page.getScheme(), page.getHost(), page.getPort())) {
      sendNativeResult(requestId, openReply(NativeOpenPolicy.REASON_ORIGIN));
      return;
    }
    if (!openTransfer.isActive()) releaseOpenGrant();
    String reason = openTransfer.begin(
        payload.optString("transferId", ""),
        payload.optString("mime", ""),
        payload.optLong("size", 0),
        SystemClock.elapsedRealtime());
    sendNativeResult(requestId, openReply(reason));
  }

  private void writeOpenChunk(String requestId, JSONObject payload) {
    if (payload == null
        || !NativeOpenPolicy.isValidChunkPayload(
            payload.length(), payload.opt("transferId"), payload.opt("seq"), payload.opt("data"))) {
      openTransfer.cancel();
      sendNativeResult(requestId, openReply(NativeOpenPolicy.REASON_PAYLOAD));
      return;
    }
    String data = payload.optString("data", "");
    byte[] bytes = null;
    if (NativeOpenPolicy.isAllowedBase64Length(data.length())) {
      try {
        bytes = android.util.Base64.decode(data, android.util.Base64.NO_WRAP);
      } catch (IllegalArgumentException ignored) {
        bytes = null;
      }
    }
    if (bytes == null) {
      openTransfer.cancel();
      sendNativeResult(requestId, openReply(NativeOpenPolicy.REASON_SIZE));
      return;
    }
    String reason = openTransfer.chunk(
        payload.optString("transferId", ""),
        payload.optInt("seq", -1),
        bytes,
        SystemClock.elapsedRealtime());
    sendNativeResult(requestId, openReply(reason));
  }

  private void finishOpenFile(String requestId, JSONObject payload) {
    if (payload == null
        || !NativeOpenPolicy.isValidFinishPayload(payload.length(), payload.opt("transferId"))) {
      openTransfer.cancel();
      sendNativeResult(requestId, openReply(NativeOpenPolicy.REASON_PAYLOAD));
      return;
    }
    NativeOpenPolicy.Result copy =
        openTransfer.finish(payload.optString("transferId", ""), SystemClock.elapsedRealtime());
    if (!copy.ok()) {
      sendNativeResult(requestId, openReply(copy.reason));
      return;
    }
    openUri = VellumFileProvider.registerOpen(copy.file, copy.token, copy.mime);
    String outcome = launchViewer(openUri, copy.mime);
    if (!"opened".equals(outcome)) dropOpenCopies();
    JSONObject result = new JSONObject();
    try {
      result.put("outcome", outcome);
    } catch (JSONException ignored) {
      // A fixed key and a fixed outcome cannot fail JSON encoding.
    }
    sendNativeResult(requestId, result);
  }

  // Read access only, through a chooser. A chooser never throws for "no app", so look first.
  private String launchViewer(Uri uri, String mime) {
    Intent view = new Intent(Intent.ACTION_VIEW);
    view.setDataAndType(uri, mime);
    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    view.setClipData(ClipData.newRawUri("", uri));
    if (view.resolveActivity(getPackageManager()) == null) return "no-app";
    Intent chooser = Intent.createChooser(view, null);
    chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    chooser.setClipData(ClipData.newRawUri("", uri));
    try {
      startActivity(chooser);
      return "opened";
    } catch (ActivityNotFoundException error) {
      return "no-app";
    } catch (RuntimeException error) {
      return "failed";
    }
  }

  private void writeChunk(String requestId, JSONObject payload) {
    String base64 = payload == null ? null : payload.optString("data", null);
    boolean written = false;
    if (base64 != null && !base64.isEmpty()
        && base64.length() <= (MAX_SAVE_CHUNK_BYTES * 4 / 3) + 4) {
      try {
        byte[] bytes = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
        synchronized (saveLock) {
          if (saveReady && saveBuffer != null && !saveFailed
              && bytes.length > 0 && bytes.length <= MAX_SAVE_CHUNK_BYTES
              && bytes.length <= MAX_SAVE_BYTES - saveBytes) {
            saveBuffer.write(bytes);
            saveBytes += bytes.length;
            written = true;
          } else if (saveReady) {
            saveFailed = true;
          }
        }
      } catch (IllegalArgumentException | IOException error) {
        synchronized (saveLock) {
          if (saveReady) saveFailed = true;
        }
      }
    }
    sendNativeResult(requestId, statusResult("written", written));
  }

  private void finishSave(String requestId) {
    pendingSaveFinishRequestId = requestId;
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

  private File migrationDirectory() throws IOException {
    File directory = new File(getFilesDir(), MIGRATION_DIR);
    if (!directory.isDirectory() && !directory.mkdirs()) {
      throw new IOException("Could not prepare private migration storage.");
    }
    return directory;
  }

  private Set<Integer> readCompletedMigrationPorts() {
    Set<Integer> result = new HashSet<>();
    Set<String> stored = getSharedPreferences("vellum-migration", MODE_PRIVATE)
        .getStringSet("completedPorts", Collections.emptySet());
    for (String value : stored) {
      try {
        result.add(Integer.parseInt(value));
      } catch (NumberFormatException ignored) {
        // Ignore malformed local migration markers.
      }
    }
    return result;
  }

  private void migrationStatus(String requestId) {
    WebStorage.getInstance().getOrigins(origins -> {
      JSONArray legacyOrigins = new JSONArray();
      Set<Integer> done = readCompletedMigrationPorts();
      for (Object originValue : origins.keySet()) {
        if (!(originValue instanceof String)) continue;
        String origin = (String) originValue;
        Uri uri = Uri.parse(origin);
        int port = uri.getPort();
        if ("http".equalsIgnoreCase(uri.getScheme())
            && "127.0.0.1".equals(uri.getHost())
            && port > 0
            && !done.contains(port)) {
          JSONObject item = new JSONObject();
          try {
            item.put("port", port);
            legacyOrigins.put(item);
          } catch (JSONException ignored) {
            // Integer port fields are always encodable.
          }
        }
      }
      JSONArray archives = new JSONArray();
      File directory;
      try {
        directory = migrationDirectory();
      } catch (IOException error) {
        sendNativeError(requestId, "Private migration storage is unavailable.");
        return;
      }
      File[] files = directory.listFiles();
      if (files != null) {
        for (File file : files) {
          Matcher match = MIGRATION_FILE.matcher(file.getName());
          if (!match.matches()) continue;
          int port;
          try {
            port = Integer.parseInt(match.group(1));
          } catch (NumberFormatException ignored) {
            continue;
          }
          if (done.contains(port)) continue;
          JSONObject item = new JSONObject();
          try {
            item.put("port", port);
            item.put("bytes", file.length());
            archives.put(item);
          } catch (JSONException ignored) {
            // Integer and long fields are always encodable.
          }
        }
      }
      JSONObject result = new JSONObject();
      try {
        result.put("legacyOrigins", legacyOrigins);
        result.put("archives", archives);
        sendNativeResult(requestId, result);
      } catch (JSONException error) {
        sendNativeError(requestId, "Could not read migration status.");
      }
    });
  }

  private void beginLegacyMigration(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    WebStorage.getInstance().getOrigins(origins -> {
      boolean found = false;
      for (Object originValue : origins.keySet()) {
        if (!(originValue instanceof String)) continue;
        String origin = (String) originValue;
        Uri parsed = Uri.parse(origin);
        if ("http".equalsIgnoreCase(parsed.getScheme())
            && "127.0.0.1".equals(parsed.getHost())
            && parsed.getPort() == port) {
          found = true;
          break;
        }
      }
      if (!found || port <= 0 || readCompletedMigrationPorts().contains(port)) {
        sendNativeError(requestId, "That older casebook origin is no longer available.");
        return;
      }
      try {
        if (migrationServer != null) migrationServer.stop();
        migrationServer = new AssetServer(getAssets());
        migrationServer.start(port);
        migrationPort = port;
        Set<String> allowedOrigins = new HashSet<>();
        allowedOrigins.add("https://" + ASSET_HOST);
        allowedOrigins.add("http://127.0.0.1:" + port);
        installNativeMessageListener(allowedOrigins);
        sendNativeResult(requestId, statusResult("started", true));
        webView.loadUrl("http://127.0.0.1:" + port + "/?migration=source&port=" + port);
      } catch (IOException error) {
        migrationPort = -1;
        if (migrationServer != null) migrationServer.stop();
        migrationServer = null;
        sendNativeError(requestId, "The older casebook could not be opened safely.");
      }
    });
  }

  private boolean isValidMigrationPort(int port) {
    return port > 0 && port <= 65535 && migrationPort == port && isTrustedMigrationPage();
  }

  private void beginMigrationArchive(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    long expected = payload == null ? -1 : payload.optLong("bytes", -1);
    if (!isValidMigrationPort(port) || expected < 43 || expected > MAX_MIGRATION_ARCHIVE_BYTES) {
      sendNativeError(requestId, "The encrypted migration archive is invalid or too large.");
      return;
    }
    if (migrationOutput != null) {
      sendNativeError(requestId, "Another migration archive is already being written.");
      return;
    }
    try {
      File directory = migrationDirectory();
      File archived = new File(directory, "migration-" + port + ".vellum");
      if (archived.exists()) {
        sendNativeError(requestId, "A migration archive for this origin is already stored.");
        return;
      }
      migrationTempFile = new File(directory, "migration-" + port + ".tmp");
      if (migrationTempFile.exists() && !migrationTempFile.delete()) {
        sendNativeError(requestId, "An incomplete migration file could not be cleared.");
        return;
      }
      migrationOutput = new FileOutputStream(migrationTempFile, false);
      migrationWritePort = port;
      migrationExpectedBytes = expected;
      migrationWrittenBytes = 0;
      sendNativeResult(requestId, statusResult("started", true));
    } catch (IOException error) {
      clearMigrationWrite();
      sendNativeError(requestId, "Private migration storage is unavailable.");
    }
  }

  private void writeMigrationChunk(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    String data = payload == null ? null : payload.optString("data", null);
    if (!isValidMigrationPort(port) || migrationOutput == null || migrationWritePort != port
        || data == null || data.isEmpty() || data.length() > (MAX_MIGRATION_CHUNK_BYTES * 4 / 3) + 4) {
      sendNativeError(requestId, "The migration archive transfer is out of sequence.");
      return;
    }
    try {
      byte[] bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT);
      if (bytes.length == 0 || bytes.length > MAX_MIGRATION_CHUNK_BYTES
          || bytes.length > migrationExpectedBytes - migrationWrittenBytes) {
        clearMigrationWrite();
        sendNativeError(requestId, "The migration archive exceeded its declared size.");
        return;
      }
      migrationOutput.write(bytes);
      migrationWrittenBytes += bytes.length;
      JSONObject result = new JSONObject();
      result.put("written", true);
      sendNativeResult(requestId, result);
    } catch (IllegalArgumentException | IOException | JSONException error) {
      clearMigrationWrite();
      sendNativeError(requestId, "The encrypted migration archive could not be written.");
    }
  }

  private void finishMigrationArchive(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    if (!isValidMigrationPort(port) || migrationOutput == null || migrationWritePort != port) {
      sendNativeError(requestId, "The migration archive transfer is out of sequence.");
      return;
    }
    File temp = migrationTempFile;
    try {
      if (migrationWrittenBytes != migrationExpectedBytes) {
        throw new IOException("Migration archive was incomplete.");
      }
      migrationOutput.flush();
      if (migrationOutput instanceof FileOutputStream) {
        ((FileOutputStream) migrationOutput).getFD().sync();
      }
      migrationOutput.close();
      migrationOutput = null;
      if (!hasArchiveMagic(temp)) throw new IOException("Migration archive verification failed.");
      File archived = new File(migrationDirectory(), "migration-" + port + ".vellum");
      if (!temp.renameTo(archived)) throw new IOException("Could not finalize migration archive.");
      migrationTempFile = null;
      migrationWritePort = -1;
      migrationExpectedBytes = 0;
      migrationWrittenBytes = 0;
      sendNativeResult(requestId, statusResult("verified", true));
      if (migrationServer != null) migrationServer.stop();
      migrationServer = null;
      migrationPort = -1;
      installSecureMessageListener();
      webView.loadUrl("https://" + ASSET_HOST + "/?migration=restore&port=" + port);
    } catch (IOException error) {
      clearMigrationWrite();
      sendNativeError(requestId, "The encrypted migration archive could not be verified.");
    }
  }

  private boolean hasArchiveMagic(File file) {
    byte[] expected = "VELLUM1".getBytes(StandardCharsets.US_ASCII);
    if (file == null || !file.isFile() || file.length() < 35) return false;
    try (InputStream input = new FileInputStream(file)) {
      for (byte value : expected) {
        if (input.read() != (value & 0xff)) return false;
      }
      return true;
    } catch (IOException error) {
      return false;
    }
  }

  private void clearMigrationWrite() {
    if (migrationOutput != null) {
      try {
        migrationOutput.close();
      } catch (IOException ignored) {
        // The temporary archive will be discarded.
      }
    }
    migrationOutput = null;
    if (migrationTempFile != null) migrationTempFile.delete();
    migrationTempFile = null;
    migrationWritePort = -1;
    migrationExpectedBytes = 0;
    migrationWrittenBytes = 0;
  }

  private void discardInterruptedMigrationFiles() {
    try {
      File[] files = migrationDirectory().listFiles();
      if (files == null) return;
      for (File file : files) {
        if (file.getName().endsWith(".tmp")) file.delete();
      }
    } catch (IOException ignored) {
      // Storage failures are reported when a migration is requested.
    }
  }

  private void cancelMigration(String requestId) {
    clearMigrationWrite();
    if (migrationServer != null) migrationServer.stop();
    migrationServer = null;
    migrationPort = -1;
    installSecureMessageListener();
    sendNativeResult(requestId, new JSONObject());
    webView.loadUrl("https://" + ASSET_HOST + "/");
  }

  private File migrationArchive(int port) throws IOException {
    if (port <= 0 || port > 65535) throw new IOException("Invalid archive origin.");
    File archive = new File(migrationDirectory(), "migration-" + port + ".vellum");
    if (!archive.isFile() || !hasArchiveMagic(archive)) {
      throw new IOException("The encrypted migration archive is unavailable.");
    }
    return archive;
  }

  private void migrationArchiveInfo(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    try {
      File archive = migrationArchive(port);
      JSONObject result = new JSONObject();
      result.put("bytes", archive.length());
      sendNativeResult(requestId, result);
    } catch (IOException | JSONException error) {
      sendNativeError(requestId, "The encrypted migration archive is unavailable.");
    }
  }

  private void readMigrationChunk(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    long offset = payload == null ? -1 : payload.optLong("offset", -1);
    try {
      File archive = migrationArchive(port);
      if (offset < 0 || offset >= archive.length()) throw new IOException("Invalid archive offset.");
      int length = (int) Math.min(MAX_MIGRATION_CHUNK_BYTES, archive.length() - offset);
      byte[] bytes = new byte[length];
      try (java.io.RandomAccessFile input = new java.io.RandomAccessFile(archive, "r")) {
        input.seek(offset);
        input.readFully(bytes);
      }
      JSONObject result = new JSONObject();
      result.put("data", android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP));
      result.put("offset", offset);
      sendNativeResult(requestId, result);
    } catch (IOException | JSONException error) {
      sendNativeError(requestId, "The encrypted migration archive could not be read.");
    }
  }

  private void completeMigration(String requestId, JSONObject payload) {
    int port = payload == null ? -1 : payload.optInt("port", -1);
    try {
      migrationArchive(port);
      completedMigrationPorts.add(port);
      Set<String> stored = new HashSet<>();
      for (Integer completed : completedMigrationPorts) stored.add(Integer.toString(completed));
      getSharedPreferences("vellum-migration", MODE_PRIVATE)
          .edit().putStringSet("completedPorts", stored).apply();
      sendNativeResult(requestId, new JSONObject());
      webView.loadUrl("https://" + ASSET_HOST + "/");
    } catch (IOException error) {
      sendNativeError(requestId, "The migration cannot be marked complete yet.");
    }
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

  private void armAttachmentPicker(String requestId, JSONObject payload) {
    Object rawPurpose = payload == null ? null : payload.opt("purpose");
    Object rawMaxItems = payload == null ? null : payload.opt("maxItems");
    String purpose = rawPurpose instanceof String ? (String) rawPurpose : null;
    long rawCount = rawMaxItems instanceof Number ? ((Number) rawMaxItems).longValue() : -1;
    int maxItems = rawCount >= Integer.MIN_VALUE && rawCount <= Integer.MAX_VALUE ? (int) rawCount : -1;
    Uri page = webView == null || webView.getUrl() == null ? null : Uri.parse(webView.getUrl());
    if (payload == null
        || payload.length() != 2
        || !(rawMaxItems instanceof Integer || rawMaxItems instanceof Long)
        || !NativeAttachmentPickerPolicy.isValidRequest(
            page == null ? null : page.getScheme(),
            page == null ? null : page.getHost(),
            page == null ? -1 : page.getPort(),
            purpose,
            maxItems)
        || !attachmentPickerArm.arm(purpose, maxItems, SystemClock.elapsedRealtime())) {
      sendNativeError(requestId, "The attachment picker request is invalid.");
      return;
    }
    JSONObject result = new JSONObject();
    try {
      result.put("armed", true);
      sendNativeResult(requestId, result);
    } catch (JSONException error) {
      attachmentPickerArm.clear();
      sendNativeError(requestId, "The attachment picker could not be prepared.");
    }
  }

  private void launchAttachmentPicker(NativeAttachmentPickerPolicy.Request request) {
    dropCameraOutput();
    pickerUris.clear();
    attachmentPickerMaxItems = request.maxItems;
    try {
      switch (request.purpose) {
        case NativeAttachmentPickerPolicy.FILES: {
          Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          intent.setType("*/*");
          intent.putExtra(
              Intent.EXTRA_MIME_TYPES,
              new String[] {
                "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
                "image/bmp", "audio/mpeg", "audio/mp4", "audio/aac", "audio/wav", "audio/x-wav",
                "audio/ogg", "audio/webm", "audio/3gpp", "audio/amr", "application/pdf", "text/plain"
              });
          intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
          startActivityForResult(intent, FILE_REQ);
          return;
        }
        case NativeAttachmentPickerPolicy.PHOTOS: {
          Intent intent;
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, request.maxItems);
          } else {
            intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
          }
          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
          startActivityForResult(intent, FILE_REQ);
          return;
        }
        case NativeAttachmentPickerPolicy.CAMERA:
          if (!launchCamera()) {
            showAttachmentError("This phone could not open the camera.");
            finishUpload(null);
          }
          return;
        case NativeAttachmentPickerPolicy.RECORDER: {
          Intent intent = new Intent(MediaStore.Audio.Media.RECORD_SOUND_ACTION);
          startActivityForResult(intent, FILE_REQ);
          return;
        }
        default:
          showAttachmentError("That attachment option is not available.");
          finishUpload(null);
      }
    } catch (ActivityNotFoundException error) {
      showAttachmentError(
          NativeAttachmentPickerPolicy.CAMERA.equals(request.purpose)
              ? "This phone has no camera app available."
              : NativeAttachmentPickerPolicy.RECORDER.equals(request.purpose)
                  ? "This phone has no voice recorder app available."
                  : "This phone has no app that can select that type of file.");
      dropCameraOutput();
      finishUpload(null);
    }
  }

  private void launchRestoreChooser() {
    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.setType("*/*");
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    try {
      startActivityForResult(intent, RESTORE_FILE_REQ);
    } catch (ActivityNotFoundException error) {
      showAttachmentError("This phone has no app that can open a backup file.");
      finishUpload(null);
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
    String requestId = pendingMicRequestId;
    pendingMicRequestId = null;
    if (requestId == null) return;
    try {
      JSONObject result = new JSONObject();
      result.put("status", granted ? "granted" : reason);
      sendNativeResult(requestId, result);
    } catch (JSONException error) {
      sendNativeError(requestId, "The phone could not prepare the microphone response.");
    }
  }

  private void clearMicrophoneCapture() {
    micFromBridge = false;
    micCaptureArmed = false;
    micCaptureActive = false;
    micRequestExpiresAt = 0;
    micCaptureArmExpiresAt = 0;
  }

  private void signalCam(boolean granted, String reason) {
    String requestId = pendingCameraRequestId;
    pendingCameraRequestId = null;
    if (requestId == null) return;
    try {
      JSONObject result = new JSONObject();
      result.put("status", granted ? "granted" : reason);
      sendNativeResult(requestId, result);
    } catch (JSONException error) {
      sendNativeError(requestId, "The phone could not prepare the camera response.");
    }
  }

  private void signalPhoto(boolean ok) {
    signalPickEnd(ok, ok ? "" : "");
  }

  private void signalList(boolean ok, String payloadJson, String message) {
    String requestId = pendingListRequestId;
    pendingListRequestId = null;
    if (requestId == null) return;
    try {
      if (!ok) {
        sendNativeError(requestId, message.isEmpty() ? "The document could not be processed locally." : message);
        return;
      }
      sendNativeResult(requestId, new JSONObject(payloadJson));
    } catch (JSONException error) {
      sendNativeError(requestId, "The local extraction result could not be read.");
    }
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

  private String attachmentSelectionMessage(int acceptedCount, List<String> refusedReasons) {
    if (refusedReasons.isEmpty()) return null;
    List<String> uniqueReasons = new ArrayList<>();
    for (String reason : refusedReasons) {
      if (!uniqueReasons.contains(reason)) uniqueReasons.add(reason);
    }
    StringBuilder message = new StringBuilder();
    if (acceptedCount > 0) {
      message.append("Added ").append(acceptedCount).append(acceptedCount == 1 ? " file. " : " files. ");
    } else {
      message.append("No files were added. ");
    }
    message.append(refusedReasons.size())
        .append(refusedReasons.size() == 1 ? " file was not added. " : " files were not added. ");
    for (String reason : uniqueReasons) {
      message.append(reason).append(' ');
    }
    if (acceptedCount > 0) message.append("Accepted files are shown below.");
    return message.toString().trim();
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
    String requestId = pendingSavePickerRequestId;
    pendingSavePickerRequestId = null;
    if (requestId == null) return;
    try {
      JSONObject result = new JSONObject();
      result.put("picked", ok);
      sendNativeResult(requestId, result);
    } catch (JSONException error) {
      sendNativeError(requestId, "The phone could not prepare the file picker response.");
    }
  }

  private void signalSaved(boolean ok) {
    String requestId = pendingSaveFinishRequestId;
    pendingSaveFinishRequestId = null;
    if (requestId == null) return;
    try {
      JSONObject result = new JSONObject();
      result.put("written", ok);
      sendNativeResult(requestId, result);
    } catch (JSONException error) {
      sendNativeError(requestId, "The phone could not prepare the file result.");
    }
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

    public void endMicrophoneCapture() {
      runOnUiThread(MainActivity.this::clearMicrophoneCapture);
    }

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

    public void openAttach() {
      runOnUiThread(MainActivity.this::launchAttachChooser);
    }

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
    if (requestCode == RESTORE_FILE_REQ) {
      Uri selected = resultCode == RESULT_OK && data != null ? data.getData() : null;
      String name = displayName(selected, "");
      long size = contentSize(selected);
      if (selected == null) {
        finishUpload(null);
      } else if (!NativeRestorePickerPolicy.isAllowedExtension(name)) {
        showAttachmentError("Choose a .vellum or .csv backup file.");
        finishUpload(null);
      } else if (size == 0) {
        showAttachmentError("That backup file is empty.");
        finishUpload(null);
      } else if (size < 0) {
        showAttachmentError("The backup file size could not be verified.");
        finishUpload(null);
      } else if (size > NativeRestorePickerPolicy.MAX_FILE_BYTES) {
        showAttachmentError("Backup files must be 64 MB or smaller.");
        finishUpload(null);
      } else if (!NativeRestorePickerPolicy.isAllowedFile(
          NativeRestorePickerPolicy.PURPOSE, name, size)) {
        showAttachmentError("That backup file could not be opened.");
        finishUpload(null);
      } else {
        pickerUris.add(selected.toString());
        finishUpload(new Uri[] {selected});
      }
      return;
    }
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
        List<Uri> accepted = new ArrayList<>();
        List<String> refusedReasons = new ArrayList<>();
        if (selected != null) {
          for (Uri uri : selected) {
            if (accepted.size() >= attachmentPickerMaxItems) {
              refusedReasons.add(attachmentPickerMaxItems == 1
                  ? "You can add only one more attachment."
                  : "You can add up to " + attachmentPickerMaxItems + " more attachments.");
              continue;
            }
            String problem = attachmentError(uri);
            if (problem == null) accepted.add(uri);
            else refusedReasons.add(problem);
          }
        }
        String selectionMessage = selected == null
            ? "Choose an attachment to continue."
            : attachmentSelectionMessage(accepted.size(), refusedReasons);
        attachmentPickerMaxItems = NativeAttachmentPolicy.MAX_FILES;
        if (selectionMessage != null && accepted.isEmpty()) {
          showAttachmentError(selectionMessage);
          dropCameraOutput();
          finishUpload(null);
        } else {
          if (selectionMessage != null) showAttachmentError(selectionMessage);
          for (Uri uri : accepted) {
            pickerUris.add(uri.toString());
            if (VellumFileProvider.isRegistered(uri)) VellumFileProvider.markReady(uri);
          }
          finishUpload(accepted.toArray(new Uri[0]));
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
            finishUpload(new Uri[] {taken});
          } else {
            showAttachmentError(problem);
            dropCameraOutput();
            finishUpload(null);
          }
        } else {
          dropCameraOutput();
          finishUpload(null);
        }
        upload = null;
      }
      attachmentPickerMaxItems = NativeAttachmentPolicy.MAX_FILES;
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
  protected void onResume() {
    super.onResume();
    // Coming back from another app ends the hand-off: grant revoked, temporary copy deleted.
    dropOpenCopies();
  }

  @Override
  protected void onPause() {
    restorePickerArm.clear();
    attachmentPickerArm.clear();
    if (openTransfer != null) openTransfer.cancel();
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
      if (pendingMicRequestId != null) signalMic(false, "denied");
    }
    super.onPause();
  }

  @Override
  protected void onDestroy() {
    restorePickerArm.clear();
    dropOpenCopies();
    clearMicrophoneCapture();
    if (server != null) server.stop();
    if (migrationServer != null) migrationServer.stop();
    migrationServer = null;
    clearMigrationWrite();
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
    pendingReplies.clear();
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

    private static final java.util.Map<String, String> OPEN_TYPES = new java.util.concurrent.ConcurrentHashMap<>();

    // Hand-off copies live at open/<token>/<neutral name> and are readable, never writable.
    static Uri registerOpen(File file, String token, String mime) {
      Uri uri = new Uri.Builder()
          .scheme(ContentResolver.SCHEME_CONTENT)
          .authority(AUTHORITY)
          .appendPath(NativeOpenPolicy.DIR)
          .appendPath(token)
          .appendPath(file.getName())
          .build();
      FILES.put(uri.toString(), file);
      OPEN_TYPES.put(uri.toString(), mime);
      return uri;
    }

    private static boolean isOpenUri(Uri uri) {
      return uri != null && OPEN_TYPES.containsKey(uri.toString());
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
      OPEN_TYPES.remove(key);
      File file = FILES.remove(key);
      if (file != null && file.exists()) file.delete();
    }

    @Override
    public boolean onCreate() {
      return true;
    }

    @Override
    public String getType(Uri uri) {
      if (isOpenUri(uri)) return OPEN_TYPES.get(uri.toString());
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
      if (isOpenUri(uri)) {
        if (!"r".equals(mode)) throw new FileNotFoundException("Unsupported file mode.");
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY);
      }
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
          || !AUTHORITY.equals(uri.getAuthority())) {
        return null;
      }
      List<String> segments = uri.getPathSegments();
      boolean open = segments.size() == 3 && NativeOpenPolicy.DIR.equals(segments.get(0));
      boolean camera = segments.size() == 2 && "camera".equals(segments.get(0));
      if (!open && !camera) return null;
      File file = FILES.get(uri.toString());
      if (file == null || getContext() == null) return null;
      try {
        File root = new File(getContext().getCacheDir(), open ? NativeOpenPolicy.DIR : "camera").getCanonicalFile();
        File candidate = file.getCanonicalFile();
        File parent = candidate.getParentFile();
        if (open && parent != null) parent = parent.getParentFile();
        return root.equals(parent) ? candidate : null;
      } catch (IOException error) {
        return null;
      }
    }
  }
}
