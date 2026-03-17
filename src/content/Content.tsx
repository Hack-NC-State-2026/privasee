import {
  CSSProperties,
  JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  OverlayInsightState,
  PrivacyInsight,
} from '../utils/overlayInsight';
import type { PolicyLink } from './policyLinks';

import {
  createProcessingOverlayState,
  OVERLAY_PROCESSING_MESSAGE,
} from '../utils/overlayInsight';
import { findPolicyLinks } from './policyLinks';

type SignupContext = {
  container: HTMLElement | null;
  confidence: number;
  isDialogLike: boolean;
};

type FetchInsightOptions = {
  force?: boolean;
};

const SESSION_SIGNUP_JOURNEY_KEY_PREFIX = 'privasee:overlay:signup-journey:';
const SNOOZE_KEY = 'privasee_overlay_snooze_by_domain';
const SIGNUP_JOURNEY_TTL_MS = 30 * 60 * 1000;
const SKELETON_CONCERN_COUNT = 3;
const SKELETON_ACTION_COUNT = 2;

const DOMAIN = window.location.hostname;
const getCurrentViewKey = (): string =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;

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

const createClassName = (
  ...classNames: Array<string | false | null | undefined>
): string => classNames.filter(Boolean).join(' ');

export default function Content(): JSX.Element {
  const [visible, setVisible] = useState(false);
  const [overlayState, setOverlayState] = useState<OverlayInsightState | null>(
    null
  );
  const [hasIntent, setHasIntent] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({
    right: '16px',
    bottom: '16px',
  });
  const [spotlightVars, setSpotlightVars] = useState<CSSProperties>({
    '--privasee-spotlight-x': '84%',
    '--privasee-spotlight-y': '82%',
  } as CSSProperties);

  const currentPathRef = useRef(getCurrentViewKey());
  const overlayRef = useRef<HTMLElement | null>(null);
  const fetchedForPathRef = useRef<string | null>(null);
  const visibleRef = useRef(false);
  const overlayStateRef = useRef<OverlayInsightState | null>(null);
  /** In-memory only: avoid showing overlay again in this page load. Resets on tab close/refresh. */
  const hasShownThisLoadRef = useRef(false);
  const dismissedForCurrentViewRef = useRef(false);

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

  const fetchInsight = useCallback(
    ({ force = false }: FetchInsightOptions = {}) => {
      const currentPath = getCurrentViewKey();
      if (!force && fetchedForPathRef.current === currentPath) return;
      fetchedForPathRef.current = currentPath;
      setOverlayState(createProcessingOverlayState(DOMAIN));

      const policyLinks: PolicyLink[] = findPolicyLinks(document);
      // eslint-disable-next-line no-console
      console.log(
        '[privasee:content] fetchInsight sending GET_PRIVACY_INSIGHT for',
        DOMAIN
      );
      chrome.runtime
        .sendMessage({
          type: 'GET_PRIVACY_INSIGHT',
          payload: {
            domain: DOMAIN,
            pathname: getCurrentViewKey(),
            policyLinks,
          },
        })
        .catch(() => {
          setOverlayState(createProcessingOverlayState(DOMAIN));
        });
    },
    []
  );

  const reopenOverlay = useCallback(() => {
    if (visibleRef.current) return;

    hasShownThisLoadRef.current = true;
    setHasIntent(true);
    setVisible(true);
    dismissedForCurrentViewRef.current = false;
    if (overlayStateRef.current?.status !== 'ready') {
      fetchInsight({ force: true });
    }
  }, [fetchInsight]);

  const showOverlay = useCallback(async () => {
    if (visibleRef.current) return;
    if (dismissedForCurrentViewRef.current) return;
    if (hasShownThisLoadRef.current) return;
    if (await isSnoozed(DOMAIN)) return;

    hasShownThisLoadRef.current = true;
    setHasIntent(true);
    setVisible(true);

    fetchInsight();
  }, [fetchInsight]);

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

  const dismissForCurrentView = useCallback(() => {
    dismissedForCurrentViewRef.current = true;
    setVisible(false);
  }, []);

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
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    overlayStateRef.current = overlayState;
  }, [overlayState]);

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
      if (event.key === 'Escape' && visibleRef.current) {
        dismissForCurrentView();
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
    dismissForCurrentView,
    evaluateIntentAndMaybeShow,
    showOverlay,
    updatePopoverPosition,
    syncBackdropToPopover,
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
  }, [updatePopoverPosition, visible, syncBackdropToPopover]);

  useEffect(() => {
    const syncPath = () => {
      const currentViewKey = getCurrentViewKey();
      if (currentPathRef.current === currentViewKey) return;
      currentPathRef.current = currentViewKey;
      fetchedForPathRef.current = null;
      hasShownThisLoadRef.current = false;
      dismissedForCurrentViewRef.current = false;
      setVisible(false);
      setHasIntent(false);
      setOverlayState(null);
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
    const onMessage = (
      message: {
        type?: string;
        ok?: boolean;
        data?: OverlayInsightState;
        payload?: OverlayInsightState;
      },
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: { ok: boolean; reopened?: boolean }) => void
    ) => {
      try {
        if (message.type === 'REOPEN_OVERLAY') {
          if (visibleRef.current) {
            sendResponse({ ok: true, reopened: false });
            return undefined;
          }

          reopenOverlay();
          sendResponse({ ok: true, reopened: true });
          return undefined;
        }

        let nextState: OverlayInsightState | undefined;
        if (message.type === 'GET_PRIVACY_INSIGHT_RESULT') {
          nextState = message.data;
        } else if (message.type === 'PRIVACY_INSIGHT_UPDATED') {
          nextState = message.payload;
        }

        if (!message.ok && message.type === 'GET_PRIVACY_INSIGHT_RESULT') {
          return undefined;
        }
        if (!nextState || nextState.domain !== DOMAIN) return undefined;

        // eslint-disable-next-line no-console
        console.log(
          '[privasee:content] overlay state update received:',
          nextState
        );
        setOverlayState(nextState);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[privasee:content] overlay state handler error:', err);
      }
      return undefined;
    };

    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(onMessage);
      } catch {
        // Extension context may be invalidated
      }
    };
  }, [reopenOverlay]);

  if (!hasIntent || !visible) {
    return <div id='my-ext' className='privasee-shell' data-theme='dark' />;
  }

  const isLoadingState = !overlayState || overlayState.status === 'processing';
  const readyInsight: PrivacyInsight | null =
    overlayState?.status === 'ready' ? overlayState.insight : null;
  const processingMessage =
    overlayState?.status === 'processing'
      ? overlayState.message
      : OVERLAY_PROCESSING_MESSAGE;
  const summaryText = readyInsight?.summary?.trim() ?? '';
  const sharedDataItems = readyInsight?.likelyDataCollected.slice(0, 3) ?? [];
  const keyConcerns = readyInsight?.keyConcerns.slice(0, 3) ?? [];
  const actionItems = readyInsight?.recommendations.slice(0, 2) ?? [];
  const retentionSummary = readyInsight?.retentionSummary?.trim() ?? '';
  let summaryContent: JSX.Element | null = null;
  if (isLoadingState) {
    summaryContent = (
      <div aria-hidden='true' className='privasee-summary-skeleton'>
        <span className='privasee-skeleton privasee-skeleton-line privasee-summary-line' />
        <span className='privasee-skeleton privasee-skeleton-line privasee-summary-line privasee-summary-line-medium' />
        <span className='privasee-skeleton privasee-skeleton-line privasee-summary-line privasee-summary-line-short' />
      </div>
    );
  } else if (summaryText) {
    summaryContent = <p className='privasee-summary'>{summaryText}</p>;
  }

  return (
    <div id='my-ext' className='privasee-shell' data-theme='dark'>
      <div
        aria-hidden='true'
        className='privasee-cinematic-backdrop privasee-backdrop privasee-overlay-backdrop'
        style={spotlightVars}
      />

      <aside
        ref={overlayRef}
        role='dialog'
        aria-label='Signup privacy insight'
        aria-busy={isLoadingState}
        className='privasee-popover-enter privasee-popover-pulse privasee-overlay privasee-overlay-panel'
        style={popoverStyle}
      >
        <button
          type='button'
          aria-label='Dismiss'
          className='privasee-close-btn'
          onClick={dismissForCurrentView}
        >
          ×
        </button>

        <header className='privasee-header'>
          <div className='privasee-kicker-row'>
            <span className='privasee-kicker-dot' />
            <span className='privasee-kicker'>Privasee Noir</span>
          </div>

          <div>
            <h2 className='privasee-title'>Privacy Risk Snapshot</h2>
            <p className='privasee-domain'>{DOMAIN}</p>
            {isLoadingState ? (
              <p className='privasee-loading'>{processingMessage}</p>
            ) : null}
            {summaryContent}
          </div>
        </header>

        <section className='privasee-section-stack'>
          <article className='privasee-detail-block'>
            <h3 className='privasee-block-title'>Data Being Shared</h3>
            {isLoadingState ? (
              <ul
                aria-hidden='true'
                className='privasee-data-pills privasee-skeleton-pill-list'
              >
                {Array.from({ length: SKELETON_CONCERN_COUNT }, (_, index) => (
                  <li
                    key={`pill-skeleton-${index + 1}`}
                    className={createClassName(
                      'privasee-skeleton',
                      'privasee-skeleton-pill',
                      index === 0 && 'privasee-skeleton-pill-wide',
                      index === 1 && 'privasee-skeleton-pill-medium'
                    )}
                  />
                ))}
              </ul>
            ) : (
              <ul className='privasee-data-pills'>
                {sharedDataItems.map((item, index) => (
                  <li
                    key={item.title}
                    className={`privasee-data-pill ${index < 2 ? 'is-critical' : 'is-medium'}`}
                  >
                    {item.title}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className='privasee-detail-block'>
            <h3 className='privasee-block-title'>Top Concerns</h3>
            {isLoadingState ? (
              <div aria-hidden='true' className='privasee-concern-list'>
                {Array.from(
                  { length: SKELETON_CONCERN_COUNT },
                  (_, index) => index
                ).map((index) => {
                  const concernToneClass =
                    index < 2 ? 'is-critical' : 'is-medium';

                  return (
                    <article
                      key={`concern-skeleton-${index + 1}`}
                      className='privasee-concern-card privasee-concern-card-skeleton'
                    >
                      <span
                        className={`privasee-concern-skeleton-rail ${concernToneClass}`}
                      />
                      <div className='privasee-concern-skeleton-copy'>
                        <span className='privasee-skeleton privasee-skeleton-line privasee-concern-skeleton-line' />
                        <span className='privasee-skeleton privasee-skeleton-line privasee-concern-skeleton-line privasee-concern-skeleton-line-short' />
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className='privasee-concern-list'>
                {keyConcerns.map((tile, index) => {
                  const concernToneClass =
                    index < 2 ? 'is-critical' : 'is-medium';
                  const concernKey = `${tile.title}-${tile.details ?? index}`;

                  return (
                    <article
                      key={concernKey}
                      className={`privasee-concern-card ${concernToneClass}`}
                    >
                      {tile.details ? (
                        <p className='privasee-concern-text'>{tile.details}</p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </article>

          <article className='privasee-info-card privasee-retention-panel'>
            {isLoadingState ? (
              <div aria-hidden='true' className='privasee-card-skeleton'>
                <span className='privasee-skeleton privasee-skeleton-line privasee-skeleton-title' />
                <span className='privasee-skeleton privasee-skeleton-line privasee-card-line' />
                <span className='privasee-skeleton privasee-skeleton-line privasee-card-line privasee-card-line-short' />
              </div>
            ) : (
              <>
                <h3 className='privasee-subtitle'>DATA RENTENTION POLICY</h3>
                {retentionSummary ? (
                  <p className='privasee-copy'>{retentionSummary}</p>
                ) : null}
              </>
            )}
          </article>

          <article className='privasee-info-card privasee-action-panel'>
            {isLoadingState ? (
              <div aria-hidden='true' className='privasee-card-skeleton'>
                <span className='privasee-skeleton privasee-skeleton-line privasee-skeleton-title privasee-skeleton-title-wide' />
                <div className='privasee-numbered-skeleton-list'>
                  {Array.from(
                    { length: SKELETON_ACTION_COUNT },
                    (_, index) => index + 1
                  ).map((index) => (
                    <div
                      key={`action-skeleton-${index}`}
                      className='privasee-numbered-skeleton-row'
                    >
                      <span className='privasee-numbered-skeleton-index'>
                        {index}.
                      </span>
                      <span
                        className={createClassName(
                          'privasee-skeleton',
                          'privasee-skeleton-line',
                          'privasee-numbered-skeleton-line',
                          index === 2 && 'privasee-numbered-skeleton-line-short'
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <h3 className='privasee-subtitle'>REDUCE EXPOSURE NOW</h3>
                <ul className='privasee-action-list'>
                  {actionItems.map((item, index) => (
                    <li key={item} className='privasee-action-item'>
                      <span className='privasee-action-number'>
                        {index + 1}.
                      </span>
                      <span className='privasee-action-copy'>{item}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </section>

        <footer className='privasee-footer'>
          <div className='privasee-footer-actions'>
            <button
              type='button'
              className='privasee-btn privasee-btn-primary'
              onClick={openBrowserSidePanel}
            >
              Open Dashboard
            </button>
          </div>

          <p className='privasee-footer-note'>
            Open the dashboard to view full clause evidence, all detected risks,
            and privacy controls.
          </p>
        </footer>
      </aside>
    </div>
  );
}
