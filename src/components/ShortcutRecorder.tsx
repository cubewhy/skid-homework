import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  formatShortcutLabel,
  buildShortcutFromKeyboardEvent,
} from "@/utils/shortcuts";
import { useTranslation } from "react-i18next";

export interface ShortcutRecorderProps {
  value: string;
  onChange: (value: string) => void;
}

export default function ShortcutRecorder({
  value,
  onChange,
}: ShortcutRecorderProps) {
  const { t } = useTranslation("commons");
  const [recording, setRecording] = useState(false);
  // const [manualValue, setManualValue] = useState(value);
  // const [manualError, setManualError] = useState<string | null>(null);
  const recordingLabel = t("settings-page.shortcuts.recording");
  const unassignedLabel = t("settings-page.shortcuts.unassigned");
  const clearLabel = t("settings-page.shortcuts.clear");
  // const manualPlaceholder = t("settings-page.shortcuts.manual.placeholder");
  // const manualInvalid = t("settings-page.shortcuts.manual.invalid");

  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Block global shortcuts (including Settings page ESC) while recording.
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        onChange("");
        setRecording(false);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        return; // handled on keydown
      }

      const combo = buildShortcutFromKeyboardEvent(event);
      if (!combo) return;

      onChange(combo);
      // setManualValue(combo);
      setRecording(false);
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    window.addEventListener("keyup", handleKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
      window.removeEventListener("keyup", handleKeyUp, { capture: true });
    };
  }, [recording, onChange]);

  // useEffect(() => {
  //   setManualValue(value);
  // }, [value]);

  // const handleManualCommit = useCallback(() => {
  //   const trimmed = manualValue.trim();
  //   if (!trimmed) {
  //     onChange("");
  //     setManualError(null);
  //     return;
  //   }
  //
  //   const parsed = parseShortcutString(trimmed);
  //   if (!parsed) {
  //     setManualError(manualInvalid);
  //     return;
  //   }
  //
  //   onChange(parsed);
  //   setManualValue(parsed);
  //   setManualError(null);
  // }, [manualValue, manualInvalid, onChange]);

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
          // setManualError(null);
        }}
      >
        {recording ? recordingLabel : label || unassignedLabel}
      </Button>
      <Button
        type="button"
        variant="ghost"
        onClick={() => {
          onChange("");
          // setManualValue("");
          // setManualError(null);
        }}
        disabled={!value}
      >
        {clearLabel}
      </Button>
      {/* <div className="flex min-w-[12rem] flex-1 flex-col"> */}
      {/*   <Input */}
      {/*     placeholder={manualPlaceholder} */}
      {/*     value={manualValue} */}
      {/*     onChange={(event) => { */}
      {/*       setManualValue(event.target.value); */}
      {/*       if (manualError) setManualError(null); */}
      {/*     }} */}
      {/*     onBlur={handleManualCommit} */}
      {/*     onKeyDown={(event) => { */}
      {/*       if (event.key === "Enter") { */}
      {/*         event.preventDefault(); */}
      {/*         handleManualCommit(); */}
      {/*       } */}
      {/*       if (event.key === "Escape") { */}
      {/*         event.preventDefault(); */}
      {/*         setManualValue(value); */}
      {/*         setManualError(null); */}
      {/*       } */}
      {/*     }} */}
      {/*   /> */}
      {/*   {manualError ? ( */}
      {/*     <span className="mt-1 text-xs text-destructive">{manualError}</span> */}
      {/*   ) : null} */}
      {/* </div> */}
    </div>
  );
}
