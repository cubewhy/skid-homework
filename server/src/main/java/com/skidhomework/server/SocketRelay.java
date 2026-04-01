package com.skidhomework.server;

import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Writes length-prefixed H.264 NAL units to a socket output stream.
 *
 * <p>Each NAL unit is framed as:
 * <pre>
 *   [4 bytes big-endian length] [NAL unit data]
 * </pre>
 *
 * <p>This matches the protocol expected by the Rust stream decoder
 * ({@code stream_decoder.rs}).
 */
public final class SocketRelay {

    private final OutputStream outputStream;
    private final Consumer<StopReason> stopCallback;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    public SocketRelay(OutputStream outputStream, Consumer<StopReason> stopCallback) {
        this.outputStream = outputStream;
        this.stopCallback = stopCallback;
    }

    /**
     * Send a single NAL unit with a 4-byte big-endian length prefix.
     *
     * @param nalData the raw H.264 NAL unit bytes
     * @throws IOException if writing to the socket fails
     */
    public synchronized void sendNalUnit(byte[] nalData) throws IOException {
        if (closed.get()) {
            throw new IOException("socket relay is closed");
        }

        int length = nalData.length;
        byte[] header = new byte[] {
                (byte) ((length >> 24) & 0xFF),
                (byte) ((length >> 16) & 0xFF),
                (byte) ((length >> 8) & 0xFF),
                (byte) (length & 0xFF),
        };

        try {
            // Write the 4-byte big-endian length prefix followed by the NAL unit data.
            // Avoid flushing every packet so the socket buffer can absorb burst traffic.
            outputStream.write(header);
            outputStream.write(nalData);
        } catch (IOException e) {
            System.err.println("[Socket] Failed to write frame to upstream client: " + e.getMessage());
            stopCallback.accept(StopReason.socketWriteFailed("socket write failed: " + e.getMessage()));
            throw e;
        }
    }

    /**
     * Close the underlying socket stream.
     */
    public synchronized void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        try {
            outputStream.close();
        } catch (IOException e) {
            // Ignore cleanup failures.
        }
    }
}
