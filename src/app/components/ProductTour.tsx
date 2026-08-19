import React, { useState, useEffect } from 'react';
import { X, ChevronRight, ChevronLeft, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import DotletLogo from '../../imports/DotletLogo-1';

const TOUR_OFFERED_KEY = 'dotlet_tour_offered';

// ── Welcome modal ────────────────────────────────────────────────────────────

export function TourWelcomeModal({
  onStartTour,
  onDismiss,
}: {
  onStartTour: () => void;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!localStorage.getItem(TOUR_OFFERED_KEY)) setVisible(true);
    }, 900);
    return () => clearTimeout(timer);
  }, []);

  const handle = (action: 'tour' | 'skip') => {
    localStorage.setItem(TOUR_OFFERED_KEY, '1');
    setVisible(false);
    if (action === 'tour') setTimeout(onStartTour, 300);
    else onDismiss();
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9997] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
            onClick={() => handle('skip')}
          />
          <motion.div
            className="relative z-10 w-[340px] bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
            initial={{ scale: 0.88, opacity: 0, y: 16 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 8 }}
            transition={{ type: 'spring', bounce: 0.28, duration: 0.45 }}
          >
            <div className="h-1 bg-primary" />
            <div className="p-7 text-center space-y-5">
              <div className="w-32 h-12 mx-auto flex items-center justify-center text-primary">
                <DotletLogo />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-base font-semibold tracking-tight">Welcome to Dotlet</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Place dots that bloom into organic vector shapes. Want a quick guided tour of all the features?
                </p>
              </div>
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => handle('tour')}
                  className="w-full py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
                >
                  <ChevronRight size={14} />
                  Yes, show me around
                </button>
                <button
                  onClick={() => handle('skip')}
                  className="w-full py-2 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

export type TourStep = {
  target: string;
  title: string;
  content: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
  /** 'rect' (default rounded rectangle) or 'circle' spotlight cutout */
  spotlightShape?: 'rect' | 'circle';
};

interface ProductTourProps {
  steps: TourStep[];
  isOpen: boolean;
  onClose: () => void;
}

// ── Spotlight geometry helpers ───────────────────────────────────────────────

const PAD = 8; // padding around the target element

function getRectProps(r: DOMRect) {
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    width: r.width + PAD * 2,
    height: r.height + PAD * 2,
  };
}

function getCircleProps(r: DOMRect) {
  return {
    cx: r.left + r.width / 2,
    cy: r.top + r.height / 2,
    radius: Math.max(r.width, r.height) / 2 + PAD + 4,
  };
}

// ── Main tour ────────────────────────────────────────────────────────────────

export function ProductTour({ steps, isOpen, onClose }: ProductTourProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = steps[currentStepIndex];
  const isCircle = currentStep?.spotlightShape === 'circle';

  // Track target element's rect
  useEffect(() => {
    if (!isOpen || !currentStep) return;

    const updateRect = () => {
      const el = document.querySelector(currentStep.target);
      setTargetRect(el ? el.getBoundingClientRect() : null);
    };

    updateRect();
    // Scroll once when the step changes. Doing it inside updateRect meant the
    // 500ms poll re-triggered a smooth scroll forever, fighting the user.
    document.querySelector(currentStep.target)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    const interval = setInterval(updateRect, 500);

    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
      clearInterval(interval);
    };
  }, [isOpen, currentStep]);

  // Body scroll lock
  useEffect(() => {
    if (isOpen) {
      setCurrentStepIndex(0);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) setCurrentStepIndex(i => i + 1);
    else onClose();
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) setCurrentStepIndex(i => i - 1);
  };

  // ── Popover positioning ─────────────────────────────────────────────────

  // Fallback: centre the card when the step's target isn't on screen (e.g. the
  // sidebar steps while the panel is unpinned). Previously the card was not
  // rendered at all, leaving a scrim with no way to advance the tour.
  let popoverStyle: React.CSSProperties = {
    top: window.innerHeight / 2,
    left: window.innerWidth / 2,
    transform: 'translate(-50%, -50%)',
  };

  if (targetRect) {
    const POPOVER_PAD = 16;
    const POPOVER_WIDTH = 296;
    const placement = currentStep.placement ?? 'bottom';
    let top = 0;
    let left = 0;
    let transform = '';

    const circleR = isCircle ? getCircleProps(targetRect).radius : 0;
    // For circle: offset from circle edge; for rect: offset from rect edge
    const edgeTop    = isCircle ? targetRect.top  + targetRect.height / 2 - circleR : targetRect.top;
    const edgeBottom = isCircle ? targetRect.top  + targetRect.height / 2 + circleR : targetRect.bottom;
    const edgeLeft   = isCircle ? targetRect.left + targetRect.width  / 2 - circleR : targetRect.left;
    const edgeRight  = isCircle ? targetRect.left + targetRect.width  / 2 + circleR : targetRect.right;

    if (placement === 'bottom') {
      top = edgeBottom + POPOVER_PAD;
      left = targetRect.left + targetRect.width / 2;
      transform = 'translateX(-50%)';
    } else if (placement === 'top') {
      top = edgeTop - POPOVER_PAD;
      left = targetRect.left + targetRect.width / 2;
      transform = 'translate(-50%, -100%)';
    } else if (placement === 'left') {
      top = targetRect.top + targetRect.height / 2;
      left = edgeLeft - POPOVER_PAD;
      transform = 'translate(-100%, -50%)';
    } else if (placement === 'right') {
      top = targetRect.top + targetRect.height / 2;
      left = edgeRight + POPOVER_PAD;
      transform = 'translateY(-50%)';
    }

    // Horizontal clamp for top/bottom placements
    if (placement === 'top' || placement === 'bottom') {
      const minLeft = POPOVER_WIDTH / 2 + POPOVER_PAD;
      const maxLeft = window.innerWidth - POPOVER_WIDTH / 2 - POPOVER_PAD;
      left = Math.max(minLeft, Math.min(maxLeft, left));
    }

    // Vertical clamp for left/right placements
    if (placement === 'left' || placement === 'right') {
      const estH = 160;
      top = Math.max(estH / 2 + POPOVER_PAD, Math.min(window.innerHeight - estH / 2 - POPOVER_PAD, top));
    }

    popoverStyle = { top, left, transform };
  }

  // Geometry for SVG elements
  const rProps  = targetRect ? getRectProps(targetRect)   : null;
  const cProps  = targetRect ? getCircleProps(targetRect) : null;

  const springT = { type: 'spring', bounce: 0, duration: 0.4 } as const;

  return (
    <div className="fixed inset-0 z-[9999] pointer-events-none">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 pointer-events-auto"
          >
            {/* ── SVG overlay layer ── */}
            <svg
              className="absolute inset-0"
              style={{ width: '100vw', height: '100vh' }}
            >
              <defs>
                <mask id="spotlight-mask">
                  <rect x="0" y="0" width="100%" height="100%" fill="white" />
                  {/* Cutout — shape switches between rect and circle */}
                  {targetRect && !isCircle && rProps && (
                    <motion.rect
                      fill="black"
                      rx="10"
                      initial={false}
                      animate={{ x: rProps.x, y: rProps.y, width: rProps.width, height: rProps.height }}
                      transition={springT}
                    />
                  )}
                  {targetRect && isCircle && cProps && (
                    <motion.circle
                      fill="black"
                      initial={false}
                      animate={{ cx: cProps.cx, cy: cProps.cy, r: cProps.radius }}
                      transition={springT}
                    />
                  )}
                </mask>
              </defs>

              {/* Dark scrim */}
              <rect
                x="0" y="0" width="100%" height="100%"
                fill="rgba(0,0,0,0.62)"
                mask="url(#spotlight-mask)"
                onClick={onClose}
              />

              {/* Glow ring — rect */}
              {targetRect && !isCircle && rProps && (
                <motion.rect
                  fill="none"
                  stroke="rgba(61,94,245,0.8)"
                  strokeWidth="2"
                  rx="10"
                  initial={false}
                  animate={{ x: rProps.x, y: rProps.y, width: rProps.width, height: rProps.height }}
                  transition={springT}
                />
              )}

              {/* Glow ring — circle */}
              {targetRect && isCircle && cProps && (
                <motion.circle
                  fill="none"
                  stroke="rgba(61,94,245,0.8)"
                  strokeWidth="2"
                  initial={false}
                  animate={{ cx: cProps.cx, cy: cProps.cy, r: cProps.radius }}
                  transition={springT}
                />
              )}

              {/* Pulsing outer ring */}
              {targetRect && !isCircle && rProps && (
                <motion.rect
                  fill="none"
                  stroke="rgba(61,94,245,0.2)"
                  strokeWidth="4"
                  rx="14"
                  initial={false}
                  animate={{
                    x: rProps.x - 6,
                    y: rProps.y - 6,
                    width: rProps.width + 12,
                    height: rProps.height + 12,
                    opacity: [0.5, 0.15, 0.5],
                  }}
                  transition={{
                    x: springT, y: springT, width: springT, height: springT,
                    opacity: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
                  }}
                />
              )}
              {targetRect && isCircle && cProps && (
                <motion.circle
                  fill="none"
                  stroke="rgba(61,94,245,0.2)"
                  strokeWidth="4"
                  initial={false}
                  animate={{
                    cx: cProps.cx,
                    cy: cProps.cy,
                    r: cProps.radius + 8,
                    opacity: [0.5, 0.15, 0.5],
                  }}
                  transition={{
                    cx: springT, cy: springT, r: springT,
                    opacity: { repeat: Infinity, duration: 2, ease: 'easeInOut' },
                  }}
                />
              )}
            </svg>

            {/* Click blocker over target so user can't accidentally interact */}
            {targetRect && (
              <div
                className="absolute"
                style={{
                  top: targetRect.top - PAD,
                  left: targetRect.left - PAD,
                  width: targetRect.width + PAD * 2,
                  height: targetRect.height + PAD * 2,
                  zIndex: 10,
                }}
              />
            )}

            {/* ── Popover card ── */}
            {(
              <motion.div
                className="absolute w-[296px] bg-popover text-popover-foreground border border-border shadow-2xl rounded-2xl overflow-hidden z-20 pointer-events-auto"
                initial={false}
                animate={popoverStyle as any}
                transition={springT}
              >
                {/* Progress bar */}
                <div className="relative h-0.5 bg-border">
                  <motion.div
                    className="absolute left-0 top-0 h-full bg-primary"
                    initial={false}
                    animate={{ width: `${((currentStepIndex + 1) / steps.length) * 100}%` }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                  />
                </div>

                <div className="p-4 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {/* Step number badge — light pink from palette */}
                      <span className={`w-5 h-5 flex-shrink-0 flex items-center justify-center text-[9px] font-bold text-[#1a1040] bg-[#ffc1fa] ${isCircle ? 'rounded-full' : 'rounded'}`}>
                        {currentStepIndex + 1}
                      </span>
                      <h3 className="text-sm font-semibold leading-snug">{currentStep.title}</h3>
                    </div>
                    <button
                      onClick={onClose}
                      className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                    >
                      <X size={13} />
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed pl-7">
                    {currentStep.content}
                  </p>
                </div>

                <div className="flex items-center justify-between px-4 py-3 bg-muted/30 border-t border-border">
                  {/* Step dots */}
                  <div className="flex items-center gap-1">
                    {steps.map((_, i) => (
                      <span
                        key={i}
                        className={`rounded-full transition-all duration-300 ${
                          i === currentStepIndex
                            ? 'w-3 h-1.5 bg-primary'
                            : i < currentStepIndex
                            ? 'w-1.5 h-1.5 bg-primary/40'
                            : 'w-1.5 h-1.5 bg-border'
                        }`}
                      />
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {currentStepIndex > 0 && (
                      <button
                        onClick={handlePrev}
                        className="flex items-center gap-0.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      >
                        <ChevronLeft size={12} /> Prev
                      </button>
                    )}
                    {currentStepIndex < steps.length - 1 && (
                      <button
                        onClick={onClose}
                        className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                      >
                        Skip
                      </button>
                    )}
                    <button
                      onClick={handleNext}
                      className="flex items-center gap-0.5 px-3 py-1.5 text-[11px] font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                    >
                      {currentStepIndex === steps.length - 1 ? 'Finish ✓' : <>Next <ChevronRight size={12} /></>}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
