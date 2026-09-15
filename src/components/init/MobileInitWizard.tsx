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

const MOBILE_TOTAL_STEPS = 3;

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

export default function MobileInitWizard() {
  const currentStep = useInitStore((s) => s.currentStep);
  const direction = useInitStore((s) => s.direction);
  const setCurrentStep = useInitStore((s) => s.setCurrentStep);
  const setInitCompleted = useInitStore((s) => s.setInitCompleted);
  const { t } = useTranslation("commons", { keyPrefix: "init-page.navigation" });
  const router = useRouter();

  const { sourceModelsMap, allModels, isLoading, fetchErrors, hasFetched } = useAvailableModels();
  const hasValidConfig = allModels.length > 0;

  const clampedStep = Math.min(currentStep, MOBILE_TOTAL_STEPS - 1);

  const completeWizard = useCallback(() => {
    setInitCompleted(true);
    router.replace("/");
  }, [setInitCompleted, router]);

  const handleNext = useCallback(() => {
    if (clampedStep >= MOBILE_TOTAL_STEPS - 1) {
      completeWizard();
    } else {
      setCurrentStep(clampedStep + 1);
    }
  }, [clampedStep, setCurrentStep, completeWizard]);

  const handleBack = useCallback(() => {
    if (clampedStep > 0) {
      setCurrentStep(clampedStep - 1);
    }
  }, [clampedStep, setCurrentStep]);

  const handleSkip = useCallback(() => {
    setCurrentStep(clampedStep + 1);
  }, [clampedStep, setCurrentStep]);

  const stepContent = useMemo(() => {
    switch (clampedStep) {
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
      default:
        return <WelcomeStep />;
    }
  }, [clampedStep, sourceModelsMap, allModels, isLoading, fetchErrors, hasFetched]);

  return (
    <div className="flex h-full flex-col bg-background px-6 pb-8 pt-8">
      <StepIndicator totalSteps={MOBILE_TOTAL_STEPS} currentStep={clampedStep} />

      <div className="mt-6 flex-1">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={clampedStep}
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
        currentStep={clampedStep}
        totalSteps={MOBILE_TOTAL_STEPS}
        onBack={handleBack}
        onNext={handleNext}
        onSkip={handleSkip}
        showSkip={clampedStep === 1}
        showAdvanced={false}
        finishLabel={clampedStep === MOBILE_TOTAL_STEPS - 1 ? t("finish") : undefined}
        disableNext={clampedStep === 1 && hasFetched && !hasValidConfig && !isLoading}
      />
    </div>
  );
}
