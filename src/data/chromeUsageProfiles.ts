import {
  DataUsageProfile,
  DataManagementLevel,
  PrivacyMetricSet,
  WebsiteProfile,
} from '@/data/dashboardProfiles';

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

const PERSONAL_IDENTIFIER_PRESETS: string[][] = [
  ['Name', 'Email address', 'Physical address', 'IP address'],
  [
    'Name',
    'Email address',
    'Billing address',
    'Financial account',
  ],
  ['Email address', 'Date of birth', 'Gender', 'IP address'],
  [
    'Account identifier',
    'IP address',
    'Device identifier',
    'Location (IP-derived)',
  ],
];

const PERMISSION_PRESETS: string[][] = [
  ['Notifications', 'Camera / Mic', 'Cookies'],
  ['Pop-ups', 'Location', 'Background sync'],
  ['Sound', 'Automatic downloads', 'Clipboard'],
  ['Third-party cookies', 'Device sensors', 'Cross-site tracking'],
];

const RISK_SIGNAL_PRESETS: string[][] = [
  ['Requires periodic permission review', 'Broad data processing surface'],
  ['Cookie and storage persistence detected', 'Potential cross-site linkage'],
  ['Multiple browser capabilities requested', 'Review retention disclosures'],
  ['Sign-in plus tracking signals present', 'Needs manual controls review'],
];

const DATA_USAGE_PRESETS: DataUsageProfile[] = [
  {
    modelTraining: 'not_found',
    advertising: 'true',
    dataSale: 'false',
    crossCompanySharing: 'true',
    anonymizationClaimed: 'true',
  },
  {
    modelTraining: 'not_found',
    advertising: 'true',
    dataSale: 'not_found',
    crossCompanySharing: 'true',
    anonymizationClaimed: 'true',
  },
  {
    modelTraining: 'not_found',
    advertising: 'false',
    dataSale: 'false',
    crossCompanySharing: 'true',
    anonymizationClaimed: 'true',
  },
];

const RETENTION_DETAIL_PRESETS = [
  { retentionDuration: 'case_by_case', vagueRetentionLanguage: true },
  { retentionDuration: 'not_specified', vagueRetentionLanguage: true },
  { retentionDuration: 'policy_defined', vagueRetentionLanguage: false },
];

const RED_FLAG_PRESETS: NonNullable<WebsiteProfile['redFlags']>[] = [
  [
    {
      cause:
        'Collection includes sensitive profile categories with high misuse impact.',
      severity: 'high',
    },
    {
      cause: 'Retention commitments are broad and not tied to a fixed timeline.',
      severity: 'medium',
    },
  ],
  [
    {
      cause: 'Cross-company data sharing expands profiling surface area.',
      severity: 'medium',
    },
    {
      cause: 'Advertising data flows can link activity across services.',
      severity: 'medium',
    },
  ],
  [
    {
      cause: 'Persistent device and network signals increase tracking risk.',
      severity: 'high',
    },
  ],
];

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

const computePrivacyScore = (domain: string, visitCount: number): number => {
  const seed = hashString(domain);
  const variability = seed % 51;
  const activityPenalty = clamp(Math.round(visitCount / 10), 0, 15);
  return clamp(92 - variability - activityPenalty, 28, 96);
};

const toPosture = (privacyScore: number): DataManagementLevel => {
  if (privacyScore >= 80) return 'excellent';
  if (privacyScore >= 58) return 'watch';
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

const pickPreset = <T>(collection: T[], domain: string): T =>
  collection[hashString(domain) % collection.length];

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

export type ParsedPolicyDetails = {
  personalIdentifiers: string[];
  dataUsage: DataUsageProfile;
  retentionDuration: string | null;
  vagueRetentionLanguage: boolean | null;
  redFlags: NonNullable<WebsiteProfile['redFlags']>;
};

export const extractPolicyDetailsFromAnalysis = (
  analysis: Record<string, unknown>
): ParsedPolicyDetails => {
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
};

type GetChromeHistoryResponse = {
  ok: boolean;
  items?: chrome.history.HistoryItem[];
  error?: string;
};

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

const buildProfile = (record: DomainAggregate): WebsiteProfile => {
  const privacyScore = computePrivacyScore(record.domain, record.visitCount);
  const posture = toPosture(privacyScore);
  const lastVisit = new Date(record.lastVisitTime).toISOString();
  const firstVisit = new Date(record.firstVisitTime).toISOString();
  const personalIdentifiers = pickPreset(
    PERSONAL_IDENTIFIER_PRESETS,
    record.domain
  );
  const retentionDetails = pickPreset(RETENTION_DETAIL_PRESETS, record.domain);

  return {
    domain: record.domain,
    name: toDisplayName(record.domain),
    category: categorizeDomain(record.domain),
    accountCreated: firstVisit,
    lastReviewed: lastVisit,
    sharedData: personalIdentifiers,
    permissions: pickPreset(PERMISSION_PRESETS, record.domain),
    riskSignals: pickPreset(RISK_SIGNAL_PRESETS, record.domain),
    personalIdentifiers,
    dataUsage: pickPreset(DATA_USAGE_PRESETS, record.domain),
    retentionDuration: retentionDetails.retentionDuration,
    vagueRetentionLanguage: retentionDetails.vagueRetentionLanguage,
    redFlags: pickPreset(RED_FLAG_PRESETS, record.domain),
    privacyScore,
    posture,
    verdict: toVerdict(posture),
    metrics: buildMetrics(record.domain, privacyScore),
  };
};

export const buildChromeSiteSettingsUrl = (domain: string): string =>
  `chrome://settings/content/all?searchSubpage=${encodeURIComponent(
    domain
  )}&search=permissions`;

export const loadChromeUsageProfiles = async (): Promise<WebsiteProfile[]> => {
  const historyItems = await queryHistory();
  const topDomains = aggregateHistory(historyItems);
  return topDomains.map(buildProfile);
};
