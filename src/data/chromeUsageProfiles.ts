import {
  AttributeSeverityColor,
  DataUsageProfile,
  DataManagementLevel,
  PrivacyMetricSet,
  WebsiteProfile,
} from '@/data/dashboardProfiles';

const BACKEND_ORIGIN = 'http://localhost:8000';
const TOS_CACHE_PREFIX = 'tos:process:';
const TOS_CACHED_ANALYSES_URL = `${BACKEND_ORIGIN}/api/tos_processor/cached`;
const ATTRIBUTE_SEVERITY_URL = `${BACKEND_ORIGIN}/api/attribute_severity/`;

const HISTORY_LOOKBACK_DAYS = 365;
const HISTORY_MAX_RESULTS = 5000;
const MAX_PROFILE_COUNT = 24;

const MULTI_PART_TLDS = new Set([
  'co.uk',
  'org.uk',
  'ac.uk',
  'co.in',
  'com.au',
  'com.br',
  'co.jp',
  'co.kr',
  'com.mx',
  'co.nz',
]);

type DomainAggregate = {
  domain: string;
  firstVisitTime: number;
  lastVisitTime: number;
  visitCount: number;
  typedCount: number;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 2147483647;
  }
  return hash;
};

const toBaseDomain = (hostname: string): string => {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) return hostname;

  const suffix = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(suffix)) {
    return parts.slice(-3).join('.');
  }

  return parts.slice(-2).join('.');
};

const normalizeDomainFromUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    let hostname = parsed.hostname.toLowerCase();
    if (!hostname || hostname === 'localhost') return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;

    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }

    return toBaseDomain(hostname);
  } catch {
    return null;
  }
};

const toDisplayName = (domain: string): string => {
  const base = domain.split('.')[0] ?? domain;
  return base
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
};

const categorizeDomain = (domain: string): string => {
  if (/github|gitlab|vercel|netlify|aws|azure|cloudflare/.test(domain)) {
    return 'Developer Tools';
  }
  if (/notion|slack|figma|asana|trello|zoom|atlassian|jira/.test(domain)) {
    return 'Productivity';
  }
  if (/youtube|netflix|spotify|primevideo|disney|hulu|twitch/.test(domain)) {
    return 'Entertainment';
  }
  if (/amazon|ebay|etsy|walmart|target|bestbuy/.test(domain)) {
    return 'Commerce';
  }
  if (/linkedin|facebook|instagram|x\.com|reddit|pinterest|snapchat/.test(domain)) {
    return 'Social';
  }
  if (/uber|lyft|airbnb|booking|expedia/.test(domain)) {
    return 'Travel';
  }
  if (/google|microsoft|apple|dropbox|adobe|salesforce/.test(domain)) {
    return 'Platform';
  }
  return 'Web App';
};

const toPostureFromRiskScore = (riskScore: number): DataManagementLevel => {
  if (riskScore < 35) return 'excellent';
  if (riskScore < 65) return 'watch';
  return 'critical';
};

const toVerdict = (posture: DataManagementLevel): string => {
  if (posture === 'excellent') {
    return 'Lower observed exposure with more stable privacy posture.';
  }
  if (posture === 'watch') {
    return 'Moderate exposure; review permissions and retention controls regularly.';
  }
  return 'Higher exposure pattern; prioritize this app for permissions review.';
};

const buildMetrics = (domain: string, baseScore: number): PrivacyMetricSet => {
  const seed = hashString(domain);
  return {
    dataMinimization: clamp(baseScore + ((seed % 15) - 7), 20, 97),
    retentionTransparency: clamp(
      baseScore + ((Math.floor(seed / 4) % 17) - 8),
      20,
      97
    ),
    thirdPartyExposure: clamp(
      baseScore + ((Math.floor(seed / 16) % 19) - 9),
      20,
      97
    ),
    userControl: clamp(baseScore + ((Math.floor(seed / 64) % 13) - 6), 20, 97),
    incidentTrackRecord: clamp(
      baseScore + ((Math.floor(seed / 256) % 11) - 5),
      20,
      97
    ),
  };
};

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const toStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
};

const titleCase = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const normalizeDataUsageValue = (value: unknown): string => {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value !== 'string') return 'unknown';

  const normalized = value.trim().toLowerCase();
  if (['true', 'yes', '1', 'active', 'enabled'].includes(normalized)) {
    return 'true';
  }
  if (['false', 'no', '0', 'disabled'].includes(normalized)) {
    return 'false';
  }
  if (normalized === 'not_found') return 'not_found';
  if (!normalized) return 'unknown';
  return normalized;
};

const readNestedStatus = (value: unknown): string => {
  const asRecord = toRecord(value);
  if (!asRecord) return normalizeDataUsageValue(value);
  return normalizeDataUsageValue(asRecord.status);
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (!Number.isFinite(value)) return null;
  return value;
};

const normalizeDateFromValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const normalizeSeverityColor = (
  value: unknown
): AttributeSeverityColor | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'red' || normalized === 'yellow' || normalized === 'green') {
    return normalized;
  }
  return null;
};

const normalizeIdentifierToSeverityKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, '_');

const buildIdentifierSeverityMap = (
  personalIdentifiers: string[],
  severityByAttributeKey: Record<string, AttributeSeverityColor>
): Record<string, AttributeSeverityColor> =>
  personalIdentifiers.reduce<Record<string, AttributeSeverityColor>>(
    (running, identifier) => {
      const key = normalizeIdentifierToSeverityKey(identifier);
      return {
        ...running,
        [identifier]: severityByAttributeKey[key] ?? 'yellow',
      };
    },
    {}
  );

const calculateRiskScoreFromSeverityMap = (
  identifierSeverityByIdentifier: Record<string, AttributeSeverityColor>
): number => {
  const colors = Object.values(identifierSeverityByIdentifier);
  if (colors.length === 0) return 0;

  let redCount = 0;
  let yellowCount = 0;
  let greenCount = 0;

  colors.forEach((color) => {
    if (color === 'red') {
      redCount += 1;
      return;
    }
    if (color === 'yellow') {
      yellowCount += 1;
      return;
    }
    greenCount += 1;
  });

  const weightedTotal = redCount * 3 + yellowCount * 2 + greenCount;
  const weightedAverage = (weightedTotal / (colors.length * 3)) * 100;
  return Math.round(weightedAverage);
};

const buildRiskSignals = (
  analysis: Record<string, unknown>,
  redFlags: NonNullable<WebsiteProfile['redFlags']>
): string[] => {
  const overlaySummary = toRecord(analysis.overlay_summary);
  const topRiskAttributes = Array.isArray(
    overlaySummary?.top_high_risk_attributes
  )
    ? overlaySummary.top_high_risk_attributes
    : [];

  const overlayTitles = topRiskAttributes
    .map((rawItem) => toRecord(rawItem))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => (typeof item.title === 'string' ? item.title.trim() : ''))
    .filter((title) => title.length > 0);

  if (overlayTitles.length > 0) {
    return overlayTitles.slice(0, 4);
  }

  return redFlags
    .map((flag) => flag.cause)
    .filter((cause) => cause.trim().length > 0)
    .slice(0, 4);
};

export type ParsedPolicyDetails = {
  personalIdentifiers: string[];
  dataUsage: DataUsageProfile;
  retentionDuration: string | null;
  vagueRetentionLanguage: boolean | null;
  redFlags: NonNullable<WebsiteProfile['redFlags']>;
};

export function extractPolicyDetailsFromAnalysis(
  analysis: Record<string, unknown>
): ParsedPolicyDetails {
  const dataCollection = toRecord(analysis.data_collection);
  const personalIdentifierSet = new Set<string>();
  Object.entries(dataCollection ?? {}).forEach(([rawKey, rawValue]) => {
    const collectionEntry = toRecord(rawValue);
    const typedValues = toStringArray(collectionEntry?.types);
    if (typedValues.length > 0) {
      typedValues
        .map(titleCase)
        .filter((value) => value.length > 0)
        .forEach((value) => personalIdentifierSet.add(value));
      return;
    }

    const statusSource =
      collectionEntry && 'status' in collectionEntry
        ? collectionEntry.status
        : rawValue;
    if (readNestedStatus(statusSource) === 'true') {
      const formattedKey = titleCase(rawKey);
      if (formattedKey.length > 0) {
        personalIdentifierSet.add(formattedKey);
      }
    }
  });
  const personalIdentifiers = [...personalIdentifierSet];

  const dataUsageSection = toRecord(analysis.data_usage);
  const dataUsageEntries = Object.entries(dataUsageSection ?? {}).map(
    ([rawKey, rawValue]) => [rawKey, readNestedStatus(rawValue)] as const
  );
  const dataUsage = dataUsageEntries.reduce<DataUsageProfile>(
    (running, [rawKey, status]) => ({
      ...running,
      [rawKey]: status,
    }),
    {}
  );

  const retention = toRecord(analysis.retention);
  const retentionDurationRaw =
    typeof retention?.retention_duration === 'string'
      ? retention.retention_duration
      : null;
  const vagueRetentionNode = toRecord(retention?.vague_retention_language);
  const vagueRetentionStatus = readNestedStatus(vagueRetentionNode?.status);
  let vagueRetentionLanguage: boolean | null = null;
  if (vagueRetentionStatus === 'true') {
    vagueRetentionLanguage = true;
  } else if (vagueRetentionStatus === 'false') {
    vagueRetentionLanguage = false;
  }

  const redFlagItems = Array.isArray(analysis.red_flags) ? analysis.red_flags : [];
  const redFlags = redFlagItems
    .map((item) => toRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .map((item) => {
      const causeFromClause =
        typeof item.clause === 'string' ? item.clause.trim() : '';
      const causeFromExplanation =
        typeof item.explanation === 'string' ? item.explanation.trim() : '';
      const severity =
        typeof item.severity === 'string' && item.severity.trim().length > 0
          ? item.severity.trim().toLowerCase()
          : 'unknown';
      return {
        cause: causeFromClause || causeFromExplanation || 'No cause provided.',
        severity,
      };
    });

  return {
    personalIdentifiers,
    dataUsage,
    retentionDuration: retentionDurationRaw,
    vagueRetentionLanguage,
    redFlags,
  };
}

const buildProfileFromAnalysis = (
  record: DomainAggregate,
  analysis: Record<string, unknown>,
  severityByAttributeKey: Record<string, AttributeSeverityColor>
): WebsiteProfile => {
  const parsedDetails = extractPolicyDetailsFromAnalysis(analysis);
  const scores = toRecord(analysis.scores);
  const metadata = toRecord(analysis.metadata);
  const identifierSeverityByIdentifier = buildIdentifierSeverityMap(
    parsedDetails.personalIdentifiers,
    severityByAttributeKey
  );
  const privacyScore = clamp(
    calculateRiskScoreFromSeverityMap(identifierSeverityByIdentifier),
    0,
    100
  );
  const posture = toPostureFromRiskScore(privacyScore);
  const fallbackMetricBaseScore = clamp(100 - privacyScore, 0, 100);
  const scoreDrivenMetrics = buildMetrics(record.domain, fallbackMetricBaseScore);
  const metrics: PrivacyMetricSet = {
    dataMinimization: clamp(
      Math.round(
        toFiniteNumber(scores?.data_minimization) ??
          scoreDrivenMetrics.dataMinimization
      ),
      0,
      100
    ),
    retentionTransparency: clamp(
      Math.round(
        toFiniteNumber(scores?.retention_transparency) ??
          scoreDrivenMetrics.retentionTransparency
      ),
      0,
      100
    ),
    thirdPartyExposure: clamp(
      Math.round(
        toFiniteNumber(scores?.third_party_exposure) ??
          scoreDrivenMetrics.thirdPartyExposure
      ),
      0,
      100
    ),
    userControl: clamp(
      Math.round(
        toFiniteNumber(scores?.user_control) ?? scoreDrivenMetrics.userControl
      ),
      0,
      100
    ),
    incidentTrackRecord: clamp(
      Math.round(scoreDrivenMetrics.incidentTrackRecord),
      0,
      100
    ),
  };

  const policyLastUpdated = normalizeDateFromValue(metadata?.policy_last_updated);
  const { personalIdentifiers } = parsedDetails;

  return {
    domain: record.domain,
    name: toDisplayName(record.domain),
    category: categorizeDomain(record.domain),
    accountCreated: new Date(record.firstVisitTime).toISOString(),
    lastReviewed: policyLastUpdated ?? new Date(record.lastVisitTime).toISOString(),
    sharedData: personalIdentifiers,
    permissions: [],
    riskSignals: buildRiskSignals(analysis, parsedDetails.redFlags),
    personalIdentifiers,
    attributeSeverityByIdentifier: identifierSeverityByIdentifier,
    dataUsage: parsedDetails.dataUsage,
    retentionDuration: parsedDetails.retentionDuration ?? undefined,
    vagueRetentionLanguage: parsedDetails.vagueRetentionLanguage,
    redFlags: parsedDetails.redFlags,
    privacyScore,
    posture,
    verdict: toVerdict(posture),
    metrics,
  };
};

type GetChromeHistoryResponse = {
  ok: boolean;
  items?: chrome.history.HistoryItem[];
  error?: string;
};

type CachedAnalysesResponse = {
  matched?: Record<string, Record<string, unknown>>;
  error?: string;
};

type AttributeSeverityResponse = Record<string, unknown>;

const queryHistoryViaBackground = async (): Promise<chrome.history.HistoryItem[]> => {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime messaging is unavailable in this context.');
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'GET_CHROME_HISTORY',
    payload: {
      text: '',
      startTime: Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
      maxResults: HISTORY_MAX_RESULTS,
    },
  })) as GetChromeHistoryResponse;

  if (!response?.ok) {
    throw new Error(
      response?.error ?? 'Failed to fetch Chrome history from background.'
    );
  }

  return response.items ?? [];
};

const queryHistory = async (): Promise<chrome.history.HistoryItem[]> =>
  new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined') {
      reject(new Error('Chrome extension APIs are unavailable in this context.'));
      return;
    }

    if (!chrome.history?.search) {
      queryHistoryViaBackground().then(resolve).catch(reject);
      return;
    }

    chrome.history.search(
      {
        text: '',
        startTime: Date.now() - HISTORY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
        maxResults: HISTORY_MAX_RESULTS,
      },
      (items) => {
        const { lastError } = chrome.runtime;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        resolve(items ?? []);
      }
    );
  });

const aggregateHistory = (items: chrome.history.HistoryItem[]): DomainAggregate[] => {
  const domainMap = new Map<string, DomainAggregate>();

  items.forEach((item) => {
    if (!item.url) return;

    const normalizedDomain = normalizeDomainFromUrl(item.url);
    if (!normalizedDomain) return;

    const eventTime = Math.round(item.lastVisitTime ?? Date.now());
    const visitCount = item.visitCount ?? 1;
    const typedCount = item.typedCount ?? 0;
    const existing = domainMap.get(normalizedDomain);

    if (!existing) {
      domainMap.set(normalizedDomain, {
        domain: normalizedDomain,
        firstVisitTime: eventTime,
        lastVisitTime: eventTime,
        visitCount,
        typedCount,
      });
      return;
    }

    existing.firstVisitTime = Math.min(existing.firstVisitTime, eventTime);
    existing.lastVisitTime = Math.max(existing.lastVisitTime, eventTime);
    existing.visitCount += visitCount;
    existing.typedCount += typedCount;
  });

  const now = Date.now();
  return [...domainMap.values()]
    .sort((left, right) => {
      const leftAgeDays = (now - left.lastVisitTime) / (1000 * 60 * 60 * 24);
      const rightAgeDays = (now - right.lastVisitTime) / (1000 * 60 * 60 * 24);

      const leftRank =
        left.visitCount * 2 + left.typedCount * 4 + Math.max(0, 35 - leftAgeDays);
      const rightRank =
        right.visitCount * 2 +
        right.typedCount * 4 +
        Math.max(0, 35 - rightAgeDays);

      return rightRank - leftRank;
    })
    .slice(0, MAX_PROFILE_COUNT);
};

const fetchCachedAnalyses = async (
  domains: string[]
): Promise<Record<string, Record<string, unknown>>> => {
  if (domains.length === 0) {
    return {};
  }

  const query = new URLSearchParams();
  domains.forEach((domain) => {
    query.append('domain', domain);
  });

  const requestUrl = `${TOS_CACHED_ANALYSES_URL}?${query.toString()}`;
  const response = await fetch(requestUrl);
  const payload = (await response
    .json()
    .catch(() => ({}))) as CachedAnalysesResponse;

  if (!response.ok) {
    const backendError =
      typeof payload.error === 'string' && payload.error.trim().length > 0
        ? payload.error
        : `Backend returned ${response.status}`;
    throw new Error(
      `Failed to load cached policy analyses (${backendError}). Expected keys with prefix ${TOS_CACHE_PREFIX}<domain>.`
    );
  }

  const matched = toRecord(payload.matched);
  if (!matched) return {};

  const parsed: Record<string, Record<string, unknown>> = {};
  Object.entries(matched).forEach(([domain, rawAnalysis]) => {
    const analysis = toRecord(rawAnalysis);
    if (!analysis) return;
    parsed[domain] = analysis;
  });

  return parsed;
};

const fetchAttributeSeverityMap = async (): Promise<
  Record<string, AttributeSeverityColor>
> => {
  const response = await fetch(ATTRIBUTE_SEVERITY_URL);
  const payload = (await response
    .json()
    .catch(() => ({}))) as AttributeSeverityResponse;

  if (!response.ok) {
    throw new Error(
      `Failed to load attribute severity map (status ${response.status}) from config:attribute_severity.`
    );
  }

  const severityByAttributeKey: Record<string, AttributeSeverityColor> = {};
  Object.entries(payload).forEach(([attribute, rawEntry]) => {
    const entry = toRecord(rawEntry);
    const color = normalizeSeverityColor(entry?.color);
    if (!color) return;
    severityByAttributeKey[attribute.trim().toLowerCase()] = color;
  });

  return severityByAttributeKey;
};

export const buildChromeSiteSettingsUrl = (domain: string): string =>
  `chrome://settings/content/all?searchSubpage=${encodeURIComponent(
    domain
  )}&search=permissions`;

export const loadChromeUsageProfiles = async (): Promise<WebsiteProfile[]> => {
  const historyItems = await queryHistory();
  const topDomains = aggregateHistory(historyItems);
  if (topDomains.length === 0) return [];

  const domains = topDomains.map((item) => item.domain);
  const [cachedAnalysesByDomain, severityByAttributeKey] = await Promise.all([
    fetchCachedAnalyses(domains),
    fetchAttributeSeverityMap(),
  ]);

  return topDomains
    .map((item) => {
      const analysis = cachedAnalysesByDomain[item.domain];
      if (!analysis) return null;
      return buildProfileFromAnalysis(item, analysis, severityByAttributeKey);
    })
    .filter((profile): profile is WebsiteProfile => Boolean(profile));
};
