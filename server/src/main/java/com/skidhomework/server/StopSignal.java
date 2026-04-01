package com.skidhomework.server;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Allows multiple asynchronous components to request a single coordinated stop.
 */
final class StopSignal {

    private final CountDownLatch latch = new CountDownLatch(1);
    private final AtomicBoolean requested = new AtomicBoolean(false);
    private final AtomicReference<StopReason> reason = new AtomicReference<>(
            StopReason.fatal("session stopped without a reason")
    );

    public void request(StopReason stopReason) {
        if (stopReason == null) {
            stopReason = StopReason.fatal("session stopped with a null reason");
        }

        if (requested.compareAndSet(false, true)) {
            reason.set(stopReason);
            latch.countDown();
        }
    }

    public void await() throws InterruptedException {
        latch.await();
    }

    public StopReason getReason() {
        return reason.get();
    }

    public boolean isRequested() {
        return requested.get();
    }
}
