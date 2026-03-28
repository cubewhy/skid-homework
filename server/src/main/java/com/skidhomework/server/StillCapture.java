package com.skidhomework.server;

import android.net.LocalSocket;
import android.net.LocalSocketAddress;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * One-shot app_process entrypoint that requests a full-resolution still image from
 * the live camera server and either streams the image bytes over stdout or
 * writes them to a device-local file for a later host-side transfer step.
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
            System.err.println("[StillCapture] Received payload summary: " + describeImageBytes(imageBytes));
            if (config.outputPath != null && !config.outputPath.isEmpty()) {
                writeStillToFile(config.outputPath, imageBytes);
                System.err.println(
                        "[StillCapture] Wrote still payload to "
                                + config.outputPath
                                + " (bytes="
                                + imageBytes.length
                                + ")"
                );
            } else {
                OutputStream outputStream = System.out;
                outputStream.write(imageBytes);
                outputStream.flush();
            }
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

    private static void writeStillToFile(String outputPath, byte[] imageBytes) throws IOException {
        File outputFile = new File(outputPath);
        File parent = outputFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs() && !parent.isDirectory()) {
            throw new IOException("Failed to create still output directory: " + parent.getAbsolutePath());
        }

        try (FileOutputStream outputStream = new FileOutputStream(outputFile, false)) {
            outputStream.write(imageBytes);
            outputStream.flush();
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

    private static Config parseArgs(String[] args) {
        Config config = new Config();

        for (int index = 0; index < args.length; index++) {
            if ("--socket".equals(args[index]) && index + 1 < args.length) {
                config.socketName = args[++index];
            } else if ("--output".equals(args[index]) && index + 1 < args.length) {
                config.outputPath = args[++index];
            } else {
                System.err.println("[StillCapture] Unknown argument: " + args[index]);
            }
        }

        return config;
    }

    private static final class Config {
        String socketName = DEFAULT_SOCKET_NAME;
        String outputPath = null;
    }
}
