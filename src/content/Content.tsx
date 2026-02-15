import {
  CSSProperties,
  JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

type RiskLevel = 'low' | 'medium' | 'high' | 'unknown';

type InsightItem = {
  title: string;
  details?: string;
};

type PrivacyInsight = {
  domain: string;
  riskLevel: RiskLevel;
  summary: string;
  likelyDataCollected: InsightItem[];
  keyConcerns: InsightItem[];
  recommendations: string[];
  generatedAt: number;
};

type Severity = 'low' | 'medium' | 'high';

type InsightResponse = {
  ok: boolean;
  data?: PrivacyInsight;
  error?: string;
};

type SignupContext = {
  container: HTMLElement | null;
  confidence: number;
  isDialogLike: boolean;
};

const SESSION_SEEN_KEY_PREFIX = 'privasee:overlay:seen:';
const SESSION_DISMISS_KEY_PREFIX = 'privasee:overlay:dismissed:';
const SESSION_SIGNUP_JOURNEY_KEY_PREFIX = 'privasee:overlay:signup-journey:';
const SNOOZE_KEY = 'privasee_overlay_snooze_by_domain';
const SIGNUP_JOURNEY_TTL_MS = 30 * 60 * 1000;
const DOMAIN = window.location.hostname;
const DEBUG_ALWAYS_SHOW_ON_RELOAD = true;

const SIGNUP_KEYWORDS = [
  'sign up',
  'signup',
  'register',
  'create account',
  'create your account',
  'create your google account',
  'create a google account',
  'new account',
  'join',
  'start free',
  'get started',
];

const LOGIN_KEYWORDS = ['sign in', 'login', 'log in'];
const STEP_BUTTON_HINTS = ['next', 'continue'];
const AUTH_ACTION_KEYWORDS = [
  'sign up',
  'signup',
  'register',
  'create account',
  'join',
  'continue with',
  'continue',
  'google',
  'apple',
  'email',
];

const FIELD_PATTERNS = {
  email: /(email|e-mail)/i,
  password: /password/i,
  confirm: /(confirm|repeat|re-enter)/i,
  fullName: /(name|first|last)/i,
  phone: /(phone|mobile|tel)/i,
};
const DIALOG_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  '[data-testid*="modal"]',
  '[class*="modal"]',
].join(',');

const isInputLike = (
  el: Element
): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

const getFieldIdentifier = (el: Element): string => {
  if (!isInputLike(el)) return '';
  return `${el.name} ${el.id} ${el.placeholder} ${el.type}`
    .trim()
    .toLowerCase();
};

const getNodeText = (node: Element): string =>
  node.textContent?.trim().toLowerCase().slice(0, 1600) ?? '';

const getPageText = (): string =>
  document.body?.textContent?.trim().toLowerCase().slice(0, 1500) ?? '';

const getActionLabel = (element: Element): string => {
  if (element instanceof HTMLInputElement) {
    return `${element.value} ${element.name} ${element.id}`
      .trim()
      .toLowerCase();
  }
  if (element instanceof HTMLElement) {
    const ariaLabel = element.getAttribute('aria-label') ?? '';
    return `${ariaLabel} ${element.textContent ?? ''}`.trim().toLowerCase();
  }
  return '';
};

const isAuthActionElement = (element: Element): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  const isActionControl = element.matches(
    'button, input[type="submit"], input[type="button"], a, [role="button"]'
  );
  if (!isActionControl) return false;
  const label = getActionLabel(element);
  return AUTH_ACTION_KEYWORDS.some((keyword) => label.includes(keyword));
};

const findSignupContext = (): SignupContext => {
  const forms = Array.from(document.querySelectorAll('form'));
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(DIALOG_SELECTORS)
  );
  const candidates = Array.from(
    new Set<HTMLElement>([
      ...forms.map((form) => form as HTMLElement),
      ...dialogs,
    ])
  );
  let best: SignupContext = {
    container: null,
    confidence: 0,
    isDialogLike: false,
  };

  candidates.forEach((container) => {
    const text = getNodeText(container);
    const fields = Array.from(
      container.querySelectorAll('input, textarea, select')
    );
    let score = 0;
    const isDialogLike =
      container.matches(DIALOG_SELECTORS) ||
      container.closest(DIALOG_SELECTORS) !== null;

    const hasSignupKeyword = SIGNUP_KEYWORDS.some((keyword) =>
      text.includes(keyword)
    );
    const hasLoginKeyword = LOGIN_KEYWORDS.some((keyword) =>
      text.includes(keyword)
    );

    if (hasSignupKeyword) score += 3;
    if (hasLoginKeyword && !hasSignupKeyword) score -= 2;
    if (hasLoginKeyword && hasSignupKeyword) score -= 0.5;
    if (isDialogLike) score += 1;

    let hasEmail = false;
    let hasPassword = false;
    let hasConfirm = false;
    let hasName = false;
    let hasPhone = false;

    fields.forEach((field) => {
      const id = getFieldIdentifier(field);
      if (!id) return;

      if (FIELD_PATTERNS.email.test(id)) hasEmail = true;
      if (FIELD_PATTERNS.password.test(id)) hasPassword = true;
      if (FIELD_PATTERNS.confirm.test(id)) hasConfirm = true;
      if (FIELD_PATTERNS.fullName.test(id)) hasName = true;
      if (FIELD_PATTERNS.phone.test(id)) hasPhone = true;
    });

    if (hasName) score += 1;
    if (hasPhone) score += 0.5;
    if (hasEmail) score += 1.5;
    if (hasPassword) score += 1.5;
    if (hasConfirm) score += 1.5;

    const submitButtons = Array.from(
      container.querySelectorAll(
        'button, input[type="submit"], input[type="button"]'
      )
    );
    const hasSignupSubmit = submitButtons.some((btn) => {
      const label =
        btn instanceof HTMLInputElement
          ? btn.value.toLowerCase()
          : btn.textContent?.toLowerCase() ?? '';
      return SIGNUP_KEYWORDS.some((keyword) => label.includes(keyword));
    });

    if (hasSignupSubmit) score += 2;
    const hasStepButton = submitButtons.some((btn) => {
      const label =
        btn instanceof HTMLInputElement
          ? btn.value.toLowerCase()
          : btn.textContent?.toLowerCase() ?? '';
      return STEP_BUTTON_HINTS.some((hint) => label.includes(hint));
    });
    const looksLikeEarlyStep = hasSignupKeyword && hasName && !hasPassword;
    if (looksLikeEarlyStep && hasStepButton) score += 1.5;

    if (score > best.confidence) {
      best = { container, confidence: score, isDialogLike };
    }
  });

  return best;
};

const getSessionKey = (prefix: string): string => `${prefix}${DOMAIN}`;

const setSessionFlag = (key: string) => {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Ignore storage failures in restricted contexts.
  }
};

const hasSessionFlag = (key: string): boolean => {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const setSignupJourneySeen = () => {
  const key = getSessionKey(SESSION_SIGNUP_JOURNEY_KEY_PREFIX);
  try {
    window.sessionStorage.setItem(
      key,
      String(Date.now() + SIGNUP_JOURNEY_TTL_MS)
    );
  } catch {
    // Ignore storage failures in restricted contexts.
  }
};

const hasRecentSignupJourney = (): boolean => {
  const key = getSessionKey(SESSION_SIGNUP_JOURNEY_KEY_PREFIX);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return false;
    const expiresAt = Number(raw);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
      window.sessionStorage.removeItem(key);
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

const hasPageLevelSignupSignals = (): boolean => {
  const pageText = getPageText();
  const hasSignupKeyword = SIGNUP_KEYWORDS.some((keyword) =>
    pageText.includes(keyword)
  );
  const hasLoginOnlyKeyword = LOGIN_KEYWORDS.some((keyword) =>
    pageText.includes(keyword)
  );
  const pathHint =
    /(sign.?up|register|create.?account|accounts?\/signup)/i.test(
      window.location.pathname
    );
  return (hasSignupKeyword && !hasLoginOnlyKeyword) || pathHint;
};

const hasDialogLevelAuthSignals = (): boolean => {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(DIALOG_SELECTORS)
  );
  return dialogs.some((dialog) => {
    const text = getNodeText(dialog);
    const hasSignup = SIGNUP_KEYWORDS.some((keyword) => text.includes(keyword));
    const hasLogin = LOGIN_KEYWORDS.some((keyword) => text.includes(keyword));
    const hasProviderAction =
      text.includes('continue with') ||
      text.includes('google') ||
      text.includes('apple');
    return (hasSignup || hasLogin) && hasProviderAction;
  });
};

const isRedditAuthModalVisible = (): boolean => {
  const hostname = window.location.hostname.toLowerCase();
  if (!hostname.includes('reddit.com')) return false;

  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(DIALOG_SELECTORS)
  );
  return dialogs.some((dialog) => {
    const text = getNodeText(dialog);
    const hasSignUpTitle = text.includes('sign up');
    const hasPrivacyReference =
      text.includes('privacy policy') || text.includes('user agreement');
    const hasEmailEntry = dialog.querySelector(
      'input[type="email"], input[name*="email" i]'
    );
    return hasSignUpTitle && (hasPrivacyReference || Boolean(hasEmailEntry));
  });
};

const getSnoozeMap = async (): Promise<Record<string, number>> => {
  try {
    const result = await chrome.storage.local.get(SNOOZE_KEY);
    const raw = result[SNOOZE_KEY];
    if (!raw || typeof raw !== 'object') return {};
    return raw as Record<string, number>;
  } catch {
    return {};
  }
};

const isSnoozed = async (domain: string): Promise<boolean> => {
  const map = await getSnoozeMap();
  const expiry = map[domain];
  if (!expiry) return false;
  if (Date.now() > expiry) {
    delete map[domain];
    await chrome.storage.local.set({ [SNOOZE_KEY]: map });
    return false;
  }
  return true;
};

const formatRiskLabel = (riskLevel: RiskLevel): string => {
  if (riskLevel === 'unknown') return 'Risk: Unknown';
  return `Risk: ${riskLevel[0].toUpperCase()}${riskLevel.slice(1)}`;
};

const riskPillClass = (riskLevel: RiskLevel): string => {
  if (riskLevel === 'high')
    return 'border border-red-300 bg-red-50 text-red-700';
  if (riskLevel === 'medium') {
    return 'border border-amber-300 bg-amber-50 text-amber-700';
  }
  if (riskLevel === 'low') {
    return 'border border-emerald-300 bg-emerald-50 text-emerald-700';
  }
  return 'border border-base-300 bg-base-200 text-base-content/80';
};

const classifySeverity = (title: string, details?: string): Severity => {
  const text = `${title} ${details ?? ''}`.toLowerCase();
  if (
    /location|biometric|government|ssn|social security|tracking|third-party|sell|advertis|behavior/.test(
      text
    )
  ) {
    return 'high';
  }
  if (
    /device|phone|retention|analytics|affiliate|profil|identifier/.test(text)
  ) {
    return 'medium';
  }
  return 'low';
};

const chipToneClass = (severity: Severity): string => {
  if (severity === 'high') return 'border-red-200 bg-red-50 text-red-700';
  if (severity === 'medium')
    return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-emerald-200 bg-emerald-50 text-emerald-700';
};

const concernToneClass = (severity: Severity): string => {
  if (severity === 'high') return 'bg-red-500';
  if (severity === 'medium') return 'bg-amber-500';
  return 'bg-emerald-500';
};

const impactFromRecommendation = (text: string): Severity => {
  const normalized = text.toLowerCase();
  if (/immediately|disable|restrict|block|remove|limit/.test(normalized)) {
    return 'high';
  }
  if (/review|check|audit|opt|adjust/.test(normalized)) {
    return 'medium';
  }
  return 'low';
};

const impactBadgeClass = (impact: Severity): string => {
  if (impact === 'high') return 'bg-red-50 text-red-700';
  if (impact === 'medium') return 'bg-amber-50 text-amber-700';
  return 'bg-emerald-50 text-emerald-700';
};

export default function Content(): JSX.Element {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<PrivacyInsight | null>(null);
  const [hasIntent, setHasIntent] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    right: '16px',
    bottom: '16px',
  });
  const [spotlightVars, setSpotlightVars] = useState<CSSProperties>({
    '--privasee-spotlight-x': '84%',
    '--privasee-spotlight-y': '82%',
  } as CSSProperties);
  const currentPathRef = useRef(window.location.pathname);
  const overlayRef = useRef<HTMLElement | null>(null);
  const dismissSessionKey = getSessionKey(SESSION_DISMISS_KEY_PREFIX);
  const seenSessionKey = getSessionKey(SESSION_SEEN_KEY_PREFIX);

  const openBrowserSidePanel = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  }, []);

  const fetchInsight = useCallback(async () => {
    setLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_PRIVACY_INSIGHT',
        payload: {
          domain: DOMAIN,
          pathname: window.location.pathname,
        },
      });

      const parsed = response as InsightResponse;
      if (parsed?.ok && parsed.data) {
        setInsight(parsed.data);
        return;
      }

      setInsight({
        domain: DOMAIN,
        riskLevel: 'unknown',
        summary: parsed?.error || 'Privacy analysis is still loading.',
        likelyDataCollected: [],
        keyConcerns: [],
        recommendations: ['Review account privacy settings after signup.'],
        generatedAt: Date.now(),
      });
    } catch {
      setInsight({
        domain: DOMAIN,
        riskLevel: 'unknown',
        summary: 'Unable to load privacy summary right now.',
        likelyDataCollected: [],
        keyConcerns: [],
        recommendations: [
          'Proceed carefully and review policy links before submit.',
        ],
        generatedAt: Date.now(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const showOverlay = useCallback(async () => {
    if (!DEBUG_ALWAYS_SHOW_ON_RELOAD) {
      if (hasSessionFlag(dismissSessionKey) || hasSessionFlag(seenSessionKey))
        return;
      if (await isSnoozed(DOMAIN)) return;
    }

    setVisible(true);
    if (!DEBUG_ALWAYS_SHOW_ON_RELOAD) {
      setSessionFlag(seenSessionKey);
    }
    fetchInsight();
  }, [dismissSessionKey, fetchInsight, seenSessionKey]);

  const evaluateIntentAndMaybeShow = useCallback(async () => {
    const context = findSignupContext();
    const formIntentDetected = context.confidence >= 3.5;
    const pageIntentDetected = hasPageLevelSignupSignals();
    const dialogIntentDetected = hasDialogLevelAuthSignals();
    const redditModalIntentDetected = isRedditAuthModalVisible();
    const journeyIntentDetected = hasRecentSignupJourney();
    const intentDetected =
      formIntentDetected ||
      pageIntentDetected ||
      dialogIntentDetected ||
      redditModalIntentDetected ||
      journeyIntentDetected;
    setHasIntent(intentDetected);

    if (!intentDetected) return;
    if (
      formIntentDetected ||
      pageIntentDetected ||
      dialogIntentDetected ||
      redditModalIntentDetected
    ) {
      setSignupJourneySeen();
    }

    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    const isInputFocused = active.matches('input, textarea, select');
    const isControlFocused = active.matches(
      'input, textarea, select, button, [role="button"]'
    );
    const isFocusedInsideContext = context.container
      ? context.container.contains(active)
      : false;
    const allowDialogFocus =
      context.isDialogLike && isControlFocused && isFocusedInsideContext;

    const allowRedditModalFocus =
      redditModalIntentDetected && isFocusedInsideContext;
    if (!isInputFocused && !allowDialogFocus && !allowRedditModalFocus) return;
    if (
      context.container &&
      !context.container.contains(active) &&
      !journeyIntentDetected
    ) {
      return;
    }

    await showOverlay();
  }, [showOverlay]);

  const dismissForSession = useCallback(() => {
    if (!DEBUG_ALWAYS_SHOW_ON_RELOAD) {
      setSessionFlag(dismissSessionKey);
    }
    setVisible(false);
  }, [dismissSessionKey]);

  const updatePopoverPosition = useCallback(() => {
    setPopoverStyle({
      right: '16px',
      bottom: '16px',
      left: 'auto',
      top: 'auto',
    });
  }, []);

  const syncBackdropToPopover = useCallback(() => {
    const popup = overlayRef.current;
    if (!popup) return;
    const rect = popup.getBoundingClientRect();
    const x = `${Math.round(rect.left + rect.width / 2)}px`;
    const y = `${Math.round(rect.top + rect.height / 2)}px`;
    setSpotlightVars({
      '--privasee-spotlight-x': x,
      '--privasee-spotlight-y': y,
    } as CSSProperties);
  }, []);

  useEffect(() => {
    const onFocusIn = () => {
      evaluateIntentAndMaybeShow().catch(() => undefined);
      updatePopoverPosition();
    };

    const onInput = () => {
      evaluateIntentAndMaybeShow().catch(() => undefined);
      updatePopoverPosition();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && visible) {
        dismissForSession();
      }
    };
    const onClick = (event: MouseEvent) => {
      const { target } = event;
      if (!(target instanceof Element)) return;
      const actionElement = target.closest(
        'button, input[type="submit"], input[type="button"], a, [role="button"]'
      );
      if (!actionElement || !isAuthActionElement(actionElement)) return;
      setSignupJourneySeen();
      setHasIntent(true);
      showOverlay().catch(() => undefined);
    };

    document.addEventListener('focusin', onFocusIn, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('click', onClick, true);

    evaluateIntentAndMaybeShow().catch(() => undefined);
    updatePopoverPosition();
    requestAnimationFrame(syncBackdropToPopover);

    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [
    dismissForSession,
    evaluateIntentAndMaybeShow,
    showOverlay,
    updatePopoverPosition,
    syncBackdropToPopover,
    visible,
  ]);

  useEffect(() => {
    if (!visible) return undefined;

    const onResize = () => {
      updatePopoverPosition();
    };
    const onPointerDown = (event: MouseEvent) => {
      const { target } = event;
      if (!(target instanceof Node)) return;
      if (overlayRef.current?.contains(target)) return;
      dismissForSession();
    };

    updatePopoverPosition();
    requestAnimationFrame(syncBackdropToPopover);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    document.addEventListener('mousedown', onPointerDown, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      document.removeEventListener('mousedown', onPointerDown, true);
    };
  }, [
    dismissForSession,
    updatePopoverPosition,
    visible,
    syncBackdropToPopover,
  ]);

  useEffect(() => {
    const syncPath = () => {
      if (currentPathRef.current === window.location.pathname) return;

      currentPathRef.current = window.location.pathname;
      setVisible(false);
      setHasIntent(false);
      setInsight(null);
      evaluateIntentAndMaybeShow().catch(() => undefined);
    };

    const onNavigate = () => {
      syncPath();
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    window.history.pushState = function pushState(...args) {
      originalPushState.apply(this, args);
      window.dispatchEvent(new Event('privasee:navigation'));
    };

    window.history.replaceState = function replaceState(...args) {
      originalReplaceState.apply(this, args);
      window.dispatchEvent(new Event('privasee:navigation'));
    };

    window.addEventListener('popstate', onNavigate);
    window.addEventListener('hashchange', onNavigate);
    window.addEventListener('privasee:navigation', onNavigate);

    return () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', onNavigate);
      window.removeEventListener('hashchange', onNavigate);
      window.removeEventListener('privasee:navigation', onNavigate);
    };
  }, [evaluateIntentAndMaybeShow]);

  useEffect(() => {
    const onMessage = (message: {
      type?: string;
      payload?: PrivacyInsight;
    }) => {
      if (message.type !== 'PRIVACY_INSIGHT_UPDATED' || !message.payload) {
        return;
      }

      if (message.payload.domain !== DOMAIN) return;
      setInsight(message.payload);
      setLoading(false);
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, []);

  if (!hasIntent || !visible) {
    return <div id='my-ext' data-theme='light' />;
  }

  const riskLevel = insight?.riskLevel ?? 'unknown';
  const summaryText = loading
    ? 'Analyzing this signup flow...'
    : insight?.summary ?? 'Preparing privacy summary...';
  const dataItems = insight?.likelyDataCollected ?? [];
  const visibleDataItems = dataItems.slice(0, 6);
  const remainingDataCount = Math.max(
    0,
    dataItems.length - visibleDataItems.length
  );
  const concernItems = (insight?.keyConcerns ?? []).slice(0, 3);
  const actionItems = (insight?.recommendations ?? []).slice(0, 3);
  const highRiskDataCount = dataItems.filter(
    (item) => classifySeverity(item.title, item.details) === 'high'
  ).length;
  const sharingFlagsCount = (insight?.keyConcerns ?? []).filter((item) =>
    /share|sharing|third|affiliate|sell|partner/i.test(
      `${item.title} ${item.details ?? ''}`
    )
  ).length;
  const suggestedActionCount = insight?.recommendations.length ?? 0;

  return (
    <div id='my-ext' data-theme='light'>
      <div
        aria-hidden='true'
        className='privasee-cinematic-backdrop pointer-events-none fixed inset-0 z-[2147483646]'
        style={spotlightVars}
      />
      <aside
        ref={overlayRef}
        role='dialog'
        aria-label='Signup privacy insight'
        className='privasee-popover-enter privasee-popover-pulse pointer-events-auto fixed z-[2147483647] w-[380px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-base-300 bg-base-100 p-4 text-base-content shadow-2xl'
        style={popoverStyle}
      >
        <header className='mb-4 flex items-start justify-between gap-3'>
          <div>
            <p className='text-base-content/55 text-[11px] font-semibold uppercase tracking-[0.08em]'>
              Privacy Snapshot
            </p>
            <h2 className='text-base font-bold leading-tight'>
              Creating account on {DOMAIN}
            </h2>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${riskPillClass(riskLevel)}`}
          >
            {formatRiskLabel(riskLevel).replace('Risk: ', '')}
          </span>
        </header>

        <section className='mb-5'>
          <p className='text-base-content/80 mb-3 text-sm leading-snug'>
            {summaryText}
          </p>
          <div className='grid grid-cols-1 gap-2 sm:grid-cols-3'>
            <div className='rounded-xl border border-red-100 bg-red-50 px-3 py-2'>
              <p className='text-[11px] font-medium uppercase tracking-wide text-red-600/90'>
                High-risk data items
              </p>
              <p className='text-sm font-semibold text-red-700'>
                {highRiskDataCount}
              </p>
            </div>
            <div className='rounded-xl border border-amber-100 bg-amber-50 px-3 py-2'>
              <p className='text-[11px] font-medium uppercase tracking-wide text-amber-600/90'>
                Sharing
              </p>
              <p className='text-sm font-semibold text-amber-700'>
                {sharingFlagsCount}
              </p>
            </div>
            <div className='rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2'>
              <p className='text-[11px] font-medium uppercase tracking-wide text-emerald-600/90'>
                Suggested actions
              </p>
              <p className='text-sm font-semibold text-emerald-700'>
                {suggestedActionCount}
              </p>
            </div>
          </div>
        </section>

        <section className='privasee-size-transition mb-5'>
          <h3 className='text-base-content/55 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]'>
            Data being shared
          </h3>
          <div className='flex flex-wrap gap-2'>
            {visibleDataItems.length > 0 ? (
              visibleDataItems.map((item) => {
                const severity = classifySeverity(item.title, item.details);
                const tone = chipToneClass(severity);
                return (
                  <span
                    key={item.title}
                    title={item.title}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${tone}`}
                  >
                    <span aria-hidden='true' className='text-[10px]'>
                      ●
                    </span>
                    <span className='max-w-[220px] truncate'>{item.title}</span>
                  </span>
                );
              })
            ) : (
              <p className='text-base-content/60 text-sm'>
                No detailed categories yet.
              </p>
            )}
            {remainingDataCount > 0 ? (
              <span className='text-base-content/80 rounded-full border border-base-300 bg-base-200 px-3 py-1 text-xs font-medium'>
                +{remainingDataCount} more
              </span>
            ) : null}
          </div>
        </section>

        <section className='privasee-size-transition mb-5'>
          <h3 className='text-base-content/55 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]'>
            Top concerns
          </h3>
          <div className='space-y-2'>
            {concernItems.length > 0 ? (
              concernItems.map((item) => {
                const severity = classifySeverity(item.title, item.details);
                return (
                  <div
                    key={item.title}
                    className='bg-base-200/70 flex items-start gap-2 rounded-xl border border-base-300 px-3 py-2'
                  >
                    <span
                      aria-hidden='true'
                      className={`mt-1 h-4 w-1 rounded-full ${concernToneClass(severity)}`}
                    />
                    <p className='text-base-content/85 text-sm leading-snug'>
                      <span className='font-semibold'>{item.title}</span>
                      {item.details ? `: ${item.details}` : ''}
                    </p>
                  </div>
                );
              })
            ) : (
              <p className='text-base-content/60 text-sm'>
                No specific concerns detected yet.
              </p>
            )}
          </div>
        </section>

        <section className='privasee-size-transition mb-5'>
          <h3 className='text-base-content/55 mb-2 text-[11px] font-semibold uppercase tracking-[0.08em]'>
            Reduce exposure now
          </h3>
          <div className='space-y-2'>
            {actionItems.length > 0 ? (
              actionItems.map((item) => {
                const impact = impactFromRecommendation(item);
                return (
                  <div
                    key={item}
                    className='privasee-row-hover flex items-center justify-between gap-2 rounded-xl border border-base-300 bg-base-100 px-3 py-2'
                  >
                    <p className='text-base-content/85 text-sm'>{item}</p>
                    <div className='flex shrink-0 items-center gap-2'>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${impactBadgeClass(impact)}`}
                      >
                        {impact[0].toUpperCase()}
                        {impact.slice(1)}
                      </span>
                      <span className='text-base-content/55' aria-hidden='true'>
                        ↗
                      </span>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className='text-base-content/60 text-sm'>
                Review privacy settings after signup.
              </p>
            )}
          </div>
        </section>

        <footer className='flex items-center justify-between gap-2 border-t border-base-300 pt-3'>
          <button
            type='button'
            className='focus-visible:ring-primary/40 btn btn-primary btn-sm min-h-9 px-3 focus-visible:outline-none focus-visible:ring-2'
            onClick={openBrowserSidePanel}
          >
            Open details
          </button>
          <button
            type='button'
            className='focus-visible:ring-primary/40 btn btn-outline btn-sm min-h-9 px-3 focus-visible:outline-none focus-visible:ring-2'
            onClick={dismissForSession}
          >
            Dismiss
          </button>
        </footer>
      </aside>
    </div>
  );
}
