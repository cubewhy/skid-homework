import { useCallback, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import {
  Camera,
  CameraDirection,
  CameraResultType,
  CameraSource,
  type Photo,
} from "@capacitor/camera";

const convertToFile = async (photo: Photo): Promise<File | null> => {
  const url = photo.webPath ?? photo.path;
  if (!url) return null;

  const response = await fetch(url);
  const blob = await response.blob();
  const extension = blob.type.split("/")[1] ?? "jpeg";

  const filename =
    photo.path?.split("/").pop() ?? `photo-${Date.now()}.${extension}`;

  return new File([blob], filename, { type: blob.type });
};

const ensurePermissions = async (): Promise<boolean> => {
  const status = await Camera.checkPermissions();
  const granted = status.camera === "granted" || status.photos === "granted";
  if (granted) return true;

  const requested = await Camera.requestPermissions({
    permissions: ["camera", "photos"],
  });
  return requested.camera === "granted" || requested.photos === "granted";
};

export const useNativeCamera = () => {
  const isNative = useMemo(() => Capacitor.isNativePlatform(), []);

  const capture = useCallback(async (): Promise<File[]> => {
    if (!isNative) {
      return [];
    }

    const allowed = await ensurePermissions();
    if (!allowed) {
      return [];
    }

    const photo = await Camera.getPhoto({
      source: CameraSource.Prompt,
      resultType: CameraResultType.Uri,
      quality: 85,
      saveToGallery: false,
      direction: CameraDirection.Rear,
      presentationStyle: "popover",
    });

    const file = await convertToFile(photo);
    return file ? [file] : [];
  }, [isNative]);

  return { isNative, capture };
};
