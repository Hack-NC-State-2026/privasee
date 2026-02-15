import {
  CSSProperties,
  JSX,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  dashboardProfiles,
  DataManagementLevel,
  metricLabels,
  PrivacyMetricKey,
} from '@/data/dashboardProfiles';
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
  meterGradient: string;
  label: string;
};

const metricOrder: PrivacyMetricKey[] = [
  'dataMinimization',
  'retentionTransparency',
  'thirdPartyExposure',
  'userControl',
  'incidentTrackRecord',
];

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
      'Each card shows detailed privacy metrics, shared data, and review timelines.',
    reason: 'Granular context enables confident account-level decisions and follow-up.',
  },
];

const postureStyles: Record<DataManagementLevel, PostureStyle> = {
  excellent: {
    accent: '#3ef0c4',
    accentSoft: 'rgba(62, 240, 196, 0.2)',
    badgeClass: 'border-emerald-300/50 bg-emerald-300/16 text-emerald-100',
    chipClass: 'border-emerald-300/45 bg-emerald-300/12 text-emerald-100',
    meterGradient: 'linear-gradient(90deg, #3ef0c4, #2dd4bf, #58e8ff)',
    label: 'Stable',
  },
  watch: {
    accent: '#ffb347',
    accentSoft: 'rgba(255, 179, 71, 0.2)',
    badgeClass: 'border-amber-300/50 bg-amber-300/16 text-amber-100',
    chipClass: 'border-amber-300/45 bg-amber-300/12 text-amber-100',
    meterGradient: 'linear-gradient(90deg, #ffb347, #ff8d3b, #ff6a2f)',
    label: 'Watch',
  },
  critical: {
    accent: '#ff5f7b',
    accentSoft: 'rgba(255, 95, 123, 0.2)',
    badgeClass: 'border-rose-300/50 bg-rose-300/16 text-rose-100',
    chipClass: 'border-rose-300/45 bg-rose-300/12 text-rose-100',
    meterGradient: 'linear-gradient(90deg, #ff5f7b, #ff315c, #ff6b6b)',
    label: 'Critical',
  },
};

const formatDate = (isoDate: string): string =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(isoDate));

export default function Options(): JSX.Element {
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>('all');
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<DashboardTheme>(DEFAULT_DASHBOARD_THEME);
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
    const totalAccounts = dashboardProfiles.length;
    const averageScore = Math.round(
      dashboardProfiles.reduce(
        (runningScore, profile) => runningScore + profile.privacyScore,
        0
      ) / totalAccounts
    );

    const criticalCount = dashboardProfiles.filter(
      (profile) => profile.posture === 'critical'
    ).length;

    const monitoredFields = dashboardProfiles.reduce(
      (runningTotal, profile) => runningTotal + profile.sharedData.length,
      0
    );

    const dataTypeFrequency = new Map<string, number>();
    dashboardProfiles.forEach((profile) => {
      profile.sharedData.forEach((field) => {
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
  }, []);

  const filters = useMemo(
    () => [
      {
        key: 'all' as DashboardFilter,
        label: 'All',
        count: dashboardProfiles.length,
      },
      {
        key: 'excellent' as DashboardFilter,
        label: 'Stable',
        count: dashboardProfiles.filter((profile) => profile.posture === 'excellent')
          .length,
      },
      {
        key: 'watch' as DashboardFilter,
        label: 'Watch',
        count: dashboardProfiles.filter((profile) => profile.posture === 'watch')
          .length,
      },
      {
        key: 'critical' as DashboardFilter,
        label: 'Critical',
        count: dashboardProfiles.filter((profile) => profile.posture === 'critical')
          .length,
      },
    ],
    []
  );

  const signalLane = useMemo(
    () =>
      [...dashboardProfiles]
        .sort((left, right) => left.privacyScore - right.privacyScore)
        .slice(0, 6),
    []
  );

  const visibleProfiles = useMemo(() => {
    const cleanedQuery = query.trim().toLowerCase();

    return dashboardProfiles
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
  }, [activeFilter, query]);

  const jumpToSection = (sectionId: string): void => {
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

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
                and sharp risk visibility. Each account card now carries a noir-style
                visual intensity based on data-management posture.
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
            <p className='noir-kpi-label'>Data Fields Monitored</p>
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

          <div className='mt-4 flex flex-wrap gap-2'>
            {summary.topFields.map(([field, count]) => (
              <span key={field} className='noir-top-chip'>
                {field} ({count})
              </span>
            ))}
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
            {signalLane.map((profile, index) => {
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
                  <div className='mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800/80'>
                    <div
                      className='h-full rounded-full'
                      style={{
                        width: `${profile.privacyScore}%`,
                        background: posture.meterGradient,
                      }}
                    />
                  </div>
                  <p className='mt-2 text-xs font-semibold text-slate-300'>
                    Score {profile.privacyScore}
                  </p>
                </article>
              );
            })}
          </div>
        </section>

        {visibleProfiles.length > 0 ? (
          <section id='risk-grid' className='mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {visibleProfiles.map((profile, index) => {
              const posture = postureStyles[profile.posture];
              const visibleSharedData = profile.sharedData.slice(0, 4);
              const hiddenSharedDataCount =
                profile.sharedData.length - visibleSharedData.length;

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
                  <header className='flex items-start justify-between gap-3'>
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
                  </header>

                  <div className='mt-4 grid grid-cols-[84px_1fr] gap-4'>
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

                  <div className='mt-4 space-y-2'>
                    {metricOrder.map((metricKey) => {
                      const value = profile.metrics[metricKey];

                      return (
                        <div key={metricKey}>
                          <div className='mb-1 flex items-center justify-between text-xs text-slate-300'>
                            <span>{metricLabels[metricKey]}</span>
                            <span className='font-semibold text-slate-100'>
                              {value}
                            </span>
                          </div>
                          <div className='h-1.5 overflow-hidden rounded-full bg-slate-800/90'>
                            <div
                              className='h-full rounded-full'
                              style={{
                                width: `${value}%`,
                                background: posture.meterGradient,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className='mt-4'>
                    <p className='text-xs uppercase tracking-[0.14em] text-slate-400'>
                      Shared Data
                    </p>
                    <div className='mt-2 flex flex-wrap gap-2'>
                      {visibleSharedData.map((item) => (
                        <span
                          key={`${profile.domain}-${item}`}
                          className={`rounded-full border px-2.5 py-1 text-xs ${posture.chipClass}`}>
                          {item}
                        </span>
                      ))}

                      {hiddenSharedDataCount > 0 ? (
                        <span className='rounded-full border border-slate-500/60 bg-slate-800/70 px-2.5 py-1 text-xs text-slate-200'>
                          +{hiddenSharedDataCount} more
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className='mt-4 flex items-center justify-between text-xs text-slate-400'>
                    <p>Created {formatDate(profile.accountCreated)}</p>
                    <p>Reviewed {formatDate(profile.lastReviewed)}</p>
                  </div>

                  <div className='mt-1 text-xs text-slate-300'>
                    {profile.permissions.length} permission groups
                  </div>
                </article>
              );
            })}
          </section>
        ) : (
          <section id='risk-grid' className='noir-empty privacy-reveal'>
            <p className='text-lg font-semibold text-slate-100'>
              No accounts matched your filters.
            </p>
            <p className='mt-2 text-sm text-slate-400'>
              Try clearing the search or selecting a different posture filter.
            </p>
          </section>
        )}
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
    </div>
  );
}
