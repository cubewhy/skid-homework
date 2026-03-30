package com.skidhomework.server;

import java.io.IOException;

interface PreviewStreamEncoder {
    void start();

    void awaitFirstFrame(long timeoutMs) throws InterruptedException, IOException;

    void stop();
}
