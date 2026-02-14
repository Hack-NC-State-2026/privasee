import { CSSProperties, JSX, useCallback, useEffect, useMemo, useState } from 'react';
import browser from 'webextension-polyfill';

import {
  dashboardProfiles,
  DataManagementLevel,
} from '@/data/dashboardProfiles';
import {
  DashboardTheme,
  DEFAULT_DASHBOARD_THEME,
  loadDashboardTheme,
  saveDashboardTheme,
} from '@/utils/themePreference';

const postureIndicatorClass: Record<DataManagementLevel, string> = {
  excellent: 'bg-emerald-300',
  watch: 'bg-amber-300',
  critical: 'bg-rose-300',
};

const BACKEND_ORIGIN = 'http://localhost:8000';
const HEALTH_ENDPOINTS = [`${BACKEND_ORIGIN}/api/health`, `${BACKEND_ORIGIN}/api/v1/health`];

type HealthResponse = {
  status: string;
  environment: string;
};

type PolicyLink = { url: string; text: string };

export default function SidePanel(): JSX.Element {
  const [theme, setTheme] = useState<DashboardTheme>(DEFAULT_DASHBOARD_THEME);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [policyLinks, setPolicyLinks] = useState<PolicyLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);

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

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);

    const requestHealthFrom = async (
      index: number,
      lastMessage = 'Failed to fetch health'
    ): Promise<HealthResponse> => {
      if (index >= HEALTH_ENDPOINTS.length) {
        throw new Error(lastMessage);
      }

      try {
        const response = await fetch(HEALTH_ENDPOINTS[index]);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as HealthResponse;
      } catch (requestError) {
        const nextMessage =
          requestError instanceof Error ? requestError.message : 'Network error';
        return requestHealthFrom(index + 1, nextMessage);
      }
    };

    try {
      const data = await requestHealthFrom(0);
      setHealth(data);
      setLoading(false);
    } catch (requestError) {
      setHealth(null);
      const message =
        requestError instanceof Error ? requestError.message : 'Failed to fetch health';
      setError(message);
      setLoading(false);
    }
  }, []);

  const fetchPolicyLinks = useCallback(async () => {
    setLinksLoading(true);
    setLinksError(null);

    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        setPolicyLinks([]);
        setLinksError('No active tab');
        setLinksLoading(false);
        return;
      }

      const response = (await browser.tabs.sendMessage(tab.id, {
        type: 'GET_POLICY_LINKS',
      })) as { links?: PolicyLink[] };

      setPolicyLinks(response?.links ?? []);
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : 'Could not get links from page';
      setPolicyLinks([]);
      setLinksError(message);
    } finally {
      setLinksLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    fetchPolicyLinks();
  }, [fetchPolicyLinks]);

  const snapshot = useMemo(() => {
    const totalAccounts = dashboardProfiles.length;
    const riskyAccounts = dashboardProfiles.filter(
      (profile) => profile.posture === 'critical'
    ).length;
    const averageScore = Math.round(
      dashboardProfiles.reduce(
        (runningScore, profile) => runningScore + profile.privacyScore,
        0
      ) / totalAccounts
    );
    const mostExposed = [...dashboardProfiles]
      .sort((left, right) => left.privacyScore - right.privacyScore)
      .slice(0, 3);

    return {
      totalAccounts,
      riskyAccounts,
      averageScore,
      mostExposed,
    };
  }, []);

  const openDashboard = () => {
    if (chrome.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }

    window.open(
      chrome.runtime.getURL('src/options/index.html'),
      '_blank',
      'noopener,noreferrer'
    );
  };

  let backendStatusText = 'Live';
  if (loading) {
    backendStatusText = '...';
  } else if (error) {
    backendStatusText = 'Down';
  }

  return (
    <div id='my-ext' className='urban-shell side-shell' data-theme={theme}>
      <div className='urban-bg' aria-hidden='true'>
        <div className='urban-bg-layer urban-bg-layer-cyan' />
        <div className='urban-bg-layer urban-bg-layer-red' />
        <div className='urban-grid' />
        <div className='urban-rain' />
      </div>

      <main className='side-panel-main'>
        <header className='noir-hero privacy-reveal side-hero'>
          <div className='flex items-start justify-between gap-3'>
            <div>
              <p className='hero-kicker'>Privasee Noir</p>
              <h1 className='side-title'>Quick Risk Pulse</h1>
            </div>
            <button
              type='button'
              onClick={toggleTheme}
              className='theme-toggle-btn side-theme-toggle'>
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
          <p className='hero-body'>Open the full dashboard for complete account intelligence.</p>
          <div className='city-window side-city-window'>
            <div className='city-sweep' />
            <p className='city-caption'>Side Channel // Live</p>
          </div>
        </header>

        <section
          className='privacy-reveal mt-4 grid grid-cols-2 gap-3'
          style={{ '--delay': '90ms' } as CSSProperties}>
          <article className='side-mini-card'>
            <p className='side-mini-label'>Accounts</p>
            <p className='side-mini-value text-cyan-200'>{snapshot.totalAccounts}</p>
          </article>
          <article className='side-mini-card'>
            <p className='side-mini-label'>Critical</p>
            <p className='side-mini-value text-rose-200'>{snapshot.riskyAccounts}</p>
          </article>
          <article className='side-mini-card'>
            <p className='side-mini-label'>Policy Links</p>
            <p className='side-mini-value text-amber-200'>{policyLinks.length}</p>
          </article>
          <article className='side-mini-card'>
            <p className='side-mini-label'>Backend</p>
            <p className='side-mini-value text-emerald-200'>{backendStatusText}</p>
          </article>
        </section>

        <section
          className='privacy-reveal mt-4 side-section'
          style={{ '--delay': '150ms' } as CSSProperties}>
          <p className='side-mini-label'>Average Privacy Score</p>
          <div className='mt-2 h-2 overflow-hidden rounded-full bg-slate-800/85'>
            <div
              className='h-full rounded-full bg-gradient-to-r from-cyan-300 via-amber-300 to-rose-300'
              style={{ width: `${snapshot.averageScore}%` }}
            />
          </div>
          <p className='mt-2 text-sm font-semibold text-amber-100'>
            {snapshot.averageScore} / 100
          </p>
        </section>

        <section
          className='privacy-reveal mt-4 side-section'
          style={{ '--delay': '210ms' } as CSSProperties}>
          <h2 className='side-mini-label'>Highest Exposure</h2>
          <ul className='mt-3 space-y-2'>
            {snapshot.mostExposed.map((profile) => (
              <li key={profile.domain} className='side-list-card'>
                <div className='min-w-0'>
                  <p className='truncate text-sm font-semibold text-slate-100'>{profile.name}</p>
                  <p className='truncate text-xs text-slate-400'>{profile.domain}</p>
                </div>
                <div className='flex items-center gap-2'>
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${postureIndicatorClass[profile.posture]}`}
                  />
                  <span className='text-sm font-bold text-slate-100'>
                    {profile.privacyScore}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section
          className='privacy-reveal mt-4 side-section'
          style={{ '--delay': '230ms' } as CSSProperties}>
          <div className='flex items-center justify-between gap-3'>
            <h2 className='side-mini-label'>Policy & Terms On Current Site</h2>
            <button
              type='button'
              onClick={fetchPolicyLinks}
              className='rounded-md border border-slate-500/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-300/60 hover:text-cyan-200'>
              Refresh
            </button>
          </div>
          {linksLoading && <p className='mt-3 text-xs text-slate-300'>Scanning active tab…</p>}
          {linksError && <p className='mt-3 text-xs text-rose-200'>{linksError}</p>}
          {!linksLoading && !linksError && (
            <ul className='mt-3 space-y-2'>
              {policyLinks.length === 0 ? (
                <li className='text-xs text-slate-300'>
                  No policy links were detected on this page.
                </li>
              ) : (
                policyLinks.slice(0, 3).map((link) => (
                  <li key={link.url} className='side-list-card'>
                    <a
                      href={link.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='block min-w-0 truncate text-xs font-semibold text-cyan-200 hover:underline'>
                      {link.text || link.url}
                    </a>
                  </li>
                ))
              )}
            </ul>
          )}
        </section>

        <section
          className='privacy-reveal mt-4 side-section'
          style={{ '--delay': '245ms' } as CSSProperties}>
          <div className='flex items-center justify-between gap-3'>
            <h2 className='side-mini-label'>Backend Health</h2>
            <button
              type='button'
              onClick={fetchHealth}
              className='rounded-md border border-slate-500/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200 transition hover:border-cyan-300/60 hover:text-cyan-200'>
              Retry
            </button>
          </div>
          {loading && <p className='mt-3 text-xs text-slate-300'>Checking service heartbeat…</p>}
          {error && !loading && <p className='mt-3 text-xs text-rose-200'>{error}</p>}
          {!loading && !error && health && (
            <div className='mt-3 grid grid-cols-2 gap-2'>
              <div className='side-list-card'>
                <p className='text-xs text-slate-300'>Status</p>
                <p className='text-xs font-bold uppercase tracking-[0.14em] text-emerald-200'>
                  {health.status}
                </p>
              </div>
              <div className='side-list-card'>
                <p className='text-xs text-slate-300'>Environment</p>
                <p className='text-xs font-bold uppercase tracking-[0.14em] text-cyan-200'>
                  {health.environment}
                </p>
              </div>
            </div>
          )}
        </section>

        <button
          type='button'
          onClick={openDashboard}
          className='privacy-reveal side-cta'
          style={{ '--delay': '260ms' } as CSSProperties}>
          <span>Go to Dashboard</span>
          <svg
            xmlns='http://www.w3.org/2000/svg'
            viewBox='0 0 20 20'
            fill='currentColor'
            className='h-5 w-5'>
            <path
              fillRule='evenodd'
              d='M3 10a.75.75 0 0 1 .75-.75h10.69l-2.72-2.72a.75.75 0 1 1 1.06-1.06l4 4a.75.75 0 0 1 0 1.06l-4 4a.75.75 0 1 1-1.06-1.06l2.72-2.72H3.75A.75.75 0 0 1 3 10Z'
              clipRule='evenodd'
            />
          </svg>
        </button>
      </main>
    </div>
  );
}
