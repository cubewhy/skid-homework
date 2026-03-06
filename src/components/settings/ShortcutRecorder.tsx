import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { buildShortcutFromKeyboardEvent, formatShortcutLabel } from "@/utils/shortcuts";
import { useTranslation } from "react-i18next";

export interface ShortcutRecorderProps {
  value: string;
  onChange: (value: string) => void;
  isRecording?: boolean;
  onRecordingChange?: (state: boolean) => void;
}

export default function ShortcutRecorder({
  value,
  onChange,
  isRecording,
  onRecordingChange,
}: ShortcutRecorderProps) {
  const { t } = useTranslation("commons");
  const [recording, setRecording] = useState(isRecording ?? false);

  const recordingLabel = t("settings-page.shortcuts.recording");
  const unassignedLabel = t("settings-page.shortcuts.unassigned");
  const clearLabel = t("settings-page.shortcuts.clear");

  useEffect(() => {
    onRecordingChange?.(recording)
  }, [onRecordingChange, recording]);

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        return;
      }

      const combo = buildShortcutFromKeyboardEvent(event);
      if (!combo) return;

      onChange(combo);
      setRecording(false);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [recording, onChange, setRecording]);

  const label = formatShortcutLabel(value);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap sm:items-center">
      <Button
        type="button"
        variant={recording ? "destructive" : "outline"}
        onKeyDown={(e) => {
          // Prevent back to main page when recording
          if (recording) e.stopPropagation();
        }}
        onClick={() => {
          setRecording((prev) => !prev);
        }}
        onBlur={() => setRecording(false)}
      >
        {recording ? recordingLabel : label || unassignedLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          onChange("");
        }}
        disabled={!value}
      >
        {clearLabel}
      </Button>
    </div>
  );
}
