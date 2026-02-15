import {
  CSSProperties,
  JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { findPolicyLinks, type PolicyLink } from './policyLinks';

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
  retentionSummary: string;
  generatedAt: number;
};

type SignupContext = {
  container: HTMLElement | null;
  confidence: number;
  isDialogLike: boolean;
};

const SESSION_DISMISS_KEY_PREFIX = 'privasee:overlay:dismissed:';
const SESSION_SIGNUP_JOURNEY_KEY_PREFIX = 'privasee:overlay:signup-journey:';
const SNOOZE_KEY = 'privasee_overlay_snooze_by_domain';
const SIGNUP_JOURNEY_TTL_MS = 30 * 60 * 1000;

const DOMAIN = window.location.hostname;

/**
 * Debug flag:
 * When true, the signup overlay is allowed to show on every page reload
 * (still only when signup intent is detected on the current page).
 */
const DEBUG_SHOW_ON_EVERY_SIGNUP_RELOAD = true;

const SIGNUP_KEYWORDS = [
  'agree and join',
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
  'agree and join',
  'sign up',
  'signup',
  'register',
  'create account',
  'create your account',
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

const hasSignupPathHint = (): boolean =>
  /(sign.?up|register|create.?account|accounts?\/signup)/i.test(
    window.location.pathname
  );

const hasDialogLevelAuthSignals = (): boolean => {
  const dialogs = Array.from(
    document.querySelectorAll<HTMLElement>(DIALOG_SELECTORS)
  );

  return dialogs.some((dialog) => {
    const text = getNodeText(dialog);
    const hasSignup = SIGNUP_KEYWORDS.some((keyword) =>
      text.includes(keyword)
    );
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
  const fetchedForPathRef = useRef<string | null>(null);
  /** In-memory only: avoid showing overlay again in this page load. Resets on tab close/refresh. */
  const hasShownThisLoadRef = useRef(false);

  const dismissSessionKey = getSessionKey(SESSION_DISMISS_KEY_PREFIX);

  const openBrowserSidePanel = useCallback(() => {
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    window.open(
      chrome.runtime.getURL('src/options/index.html'),
      '_blank',
      'noopener,noreferrer'
    );
  }, []);

  const fetchInsight = useCallback(() => {
    const currentPath = window.location.pathname;
    if (fetchedForPathRef.current === currentPath) return;
    fetchedForPathRef.current = currentPath;

    setLoading(true);

    const policyLinks: PolicyLink[] = findPolicyLinks(document);
    // eslint-disable-next-line no-console
    console.log('[privasee:content] fetchInsight sending GET_PRIVACY_INSIGHT for', DOMAIN);

    const fallbackInsight: PrivacyInsight = {
      domain: DOMAIN,
      riskLevel: 'unknown',
      summary: 'Privacy analysis is still loading.',
      likelyDataCollected: [],
      keyConcerns: [],
      recommendations: ['Review account privacy settings after signup.'],
      retentionSummary:
        'Retention terms are still loading. Review policy details before submitting.',
      generatedAt: Date.now(),
    };

    let timeoutId: ReturnType<typeof setTimeout>;
    const handleResult = (message: { type: string; ok?: boolean; data?: PrivacyInsight }) => {
      if (message.type !== 'GET_PRIVACY_INSIGHT_RESULT') return;
      try {
        try {
          chrome.runtime.onMessage.removeListener(handleResult);
        } catch {
          // Extension context may be invalidated (e.g. reload)
        }
        clearTimeout(timeoutId);
        // eslint-disable-next-line no-console
        console.log('[privasee:content] GET_PRIVACY_INSIGHT response (api data):', message);
        if (message.ok && message.data) {
          // eslint-disable-next-line no-console
          console.log('[privasee:content] keyConcerns received:', message.data.keyConcerns);
          setInsight(message.data);
        } else {
          setInsight(fallbackInsight);
        }
        setLoading(false);
      } catch (err) {
        // Avoid uncaught errors when port is disconnected (e.g. CRX HMR / service worker restart)
        // eslint-disable-next-line no-console
        console.warn('[privasee:content] handleResult error:', err);
        setLoading(false);
      }
    };

    timeoutId = setTimeout(() => {
      try {
        chrome.runtime.onMessage.removeListener(handleResult);
      } catch {
        // Extension context may be invalidated
      }
      setInsight(fallbackInsight);
      setLoading(false);
    }, 30000);

    chrome.runtime.onMessage.addListener(handleResult);
    chrome.runtime.sendMessage({
      type: 'GET_PRIVACY_INSIGHT',
      payload: {
        domain: DOMAIN,
        pathname: window.location.pathname,
        policyLinks,
      },
    }).catch(() => {
      try {
        chrome.runtime.onMessage.removeListener(handleResult);
      } catch {
        // Extension context may be invalidated
      }
      clearTimeout(timeoutId);
      setInsight({
        ...fallbackInsight,
        summary: 'Unable to load privacy summary right now.',
      });
      setLoading(false);
    });
  }, []);

  const showOverlay = useCallback(async () => {
    if (visible) return;

    if (!DEBUG_SHOW_ON_EVERY_SIGNUP_RELOAD) {
      if (hasSessionFlag(dismissSessionKey)) return;
      if (hasShownThisLoadRef.current) return;
      if (await isSnoozed(DOMAIN)) return;
    }

    hasShownThisLoadRef.current = true;
    setVisible(true);

    fetchInsight();
  }, [visible, dismissSessionKey, fetchInsight]);

  const evaluateIntentAndMaybeShow = useCallback(async () => {
    const context = findSignupContext();
    const formIntentDetected = context.confidence >= 3.5;
    const pageIntentDetected = hasPageLevelSignupSignals();
    const pathIntentDetected = hasSignupPathHint();
    const dialogIntentDetected = hasDialogLevelAuthSignals();
    const redditModalIntentDetected = isRedditAuthModalVisible();
    const journeyIntentDetected = hasRecentSignupJourney();

    const intentDetected =
      formIntentDetected ||
      pageIntentDetected ||
      pathIntentDetected ||
      dialogIntentDetected ||
      redditModalIntentDetected ||
      journeyIntentDetected;

    setHasIntent(intentDetected);

    if (!intentDetected) return;

    if (
      formIntentDetected ||
      pageIntentDetected ||
      pathIntentDetected ||
      dialogIntentDetected ||
      redditModalIntentDetected
    ) {
      setSignupJourneySeen();
    }

    // On explicit signup/create-account routes, show immediately.
    if (pathIntentDetected) {
      await showOverlay();
      return;
    }

    // When page text shows signup/join/create-account CTAs, show overlay immediately.
    if (pageIntentDetected) {
      await showOverlay();
      return;
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
    if (!DEBUG_SHOW_ON_EVERY_SIGNUP_RELOAD) {
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

    updatePopoverPosition();
    requestAnimationFrame(syncBackdropToPopover);

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [
    updatePopoverPosition,
    visible,
    syncBackdropToPopover,
  ]);

  useEffect(() => {
    const syncPath = () => {
      if (currentPathRef.current === window.location.pathname) return;
      currentPathRef.current = window.location.pathname;
      fetchedForPathRef.current = null;
      hasShownThisLoadRef.current = false;
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
      try {
        if (message.type !== 'PRIVACY_INSIGHT_UPDATED' || !message.payload) {
          return;
        }
        if (message.payload.domain !== DOMAIN) return;
        // eslint-disable-next-line no-console
        console.log(
          '[privasee:content] PRIVACY_INSIGHT_UPDATED received, keyConcerns:',
          message.payload.keyConcerns
        );
        setInsight(message.payload);
        setLoading(false);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[privasee:content] PRIVACY_INSIGHT_UPDATED handler error:', err);
      }
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // Extension context may be invalidated
      }
    };
  }, []);

  // Call tos_processor API directly from content script (host_permissions grants localhost access)
  useEffect(() => {
    const TOS_PROCESS_URL = 'http://localhost:8000/api/tos_processor/process';
    const requestUrl = `${TOS_PROCESS_URL}?url=${encodeURIComponent(`https://${DOMAIN}`)}`;
    // eslint-disable-next-line no-console
    console.log('[privasee:content] calling tos_processor directly:', requestUrl);
    fetch(requestUrl)
      .then((res) => res.json())
      .then((data: Record<string, unknown>) => {
        // eslint-disable-next-line no-console
        console.log('[privasee:content] backend raw response (untouched):', data);
        // eslint-disable-next-line no-console
        console.log('[privasee:content] backend raw response JSON:', JSON.stringify(data, null, 2));
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[privasee:content] tos_processor fetch failed:', err);
      });
  }, []);

  if (!hasIntent || !visible) {
    return <div id='my-ext' className='privasee-shell' data-theme='dark' />;
  }

  const riskLevel = insight?.riskLevel ?? 'unknown';
  const riskBadgeConfig: Record<
    RiskLevel,
    {
      label: string;
      badgeClassName: string;
      tileClassName: string;
      titleClassName: string;
    }
  > = {
    high: {
      label: 'Critical Exposure',
      badgeClassName: 'is-high',
      tileClassName: 'is-high',
      titleClassName: 'is-high',
    },
    medium: {
      label: 'Watch List',
      badgeClassName: 'is-watch',
      tileClassName: 'is-watch',
      titleClassName: 'is-watch',
    },
    low: {
      label: 'Lower Risk',
      badgeClassName: 'is-stable',
      tileClassName: 'is-stable',
      titleClassName: 'is-stable',
    },
    unknown: {
      label: 'Risk Assessment In Progress',
      badgeClassName: 'is-unknown',
      tileClassName: 'is-unknown',
      titleClassName: 'is-unknown',
    },
  };

  const fallbackConcerns: InsightItem[] = [
    {
      title: 'Sharing details may be broad',
      details: 'Review third-party and affiliate sharing clauses.',
    },
    {
      title: 'Retention duration not yet verified',
      details: 'Look for explicit deletion and retention windows.',
    },
  ];
  // Risk factors use explanation (in details), not evidence, for user-facing text
  const rawConcerns = insight?.keyConcerns ?? [];
  const keyConcerns =
    rawConcerns.length > 0 ? rawConcerns.slice(0, 3) : fallbackConcerns;

  const likelyData = insight?.likelyDataCollected ?? [];

  const fallbackRecommendations = [
    'Use a dedicated email alias for this signup.',
    'Review privacy settings as soon as account creation is complete.',
  ];
  const recommendations = insight?.recommendations?.length
    ? insight.recommendations
    : fallbackRecommendations;

  const retentionSummary =
    insight?.retentionSummary ||
    'Retention terms are still being analyzed. Review policy details before submitting.';

  const summaryText =
    insight?.summary ||
    'We are still processing policy links for a complete risk assessment.';

  const badgeConfig = riskBadgeConfig[riskLevel];

  return (
    <div id='my-ext' className='privasee-shell' data-theme='dark'>
      <div
        aria-hidden='true'
        className='privasee-cinematic-backdrop privasee-backdrop pointer-events-none fixed inset-0 z-[2147483646]'
        style={spotlightVars}
      />

      <aside
        ref={overlayRef}
        role='dialog'
        aria-label='Signup privacy insight'
        className='privasee-popover-enter privasee-popover-pulse privasee-overlay pointer-events-auto fixed z-[2147483647]'
        style={popoverStyle}
      >
        <header className='privasee-header'>
          <div className='privasee-kicker-row'>
            <span className='privasee-kicker-dot' />
            <span className='privasee-kicker'>Privasee Noir</span>
          </div>

          <div>
            <div
              className={`privasee-risk-pill ${badgeConfig.badgeClassName}`}
            >
              {badgeConfig.label}
            </div>

            <h2 className='privasee-title'>
              Signup privacy risks for {DOMAIN}
            </h2>
            <p className='privasee-summary'>{summaryText}</p>
            {loading ? (
              <p className='privasee-loading'>Refreshing backend analysis...</p>
            ) : null}
          </div>
        </header>

        <section className='privasee-section-stack'>
          {keyConcerns.map((tile, index) => {
            const concernToneClass = index < 2 ? 'is-critical' : 'is-medium';

            return (
              <article
                key={tile.title}
                className={`privasee-concern-card ${concernToneClass}`}
              >
                <h3
                  className={`privasee-concern-title ${concernToneClass}`}
                >
                  {tile.title}
                </h3>

                <p className='privasee-concern-text'>
                  {tile.details || 'Review this clause in the policy for more details.'}
                </p>
              </article>
            );
          })}

          {likelyData.length > 0 ? (
            <article className='privasee-info-card'>
              <h3 className='privasee-subtitle'>
                Likely Data Collected
              </h3>
              <ul className='privasee-info-list'>
                {likelyData.map((item) => (
                  <li key={item.title} className='privasee-info-item'>
                    <span className='privasee-info-item-title'>{item.title}:</span>{' '}
                    {item.details || 'Collected according to policy analysis.'}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          <article className='privasee-info-card privasee-retention-panel'>
            <h3 className='privasee-subtitle'>
              Data Retention Policy
            </h3>
            <p className='privasee-copy'>
              {retentionSummary}
            </p>
          </article>

          <article className='privasee-info-card privasee-action-panel'>
            <h3 className='privasee-subtitle'>
              Action Items You Can Take Now
            </h3>
            <ul className='privasee-action-list'>
              {recommendations.map((item, index) => (
                <li key={item} className='privasee-action-item'>
                  <span className='privasee-action-index'>{index + 1}</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        </section>

        <footer className='privasee-footer'>
          <button
            type='button'
            className='privasee-btn privasee-btn-primary'
            onClick={openBrowserSidePanel}
          >
            Open Dashboard
          </button>

          <button
            type='button'
            className='privasee-btn privasee-btn-secondary'
            onClick={dismissForSession}
          >
            Dismiss
          </button>
        </footer>
      </aside>
    </div>
  );
}
