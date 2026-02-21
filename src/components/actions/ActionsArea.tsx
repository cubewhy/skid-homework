import { Loader2Icon, Trash2 } from "lucide-react";
import { Button } from "../ui/button";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProblemsStore } from "@/store/problems-store";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useShortcut } from "@/hooks/use-shortcut";
import { ShortcutHint } from "../ShortcutHint";
import GlobalTraitsEditor from "./GlobalTraitsEditor";

export type ActionsAreaProps = {
  startScan: () => Promise<void>;
  stopScan?: () => void;
  clearAll: () => void;
  itemsLength: number;
  layout?: "default" | "mobile";
};

export default function ActionsArea({
  startScan,
  stopScan,
  itemsLength,
  clearAll,
  layout = "default",
}: ActionsAreaProps) {
  const { t } = useTranslation("commons", { keyPrefix: "actions" });
  const isMobileLayout = layout === "mobile";

  const isWorking = useProblemsStore((s) => s.isWorking);
  const handleSkidBtnClicked = useCallback(() => {
    if (isWorking) {
      stopScan?.();
      return;
    }
    startScan();
  }, [isWorking, startScan, stopScan]);

  const clearAllBtnRef = useRef<HTMLButtonElement | null>(null);
  const skidBtnRef = useRef<HTMLButtonElement | null>(null);

  const [confirmedClear, setConfirmedClear] = useState(false);

  const handleClearAll = useCallback(() => {
    if (confirmedClear) {
      clearAll();
      setConfirmedClear(false);
    } else {
      setConfirmedClear(true);
    }
  }, [clearAll, confirmedClear]);

  useEffect(() => {
    if (!confirmedClear) return; // do not modify the variable if it is already false
    const timeoutId = setTimeout(() => {
      setConfirmedClear(false);
    }, 3000);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [confirmedClear, setConfirmedClear]);

  const scanShortcut = useShortcut(
    "startScan",
    () => skidBtnRef.current?.click(),
    [],
  );

  const clearShortcut = useShortcut(
    "clearAll",
    () => clearAllBtnRef.current?.click(),
    [confirmedClear],
  );

  return (
    <div
      className={cn("flex gap-2 flex-wrap", isMobileLayout && "flex-col gap-3")}
    >
      <GlobalTraitsEditor
        className={cn(
          "flex-1 items-center justify-center",
          isMobileLayout && "py-6 text-base",
        )}
      />

      <Button
        ref={clearAllBtnRef}
        variant="destructive"
        className={cn(
          "flex-1 items-center justify-center",
          isMobileLayout && "py-6 text-base",
        )}
        size={isMobileLayout ? "lg" : "default"}
        disabled={itemsLength === 0 || isWorking}
        onClick={handleClearAll}
      >
        <span className="flex items-center gap-2">
          <Trash2 className="h-5 w-5 shrink-0" />
          {!confirmedClear ? t("clear-all") : t("clear-confirmation")}
        </span>
        {!isMobileLayout && <ShortcutHint shortcut={clearShortcut} />}
      </Button>
      <Button
        ref={skidBtnRef}
        className={cn(
          "flex-1 items-center justify-center gap-2",
          isMobileLayout && "py-6 text-base",
        )}
        size={isMobileLayout ? "lg" : "default"}
        disabled={itemsLength === 0 || isWorking}
        onClick={handleSkidBtnClicked}
      >
        {isWorking ? (
          <>
            <Loader2Icon className="h-5 w-5 animate-spin" /> {t("stop")}
          </>
        ) : (
          <>
            {t("scan")}{" "}
            {!isMobileLayout && <ShortcutHint shortcut={scanShortcut} />}
          </>
        )}
      </Button>
    </div>
  );
}
