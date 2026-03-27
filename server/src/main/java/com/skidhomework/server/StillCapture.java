package com.skidhomework.server;

import android.net.LocalSocket;
import android.net.LocalSocketAddress;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * One-shot app_process entrypoint that requests a full-resolution still image from
 * the live camera server and streams the image bytes back over adb exec-out.
 */
public final class StillCapture {

    private static final String DEFAULT_SOCKET_NAME = "scanner-still";
    private static final byte STATUS_SUCCESS = 0;
    private static final byte STATUS_ERROR = 1;
    private static final int BUFFER_SIZE = 16 * 1024;

    private StillCapture() {
    }

    public static void main(String[] args) {
        Config config = parseArgs(args);

        try {
            byte[] imageBytes = requestStillCapture(config.socketName);
            OutputStream outputStream = System.out;
            outputStream.write(imageBytes);
            outputStream.flush();
        } catch (Throwable throwable) {
            String message = throwable.getMessage() == null ? throwable.toString() : throwable.getMessage();
            System.err.println("[StillCapture] " + message);
            throwable.printStackTrace(System.err);
            System.exit(1);
        }
    }

    private static byte[] requestStillCapture(String socketName) throws IOException {
        LocalSocket socket = new LocalSocket();
        try {
            socket.connect(new LocalSocketAddress(socketName, LocalSocketAddress.Namespace.ABSTRACT));
            InputStream inputStream = socket.getInputStream();
            int status = inputStream.read();
            if (status < 0) {
                throw new IOException("Still capture socket returned no status byte.");
            }

            byte[] payload = readFully(inputStream);
            if (status == STATUS_SUCCESS) {
                if (payload.length == 0) {
                    throw new IOException("Still capture returned an empty payload.");
                }
                return payload;
            }

            String message = new String(payload, StandardCharsets.UTF_8).trim();
            if (message.isEmpty()) {
                message = "Still capture request failed without an error message.";
            }
            if (status == STATUS_ERROR) {
                throw new IOException(message);
            }

            throw new IOException("Still capture returned unknown status " + status + ": " + message);
        } finally {
            try {
                socket.close();
            } catch (IOException e) {
                // Ignore cleanup failures.
            }
        }
    }

    private static byte[] readFully(InputStream inputStream) throws IOException {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        byte[] buffer = new byte[BUFFER_SIZE];
        int read;
        while ((read = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, read);
        }
        return outputStream.toByteArray();
    }

    private static Config parseArgs(String[] args) {
        Config config = new Config();

        for (int index = 0; index < args.length; index++) {
            if ("--socket".equals(args[index]) && index + 1 < args.length) {
                config.socketName = args[++index];
            } else {
                System.err.println("[StillCapture] Unknown argument: " + args[index]);
            }
        }

        return config;
    }

    private static final class Config {
        String socketName = DEFAULT_SOCKET_NAME;
    }
}
