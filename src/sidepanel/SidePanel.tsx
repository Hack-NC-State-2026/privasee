import { JSX, useCallback, useEffect, useRef, useState } from 'react';
import browser from 'webextension-polyfill';

const BACKEND_ORIGIN = 'http://localhost:8000';
const HEALTH_ENDPOINTS = [
  `${BACKEND_ORIGIN}/api/health`,
  `${BACKEND_ORIGIN}/api/v1/health`,
];

const POLL_INTERVAL_MS = 2000;

type HealthResponse = {
  status: string;
  environment: string;
};

type PolicyLink = { url: string; text: string };

type CachedAnalysis = {
  links: PolicyLink[];
  tosResult: Record<string, unknown> | null;
  tosError: string | null;
  tosLoading: boolean;
};

export default function SidePanel(): JSX.Element {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [policyLinks, setPolicyLinks] = useState<PolicyLink[]>([]);
  const [linksLoading, setLinksLoading] = useState(true);
  const [linksError, setLinksError] = useState<string | null>(null);

  const [tosLoading, setTosLoading] = useState(false);
  const [tosError, setTosError] = useState<string | null>(null);
  const [tosResult, setTosResult] = useState<Record<string, unknown> | null>(
    null
  );

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    let lastError: string | null = null;
    for (const url of HEALTH_ENDPOINTS) {
      try {
        const res = await fetch(url);
        if (!res.ok) {
          lastError = `HTTP ${res.status}`;
          continue;
        }
        const data = (await res.json()) as HealthResponse;
        setHealth(data);
        setLoading(false);
        return;
      } catch {
        lastError = 'Network error';
      }
    }
    setError(lastError ?? 'Failed to fetch health');
    setHealth(null);
    setLoading(false);
  }, []);

  const applyCachedAnalysis = useCallback((cached: CachedAnalysis): boolean => {
    setPolicyLinks(cached.links);
    setTosResult(cached.tosResult);
    setTosError(cached.tosError);
    setTosLoading(cached.tosLoading);

    const done = !cached.tosLoading;
    if (done) {
      setLinksLoading(false);
    }
    return done;
  }, []);

  const fetchCachedAnalysis = useCallback(async () => {
    setLinksLoading(true);
    setLinksError(null);
    setTosResult(null);
    setTosError(null);

    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id) {
        setLinksError('No active tab');
        setPolicyLinks([]);
        setLinksLoading(false);
        return;
      }

      const tabId = tab.id;

      const cached = (await browser.runtime.sendMessage({
        type: 'GET_CACHED_ANALYSIS',
        tabId,
      })) as CachedAnalysis;

      const done = applyCachedAnalysis(cached);
      if (done) return;

      /* Analysis still in progress — poll until finished */
      setLinksLoading(false);
      pollRef.current = setInterval(async () => {
        try {
          const updated = (await browser.runtime.sendMessage({
            type: 'GET_CACHED_ANALYSIS',
            tabId,
          })) as CachedAnalysis;

          const finished = applyCachedAnalysis(updated);
          if (finished && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch {
          /* ignore transient errors during poll */
        }
      }, POLL_INTERVAL_MS);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Could not get analysis from background';
      setLinksError(message);
      setPolicyLinks([]);
      setLinksLoading(false);
    }
  }, [applyCachedAnalysis]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    fetchCachedAnalysis();
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [fetchCachedAnalysis]);

  return (
    <div id='my-ext' className='container p-4' data-theme='light'>
      <h1 className='text-xl font-bold'>Extension Side Panel</h1>

      <section className='mt-4'>
        <h2 className='text-sm font-semibold text-base-content/80'>
          Policy & terms links
        </h2>
        {linksLoading && <p className='mt-2 text-sm'>Loading…</p>}
        {linksError && (
          <p className='mt-2 text-sm text-error'>{linksError}</p>
        )}
        {!linksLoading && !linksError && (
          <>
            <ul className='mt-2 list-inside list-disc space-y-1 text-sm'>
              {policyLinks.length === 0 ? (
                <li className='text-base-content/70'>
                  No policy links found on this page.
                </li>
              ) : (
                policyLinks.map((link) => (
                  <li key={link.url}>
                    <a
                      href={link.url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='link link-primary break-all'
                    >
                      {link.text || link.url}
                    </a>
                  </li>
                ))
              )}
            </ul>
            {policyLinks.length > 0 && (
              <div className='mt-3'>
                {tosLoading && (
                  <p className='text-sm text-base-content/70'>
                    Analyzing policies…
                  </p>
                )}
                {tosError && (
                  <p className='text-sm text-error'>{tosError}</p>
                )}
                {!tosLoading && tosResult && (
                  <p className='text-sm'>
                    <span className='badge badge-sm badge-success'>
                      Analysis complete
                    </span>
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <section className='mt-4'>
        <h2 className='text-sm font-semibold text-base-content/80'>
          Backend health
        </h2>
        {loading && <p className='mt-2 text-sm'>Loading…</p>}
        {error && <p className='mt-2 text-sm text-error'>{error}</p>}
        {!loading && !error && health && (
          <div className='mt-2 rounded-lg bg-base-200 p-3 text-sm'>
            <p>
              <span className='font-medium'>Status:</span>{' '}
              <span className='badge badge-sm badge-success'>
                {health.status}
              </span>
            </p>
            <p className='mt-1'>
              <span className='font-medium'>Environment:</span>{' '}
              {health.environment}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
