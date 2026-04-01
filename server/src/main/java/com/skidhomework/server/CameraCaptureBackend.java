package com.skidhomework.server;

import java.io.OutputStream;

interface CameraCaptureBackend {
    void start() throws Exception;

    void stop();

    byte[] captureStillJpeg() throws Exception;

    void streamStillJpeg(OutputStream outputStream) throws Exception;
}
