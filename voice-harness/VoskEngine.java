import java.nio.file.Path;
import java.util.Map;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

/**
 * Vosk adapter. Registered as "vosk-small" for vosk-model-small-en-us-0.15. Optional option
 * {@code grammar=PATH} points to a JSON array of phrases (Vosk grammar mode); words that the
 * model lacks are dropped by Vosk itself, which is part of what is being measured.
 */
public final class VoskEngine implements Engine {
    private final String id;
    private Model model;
    private String grammar;

    public VoskEngine(String id) {
        this.id = id;
    }

    @Override
    public String id() {
        return id;
    }

    @Override
    public void load(Path modelDir, Map<String, String> options) throws Exception {
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        model = new Model(modelDir.toString());
        String path = options.get("grammar");
        grammar = path == null ? null : java.nio.file.Files.readString(Path.of(path));
    }

    @Override
    public String transcribe(byte[] pcm) throws Exception {
        StringBuilder text = new StringBuilder();
        try (Recognizer rec = grammar == null ? new Recognizer(model, 16000f)
                : new Recognizer(model, 16000f, grammar)) {
            for (int off = 0; off < pcm.length; off += 8000) {
                int n = Math.min(8000, pcm.length - off);
                byte[] chunk = java.util.Arrays.copyOfRange(pcm, off, off + n);
                if (rec.acceptWaveForm(chunk, n)) {
                    append(text, rec.getResult());
                }
            }
            append(text, rec.getFinalResult());
        }
        return text.toString().trim();
    }

    // Vosk returns {"text" : "..."}; avoid a JSON dependency.
    private static void append(StringBuilder out, String json) {
        int key = json.indexOf("\"text\"");
        if (key < 0) {
            return;
        }
        int open = json.indexOf('"', json.indexOf(':', key) + 1);
        int close = json.lastIndexOf('"');
        if (open >= 0 && close > open) {
            String t = json.substring(open + 1, close).trim();
            if (!t.isEmpty()) {
                out.append(t).append(' ');
            }
        }
    }

    @Override
    public void close() {
        if (model != null) {
            model.close();
        }
    }
}
