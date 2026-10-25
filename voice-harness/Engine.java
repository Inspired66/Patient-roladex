import java.nio.file.Path;
import java.util.Map;

/**
 * One speech-recognition engine under test. Implementations are loaded by id in {@link Harness}.
 * Audio is always 16 kHz, mono, 16-bit little-endian PCM. Implementations must not use the network.
 */
public interface Engine extends AutoCloseable {
    /** Stable id used for output folders and the comparison table, e.g. "vosk-small". */
    String id();

    /** Load the model. {@code options} are engine-specific key=value pairs from the command line. */
    void load(Path model, Map<String, String> options) throws Exception;

    /** Transcribe one clip of PCM audio and return plain text. */
    String transcribe(byte[] pcm16k) throws Exception;

    @Override
    void close();
}
