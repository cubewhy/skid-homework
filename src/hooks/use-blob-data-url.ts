import {useEffect, useState} from "react";

export const useBlobDataUrl = (blob: Blob | null | undefined): string | null => {
  const [resolvedBlobUrl, setResolvedBlobUrl] = useState<{
    blob: Blob;
    objectUrl: string;
  } | null>(null);

  useEffect(() => {
    if (!blob) {
      return;
    }

    let cancelled = false;
    const objectUrl = URL.createObjectURL(blob);
    queueMicrotask(() => {
      if (!cancelled) {
        setResolvedBlobUrl({
          blob,
          objectUrl,
        });
      }
    });

    return () => {
      cancelled = true;
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return blob && resolvedBlobUrl?.blob === blob ? resolvedBlobUrl.objectUrl : null;
};
