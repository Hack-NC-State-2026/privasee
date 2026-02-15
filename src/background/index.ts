const BACKEND_ORIGIN = 'http://localhost:8000';
const TOS_PROCESS_URL = `${BACKEND_ORIGIN}/api/tos_processor/process`;
const OVERLAY_SUMMARY_URL = `${BACKEND_ORIGIN}/api/overlay_summary/top_risks`;

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 20;

type PolicyLink = { url: string; text: string };

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

type GetInsightMessage = {
  type: 'GET_PRIVACY_INSIGHT';
  payload?: {
    domain?: string;
    pathname?: string;
    policyLinks?: PolicyLink[];
  };
};

type OpenPanelMessage = {
  type: 'OPEN_SIDE_PANEL';
};

type FetchTosEnrichedMessage = {
  type: 'FETCH_TOS_ENRICHED';
  payload?: { urls: string[] };
};

type GetChromeHistoryMessage = {
  type: 'GET_CHROME_HISTORY';
  payload?: {
    text?: string;
    startTime?: number;
    maxResults?: number;
  };
};

type RuntimeMessage =
  | OpenPanelMessage
  | GetInsightMessage
  | FetchTosEnrichedMessage
  | GetChromeHistoryMessage
  | { type?: string };

type OverlaySummaryAttribute = {
  title: string;
  evidence: string;
  explanation?: string;
  color: string;
  sensitivity_level: number;
};

type OverlaySummaryResponse = {
  domain: string;
  top_high_risk_attributes: OverlaySummaryAttribute[];
  data_retention_policy?: { title: string; explanation: string };
  mitigations?: { title: string; mitigation: string }[];
  has_cached_analysis: boolean;
};

/** Raw backend PolicyAnalysis responses cached per tab. */
const tabBackendCache = new Map<number, Record<string, unknown>>();

/** Tracks in-flight fetches so we don't duplicate requests for the same tab. */
const tabFetchInFlight = new Set<number>();

const createFallbackInsight = (domain: string): PrivacyInsight => ({
  domain,
  riskLevel: 'unknown',
  summary:
    'Policy analysis is in progress. Treat this as a preliminary snapshot.',
  likelyDataCollected: [
    {
      title: 'Account identity',
      details: 'Name, email, and authentication data',
    },
    { title: 'Device and usage', details: 'IP, browser, and activity events' },
  ],
  keyConcerns: [
    {
      title: 'Sharing details may be broad',
      details: 'Review third-party and affiliate sharing clauses.',
    },
    {
      title: 'Retention duration not yet verified',
      details: 'Look for explicit deletion and retention windows.',
    },
  ],
  recommendations: [
    'Use a dedicated email alias for new signups.',
    'Skip optional profile fields where possible.',
    'Review account privacy settings immediately after registration.',
  ],
  retentionSummary:
    'Retention policy details are still being analyzed. Review deletion and retention terms before submitting.',
  generatedAt: Date.now(),
});

const formatAttributeName = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getNestedRecord = (
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> | null => {
  const value = source[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const getStringValue = (
  source: Record<string, unknown> | null,
  key: string
): string | null => {
  if (!source) return null;
  const value = source[key];
  return typeof value === 'string' ? value : null;
};

const mapPostureToRiskLevel = (posture: string | null): RiskLevel => {
  if (!posture) return 'unknown';
  if (posture === 'high_risk') return 'high';
  if (posture === 'moderate_risk') return 'medium';
  if (posture === 'low_risk') return 'low';
  return 'unknown';
};

const collectTypes = (
  section: Record<string, unknown> | null,
  key: string
): string[] => {
  const nested = getNestedRecord(section ?? {}, key);
  if (!nested) return [];
  const { types } = nested;
  if (!Array.isArray(types)) return [];
  return types.filter((item): item is string => typeof item === 'string');
};

const getSignalStatus = (
  section: Record<string, unknown> | null,
  key: string
): string | null => {
  const signal = getNestedRecord(section ?? {}, key);
  return getStringValue(signal, 'status');
};

const buildLikelyDataCollected = (
  dataCollection: Record<string, unknown> | null
): InsightItem[] => {
  if (!dataCollection) return [];

  const personalIdentifiers = collectTypes(dataCollection, 'personal_identifiers');
  const locationData = collectTypes(dataCollection, 'precise_location');
  const deviceData = collectTypes(dataCollection, 'device_fingerprinting');
  const userContent = collectTypes(dataCollection, 'user_content');
  const thirdPartyData = collectTypes(dataCollection, 'third_party_data');
  const sensitiveData = collectTypes(dataCollection, 'sensitive_data');

  const candidates: Array<[string, string[]]> = [
    ['Personal identifiers', personalIdentifiers],
    ['Location data', locationData],
    ['Device fingerprints', deviceData],
    ['User content', userContent],
    ['Third-party sources', thirdPartyData],
    ['Sensitive categories', sensitiveData],
  ];

  return candidates
    .filter(([, values]) => values.length > 0)
    .slice(0, 4)
    .map(([title, values]) => ({
      title,
      details: values.slice(0, 5).map(formatAttributeName).join(', '),
    }));
};

const buildKeyConcerns = (
  redFlags: unknown,
  legalTerms: Record<string, unknown> | null
): InsightItem[] => {
  const fromFlags: InsightItem[] = [];
  if (Array.isArray(redFlags)) {
    redFlags.forEach((flag) => {
      if (!flag || typeof flag !== 'object' || Array.isArray(flag)) {
        return;
      }
      const item = flag as Record<string, unknown>;
      const clause = typeof item.clause === 'string' ? item.clause : null;
      const explanation =
        typeof item.explanation === 'string' ? item.explanation : undefined;
      if (!clause) return;
      const concern: InsightItem = explanation
        ? { title: clause, details: explanation }
        : { title: clause };
      fromFlags.push(concern);
    });
  }

  if (fromFlags.length > 0) return fromFlags.slice(0, 3);

  const fallbackConcerns: InsightItem[] = [];
  const unilateralStatus = getSignalStatus(legalTerms, 'unilateral_modification');
  const arbitrationStatus = getSignalStatus(legalTerms, 'mandatory_arbitration');

  if (unilateralStatus?.includes('true')) {
    fallbackConcerns.push({
      title: 'Terms can change unilaterally',
      details: 'Terms may be updated without explicit re-consent requirements.',
    });
  }
  if (arbitrationStatus?.includes('true')) {
    fallbackConcerns.push({
      title: 'Mandatory arbitration',
      details: 'Disputes may be limited to arbitration instead of court.',
    });
  }

  return fallbackConcerns;
};

const buildRecommendations = (
  userRights: Record<string, unknown> | null,
  retention: Record<string, unknown> | null
): string[] => {
  const recommendations: string[] = [
    'Use a dedicated email alias for this signup.',
    'Skip optional profile fields where possible.',
  ];

  const deletionSignal = getNestedRecord(userRights ?? {}, 'deletion');
  const deletionStatus = getStringValue(deletionSignal, 'status');
  if (deletionStatus === 'true') {
    recommendations.push(
      'Use the available deletion request workflow if you close the account.'
    );
  }

  const optOutAdsSignal = getNestedRecord(userRights ?? {}, 'opt_out_ads');
  const optOutAdsStatus = getStringValue(optOutAdsSignal, 'status');
  if (optOutAdsStatus === 'true') {
    recommendations.push('Opt out of personalized ads in account settings.');
  }

  const retentionDuration = getStringValue(retention, 'retention_duration');
  if (!retentionDuration || retentionDuration === 'unknown') {
    recommendations.push(
      'Review retention clauses closely before submitting sensitive information.'
    );
  }

  return recommendations.slice(0, 4);
};

const buildRetentionSummary = (retention: Record<string, unknown> | null): string => {
  const retentionDuration = getStringValue(retention, 'retention_duration');
  const deletionSignal = getNestedRecord(retention ?? {}, 'deletion_rights');
  const deletionStatus = getStringValue(deletionSignal, 'status');

  const durationLabel =
    retentionDuration && retentionDuration !== 'unknown'
      ? retentionDuration.replace(/_/g, ' ')
      : 'not clearly specified';
  const deletionLabel =
    deletionStatus === 'true'
      ? 'Deletion rights appear to be available.'
      : 'Deletion rights are not clearly stated.';

  return `Retention window is ${durationLabel}. ${deletionLabel}`;
};

const toPrivacyInsight = (
  domain: string,
  analysis: Record<string, unknown>
): PrivacyInsight => {
  const scores = getNestedRecord(analysis, 'scores');
  const dataCollection = getNestedRecord(analysis, 'data_collection');
  const legalTerms = getNestedRecord(analysis, 'legal_terms');
  const userRights = getNestedRecord(analysis, 'user_rights');
  const retention = getNestedRecord(analysis, 'retention');

  const posture = getStringValue(scores, 'posture');
  const privacyScore = scores?.privacy_score;
  const scoreLabel =
    typeof privacyScore === 'number'
      ? `Privacy score ${Math.round(privacyScore)}/100.`
      : '';

  const concerns = buildKeyConcerns(analysis.red_flags, legalTerms);
  const concernSummary =
    concerns.length > 0
      ? `Top concerns include ${concerns
          .slice(0, 2)
          .map((item) => item.title.toLowerCase())
          .join(' and ')}.`
      : 'Policy analysis completed with limited red-flag evidence.';

  return {
    domain,
    riskLevel: mapPostureToRiskLevel(posture),
    summary: `${scoreLabel} ${concernSummary}`.trim(),
    likelyDataCollected: buildLikelyDataCollected(dataCollection),
    keyConcerns: concerns,
    recommendations: buildRecommendations(userRights, retention),
    retentionSummary: buildRetentionSummary(retention),
    generatedAt: Date.now(),
  };
};

/**
 * Call the overlay_summary API and return the response, or `undefined` on
 * any failure.
 */
async function fetchOverlaySummary(
  domain: string
): Promise<OverlaySummaryResponse | undefined> {
  const url = `${OVERLAY_SUMMARY_URL}?domain=${encodeURIComponent(domain)}`;
  // eslint-disable-next-line no-console
  console.log('[privasee] Calling overlay_summary API:', url);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        '[privasee] overlay_summary returned',
        res.status,
        res.statusText
      );
      return undefined;
    }
    const data = (await res.json()) as OverlaySummaryResponse;
    // eslint-disable-next-line no-console
    console.log('[privasee] overlay_summary backend raw response (untouched):', data);
    return data;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[privasee] overlay_summary fetch failed:', err);
    return undefined;
  }
}

/**
 * Build a PrivacyInsight from the overlay_summary response.
 * Uses the top-3 high-risk attributes as keyConcerns; fills other sections
 * from the full cached analysis when available.
 */
const buildInsightFromOverlaySummary = (
  domain: string,
  summary: OverlaySummaryResponse,
  cached: Record<string, unknown> | undefined
): PrivacyInsight => {
  // Key concerns: set details from explanation only (never evidence, no fallback to evidence).
  const keyConcerns: InsightItem[] = summary.top_high_risk_attributes.map(
    (attr) => ({
      title: attr.title,
      details: attr.explanation?.trim() ?? undefined,
    })
  );

  const retentionSummary =
    summary.data_retention_policy?.explanation?.trim() ?? undefined;

  const recommendations: string[] =
    summary.mitigations
      ?.map((m) => m.mitigation?.trim())
      .filter((s): s is string => Boolean(s)) ?? [];

  // Fill remaining sections from the full cached analysis if available
  if (cached) {
    const full = toPrivacyInsight(domain, cached);
    return {
      ...full,
      keyConcerns:
        keyConcerns.length > 0 ? keyConcerns : full.keyConcerns,
      retentionSummary: retentionSummary ?? full.retentionSummary,
      recommendations:
        recommendations.length > 0 ? recommendations : full.recommendations,
    };
  }

  const fallbackRecommendations = [
    'Use a dedicated email alias for new signups.',
    'Skip optional profile fields where possible.',
    'Review account privacy settings immediately after registration.',
  ];

  // No full analysis available yet — return a slim insight
  return {
    domain,
    riskLevel: 'unknown',
    summary:
      'Policy analysis is in progress. Treat this as a preliminary snapshot.',
    likelyDataCollected: [],
    keyConcerns:
      keyConcerns.length > 0
        ? keyConcerns
        : [
            {
              title: 'Analyzing privacy policy',
              details:
                'We are extracting key risk clauses from the linked policy pages.',
            },
          ],
    recommendations:
      recommendations.length > 0 ? recommendations : fallbackRecommendations,
    retentionSummary:
      retentionSummary ??
      'Retention policy details are still being analyzed. Review deletion and retention terms before submitting.',
    generatedAt: Date.now(),
  };
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Single request to tos_processor (enrich_with_top_risks on cache hit).
 * Returns the parsed JSON (200 with overlay_summary when cached, or 202 body when processing).
 */
async function fetchTosEnrichedOnce(
  urls: string[]
): Promise<{ status: number; data: Record<string, unknown>; requestUrl: string }> {
  if (urls.length === 0) {
    return {
      status: 400,
      data: { error: 'At least one url is required' },
      requestUrl: '',
    };
  }
  const queryString = urls
    .map((u) => `url=${encodeURIComponent(u)}`)
    .join('&');
  const requestUrl = `${TOS_PROCESS_URL}?${queryString}`;
  // eslint-disable-next-line no-console
  console.log('[privasee] tos_processor request URL:', requestUrl);
  const res = await fetch(requestUrl);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log('[privasee] tos_processor backend raw response (untouched):', data);
  return { status: res.status, data, requestUrl };
}

/**
 * Single poll attempt against the backend. Returns the parsed JSON when the
 * result is ready, `null` when the backend is still processing (202), or
 * `undefined` on a non-recoverable error.
 */
async function pollOnce(
  endpoint: string
): Promise<Record<string, unknown> | null | undefined> {
  const res = await fetch(endpoint);

  if (res.status === 202) return null;

  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error(
      '[privasee] Backend returned error:',
      res.status,
      res.statusText
    );
    return undefined;
  }

  const data = (await res.json()) as Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log('[privasee] tos_processor poll backend raw response (untouched):', data);
  return data;
}

/**
 * Recursively polls the backend until a result is available or attempts are
 * exhausted. Returns the parsed response or `undefined` on failure/timeout.
 */
async function pollWithRetry(
  endpoint: string,
  attempt: number
): Promise<Record<string, unknown> | undefined> {
  if (attempt >= MAX_POLL_ATTEMPTS) {
    // eslint-disable-next-line no-console
    console.warn('[privasee] Max poll attempts reached');
    return undefined;
  }

  const result = await pollOnce(endpoint);

  // null → still processing, try again
  if (result === null) {
    // eslint-disable-next-line no-console
    console.log(
      `[privasee] Backend still processing (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS}), retrying...`
    );
    await delay(POLL_INTERVAL_MS);
    return pollWithRetry(endpoint, attempt + 1);
  }

  return result;
}

/**
 * Call the backend TOS processor with the given policy URLs.
 * Handles the 202-polling pattern: the backend returns 202 while processing,
 * and the cached result on subsequent calls once ready.
 */
async function fetchBackendAnalysis(
  tabId: number,
  domain: string,
  urls: string[]
): Promise<void> {
  if (urls.length === 0) return;
  if (tabFetchInFlight.has(tabId)) return;

  tabFetchInFlight.add(tabId);

  const queryString = urls
    .map((u) => `url=${encodeURIComponent(u)}`)
    .join('&');
  const endpoint = `${TOS_PROCESS_URL}?${queryString}`;

  try {
    const result = await pollWithRetry(endpoint, 0);

    if (result) {
      tabBackendCache.set(tabId, result);
      // eslint-disable-next-line no-console
      console.log('[privasee] Backend analysis cached for tab', tabId, result);

      // Use the embedded overlay_summary from the tos_processor response
      // when available (cache-hit path), otherwise fall back to a separate
      // overlay_summary API call.
      const embedded = result.overlay_summary as
        | OverlaySummaryResponse
        | undefined;

      let insight: PrivacyInsight;

      if (
        embedded &&
        Array.isArray(embedded.top_high_risk_attributes) &&
        embedded.top_high_risk_attributes.length > 0
      ) {
        // eslint-disable-next-line no-console
        console.log(
          '[privasee] Using embedded overlay_summary from tos_processor response'
        );
        insight = buildInsightFromOverlaySummary(domain, embedded, result);
      } else {
        // eslint-disable-next-line no-console
        console.log(
          '[privasee] No embedded overlay_summary — fetching separately for',
          domain
        );
        const summary = await fetchOverlaySummary(domain);
        insight = summary
          ? buildInsightFromOverlaySummary(domain, summary, result)
          : toPrivacyInsight(domain, result);
      }

      // eslint-disable-next-line no-console
      console.log(
        '[privasee] Pushing PRIVACY_INSIGHT_UPDATED with keyConcerns:',
        insight.keyConcerns
      );
      await chrome.tabs
        .sendMessage(tabId, {
          type: 'PRIVACY_INSIGHT_UPDATED',
          payload: insight,
        })
        .catch(() => undefined);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[privasee] Backend fetch failed:', err);
  } finally {
    tabFetchInFlight.delete(tabId);
  }
}

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender, sendResponse) => {
    if (message.type === 'OPEN_SIDE_PANEL') {
      const tabId = sender.tab?.id;
      if (typeof tabId !== 'number') {
        sendResponse({ ok: false, error: 'Missing tab context.' });
        return undefined;
      }

      if (!chrome.sidePanel?.open) {
        sendResponse({
          ok: false,
          error: 'Side panel API is not available in this browser.',
        });
        return undefined;
      }

      chrome.sidePanel.open({ tabId }, () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        sendResponse({ ok: true });
      });

      return true;
    }

    if (message.type === 'GET_PRIVACY_INSIGHT') {
      const payload = 'payload' in message ? message.payload : undefined;
      const domain = payload?.domain?.trim() || sender.url || 'unknown-domain';
      const policyLinks = payload?.policyLinks ?? [];
      const tabId = sender.tab?.id;
      const senderUrl =
        typeof sender.url === 'string' && /^https?:\/\//i.test(sender.url)
          ? sender.url
          : null;
      const fallbackUrl =
        senderUrl ??
        (domain !== 'unknown-domain' && !domain.includes('://')
          ? `https://${domain}`
          : null);
      let tosUrls: string[] = [];
      if (policyLinks.length > 0) {
        tosUrls = policyLinks
          .map((link: PolicyLink) => link.url?.trim())
          .filter(
            (url): url is string => Boolean(url) && /^https?:\/\//i.test(url)
          );
      } else if (fallbackUrl) {
        tosUrls = [fallbackUrl];
      }

      // eslint-disable-next-line no-console
      console.log(
        '[privasee] GET_PRIVACY_INSIGHT received for domain:',
        domain,
        'tabId:',
        tabId,
        'policyLinks:',
        policyLinks.length
      );

      // Acknowledge receipt so sendMessage callers don't fail while we stream
      // actual insight updates through tab messages.
      sendResponse({ ok: true, accepted: true });

      // Async handler — check for embedded overlay_summary from a prior
      // tos_processor cache hit first, then fall back to a separate API call.
      (async () => {
        try {
          const cached =
            typeof tabId === 'number'
              ? tabBackendCache.get(tabId)
              : undefined;

          // Try embedded overlay_summary from a cached tos_processor response
          const embedded = cached?.overlay_summary as
            | OverlaySummaryResponse
            | undefined;

          // Resolve overlay summary: prefer embedded, fall back to API call
          let summary: OverlaySummaryResponse | undefined;
          if (
            embedded &&
            Array.isArray(embedded.top_high_risk_attributes) &&
            embedded.top_high_risk_attributes.length > 0
          ) {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] Using embedded overlay_summary from cached tos_processor result'
            );
            summary = embedded;
          } else {
            summary = await fetchOverlaySummary(domain);
          }

          const sendResult = (data: PrivacyInsight) => {
            if (typeof tabId === 'number') {
              chrome.tabs.sendMessage(tabId, {
                type: 'GET_PRIVACY_INSIGHT_RESULT',
                ok: true,
                data,
              }).catch(() => undefined);
            }
          };

          if (
            summary &&
            summary.has_cached_analysis &&
            summary.top_high_risk_attributes.length > 0
          ) {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] overlay_summary has results — using top risks as keyConcerns'
            );
            const insight = buildInsightFromOverlaySummary(
              domain,
              summary,
              cached
            );
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] Sending insight with overlay keyConcerns:',
              insight.keyConcerns
            );
            sendResult(insight);
          } else if (cached) {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] No overlay summary results, using cached full analysis'
            );
            sendResult(toPrivacyInsight(domain, cached));
          } else {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] No cached analysis — sending fallback insight'
            );
            sendResult(createFallbackInsight(domain));
          }

          // Trigger TOS processing when cache data is missing/empty, or when
          // overlay_summary is temporarily unavailable.
          const shouldTriggerTos =
            !summary ||
            !summary.has_cached_analysis ||
            summary.top_high_risk_attributes.length === 0;
          if (shouldTriggerTos) {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] overlay_summary empty/no-cache — triggering TOS processing'
            );
            if (typeof tabId === 'number' && tosUrls.length > 0) {
              fetchBackendAnalysis(tabId, domain, tosUrls);
            } else if (typeof tabId === 'number') {
              // eslint-disable-next-line no-console
              console.warn(
                '[privasee] Skipping TOS processing: no valid policy links or fallback URL'
              );
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            '[privasee] GET_PRIVACY_INSIGHT handler error:',
            err
          );
          if (typeof tabId === 'number') {
            chrome.tabs.sendMessage(tabId, {
              type: 'GET_PRIVACY_INSIGHT_RESULT',
              ok: true,
              data: createFallbackInsight(domain),
            }).catch(() => undefined);
          }
        }
      })();

      return undefined;
    }

    if (message.type === 'FETCH_TOS_ENRICHED') {
      const tabId = sender.tab?.id;
      const payload =
        'payload' in message ? (message as FetchTosEnrichedMessage).payload : undefined;
      const urls = payload?.urls?.length ? payload.urls : [];
      (async () => {
        try {
          const { status, data, requestUrl } = await fetchTosEnrichedOnce(urls);
          if (typeof tabId === 'number') {
            await chrome.tabs.sendMessage(tabId, {
              type: 'FETCH_TOS_ENRICHED_RESULT',
              ok: true,
              status,
              data,
              requestUrl,
            });
          } else {
            sendResponse({ ok: false, error: 'No tab context' });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[privasee] FETCH_TOS_ENRICHED failed:', err);
          if (typeof tabId === 'number') {
            await chrome.tabs.sendMessage(tabId, {
              type: 'FETCH_TOS_ENRICHED_RESULT',
              ok: false,
              error: String(err),
            }).catch(() => undefined);
          } else {
            sendResponse({ ok: false, error: String(err) });
          }
        }
      })();
      return true;
    }

    if (message.type === 'GET_CHROME_HISTORY') {
      const payload =
        'payload' in message ? (message as GetChromeHistoryMessage).payload : undefined;

      if (!chrome.history?.search) {
        sendResponse({
          ok: false,
          error: 'History API unavailable in background context.',
        });
        return undefined;
      }

      chrome.history.search(
        {
          text: payload?.text ?? '',
          startTime: payload?.startTime,
          maxResults: payload?.maxResults,
        },
        (items) => {
          const { lastError } = chrome.runtime;
          if (lastError) {
            sendResponse({ ok: false, error: lastError.message });
            return;
          }
          sendResponse({ ok: true, items: items ?? [] });
        }
      );

      return true;
    }

    return undefined;
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabBackendCache.delete(tabId);
  tabFetchInFlight.delete(tabId);
});
