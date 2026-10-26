import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import javax.sound.sampled.AudioFormat;
import javax.sound.sampled.AudioInputStream;
import javax.sound.sampled.AudioSystem;

/**
 * Multi-engine runner. Not part of the app and not wired into the UI; no network access.
 * Usage: Harness ENGINE_ID MODEL_DIR SAMPLES_DIR OUT_DIR [key=value ...]
 * Reads SAMPLES_DIR/*.wav (16 kHz mono 16-bit PCM) and writes OUT_DIR/ENGINE_ID/NAME.hyp.txt plus
 * timing.csv (audio s, decode s, real-time factor). compare.py then scores every engine folder.
 * To add an engine: implement {@link Engine} and register it in {@link #create}.
 */
public final class Harness {
    private Harness() {}

    static Engine create(String id) {
        switch (id) {
            case "vosk-small":
            case "vosk-lgraph":
                return new VoskEngine(id);
            case "whisper-base-en":
            case "whisper-small-en":
                return new WhisperEngine(id);
            default:
                throw new IllegalArgumentException("Unknown engine: " + id);
        }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 4) {
            System.err.println("Usage: Harness ENGINE_ID MODEL_DIR SAMPLES_DIR OUT_DIR [key=value ...]");
            System.exit(2);
        }
        Map<String, String> options = new HashMap<>();
        for (int i = 4; i < args.length; i++) {
            int eq = args[i].indexOf('=');
            options.put(args[i].substring(0, eq), args[i].substring(eq + 1));
        }
        File[] wavs = new File(args[2]).listFiles((d, n) -> n.endsWith(".wav"));
        if (wavs == null || wavs.length == 0) {
            System.err.println("No .wav files found.");
            System.exit(1);
        }
        Arrays.sort(wavs);
        // label=NAME writes to OUT/NAME so variants (for example with and without a prompt) stay apart.
        Path out = Path.of(args[3], options.getOrDefault("label", args[0]));
        Files.createDirectories(out);
        StringBuilder timing = new StringBuilder("name,audio_s,decode_s,rtf\n");
        try (Engine engine = create(args[0])) {
            long loadStart = System.nanoTime();
            engine.load(Path.of(args[1]), options);
            timing.append(String.format("# model load %.2f s%n", (System.nanoTime() - loadStart) / 1e9));
            for (File wav : wavs) {
                String name = wav.getName().substring(0, wav.getName().length() - 4);
                byte[] pcm = readPcm(wav);
                if (pcm == null) {
                    System.err.println("Skipping " + name + ": need 16 kHz mono 16-bit PCM WAV");
                    continue;
                }
                long started = System.nanoTime();
                String text = engine.transcribe(pcm);
                double decode = (System.nanoTime() - started) / 1e9;
                double audio = pcm.length / 32000.0;
                Files.writeString(out.resolve(name + ".hyp.txt"), text + "\n", StandardCharsets.UTF_8);
                timing.append(String.format("%s,%.2f,%.2f,%.3f%n", name, audio, decode, decode / audio));
            }
        }
        Files.writeString(out.resolve("timing.csv"), timing.toString(), StandardCharsets.UTF_8);
    }

    static byte[] readPcm(File wav) throws IOException {
        try (AudioInputStream in = AudioSystem.getAudioInputStream(wav)) {
            AudioFormat f = in.getFormat();
            if (f.getSampleRate() != 16000f || f.getChannels() != 1 || f.getSampleSizeInBits() != 16
                    || f.getEncoding() != AudioFormat.Encoding.PCM_SIGNED || f.isBigEndian()) {
                return null;
            }
            return in.readAllBytes();
        } catch (javax.sound.sampled.UnsupportedAudioFileException e) {
            throw new IOException("Unsupported audio file", e);
        }
    }
}
