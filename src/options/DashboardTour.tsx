import { CSSProperties, JSX, useCallback, useEffect, useMemo, useState } from 'react';

export type DashboardTourStep = {
  id: string;
  targetId: string;
  title: string;
  description: string;
  reason: string;
};

type DashboardTourProps = {
  steps: DashboardTourStep[];
  isOpen: boolean;
  activeStepIndex: number;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
  onFinish: () => void;
};

type SpotlightFrame = {
  top: number;
  left: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
};

const TOOLTIP_WIDTH = 360;
const TOOLTIP_SAFE_OFFSET = 16;
const TOOLTIP_VERTICAL_GAP = 14;
const TOOLTIP_APPROX_HEIGHT = 248;
const SPOTLIGHT_PADDING = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const getTargetElement = (step: DashboardTourStep): HTMLElement | null =>
  document.getElementById(step.targetId);

const createSpotlightFrame = (
  element: HTMLElement,
  viewportWidth: number,
  viewportHeight: number
): SpotlightFrame => {
  const rect = element.getBoundingClientRect();
  const top = clamp(rect.top - SPOTLIGHT_PADDING, 0, viewportHeight);
  const left = clamp(rect.left - SPOTLIGHT_PADDING, 0, viewportWidth);
  const maxWidth = Math.max(0, viewportWidth - left);
  const maxHeight = Math.max(0, viewportHeight - top);
  const width = clamp(rect.width + SPOTLIGHT_PADDING * 2, 0, maxWidth);
  const height = clamp(rect.height + SPOTLIGHT_PADDING * 2, 0, maxHeight);

  return {
    top,
    left,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
};

export default function DashboardTour({
  steps,
  isOpen,
  activeStepIndex,
  onBack,
  onNext,
  onClose,
  onFinish,
}: DashboardTourProps): JSX.Element | null {
  const [spotlightFrame, setSpotlightFrame] = useState<SpotlightFrame | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const safeStepIndex = useMemo(
    () => clamp(activeStepIndex, 0, Math.max(steps.length - 1, 0)),
    [activeStepIndex, steps.length]
  );
  const activeStep = steps[safeStepIndex];
  const isLastStep = safeStepIndex === steps.length - 1;

  const updateSpotlight = useCallback(() => {
    if (!isOpen || !activeStep) {
      setSpotlightFrame(null);
      return;
    }

    const targetElement = getTargetElement(activeStep);
    if (!targetElement) {
      setSpotlightFrame(null);
      return;
    }

    setSpotlightFrame(
      createSpotlightFrame(targetElement, window.innerWidth, window.innerHeight)
    );
  }, [activeStep, isOpen]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

    updatePreference();
    mediaQuery.addEventListener('change', updatePreference);
    return () => {
      mediaQuery.removeEventListener('change', updatePreference);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !activeStep) {
      setSpotlightFrame(null);
      return undefined;
    }

    const targetElement = getTargetElement(activeStep);
    if (!targetElement) {
      setSpotlightFrame(null);
      return undefined;
    }

    targetElement.scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'nearest',
    });

    const frameId = window.requestAnimationFrame(updateSpotlight);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activeStep, isOpen, prefersReducedMotion, updateSpotlight]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleLayoutUpdate = () => updateSpotlight();

    window.addEventListener('resize', handleLayoutUpdate);
    window.addEventListener('scroll', handleLayoutUpdate, true);

    return () => {
      window.removeEventListener('resize', handleLayoutUpdate);
      window.removeEventListener('scroll', handleLayoutUpdate, true);
    };
  }, [isOpen, updateSpotlight]);

  useEffect(() => {
    if (!isOpen || !activeStep) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onBack();
        return;
      }

      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        if (isLastStep) {
          onFinish();
          return;
        }

        onNext();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeStep, isLastStep, isOpen, onBack, onClose, onFinish, onNext]);

  if (!isOpen || !activeStep || steps.length === 0) {
    return null;
  }

  const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;
  const availableWidth = Math.max(0, viewportWidth - TOOLTIP_SAFE_OFFSET * 2);
  const cardWidth = Math.min(TOOLTIP_WIDTH, availableWidth);
  const hasSpotlight = Boolean(spotlightFrame);

  const cardStyle: CSSProperties = hasSpotlight
    ? (() => {
        const frame = spotlightFrame as SpotlightFrame;
        const maxLeft = Math.max(
          TOOLTIP_SAFE_OFFSET,
          viewportWidth - cardWidth - TOOLTIP_SAFE_OFFSET
        );
        const left = clamp(
          frame.left + frame.width / 2 - cardWidth / 2,
          TOOLTIP_SAFE_OFFSET,
          maxLeft
        );

        const shouldRenderBelow =
          viewportHeight - frame.bottom > frame.top || frame.top < 210;
        const maxTop = Math.max(
          TOOLTIP_SAFE_OFFSET,
          viewportHeight - TOOLTIP_APPROX_HEIGHT - TOOLTIP_SAFE_OFFSET
        );
        const top = clamp(
          shouldRenderBelow
            ? frame.bottom + TOOLTIP_VERTICAL_GAP
            : frame.top - TOOLTIP_APPROX_HEIGHT - TOOLTIP_VERTICAL_GAP,
          TOOLTIP_SAFE_OFFSET,
          maxTop
        );

        return {
          width: cardWidth,
          left,
          top,
        };
      })()
    : {
        width: cardWidth,
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      };

  return (
    <div className='tour-root' aria-live='polite'>
      {hasSpotlight ? (
        <>
          <button
            type='button'
            aria-label='Skip dashboard walkthrough'
            className='tour-scrim-panel'
            onClick={onClose}
            style={{
              top: 0,
              left: 0,
              width: viewportWidth,
              height: spotlightFrame?.top,
            }}
          />
          <button
            type='button'
            aria-label='Skip dashboard walkthrough'
            className='tour-scrim-panel'
            onClick={onClose}
            style={{
              top: spotlightFrame?.top,
              left: 0,
              width: spotlightFrame?.left,
              height: spotlightFrame?.height,
            }}
          />
          <button
            type='button'
            aria-label='Skip dashboard walkthrough'
            className='tour-scrim-panel'
            onClick={onClose}
            style={{
              top: spotlightFrame?.top,
              left: spotlightFrame?.right,
              width: Math.max(0, viewportWidth - (spotlightFrame?.right ?? 0)),
              height: spotlightFrame?.height,
            }}
          />
          <button
            type='button'
            aria-label='Skip dashboard walkthrough'
            className='tour-scrim-panel'
            onClick={onClose}
            style={{
              top: spotlightFrame?.bottom,
              left: 0,
              width: viewportWidth,
              height: Math.max(0, viewportHeight - (spotlightFrame?.bottom ?? 0)),
            }}
          />
          <div
            className='tour-spotlight'
            aria-hidden='true'
            style={{
              top: spotlightFrame?.top,
              left: spotlightFrame?.left,
              width: spotlightFrame?.width,
              height: spotlightFrame?.height,
            }}
          />
        </>
      ) : (
        <button
          type='button'
          aria-label='Skip dashboard walkthrough'
          className='tour-scrim-panel'
          onClick={onClose}
          style={{ top: 0, left: 0, width: viewportWidth, height: viewportHeight }}
        />
      )}

      <section
        className='tour-card'
        role='dialog'
        aria-modal='true'
        aria-label='Dashboard walkthrough'
        style={cardStyle}>
        <p className='tour-step-count'>
          {safeStepIndex + 1} / {steps.length}
        </p>
        <h2 className='tour-step-title'>{activeStep.title}</h2>
        <p className='tour-step-description'>{activeStep.description}</p>
        <p className='tour-step-reason'>Why this exists: {activeStep.reason}</p>
        {!hasSpotlight ? (
          <p className='tour-step-note'>
            This section is currently hidden by your filters or screen size.
          </p>
        ) : null}

        <div className='tour-actions'>
          <button
            type='button'
            onClick={onBack}
            className='tour-btn tour-btn-secondary'
            disabled={safeStepIndex === 0}>
            Back
          </button>
          <button
            type='button'
            onClick={onClose}
            className='tour-btn tour-btn-secondary'>
            Skip
          </button>
          <button type='button' onClick={isLastStep ? onFinish : onNext} className='tour-btn tour-btn-primary'>
            {isLastStep ? 'Finish' : 'Next'}
          </button>
        </div>
      </section>
    </div>
  );
}
