import {
  CSSProperties,
  JSX,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  DataManagementLevel,
  DataUsageProfile,
  RedFlagItem,
  WebsiteProfile,
} from '@/data/dashboardProfiles';
import {
  buildChromeSiteSettingsUrl,
  loadChromeUsageProfiles,
} from '@/data/chromeUsageProfiles';
import DashboardTour, { DashboardTourStep } from '@/options/DashboardTour';
import {
  DashboardTheme,
  DEFAULT_DASHBOARD_THEME,
  loadDashboardTheme,
  saveDashboardTheme,
} from '@/utils/themePreference';

type DashboardFilter = 'all' | DataManagementLevel;

type PostureStyle = {
  accent: string;
  accentSoft: string;
  badgeClass: string;
  chipClass: string;
  label: string;
};

const jumpTargets = [
  { id: 'noir-control', label: 'Control Deck' },
  { id: 'signal-lane', label: 'Signal Lane' },
  { id: 'risk-grid', label: 'Risk Cards' },
] as const;

const dashboardTourSteps: DashboardTourStep[] = [
  {
    id: 'overview',
    targetId: 'tour-overview',
    title: 'Command Center Overview',
    description:
      'This hero panel sets context, offers jump navigation, and exposes global controls.',
    reason: 'Fast orientation reduces friction before users start triaging risks.',
  },
  {
    id: 'kpis',
    targetId: 'tour-kpis',
    title: 'KPI Snapshot',
    description:
      'These metrics summarize account volume, average privacy score, and critical pressure.',
    reason: 'A high-signal snapshot helps users prioritize without scanning every card.',
  },
  {
    id: 'control',
    targetId: 'noir-control',
    title: 'Control Deck',
    description:
      'Filters and search let users narrow the dataset by posture and account keywords.',
    reason: 'Targeted filtering keeps large dashboards actionable during time pressure.',
  },
  {
    id: 'signal',
    targetId: 'signal-lane',
    title: 'Signal Lane',
    description:
      'This lane ranks the highest exposure accounts first for immediate review.',
    reason: 'Sorting by urgency supports quick response and reduces missed critical items.',
  },
  {
    id: 'risk-cards',
    targetId: 'risk-grid',
    title: 'Risk Cards',
    description:
      'Each card shows identifiers collected, usage behavior, and direct settings controls.',
    reason: 'Granular context enables confident account-level decisions and follow-up.',
  },
];

const postureStyles: Record<DataManagementLevel, PostureStyle> = {
  excellent: {
    accent: '#3ef0c4',
    accentSoft: 'rgba(62, 240, 196, 0.2)',
    badgeClass: 'border-emerald-300/50 bg-emerald-300/16 text-emerald-100',
    chipClass: 'border-emerald-300/45 bg-emerald-300/12 text-emerald-100',
    label: 'Stable',
  },
  watch: {
    accent: '#ffb347',
    accentSoft: 'rgba(255, 179, 71, 0.2)',
    badgeClass: 'border-amber-300/50 bg-amber-300/16 text-amber-100',
    chipClass: 'border-amber-300/45 bg-amber-300/12 text-amber-100',
    label: 'Watch',
  },
  critical: {
    accent: '#ff5f7b',
    accentSoft: 'rgba(255, 95, 123, 0.2)',
    badgeClass: 'border-rose-300/50 bg-rose-300/16 text-rose-100',
    chipClass: 'border-rose-300/45 bg-rose-300/12 text-rose-100',
    label: 'Critical',
  },
};

const fallbackDataUsage: DataUsageProfile = {
  modelTraining: 'not_found',
  advertising: 'true',
  dataSale: 'not_found',
  crossCompanySharing: 'true',
  anonymizationClaimed: 'true',
};

const preferredUsageKeyOrder = [
  'advertising',
  'dataSale',
  'crossCompanySharing',
  'anonymizationClaimed',
  'modelTraining',
];

const getPersonalIdentifiers = (profile: WebsiteProfile): string[] =>
  profile.personalIdentifiers?.length ? profile.personalIdentifiers : profile.sharedData;

const getDataUsage = (profile: WebsiteProfile): DataUsageProfile =>
  profile.dataUsage ?? fallbackDataUsage;

const isTruthyUsageValue = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return ['true', 'yes', '1', 'active', 'enabled'].includes(normalized);
};

const formatUsageKeyLabel = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());

const getActiveUsageLabels = (profile: WebsiteProfile): string[] =>
  Object.entries(getDataUsage(profile))
    .filter(([rawKey, value]) => rawKey.trim().length > 0 && isTruthyUsageValue(value))
    .sort((left, right) => {
      const leftIndex = preferredUsageKeyOrder.indexOf(left[0]);
      const rightIndex = preferredUsageKeyOrder.indexOf(right[0]);

      if (leftIndex === -1 && rightIndex === -1) {
        return left[0].localeCompare(right[0]);
      }
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([rawKey]) => formatUsageKeyLabel(rawKey));

const formatRetentionDuration = (value: string | null | undefined): string => {
  if (!value) return 'Unknown';
  return value
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatBooleanLabel = (value: boolean | null | undefined): string => {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'unknown';
};

const getRedFlags = (profile: WebsiteProfile): RedFlagItem[] => profile.redFlags ?? [];

const getSeverityBadgeClass = (severity: string): string => {
  const normalized = severity.toLowerCase();
  if (normalized === 'high') {
    return 'border-rose-300/45 bg-rose-300/14 text-rose-100';
  }
  if (normalized === 'medium') {
    return 'border-amber-300/45 bg-amber-300/14 text-amber-100';
  }
  return 'border-slate-500/60 bg-slate-800/75 text-slate-200';
};

export default function Options(): JSX.Element {
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('all');
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<DashboardTheme>(DEFAULT_DASHBOARD_THEME);
  const [profiles, setProfiles] = useState<WebsiteProfile[]>([]);
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(true);
  const [profileSourceError, setProfileSourceError] = useState<string | null>(
    null
  );
  const [selectedRedFlagsProfile, setSelectedRedFlagsProfile] =
    useState<WebsiteProfile | null>(null);
  const [isTourOpen, setIsTourOpen] = useState(true);
  const [tourStepIndex, setTourStepIndex] = useState(0);

  useEffect(() => {
    let isMounted = true;

    loadDashboardTheme()
      .then((savedTheme) => {
        if (!isMounted) return;
        setTheme(savedTheme);
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, []);

  const toggleTheme = () => {
    setTheme((currentTheme) => {
      const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
      saveDashboardTheme(nextTheme).catch(() => {});
      return nextTheme;
    });
  };

  const syncChromeProfiles = useCallback(async () => {
    setIsLoadingProfiles(true);
    setProfileSourceError(null);

    try {
      const liveProfiles = await loadChromeUsageProfiles();
      setProfiles(liveProfiles);

      if (liveProfiles.length === 0) {
        setProfileSourceError(
          'No Chrome app usage found in the last 12 months. Visit a few sites, then refresh.'
        );
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load Chrome app data from history.';
      setProfiles([]);
      setProfileSourceError(message);
    } finally {
      setIsLoadingProfiles(false);
    }
  }, []);

  useEffect(() => {
    syncChromeProfiles().catch(() => {});
  }, [syncChromeProfiles]);

  const openSitePermissionsSettings = useCallback((domain: string) => {
    const settingsUrl = buildChromeSiteSettingsUrl(domain);

    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: settingsUrl }, () => {
        if (chrome.runtime.lastError) {
          window.open(settingsUrl, '_blank', 'noopener,noreferrer');
        }
      });
      return;
    }

    window.open(settingsUrl, '_blank', 'noopener,noreferrer');
  }, []);

  const openRedFlagsModal = useCallback((profile: WebsiteProfile) => {
    setSelectedRedFlagsProfile(profile);
  }, []);

  const closeRedFlagsModal = useCallback(() => {
    setSelectedRedFlagsProfile(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedRedFlagsProfile(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const startTour = useCallback(() => {
    setTourStepIndex(0);
    setIsTourOpen(true);
  }, []);

  const closeTour = useCallback(() => {
    setIsTourOpen(false);
  }, []);

  const finishTour = useCallback(() => {
    setIsTourOpen(false);
  }, []);

  const goToPreviousTourStep = useCallback(() => {
    setTourStepIndex((currentIndex) => Math.max(currentIndex - 1, 0));
  }, []);

  const goToNextTourStep = useCallback(() => {
    setTourStepIndex((currentIndex) =>
      Math.min(currentIndex + 1, dashboardTourSteps.length - 1)
    );
  }, []);

  const summary = useMemo(() => {
    const totalAccounts = profiles.length;
    const averageScore =
      totalAccounts === 0
        ? 0
        : Math.round(
            profiles.reduce(
              (runningScore, profile) => runningScore + profile.privacyScore,
              0
            ) / totalAccounts
          );

    const criticalCount = profiles.filter(
      (profile) => profile.posture === 'critical'
    ).length;

    const monitoredFields = profiles.reduce((runningTotal, profile) => {
      const identifiers = getPersonalIdentifiers(profile);
      return runningTotal + identifiers.length;
    }, 0);

    const dataTypeFrequency = new Map<string, number>();
    profiles.forEach((profile) => {
      const identifiers = getPersonalIdentifiers(profile);
      identifiers.forEach((field) => {
        const current = dataTypeFrequency.get(field) ?? 0;
        dataTypeFrequency.set(field, current + 1);
      });
    });

    const topFields = [...dataTypeFrequency.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6);

    return {
      totalAccounts,
      averageScore,
      criticalCount,
      monitoredFields,
      topFields,
    };
  }, [profiles]);

  const filters = useMemo(
    () => [
      {
        key: 'all' as DashboardFilter,
        label: 'All',
        count: profiles.length,
      },
      {
        key: 'excellent' as DashboardFilter,
        label: 'Stable',
        count: profiles.filter((profile) => profile.posture === 'excellent').length,
      },
      {
        key: 'watch' as DashboardFilter,
        label: 'Watch',
        count: profiles.filter((profile) => profile.posture === 'watch').length,
      },
      {
        key: 'critical' as DashboardFilter,
        label: 'Critical',
        count: profiles.filter((profile) => profile.posture === 'critical').length,
      },
    ],
    [profiles]
  );

  const signalLane = useMemo(
    () =>
      [...profiles]
        .sort((left, right) => left.privacyScore - right.privacyScore)
        .slice(0, 6),
    [profiles]
  );

  const visibleProfiles = useMemo(() => {
    const cleanedQuery = query.trim().toLowerCase();

    return profiles
      .filter((profile) =>
        activeFilter === 'all' ? true : profile.posture === activeFilter
      )
      .filter((profile) => {
        if (!cleanedQuery) return true;

        const searchableText =
          `${profile.name} ${profile.domain} ${profile.category}`.toLowerCase();
        return searchableText.includes(cleanedQuery);
      })
      .sort((left, right) => left.privacyScore - right.privacyScore);
  }, [profiles, activeFilter, query]);

  const jumpToSection = (sectionId: string): void => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const renderRiskGrid = (): JSX.Element => {
    if (isLoadingProfiles) {
      return (
        <section id='risk-grid' className='noir-empty privacy-reveal'>
          <p className='text-lg font-semibold text-slate-100'>
            Syncing your Chrome app data...
          </p>
          <p className='mt-2 text-sm text-slate-400'>
            Building cards from your real browsing history.
          </p>
        </section>
      );
    }

    if (visibleProfiles.length === 0) {
      return (
        <section id='risk-grid' className='noir-empty privacy-reveal'>
          <p className='text-lg font-semibold text-slate-100'>
            No app cards matched your filters.
          </p>
          <p className='mt-2 text-sm text-slate-400'>
            Try clearing the search or refreshing Chrome data.
          </p>
        </section>
      );
    }

    return (
      <section id='risk-grid' className='mt-6 grid gap-4'>
        {visibleProfiles.map((profile, index) => {
          const posture = postureStyles[profile.posture];
          const personalIdentifiers = getPersonalIdentifiers(profile);
          const activeUsageLabels = getActiveUsageLabels(profile);
          const redFlags = getRedFlags(profile);
          const retentionDuration = formatRetentionDuration(
            profile.retentionDuration
          );
          const vagueRetentionLanguage = formatBooleanLabel(
            profile.vagueRetentionLanguage
          );

          return (
            <article
              key={profile.domain}
              data-posture={profile.posture}
              className='noir-card privacy-reveal'
              style={
                {
                  '--delay': `${420 + index * 35}ms`,
                  '--noir-accent': posture.accent,
                  '--noir-accent-soft': posture.accentSoft,
                } as CSSProperties
              }>
              <div className='grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)_230px] lg:items-start'>
                <div className='min-w-0'>
                  <div className='flex items-start justify-between gap-3 lg:block'>
                    <div className='min-w-0'>
                      <p className='text-[11px] uppercase tracking-[0.16em] text-slate-400'>
                        {profile.category}
                      </p>
                      <h2 className='mt-1 truncate text-2xl font-black uppercase tracking-[0.04em] text-slate-100'>
                        {profile.name}
                      </h2>
                      <p className='truncate text-sm text-slate-400'>
                        {profile.domain}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.15em] ${posture.badgeClass}`}>
                      {posture.label}
                    </span>
                  </div>

                  <div className='mt-4 grid grid-cols-[84px_1fr] gap-3'>
                    <div
                      className='noir-score-ring'
                      style={{
                        background: `conic-gradient(${posture.accent} ${profile.privacyScore}%, rgba(50, 60, 78, 0.88) ${profile.privacyScore}% 100%)`,
                      }}>
                      <div className='noir-score-core'>
                        <span>{profile.privacyScore}</span>
                      </div>
                    </div>
                    <div>
                      <p className='text-xs uppercase tracking-[0.14em] text-slate-400'>
                        Privacy Verdict
                      </p>
                      <p className='mt-1 text-sm leading-relaxed text-slate-200'>
                        {profile.verdict}
                      </p>
                    </div>
                  </div>
                </div>

                <div className='min-w-0 grid gap-3 lg:grid-cols-2 lg:items-start'>
                  <section className='rounded-2xl border border-slate-600/50 bg-slate-900/45 p-4 min-h-[260px]'>
                    <p className='text-xs uppercase tracking-[0.14em] text-slate-400'>
                      Data Points Collected
                    </p>
                    <div className='mt-3 max-h-52 overflow-y-auto pr-1'>
                      {personalIdentifiers.length > 0 ? (
                        <ul className='space-y-1.5'>
                          {personalIdentifiers.map((item) => (
                            <li
                              key={`${profile.domain}-${item}`}
                              className={`rounded-xl border px-2.5 py-1.5 text-xs ${posture.chipClass}`}>
                              {item}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className='text-xs text-slate-400'>
                          No identifier details available.
                        </p>
                      )}
                    </div>
                  </section>

                  <section className='rounded-2xl border border-slate-600/50 bg-slate-900/45 p-4 min-h-[260px]'>
                    <p className='text-xs uppercase tracking-[0.14em] text-slate-400'>
                      How Data Is Used
                    </p>
                    <div className='mt-3 max-h-52 overflow-y-auto pr-1'>
                      {activeUsageLabels.length === 0 ? (
                        <p className='text-xs text-slate-400'>
                          No active usage flags surfaced.
                        </p>
                      ) : (
                        <ul className='space-y-1.5'>
                          {activeUsageLabels.map((label) => (
                            <li
                              key={`${profile.domain}-${label}`}
                              className='rounded-xl border border-amber-300/45 bg-amber-300/12 px-2.5 py-1.5 text-xs text-amber-100'>
                              {label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </section>
                </div>

                <div className='grid content-start gap-2 text-xs text-slate-300 lg:justify-items-end lg:pt-1'>
                  <div className='w-full max-w-[220px] rounded-xl border border-slate-700/60 bg-slate-950/35 p-2.5 text-[11px] text-slate-200'>
                    <p className='flex items-center justify-between gap-2'>
                      <span className='text-slate-400'>Retention duration</span>
                      <span className='font-semibold'>{retentionDuration}</span>
                    </p>
                    <p className='mt-1.5 flex items-center justify-between gap-2'>
                      <span className='text-slate-400'>Vague retention language</span>
                      <span className='font-semibold'>{vagueRetentionLanguage}</span>
                    </p>
                  </div>
                  <button
                    type='button'
                    onClick={() => openRedFlagsModal(profile)}
                    className='noir-redflags-btn w-full max-w-[220px]'>
                    Red Flags ({redFlags.length})
                  </button>

                  <button
                    type='button'
                    onClick={() => openSitePermissionsSettings(profile.domain)}
                    className='noir-settings-btn w-full max-w-[220px]'>
                    Manage Permissions
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    );
  };

  const selectedProfileRedFlags = selectedRedFlagsProfile
    ? getRedFlags(selectedRedFlagsProfile)
    : [];

  return (
    <div id='my-ext' className='urban-shell text-slate-100' data-theme={theme}>
      <div className='urban-bg' aria-hidden='true'>
        <div className='urban-bg-layer urban-bg-layer-cyan' />
        <div className='urban-bg-layer urban-bg-layer-red' />
        <div className='urban-bg-layer urban-bg-layer-amber' />
        <div className='urban-grid' />
        <div className='urban-rain' />
      </div>

      <main className='urban-main'>
        <header id='tour-overview' className='noir-hero privacy-reveal'>
          <div className='noir-hero-grid'>
            <div>
              <p className='hero-kicker'>Privasee | Urban Noir</p>
              <h1 className='hero-title'>Night-city privacy command center</h1>
              <p className='hero-body'>
                Built for your hackathon theme: rain-slick streets, neon contrast,
                and sharp risk visibility. Each app card is now populated from your
                Chrome usage data with actionable links into permissions settings.
              </p>

              <div className='noir-jump-list'>
                {jumpTargets.map((item) => (
                  <button
                    key={item.id}
                    type='button'
                    onClick={() => jumpToSection(item.id)}
                    className='noir-jump-btn'>
                    {item.label}
                  </button>
                ))}
                <button type='button' onClick={startTour} className='noir-jump-btn'>
                  Start Tour
                </button>
                <button
                  type='button'
                  onClick={toggleTheme}
                  className='theme-toggle-btn'>
                  {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                </button>
              </div>
            </div>

            <aside className='city-window'>
              <div className='city-sweep' />
              <p className='city-caption'>Metro Sector // Live Neon Feed</p>
              <p className='city-caption city-caption-secondary'>
                Synced{' '}
                {new Intl.DateTimeFormat('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                }).format(new Date())}
              </p>
            </aside>
          </div>
        </header>

        <section id='tour-kpis' className='mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
          <article
            className='noir-kpi privacy-reveal'
            style={{ '--delay': '70ms' } as CSSProperties}>
            <p className='noir-kpi-label'>Accounts Tracked</p>
            <p className='noir-kpi-value text-cyan-200'>{summary.totalAccounts}</p>
          </article>
          <article
            className='noir-kpi privacy-reveal'
            style={{ '--delay': '110ms' } as CSSProperties}>
            <p className='noir-kpi-label'>Average Score</p>
            <p className='noir-kpi-value text-emerald-200'>{summary.averageScore}</p>
          </article>
          <article
            className='noir-kpi privacy-reveal'
            style={{ '--delay': '150ms' } as CSSProperties}>
            <p className='noir-kpi-label'>Critical Accounts</p>
            <p className='noir-kpi-value text-rose-200'>{summary.criticalCount}</p>
          </article>
          <article
            className='noir-kpi privacy-reveal'
            style={{ '--delay': '190ms' } as CSSProperties}>
            <p className='noir-kpi-label'>Identifier Fields Monitored</p>
            <p className='noir-kpi-value text-amber-200'>{summary.monitoredFields}</p>
          </article>
        </section>

        <section
          id='noir-control'
          className='noir-control privacy-reveal'
          style={{ '--delay': '240ms' } as CSSProperties}>
          <div className='flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between'>
            <div className='flex flex-wrap gap-2'>
              {filters.map((filter) => (
                <button
                  key={filter.key}
                  type='button'
                  onClick={() => setActiveFilter(filter.key)}
                  className={`noir-filter-pill ${
                    activeFilter === filter.key ? 'is-active' : ''
                  }`}>
                  {filter.label} ({filter.count})
                </button>
              ))}
            </div>

            <div className='w-full lg:w-[360px]'>
              <input
                id='dashboard-search'
                type='search'
                aria-label='Search accounts'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Search by site, domain, or category'
                className='noir-search'
              />
            </div>
          </div>

          <div className='mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
            <p className='text-xs uppercase tracking-[0.14em] text-slate-400'>
              Source: Chrome history (last 12 months){' '}
              {isLoadingProfiles ? '• syncing' : '• live'}
            </p>
            <button
              type='button'
              onClick={() => {
                syncChromeProfiles().catch(() => {});
              }}
              className='noir-filter-pill disabled:cursor-not-allowed disabled:opacity-60'
              disabled={isLoadingProfiles}>
              {isLoadingProfiles ? 'Syncing...' : 'Refresh Apps'}
            </button>
          </div>

          {profileSourceError ? (
            <p className='mt-3 rounded-xl border border-rose-300/35 bg-rose-400/10 px-3 py-2 text-xs text-rose-100'>
              {profileSourceError}
            </p>
          ) : null}

          <div className='mt-4 flex flex-wrap gap-2'>
            {summary.topFields.length > 0 ? (
              summary.topFields.map(([field, count]) => (
                <span key={field} className='noir-top-chip'>
                  {field} ({count})
                </span>
              ))
            ) : (
              <span className='noir-top-chip'>
                Identifier trends appear here after sync
              </span>
            )}
          </div>
        </section>

        <section
          id='signal-lane'
          className='noir-lane privacy-reveal'
          style={{ '--delay': '290ms' } as CSSProperties}>
          <div className='mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between'>
            <div>
              <p className='text-xs uppercase tracking-[0.2em] text-slate-400'>
                Signal Lane
              </p>
              <h2 className='text-lg font-black uppercase tracking-[0.1em] text-slate-100'>
                Highest exposure first
              </h2>
            </div>
            <p className='text-xs text-slate-400'>
              Live priority queue for immediate action
            </p>
          </div>

          <div className='signal-lane-scroll'>
            {signalLane.length > 0 ? (
              signalLane.map((profile, index) => {
                const posture = postureStyles[profile.posture];
                return (
                  <article
                    key={profile.domain}
                    className='signal-card privacy-reveal'
                    style={
                      {
                        '--delay': `${320 + index * 45}ms`,
                        '--signal-accent': posture.accent,
                        '--signal-accent-soft': posture.accentSoft,
                      } as CSSProperties
                    }>
                    <p className='signal-card-category'>{profile.category}</p>
                    <p className='signal-card-name'>{profile.name}</p>
                    <p className='signal-card-domain'>{profile.domain}</p>
                    <p className='mt-3 text-xs font-semibold text-slate-300'>
                      Score {profile.privacyScore}
                    </p>
                  </article>
                );
              })
            ) : (
              <article className='signal-card'>
                <p className='signal-card-category'>Signal Lane</p>
                <p className='signal-card-name'>No Apps Yet</p>
                <p className='signal-card-domain'>
                  Sync Chrome data to populate this queue.
                </p>
              </article>
            )}
          </div>
        </section>

        {renderRiskGrid()}
      </main>

      <DashboardTour
        steps={dashboardTourSteps}
        isOpen={isTourOpen}
        activeStepIndex={tourStepIndex}
        onBack={goToPreviousTourStep}
        onNext={goToNextTourStep}
        onClose={closeTour}
        onFinish={finishTour}
      />

      {selectedRedFlagsProfile ? (
        <div className='fixed inset-0 z-[170] flex items-center justify-center p-4'>
          <button
            type='button'
            aria-label='Close red flags modal'
            onClick={closeRedFlagsModal}
            className='absolute inset-0 bg-black/70 backdrop-blur-[2px]'
          />

          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='red-flags-title'
            className='relative z-[171] w-full max-w-[680px] rounded-3xl border border-cyan-300/35 bg-slate-950/95 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.55)]'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-xs uppercase tracking-[0.16em] text-slate-400'>
                  Policy Alert Panel
                </p>
                <h2
                  id='red-flags-title'
                  className='mt-1 text-xl font-black uppercase tracking-[0.06em] text-slate-100'>
                  Red Flags: {selectedRedFlagsProfile.name}
                </h2>
                <p className='text-sm text-slate-400'>{selectedRedFlagsProfile.domain}</p>
              </div>
              <button
                type='button'
                onClick={closeRedFlagsModal}
                className='rounded-full border border-slate-500/60 bg-slate-800/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-slate-200'>
                Close
              </button>
            </div>

            <div className='mt-4 max-h-[58vh] overflow-y-auto pr-1'>
              {selectedProfileRedFlags.length > 0 ? (
                <div className='space-y-3'>
                  {selectedProfileRedFlags.map((flag, index) => (
                    <article
                      key={`${selectedRedFlagsProfile.domain}-${flag.cause}-${flag.severity}`}
                      className='rounded-2xl border border-slate-700/70 bg-slate-900/65 p-3.5'>
                      <div className='flex items-center justify-between gap-3'>
                        <p className='text-[11px] uppercase tracking-[0.14em] text-slate-400'>
                          Severity
                        </p>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.09em] ${getSeverityBadgeClass(
                            flag.severity
                          )}`}>
                          {flag.severity}
                        </span>
                      </div>
                      <p className='mt-2 text-[11px] uppercase tracking-[0.14em] text-slate-400'>
                        Cause
                      </p>
                      <p className='mt-1 text-sm leading-relaxed text-slate-100'>
                        {flag.cause}
                      </p>
                      <p className='mt-2 text-xs text-slate-500'>
                        Flag {index + 1}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className='text-sm text-slate-300'>
                  No red flags were found for this policy.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
