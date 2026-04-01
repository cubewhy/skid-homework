package com.skidhomework.server;

import android.net.LocalSocket;

import java.io.IOException;
import java.io.InputStream;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

/**
 * Watches the client side of the local socket so the server can shut down
 * promptly when the upstream ADB tunnel disappears.
 */
final class SocketConnectionMonitor {

    private final LocalSocket socket;
    private final Consumer<StopReason> stopCallback;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private Thread monitorThread;

    SocketConnectionMonitor(LocalSocket socket, Consumer<StopReason> stopCallback) {
        this.socket = socket;
        this.stopCallback = stopCallback;
    }

    public void start() throws IOException {
        final InputStream inputStream = socket.getInputStream();

        monitorThread = new Thread(() -> monitorLoop(inputStream), "SocketConnectionMonitor");
        monitorThread.setDaemon(true);
        monitorThread.start();
    }

    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        try {
            socket.shutdownInput();
        } catch (IOException | RuntimeException e) {
            // Ignore local shutdown failures during cleanup.
        }

        if (monitorThread != null) {
            monitorThread.interrupt();
            try {
                monitorThread.join(250);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void monitorLoop(InputStream inputStream) {
        byte[] buffer = new byte[1];

        try {
            while (!closed.get()) {
                int read = inputStream.read(buffer);
                if (read < 0) {
                    System.err.println("[Socket] Upstream client disconnected.");
                    stopCallback.accept(StopReason.socketClosed("client disconnected"));
                    return;
                }

                // The transport is server-to-client only. Ignore any unexpected input and
                // keep waiting for EOF or a socket read failure.
            }
        } catch (IOException e) {
            if (!closed.get()) {
                System.err.println("[Socket] Upstream client read failed: " + e.getMessage());
                stopCallback.accept(
                        StopReason.socketClosed("client socket read failed: " + e.getMessage())
                );
            }
        }
    }
}
