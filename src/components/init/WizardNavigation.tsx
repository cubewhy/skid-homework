"use client";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

interface WizardNavigationProps {
  currentStep: number;
  totalSteps: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  showSkip?: boolean;
  showAdvanced?: boolean;
  onAdvanced?: () => void;
  finishLabel?: string;
  disableNext?: boolean;
}

export default function WizardNavigation({
  currentStep,
  totalSteps,
  onBack,
  onNext,
  onSkip,
  showSkip = false,
  showAdvanced = false,
  onAdvanced,
  finishLabel,
  disableNext = false,
}: WizardNavigationProps) {
  const { t } = useTranslation("commons", { keyPrefix: "init-page.navigation" });
  const isFirst = currentStep === 0;
  const isLast = currentStep === totalSteps - 1;

  const nextLabel = finishLabel ?? (isLast ? t("finish") : t("next"));

  return (
    <div className="flex items-center justify-between pt-6">
      <Button
        variant="ghost"
        onClick={onBack}
        disabled={isFirst}
        className={isFirst ? "invisible" : ""}
      >
        {t("back")}
      </Button>

      <div className="flex items-center gap-2">
        {showSkip && (
          <Button variant="ghost" onClick={onSkip} className="text-muted-foreground">
            {t("skip")}
          </Button>
        )}
        {showAdvanced && onAdvanced && (
          <Button variant="outline" onClick={onAdvanced}>
            {t("advanced")}
          </Button>
        )}
        <Button onClick={onNext} disabled={disableNext}>
          {nextLabel}
        </Button>
      </div>
    </div>
  );
}
