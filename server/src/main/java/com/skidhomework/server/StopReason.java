package com.skidhomework.server;

/**
 * Describes why the current streaming session stopped and whether a bounded
 * in-process recovery attempt should be made.
 */
final class StopReason {

    private final String code;
    private final String message;
    private final boolean recoverable;

    private StopReason(String code, String message, boolean recoverable) {
        this.code = code;
        this.message = message;
        this.recoverable = recoverable;
    }

    public static StopReason processShutdown() {
        return new StopReason("process_shutdown", "process shutdown", false);
    }

    public static StopReason socketClosed(String message) {
        return new StopReason("socket_closed", sanitize(message, "socket closed"), false);
    }

    public static StopReason socketWriteFailed(String message) {
        return new StopReason(
                "socket_write_failed",
                sanitize(message, "socket write failed"),
                false
        );
    }

    public static StopReason cameraDisconnected() {
        return new StopReason("camera_disconnected", "camera disconnected", true);
    }

    public static StopReason cameraError(int error) {
        return new StopReason("camera_error", "camera error: " + error, true);
    }

    public static StopReason cameraSessionFailed(String message) {
        return new StopReason(
                "camera_session_failed",
                sanitize(message, "camera session failed"),
                true
        );
    }

    public static StopReason cameraStartFailed(String message) {
        return new StopReason(
                "camera_start_failed",
                sanitize(message, "camera start failed"),
                true
        );
    }

    public static StopReason cameraEnvironmentBlocked(String message) {
        return new StopReason(
                "camera_environment_blocked",
                sanitize(message, "camera environment blocked"),
                false
        );
    }

    public static StopReason encoderFailed(String message) {
        return new StopReason(
                "encoder_failed",
                sanitize(message, "encoder failed"),
                true
        );
    }

    public static StopReason encoderEndOfStream() {
        return new StopReason("encoder_eos", "encoder reached end of stream", true);
    }

    public static StopReason fatal(String message) {
        return new StopReason("fatal", sanitize(message, "fatal error"), false);
    }

    public boolean isRecoverable() {
        return recoverable;
    }

    public boolean isCameraRecoveryCandidate() {
        return "camera_disconnected".equals(code)
                || "camera_error".equals(code)
                || "camera_session_failed".equals(code)
                || "camera_start_failed".equals(code);
    }

    public boolean isEncoderRecoveryCandidate() {
        return "encoder_failed".equals(code) || "encoder_eos".equals(code);
    }

    public boolean isSocketTerminal() {
        return "socket_closed".equals(code) || "socket_write_failed".equals(code);
    }

    public String getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }

    @Override
    public String toString() {
        return code + ": " + message;
    }

    private static String sanitize(String value, String fallback) {
        if (value == null) {
            return fallback;
        }

        String trimmed = value.trim();
        return trimmed.isEmpty() ? fallback : trimmed;
    }
}
