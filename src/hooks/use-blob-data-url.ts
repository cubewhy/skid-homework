import {useEffect, useState} from "react";

import {readBlobAsDataUrl} from "@/lib/scanner/image-data";

export const useBlobDataUrl = (blob: Blob | null | undefined): string | null => {
  const [resolvedBlobUrl, setResolvedBlobUrl] = useState<{
    blob: Blob;
    dataUrl: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!blob) {
      return;
    }

    void readBlobAsDataUrl(blob)
      .then((nextDataUrl) => {
        if (!cancelled) {
          setResolvedBlobUrl({
            blob,
            dataUrl: nextDataUrl,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedBlobUrl((current) => {
            if (current?.blob === blob) {
              return null;
            }

            return current;
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [blob]);

  if (!blob) {
    return null;
  }

  return resolvedBlobUrl?.blob === blob ? resolvedBlobUrl.dataUrl : null;
};
