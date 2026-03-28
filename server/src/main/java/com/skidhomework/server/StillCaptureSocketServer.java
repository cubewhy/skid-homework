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

                System.out.println("[StillCapture] Socket payload summary: " + describeImageBytes(imageBytes));

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

    private static String describeImageBytes(byte[] bytes) {
        return "len="
                + bytes.length
                + " head=["
                + describeHexWindow(bytes, 16, false)
                + "] tail=["
                + describeHexWindow(bytes, 16, true)
                + "] firstSOI="
                + findMarkerOffset(bytes, (byte) 0xff, (byte) 0xd8, false)
                + " lastEOI="
                + findMarkerOffset(bytes, (byte) 0xff, (byte) 0xd9, true);
    }

    private static String describeHexWindow(byte[] bytes, int count, boolean fromEnd) {
        if (bytes.length == 0) {
            return "∅";
        }

        int safeCount = Math.max(1, Math.min(count, bytes.length));
        int start = fromEnd ? bytes.length - safeCount : 0;
        int end = start + safeCount;
        StringBuilder builder = new StringBuilder();
        for (int index = start; index < end; index++) {
            if (builder.length() > 0) {
                builder.append(' ');
            }
            builder.append(String.format("%02x", bytes[index] & 0xff));
        }
        return builder.toString();
    }

    private static Integer findMarkerOffset(byte[] bytes, byte high, byte low, boolean fromEnd) {
        if (bytes.length < 2) {
            return null;
        }

        if (fromEnd) {
            for (int index = bytes.length - 2; index >= 0; index--) {
                if (bytes[index] == high && bytes[index + 1] == low) {
                    return index;
                }
            }
            return null;
        }

        for (int index = 0; index < bytes.length - 1; index++) {
            if (bytes[index] == high && bytes[index + 1] == low) {
                return index;
            }
        }
        return null;
    }
}
