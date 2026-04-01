package com.skidhomework.server;

import android.net.LocalServerSocket;
import android.net.LocalSocket;

import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Dedicated device-local socket for high-throughput still streaming.
 *
 * <p>Unlike the legacy still socket, success responses are raw JPEG bytes with no leading
 * status byte so the host can start receiving the image stream immediately.
 */
final class StillCaptureStreamSocketServer implements AutoCloseable {

    interface StillCaptureStreamProvider {
        void streamStill(OutputStream outputStream) throws Exception;
    }

    private static final int SOCKET_SEND_BUFFER_BYTES = 4 * 1024 * 1024;
    private static final int OUTPUT_BUFFER_BYTES = 256 * 1024;

    private final String socketName;
    private final StillCaptureStreamProvider provider;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private LocalServerSocket serverSocket;
    private Thread acceptThread;

    StillCaptureStreamSocketServer(String socketName, StillCaptureStreamProvider provider) {
        this.socketName = socketName;
        this.provider = provider;
    }

    void start() {
        acceptThread = new Thread(this::runAcceptLoop, "StillCaptureStreamSocketServer");
        acceptThread.setDaemon(true);
        acceptThread.start();
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        closeQuietly(serverSocket);
        if (acceptThread != null) {
            acceptThread.interrupt();
        }
    }

    private void runAcceptLoop() {
        LocalServerSocket localServerSocket = null;
        try {
            localServerSocket = new LocalServerSocket(socketName);
            serverSocket = localServerSocket;
            System.out.println("[StillStream] Listening on socket " + socketName + ".");

            while (!closed.get()) {
                LocalSocket clientSocket = null;
                try {
                    clientSocket = localServerSocket.accept();
                    handoffClient(clientSocket);
                    clientSocket = null;
                } catch (IOException e) {
                    if (!closed.get()) {
                        System.err.println("[StillStream] Accept failed: " + e.getMessage());
                    }
                    closeQuietly(clientSocket);
                }
            }
        } catch (IOException e) {
            if (!closed.get()) {
                System.err.println("[StillStream] Server startup failed: " + e.getMessage());
            }
        } finally {
            closeQuietly(localServerSocket);
            serverSocket = null;
        }
    }

    private void handoffClient(LocalSocket clientSocket) {
        Thread clientThread = new Thread(
                () -> handleClient(clientSocket),
                "StillCaptureStreamClient-" + System.nanoTime()
        );
        clientThread.setDaemon(true);
        clientThread.start();
    }

    private void handleClient(LocalSocket clientSocket) {
        try {
            clientSocket.setSendBufferSize(SOCKET_SEND_BUFFER_BYTES);
            BufferedOutputStream bufferedOutputStream = new BufferedOutputStream(
                    clientSocket.getOutputStream(),
                    OUTPUT_BUFFER_BYTES
            );
            CountingOutputStream countingOutputStream = new CountingOutputStream(bufferedOutputStream);

            try {
                provider.streamStill(countingOutputStream);
                countingOutputStream.flush();
                System.out.println(
                        "[StillStream] Completed streaming still payload (bytes="
                                + countingOutputStream.getBytesWritten()
                                + ")."
                );
            } catch (Exception e) {
                String message = e.getMessage() == null ? e.toString() : e.getMessage();
                if (countingOutputStream.getBytesWritten() == 0) {
                    bufferedOutputStream.write(message.getBytes(StandardCharsets.UTF_8));
                    bufferedOutputStream.flush();
                }
                System.err.println("[StillStream] Client handling failed: " + message);
            }
        } catch (IOException e) {
            if (!closed.get()) {
                System.err.println("[StillStream] Socket I/O failed: " + e.getMessage());
            }
        } finally {
            closeQuietly(clientSocket);
        }
    }

    private static void closeQuietly(LocalSocket socket) {
        if (socket == null) {
            return;
        }

        try {
            socket.close();
        } catch (IOException e) {
            // Ignore cleanup failures.
        }
    }

    private static void closeQuietly(LocalServerSocket socket) {
        if (socket == null) {
            return;
        }

        try {
            socket.close();
        } catch (IOException e) {
            // Ignore cleanup failures.
        }
    }

    private static final class CountingOutputStream extends OutputStream {
        private final OutputStream delegate;
        private long bytesWritten = 0L;

        CountingOutputStream(OutputStream delegate) {
            this.delegate = delegate;
        }

        @Override
        public void write(int b) throws IOException {
            delegate.write(b);
            bytesWritten += 1L;
        }

        @Override
        public void write(byte[] b) throws IOException {
            delegate.write(b);
            bytesWritten += b.length;
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            delegate.write(b, off, len);
            bytesWritten += len;
        }

        @Override
        public void flush() throws IOException {
            delegate.flush();
        }

        long getBytesWritten() {
            return bytesWritten;
        }
    }
}
