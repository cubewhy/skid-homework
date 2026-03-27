package com.skidhomework.server;

import android.net.LocalServerSocket;
import android.net.LocalSocket;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Device-local control socket used to request a full-resolution still image from
 * the already-running camera server process.
 */
final class StillCaptureSocketServer implements AutoCloseable {

    interface StillCaptureProvider {
        byte[] captureStill() throws Exception;
    }

    private static final byte STATUS_SUCCESS = 0;
    private static final byte STATUS_ERROR = 1;

    private final String socketName;
    private final StillCaptureProvider provider;
    private final AtomicBoolean closed = new AtomicBoolean(false);

    private LocalServerSocket serverSocket;
    private Thread acceptThread;

    StillCaptureSocketServer(String socketName, StillCaptureProvider provider) {
        this.socketName = socketName;
        this.provider = provider;
    }

    void start() {
        acceptThread = new Thread(this::runAcceptLoop, "StillCaptureSocketServer");
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
            System.out.println("[StillCapture] Listening on socket " + socketName + ".");

            while (!closed.get()) {
                LocalSocket clientSocket = null;
                try {
                    clientSocket = localServerSocket.accept();
                    handleClient(clientSocket);
                } catch (IOException e) {
                    if (!closed.get()) {
                        System.err.println("[StillCapture] Accept failed: " + e.getMessage());
                    }
                    closeQuietly(clientSocket);
                }
            }
        } catch (IOException e) {
            if (!closed.get()) {
                System.err.println("[StillCapture] Server startup failed: " + e.getMessage());
            }
        } finally {
            closeQuietly(localServerSocket);
            serverSocket = null;
        }
    }

    private void handleClient(LocalSocket clientSocket) {
        try {
            clientSocket.setSendBufferSize(1024 * 1024);
            OutputStream outputStream = clientSocket.getOutputStream();
            try {
                byte[] imageBytes = provider.captureStill();
                if (imageBytes == null || imageBytes.length == 0) {
                    throw new IllegalStateException("Still capture provider returned no image bytes.");
                }

                outputStream.write(STATUS_SUCCESS);
                outputStream.write(imageBytes);
            } catch (Exception e) {
                String message = e.getMessage() == null ? e.toString() : e.getMessage();
                outputStream.write(STATUS_ERROR);
                outputStream.write(message.getBytes(StandardCharsets.UTF_8));
            }
            outputStream.flush();
        } catch (IOException e) {
            if (!closed.get()) {
                System.err.println("[StillCapture] Client handling failed: " + e.getMessage());
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
}
