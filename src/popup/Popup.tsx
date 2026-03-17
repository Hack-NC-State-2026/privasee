import { JSX, useEffect, useState } from 'react';

type PopupState = 'dispatching' | 'unsupported';

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

export default function Popup(): JSX.Element {
  const [status, setStatus] = useState<PopupState>('dispatching');
  const [message, setMessage] = useState('Reopening overlay on this tab...');

  useEffect(() => {
    let isMounted = true;

    const reopenOnActiveTab = async () => {
      try {
        if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) {
          throw new Error('Tab messaging is unavailable.');
        }

        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const activeTab = tabs[0];

        if (typeof activeTab?.id !== 'number') {
          throw new Error('No active tab is available.');
        }

        await chrome.tabs.sendMessage(activeTab.id, {
          type: 'REOPEN_OVERLAY',
        });

        window.close();
      } catch (error) {
        if (!isMounted) return;

        setStatus('unsupported');
        setMessage(
          error instanceof Error
            ? error.message
            : 'This page does not support the in-page overlay.'
        );
      }
    };

    reopenOnActiveTab().catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  if (status === 'dispatching') {
    return (
      <div
        id='my-ext'
        className='w-[320px] bg-zinc-950 bg-gradient-to-b from-zinc-950 via-zinc-900 to-neutral-950 p-4 text-zinc-100'
        data-theme='dark'
      >
        <div className='flex flex-col gap-3'>
          <p className='text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300'>
            Privasee
          </p>
          <h1 className='text-lg font-semibold text-zinc-50'>Reopening overlay</h1>
          <p className='text-sm leading-6 text-zinc-300'>{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      id='my-ext'
      className='w-[320px] bg-zinc-950 bg-gradient-to-b from-zinc-950 via-zinc-900 to-neutral-950 p-4 text-zinc-100'
      data-theme='dark'
    >
      <div className='flex flex-col gap-3'>
        <p className='text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300'>
          Privasee
        </p>
        <h1 className='text-lg font-semibold text-zinc-50'>Overlay unavailable</h1>
        <p className='text-sm leading-6 text-zinc-300'>
          {message || 'This page does not expose the in-page overlay.'}
        </p>
        <button
          type='button'
          className='rounded-xl border border-cyan-300/40 bg-cyan-300/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/18'
          onClick={openDashboard}
        >
          Open Dashboard
        </button>
      </div>
    </div>
  );
}
