"use client";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useInitStore } from "@/store/init-store";
import { useAvailableModels } from "@/hooks/use-available-models";
import StepIndicator from "./StepIndicator";
import WizardNavigation from "./WizardNavigation";
import WelcomeStep from "./steps/WelcomeStep";
import AiConfigStep from "./steps/AiConfigStep";
import PreferencesStep from "./steps/PreferencesStep";
import AdvancedStep from "./steps/AdvancedStep";

const TOTAL_STEPS = 4;

const variants = {
  enter: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? 24 : -24,
  }),
  center: {
    opacity: 1,
    y: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    y: direction > 0 ? -24 : 24,
  }),
};

const transition = {
  duration: 0.25,
  ease: [0.25, 0.1, 0.25, 1] as const,
};

export default function InitWizard() {
  const currentStep = useInitStore((s) => s.currentStep);
  const direction = useInitStore((s) => s.direction);
  const nextStep = useInitStore((s) => s.nextStep);
  const prevStep = useInitStore((s) => s.prevStep);
  const setInitCompleted = useInitStore((s) => s.setInitCompleted);
  const { t } = useTranslation("commons", { keyPrefix: "init-page.navigation" });
  const router = useRouter();

  // Lift model fetching to share between steps
  const { sourceModelsMap, allModels, isLoading, fetchErrors, hasFetched } = useAvailableModels();
  const hasValidConfig = allModels.length > 0;

  const completeWizard = useCallback(() => {
    setInitCompleted(true);
    router.replace("/");
  }, [setInitCompleted, router]);

  const handleNext = useCallback(() => {
    if (currentStep >= 2) {
      // Steps 2 (Preferences) and 3 (Advanced) both finish the wizard
      completeWizard();
    } else {
      nextStep();
    }
  }, [currentStep, nextStep, completeWizard]);

  const handleSkip = useCallback(() => {
    // Skip only applies to step 1 (AI Config), advances to step 2
    nextStep();
  }, [nextStep]);

  const stepContent = useMemo(() => {
    switch (currentStep) {
      case 0:
        return <WelcomeStep />;
      case 1:
        return <AiConfigStep allModels={allModels} isLoadingModels={isLoading} fetchErrors={fetchErrors} hasFetched={hasFetched} />;
      case 2:
        return (
          <PreferencesStep
            sourceModelsMap={sourceModelsMap}
            allModels={allModels}
            isLoadingModels={isLoading}
          />
        );
      case 3:
        return (
          <AdvancedStep
            sourceModelsMap={sourceModelsMap}
            allModels={allModels}
            isLoadingModels={isLoading}
          />
        );
      default:
        return <WelcomeStep />;
    }
  }, [currentStep, sourceModelsMap, allModels, isLoading, fetchErrors, hasFetched]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl rounded-xl border bg-card p-8 shadow-md">
        <StepIndicator totalSteps={TOTAL_STEPS} currentStep={currentStep} />

        <div className="mt-6 min-h-[360px]">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={currentStep}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={transition}
            >
              {stepContent}
            </motion.div>
          </AnimatePresence>
        </div>

        <WizardNavigation
          currentStep={currentStep}
          totalSteps={TOTAL_STEPS}
          onBack={prevStep}
          onNext={handleNext}
          onSkip={handleSkip}
          showSkip={currentStep === 1}
          showAdvanced={currentStep === 2}
          onAdvanced={() => nextStep()}
          finishLabel={currentStep >= 2 ? t("finish") : undefined}
          disableNext={currentStep === 1 && hasFetched && !hasValidConfig && !isLoading}
        />
      </div>
    </div>
  );
}
