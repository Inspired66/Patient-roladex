import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * whisper.cpp adapter (desktop only, for the WER comparison). Runs the locally built whisper-cli
 * as a child process on a temporary WAV; no network access. Options:
 *   cli=PATH      whisper-cli binary (required)
 *   prompt=FILE   text file used as --prompt (initial prompt biasing); omitted = no prompt
 *   threads=N     default 2
 *   tmp=DIR       scratch dir (default out/tmp next to the harness); cleaned after each clip
 * The model path is the ggml .bin file given as MODEL on the Harness command line.
 */
public final class WhisperEngine implements Engine {
    private final String id;
    private Path model;
    private Path cli;
    private String prompt;
    private String threads = "2";
    private Path tmp;

    public WhisperEngine(String id) {
        this.id = id;
    }

    @Override
    public String id() {
        return id;
    }

    @Override
    public void load(Path modelFile, Map<String, String> options) throws Exception {
        if (!Files.isRegularFile(modelFile)) {
            throw new IOException("Model file not found: " + modelFile);
        }
        model = modelFile;
        String cliPath = options.get("cli");
        if (cliPath == null) {
            throw new IllegalArgumentException("cli=PATH to whisper-cli is required");
        }
        cli = Path.of(cliPath).toAbsolutePath();
        String promptFile = options.get("prompt");
        prompt = promptFile == null ? null : Files.readString(Path.of(promptFile), StandardCharsets.UTF_8).trim();
        threads = options.getOrDefault("threads", "2");
        tmp = Path.of(options.getOrDefault("tmp", "out/tmp")).toAbsolutePath();
        Files.createDirectories(tmp);
    }

    @Override
    public String transcribe(byte[] pcm) throws Exception {
        Path wav = Files.createTempFile(tmp, "clip", ".wav");
        try {
            Files.write(wav, wavBytes(pcm));
            List<String> cmd = new ArrayList<>(List.of(cli.toString(), "-m", model.toString(),
                    "-f", wav.toString(), "-l", "en", "-nt", "-np", "-t", threads));
            if (prompt != null && !prompt.isEmpty()) {
                cmd.add("--prompt");
                cmd.add(prompt);
            }
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.environment().put("LD_LIBRARY_PATH", cli.getParent().toString());
            pb.redirectError(ProcessBuilder.Redirect.DISCARD);
            Process p = pb.start();
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
            if (p.waitFor() != 0) {
                throw new IOException("whisper-cli failed");
            }
            return out.replaceAll("\\s+", " ").trim();
        } finally {
            Files.deleteIfExists(wav);
        }
    }

    static byte[] wavBytes(byte[] pcm) {
        ByteBuffer b = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length)
                .put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16)
                .putShort((short) 1).putShort((short) 1).putInt(16000).putInt(32000)
                .putShort((short) 2).putShort((short) 16)
                .put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm);
        return b.array();
    }

    @Override
    public void close() {
        // Nothing is held open between clips.
    }
}
