import type {
  InsightItem,
  OverlayInsightState,
  PrivacyInsight,
  RiskLevel,
} from '../utils/overlayInsight';

import {
  createProcessingOverlayState,
  createReadyOverlayState,
} from '../utils/overlayInsight';

const BACKEND_ORIGIN = 'http://localhost:8000';
const TOS_PROCESS_URL = `${BACKEND_ORIGIN}/api/tos_processor/process`;
const TOS_CACHED_URL = `${BACKEND_ORIGIN}/api/tos_processor/cached`;
const OVERLAY_SUMMARY_URL = `${BACKEND_ORIGIN}/api/overlay_summary/top_risks`;

const POLL_INTERVAL_MS = 3000;

type PolicyLink = { url: string; text: string };

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

type CachedAnalysisLookupResponse = {
  matched?: Record<string, unknown>;
  matched_count?: number;
};

/** Raw backend PolicyAnalysis responses cached per tab-domain pair. */
const tabBackendCache = new Map<string, Record<string, unknown>>();

/** Tracks in-flight fetches so we don't duplicate requests for the same tab-domain pair. */
const tabFetchInFlight = new Set<string>();

const getTabDomainKey = (tabId: number, domain: string): string =>
  `${tabId}:${domain}`;

const clearTabDomainEntries = (tabId: number) => {
  const keyPrefix = `${tabId}:`;

  Array.from(tabBackendCache.keys()).forEach((key) => {
    if (key.startsWith(keyPrefix)) {
      tabBackendCache.delete(key);
    }
  });

  Array.from(tabFetchInFlight).forEach((key) => {
    if (key.startsWith(keyPrefix)) {
      tabFetchInFlight.delete(key);
    }
  });
};

const formatAttributeName = (value: string): string =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const isOverlaySummaryResponse = (
  value: unknown
): value is OverlaySummaryResponse =>
  isRecord(value) &&
  typeof value.domain === 'string' &&
  Array.isArray(value.top_high_risk_attributes) &&
  typeof value.has_cached_analysis === 'boolean';

const getNestedRecord = (
  source: Record<string, unknown>,
  key: string
): Record<string, unknown> | null => {
  const value = source[key];
  if (!isRecord(value)) {
    return null;
  }
  return value;
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

  const personalIdentifiers = collectTypes(
    dataCollection,
    'personal_identifiers'
  );
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
  const unilateralStatus = getSignalStatus(
    legalTerms,
    'unilateral_modification'
  );
  const arbitrationStatus = getSignalStatus(
    legalTerms,
    'mandatory_arbitration'
  );

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

const buildRetentionSummary = (
  retention: Record<string, unknown> | null
): string => {
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
    console.log(
      '[privasee] overlay_summary backend raw response (untouched):',
      data
    );
    return data;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[privasee] overlay_summary fetch failed:', err);
    return undefined;
  }
}

/**
 * Fetch the fully cached PolicyAnalysis payload for a domain.
 * Returns the first matched analysis on success, `null` for a confirmed miss,
 * or `undefined` when the lookup failed or returned malformed data.
 */
async function fetchCachedAnalysisByDomain(
  domain: string
): Promise<Record<string, unknown> | null | undefined> {
  const url = `${TOS_CACHED_URL}?domain=${encodeURIComponent(domain)}`;
  // eslint-disable-next-line no-console
  console.log('[privasee] Calling tos_processor cached API:', url);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        '[privasee] tos_processor/cached returned',
        res.status,
        res.statusText
      );
      return undefined;
    }

    const data = (await res
      .json()
      .catch(() => null)) as CachedAnalysisLookupResponse | null;
    // eslint-disable-next-line no-console
    console.log('[privasee] tos_processor/cached backend raw response:', data);

    if (!isRecord(data)) {
      // eslint-disable-next-line no-console
      console.warn('[privasee] tos_processor/cached returned malformed JSON');
      return undefined;
    }

    const { matched, matched_count: matchedCount } =
      data as CachedAnalysisLookupResponse;
    if (!isRecord(matched)) {
      if (matchedCount === 0) {
        return null;
      }
      // eslint-disable-next-line no-console
      console.warn(
        '[privasee] tos_processor/cached returned malformed matched payload'
      );
      return undefined;
    }

    const firstMatch = Object.values(matched).find(isRecord);
    if (firstMatch) {
      return firstMatch;
    }

    if (Object.keys(matched).length === 0 || matchedCount === 0) {
      return null;
    }

    // eslint-disable-next-line no-console
    console.warn(
      '[privasee] tos_processor/cached returned malformed matched entries'
    );
    return undefined;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[privasee] tos_processor/cached fetch failed:', err);
    return undefined;
  }
}

/**
 * Build a PrivacyInsight from the overlay_summary response.
 * Uses the top-3 high-risk attributes as keyConcerns and fills the remaining
 * sections from the full cached analysis.
 */
const buildInsightFromOverlaySummary = (
  domain: string,
  summary: OverlaySummaryResponse,
  cached: Record<string, unknown>
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

  const full = toPrivacyInsight(domain, cached);
  return {
    ...full,
    keyConcerns: keyConcerns.length > 0 ? keyConcerns : full.keyConcerns,
    recommendations:
      recommendations.length > 0 ? recommendations : full.recommendations,
    retentionSummary: retentionSummary ?? full.retentionSummary,
  };
};

/**
 * Build a ready-state insight from a full cached analysis payload, enriching it
 * with overlay-summary data when available.
 */
async function buildReadyInsight(
  domain: string,
  analysis: Record<string, unknown>
): Promise<PrivacyInsight> {
  const embedded = isOverlaySummaryResponse(analysis.overlay_summary)
    ? analysis.overlay_summary
    : undefined;

  if (embedded) {
    // eslint-disable-next-line no-console
    console.log(
      '[privasee] Using embedded overlay_summary from ready analysis'
    );
    return buildInsightFromOverlaySummary(domain, embedded, analysis);
  }

  const summary = await fetchOverlaySummary(domain);
  if (summary) {
    // eslint-disable-next-line no-console
    console.log(
      '[privasee] Using fetched overlay_summary to enrich ready analysis'
    );
    return buildInsightFromOverlaySummary(domain, summary, analysis);
  }

  return toPrivacyInsight(domain, analysis);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Single request to tos_processor (enrich_with_top_risks on cache hit).
 * Returns the parsed JSON (200 with overlay_summary when cached, or 202 body when processing).
 */
async function fetchTosEnrichedOnce(urls: string[]): Promise<{
  status: number;
  data: Record<string, unknown>;
  requestUrl: string;
}> {
  if (urls.length === 0) {
    return {
      status: 400,
      data: { error: 'At least one url is required' },
      requestUrl: '',
    };
  }
  const queryString = urls.map((u) => `url=${encodeURIComponent(u)}`).join('&');
  const requestUrl = `${TOS_PROCESS_URL}?${queryString}`;
  // eslint-disable-next-line no-console
  console.log('[privasee] tos_processor request URL:', requestUrl);
  const res = await fetch(requestUrl);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // eslint-disable-next-line no-console
  console.log(
    '[privasee] tos_processor backend raw response (untouched):',
    data
  );
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
  console.log(
    '[privasee] tos_processor poll backend raw response (untouched):',
    data
  );
  return data;
}

/**
 * Polls the backend until a result is available or a non-recoverable error occurs.
 */
async function pollUntilReady(
  endpoint: string,
  attempt = 0
): Promise<Record<string, unknown> | undefined> {
  const result = await pollOnce(endpoint);

  if (result !== null) {
    return result;
  }

  const nextAttempt = attempt + 1;
  // eslint-disable-next-line no-console
  console.log(
    `[privasee] Backend still processing (attempt ${nextAttempt}), retrying...`
  );
  await delay(POLL_INTERVAL_MS);
  return pollUntilReady(endpoint, nextAttempt);
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
  const cacheKey = getTabDomainKey(tabId, domain);
  if (urls.length === 0) return;
  if (tabFetchInFlight.has(cacheKey)) return;

  tabFetchInFlight.add(cacheKey);

  const queryString = urls.map((u) => `url=${encodeURIComponent(u)}`).join('&');
  const endpoint = `${TOS_PROCESS_URL}?${queryString}`;

  try {
    const result = await pollUntilReady(endpoint);

    if (result) {
      tabBackendCache.set(cacheKey, result);
      // eslint-disable-next-line no-console
      console.log('[privasee] Backend analysis cached for tab', tabId, result);
      const insight = await buildReadyInsight(domain, result);
      const readyState = createReadyOverlayState(insight);

      // eslint-disable-next-line no-console
      console.log(
        '[privasee] Pushing PRIVACY_INSIGHT_UPDATED with keyConcerns:',
        insight.keyConcerns
      );
      await chrome.tabs
        .sendMessage(tabId, {
          type: 'PRIVACY_INSIGHT_UPDATED',
          payload: readyState,
        })
        .catch(() => undefined);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[privasee] Backend fetch failed:', err);
  } finally {
    tabFetchInFlight.delete(cacheKey);
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

      (async () => {
        const sendResult = (data: OverlayInsightState) => {
          if (typeof tabId === 'number') {
            chrome.tabs
              .sendMessage(tabId, {
                type: 'GET_PRIVACY_INSIGHT_RESULT',
                ok: true,
                data,
              })
              .catch(() => undefined);
          }
        };

        try {
          const cacheKey =
            typeof tabId === 'number' ? getTabDomainKey(tabId, domain) : null;
          const cached = cacheKey ? tabBackendCache.get(cacheKey) : undefined;

          if (cached) {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] Using tab-local cached analysis for ready insight'
            );
            sendResult(
              createReadyOverlayState(await buildReadyInsight(domain, cached))
            );
            return;
          }

          const hydrated = await fetchCachedAnalysisByDomain(domain);
          if (hydrated) {
            if (cacheKey) {
              tabBackendCache.set(cacheKey, hydrated);
            }
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] Hydrated cached analysis from backend cache'
            );
            sendResult(
              createReadyOverlayState(await buildReadyInsight(domain, hydrated))
            );
            return;
          }

          const canProcess = typeof tabId === 'number' && tosUrls.length > 0;
          const isProcessing = cacheKey
            ? tabFetchInFlight.has(cacheKey)
            : false;

          if (hydrated === null) {
            // eslint-disable-next-line no-console
            console.log(
              '[privasee] No cached analysis available — keeping overlay in processing state'
            );
          } else {
            // eslint-disable-next-line no-console
            console.warn(
              '[privasee] Cached analysis lookup failed; keeping overlay in processing state'
            );
          }

          sendResult(createProcessingOverlayState(domain));

          if (canProcess && !isProcessing && typeof tabId === 'number') {
            fetchBackendAnalysis(tabId, domain, tosUrls);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[privasee] GET_PRIVACY_INSIGHT handler error:', err);
          sendResult(createProcessingOverlayState(domain));
        }
      })();

      return undefined;
    }

    if (message.type === 'FETCH_TOS_ENRICHED') {
      const tabId = sender.tab?.id;
      const payload =
        'payload' in message
          ? (message as FetchTosEnrichedMessage).payload
          : undefined;
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
            await chrome.tabs
              .sendMessage(tabId, {
                type: 'FETCH_TOS_ENRICHED_RESULT',
                ok: false,
                error: String(err),
              })
              .catch(() => undefined);
          } else {
            sendResponse({ ok: false, error: String(err) });
          }
        }
      })();
      return true;
    }

    if (message.type === 'GET_CHROME_HISTORY') {
      const payload =
        'payload' in message
          ? (message as GetChromeHistoryMessage).payload
          : undefined;

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
  clearTabDomainEntries(tabId);
});
