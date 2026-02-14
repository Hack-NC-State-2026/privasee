export type DataManagementLevel = 'excellent' | 'watch' | 'critical';

export type PrivacyMetricKey =
  | 'dataMinimization'
  | 'retentionTransparency'
  | 'thirdPartyExposure'
  | 'userControl'
  | 'incidentTrackRecord';

export type PrivacyMetricSet = Record<PrivacyMetricKey, number>;

export type WebsiteProfile = {
  domain: string;
  name: string;
  category: string;
  accountCreated: string;
  lastReviewed: string;
  sharedData: string[];
  permissions: string[];
  riskSignals: string[];
  privacyScore: number;
  posture: DataManagementLevel;
  verdict: string;
  metrics: PrivacyMetricSet;
};

export const metricLabels: Record<PrivacyMetricKey, string> = {
  dataMinimization: 'Data Minimization',
  retentionTransparency: 'Retention Transparency',
  thirdPartyExposure: 'Third-Party Exposure',
  userControl: 'User Controls',
  incidentTrackRecord: 'Incident Track Record',
};

export const dashboardProfiles: WebsiteProfile[] = [
  {
    domain: 'github.com',
    name: 'GitHub',
    category: 'Developer Tools',
    accountCreated: '2021-03-14',
    lastReviewed: '2026-01-27',
    sharedData: [
      'Full name',
      'Email address',
      'IP address',
      'Public repositories',
      'Billing metadata',
    ],
    permissions: ['Account', 'Security', 'Location (IP)'],
    riskSignals: ['Clear retention policy', 'Granular privacy controls'],
    privacyScore: 90,
    posture: 'excellent',
    verdict: 'Strong transparency and controls with low external exposure.',
    metrics: {
      dataMinimization: 92,
      retentionTransparency: 87,
      thirdPartyExposure: 82,
      userControl: 94,
      incidentTrackRecord: 95,
    },
  },
  {
    domain: 'notion.so',
    name: 'Notion',
    category: 'Productivity',
    accountCreated: '2022-07-19',
    lastReviewed: '2026-01-16',
    sharedData: [
      'Email address',
      'Workspace content',
      'Device identifiers',
      'Usage analytics',
    ],
    permissions: ['Account', 'Workspace', 'Telemetry'],
    riskSignals: ['Good account controls', 'Moderate analytics collection'],
    privacyScore: 84,
    posture: 'excellent',
    verdict: 'Balanced collection footprint with actionable privacy controls.',
    metrics: {
      dataMinimization: 81,
      retentionTransparency: 82,
      thirdPartyExposure: 76,
      userControl: 88,
      incidentTrackRecord: 93,
    },
  },
  {
    domain: 'spotify.com',
    name: 'Spotify',
    category: 'Entertainment',
    accountCreated: '2020-10-05',
    lastReviewed: '2026-02-03',
    sharedData: [
      'Email address',
      'Listening history',
      'Ad identifiers',
      'Approximate location',
      'Payment method',
    ],
    permissions: ['Account', 'Media Activity', 'Ad Preferences'],
    riskSignals: ['Advertising profile linkage', 'Moderate user controls'],
    privacyScore: 72,
    posture: 'watch',
    verdict: 'Useful controls exist, but ad profiling and sharing remain notable.',
    metrics: {
      dataMinimization: 70,
      retentionTransparency: 68,
      thirdPartyExposure: 58,
      userControl: 74,
      incidentTrackRecord: 81,
    },
  },
  {
    domain: 'figma.com',
    name: 'Figma',
    category: 'Design Tools',
    accountCreated: '2023-01-22',
    lastReviewed: '2026-01-31',
    sharedData: [
      'Email address',
      'Project files',
      'Team metadata',
      'Device and browser data',
    ],
    permissions: ['Account', 'Collaboration', 'Telemetry'],
    riskSignals: ['File metadata retained', 'Good enterprise controls'],
    privacyScore: 76,
    posture: 'watch',
    verdict: 'Generally healthy controls with moderate collaboration data depth.',
    metrics: {
      dataMinimization: 74,
      retentionTransparency: 70,
      thirdPartyExposure: 64,
      userControl: 79,
      incidentTrackRecord: 86,
    },
  },
  {
    domain: 'linkedin.com',
    name: 'LinkedIn',
    category: 'Professional Network',
    accountCreated: '2018-08-09',
    lastReviewed: '2026-01-25',
    sharedData: [
      'Employment history',
      'Email address',
      'Phone number',
      'Engagement signals',
      'Ad interaction history',
    ],
    permissions: ['Account', 'Professional Graph', 'Ad Personalization'],
    riskSignals: ['Extensive profile graph', 'Large ad personalization scope'],
    privacyScore: 63,
    posture: 'watch',
    verdict: 'High-profile visibility and ad linkage call for periodic review.',
    metrics: {
      dataMinimization: 60,
      retentionTransparency: 62,
      thirdPartyExposure: 49,
      userControl: 66,
      incidentTrackRecord: 78,
    },
  },
  {
    domain: 'airbnb.com',
    name: 'Airbnb',
    category: 'Travel',
    accountCreated: '2019-12-11',
    lastReviewed: '2026-01-14',
    sharedData: [
      'Government ID',
      'Payment method',
      'Location history',
      'Messaging content',
      'Trip metadata',
    ],
    permissions: ['Identity', 'Payments', 'Travel Activity'],
    riskSignals: ['Sensitive identity data', 'Retention clarity varies by region'],
    privacyScore: 58,
    posture: 'watch',
    verdict: 'Sensitive travel and identity fields require active account hygiene.',
    metrics: {
      dataMinimization: 56,
      retentionTransparency: 54,
      thirdPartyExposure: 52,
      userControl: 61,
      incidentTrackRecord: 69,
    },
  },
  {
    domain: 'amazon.com',
    name: 'Amazon',
    category: 'Commerce',
    accountCreated: '2017-04-03',
    lastReviewed: '2026-02-05',
    sharedData: [
      'Name and address',
      'Payment method',
      'Purchase history',
      'Voice assistant interactions',
      'Device IDs',
    ],
    permissions: ['Account', 'Commerce', 'Ad Network'],
    riskSignals: ['Broad ecosystem linkage', 'Long-term behavioral history'],
    privacyScore: 46,
    posture: 'critical',
    verdict: 'High-volume behavioral collection and broad internal data linkage.',
    metrics: {
      dataMinimization: 42,
      retentionTransparency: 48,
      thirdPartyExposure: 36,
      userControl: 50,
      incidentTrackRecord: 58,
    },
  },
  {
    domain: 'x.com',
    name: 'X',
    category: 'Social Media',
    accountCreated: '2016-11-21',
    lastReviewed: '2026-01-10',
    sharedData: [
      'Email address',
      'Phone number',
      'Behavioral engagement',
      'Approximate location',
      'Ad profile data',
    ],
    permissions: ['Account', 'Engagement', 'Ad Personalization'],
    riskSignals: ['High ad profile dependency', 'Policy updates can be volatile'],
    privacyScore: 41,
    posture: 'critical',
    verdict: 'Significant profiling surface with limited stable retention guarantees.',
    metrics: {
      dataMinimization: 39,
      retentionTransparency: 43,
      thirdPartyExposure: 30,
      userControl: 45,
      incidentTrackRecord: 56,
    },
  },
  {
    domain: 'uber.com',
    name: 'Uber',
    category: 'Mobility',
    accountCreated: '2019-02-18',
    lastReviewed: '2026-01-12',
    sharedData: [
      'Precise location',
      'Payment method',
      'Trip history',
      'Device identifiers',
      'Support transcripts',
    ],
    permissions: ['Account', 'Location', 'Payments'],
    riskSignals: ['Precise location retention', 'Frequent third-party service links'],
    privacyScore: 44,
    posture: 'critical',
    verdict: 'Location-heavy data model and multiple processing partners increase risk.',
    metrics: {
      dataMinimization: 41,
      retentionTransparency: 46,
      thirdPartyExposure: 34,
      userControl: 47,
      incidentTrackRecord: 54,
    },
  },
  {
    domain: 'netflix.com',
    name: 'Netflix',
    category: 'Entertainment',
    accountCreated: '2018-01-29',
    lastReviewed: '2026-01-30',
    sharedData: [
      'Payment method',
      'Viewing history',
      'Device details',
      'A/B experiment IDs',
    ],
    permissions: ['Account', 'Media Activity', 'Diagnostics'],
    riskSignals: ['Behavioral recommendation profiling', 'Moderate telemetry depth'],
    privacyScore: 68,
    posture: 'watch',
    verdict: 'Data collection is moderate, but recommendation profiling is persistent.',
    metrics: {
      dataMinimization: 66,
      retentionTransparency: 64,
      thirdPartyExposure: 57,
      userControl: 71,
      incidentTrackRecord: 79,
    },
  },
];
