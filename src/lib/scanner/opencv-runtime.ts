"use client";

const OPEN_CV_READY_EVENT = "scanner:opencv-ready";
const OPEN_CV_READY_POLL_INTERVAL_MS = 50;

interface OpenCvRuntime {
  Mat?: unknown;
  onRuntimeInitialized?: (() => void) | null;
  __scannerHooked?: boolean;
}

interface OpenCvWindow extends Window {
  cv?: OpenCvRuntime;
  __scannerOpenCvReady?: boolean;
}

const getOpenCvWindow = (): OpenCvWindow | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return window as OpenCvWindow;
};

export const getOpenCvRuntime = (): OpenCvRuntime | null => {
  return getOpenCvWindow()?.cv ?? null;
};

export const isOpenCvReady = (): boolean => {
  const openCvWindow = getOpenCvWindow();
  if (!openCvWindow) {
    return false;
  }

  return Boolean(openCvWindow.__scannerOpenCvReady || openCvWindow.cv?.Mat);
};

export const markOpenCvReady = (): boolean => {
  const openCvWindow = getOpenCvWindow();
  if (!openCvWindow?.cv?.Mat) {
    return false;
  }

  if (!openCvWindow.__scannerOpenCvReady) {
    openCvWindow.__scannerOpenCvReady = true;
    openCvWindow.dispatchEvent(new Event(OPEN_CV_READY_EVENT));
  }

  return true;
};

export const ensureOpenCvRuntimeHook = (): boolean => {
  const runtime = getOpenCvRuntime();
  if (!runtime) {
    return false;
  }

  if (runtime.Mat) {
    return markOpenCvReady();
  }

  if (runtime.__scannerHooked) {
    return false;
  }

  const previousHandler = runtime.onRuntimeInitialized;
  runtime.onRuntimeInitialized = () => {
    if (typeof previousHandler === "function") {
      previousHandler();
    }
    markOpenCvReady();
  };
  runtime.__scannerHooked = true;
  return true;
};

export const waitForOpenCvReady = async (timeoutMs: number = 12_000): Promise<boolean> => {
  if (markOpenCvReady()) {
    return true;
  }

  const openCvWindow = getOpenCvWindow();
  if (!openCvWindow) {
    return false;
  }

  ensureOpenCvRuntimeHook();

  return await new Promise<boolean>((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pollId: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      openCvWindow.removeEventListener(OPEN_CV_READY_EVENT, handleReadyEvent);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (pollId) {
        clearInterval(pollId);
      }
    };

    const settle = (ready: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(ready);
    };

    const handleReadyEvent = (): void => {
      settle(true);
    };

    openCvWindow.addEventListener(OPEN_CV_READY_EVENT, handleReadyEvent);

    pollId = setInterval(() => {
      ensureOpenCvRuntimeHook();
      if (markOpenCvReady()) {
        settle(true);
      }
    }, OPEN_CV_READY_POLL_INTERVAL_MS);

    timeoutId = setTimeout(() => {
      settle(markOpenCvReady());
    }, timeoutMs);
  });
};
