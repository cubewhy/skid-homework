"use client";

import {useEffect} from "react";
import Script from "next/script";

import {ensureOpenCvRuntimeHook, isOpenCvReady, markOpenCvReady,} from "@/lib/scanner/opencv-runtime";

export default function OpenCVLoader() {
  useEffect(() => {
    if (isOpenCvReady()) {
      markOpenCvReady();
      return undefined;
    }

    ensureOpenCvRuntimeHook();

    const pollId = window.setInterval(() => {
      ensureOpenCvRuntimeHook();
      if (markOpenCvReady()) {
        window.clearInterval(pollId);
      }
    }, 50);

    return () => {
      window.clearInterval(pollId);
    };
  }, []);

  return (
    <Script
      id="opencv-js"
      src="/opencv.js"
      strategy="afterInteractive"
      onLoad={() => {
        ensureOpenCvRuntimeHook();
        markOpenCvReady();
      }}
    />
  );
}
