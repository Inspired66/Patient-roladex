import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;
import org.vosk.LibVosk;
import org.vosk.LogLevel;
import org.vosk.Model;
import org.vosk.Recognizer;

/**
 * Desktop word-error-rate harness. Not part of the app and not wired into the UI.
 * Usage: Transcribe MODEL_DIR SAMPLES_DIR OUT_DIR
 * Reads SAMPLES_DIR/*.wav (16 kHz, mono, 16-bit PCM) and writes OUT_DIR/NAME.hyp.txt plus
 * OUT_DIR/timing.csv (audio seconds, decode seconds, real-time factor). Nothing is sent anywhere.
 */
public final class Transcribe {
    private Transcribe() {}

    public static void main(String[] args) throws Exception {
        if (args.length != 3) {
            System.err.println("Usage: Transcribe MODEL_DIR SAMPLES_DIR OUT_DIR");
            System.exit(2);
        }
        File[] wavs = new File(args[1]).listFiles((d, n) -> n.endsWith(".wav"));
        if (wavs == null || wavs.length == 0) {
            System.err.println("No .wav files found.");
            System.exit(1);
        }
        Arrays.sort(wavs);
        Files.createDirectories(Path.of(args[2]));
        LibVosk.setLogLevel(LogLevel.WARNINGS);
        StringBuilder timing = new StringBuilder("name,audio_s,decode_s,rtf\n");
        try (Model model = new Model(args[0])) {
            for (File wav : wavs) {
                String name = wav.getName().substring(0, wav.getName().length() - 4);
                long started = System.nanoTime();
                double audioSeconds = 0;
                StringBuilder text = new StringBuilder();
                try (AudioInputStream in = AudioSystem.getAudioInputStream(wav)) {
                    AudioFormat f = in.getFormat();
                    if (f.getSampleRate() != 16000f || f.getChannels() != 1
                            || f.getSampleSizeInBits() != 16
                            || f.getEncoding() != AudioFormat.Encoding.PCM_SIGNED) {
                        System.err.println("Skipping " + name + ": need 16 kHz mono 16-bit PCM WAV");
                        continue;
                    }
                    audioSeconds = in.getFrameLength() / 16000.0;
                    try (Recognizer rec = new Recognizer(model, 16000f)) {
                        byte[] buf = new byte[4000];
                        int n;
                        while ((n = in.read(buf)) >= 0) {
                            if (rec.acceptWaveForm(buf, n)) {
                                append(text, rec.getResult());
                            }
                        }
                        append(text, rec.getFinalResult());
                    }
                } catch (IOException e) {
                    System.err.println("Skipping " + name + ": " + e.getClass().getSimpleName());
                    continue;
                }
                double decode = (System.nanoTime() - started) / 1e9;
                Files.writeString(Path.of(args[2], name + ".hyp.txt"), text.toString().trim() + "\n",
                        StandardCharsets.UTF_8);
                timing.append(String.format("%s,%.2f,%.2f,%.3f%n", name, audioSeconds, decode,
                        audioSeconds > 0 ? decode / audioSeconds : 0));
            }
        }
        Files.writeString(Path.of(args[2], "timing.csv"), timing.toString(), StandardCharsets.UTF_8);
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
}
