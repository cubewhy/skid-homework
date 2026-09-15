import Script from "next/script";

export default function ImagePostProcessLoader() {
  return <Script src="/opencv.js" strategy="afterInteractive" />;
}
