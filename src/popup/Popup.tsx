import { JSX } from 'react';

export default function Popup(): JSX.Element {
  return (
    <div
      id='my-ext'
      className='w-[372px] bg-zinc-950 bg-gradient-to-b from-zinc-950 via-zinc-900 to-neutral-950 p-4 text-zinc-100'
      data-theme='dark'
    >
      <div className='flex flex-col gap-3'>
        <h1 className='mb-1 text-lg font-semibold text-zinc-50'>Risk Snapshot</h1>

        <div className='rounded-xl border border-red-700 bg-red-950 p-3 shadow-[0_0_0_1px_rgba(239,68,68,0.08)]'>
          <h2 className='text-sm font-bold text-red-200'>
            Auto-Renewal Without Reminder
          </h2>
          <p className='mt-1 text-xs leading-5 text-zinc-200/90'>
            The policy allows automatic renewal and may charge your saved payment method
            unless you cancel before the renewal date.
          </p>
        </div>

        <div className='rounded-xl border border-amber-700 bg-amber-950 p-3 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]'>
          <h2 className='text-sm font-bold text-amber-200'>
            Broad Data Sharing Clause
          </h2>
          <p className='mt-1 text-xs leading-5 text-zinc-200/90'>
            Your account and usage data can be shared with affiliates and service providers
            for analytics and business operations.
          </p>
        </div>

        <div className='rounded-xl border border-amber-700 bg-amber-950 p-3 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]'>
          <h2 className='text-sm font-bold text-amber-200'>
            Unilateral Terms Updates
          </h2>
          <p className='mt-1 text-xs leading-5 text-zinc-200/90'>
            Terms may be changed at any time, and continued use after updates can be
            interpreted as acceptance.
          </p>
        </div>

        <div className='rounded-xl border border-zinc-700 bg-zinc-900 p-3'>
          <h2 className='text-sm font-semibold text-zinc-100'>Data Retention Policy</h2>
          <p className='mt-1 text-xs leading-5 text-zinc-300'>
            Data is retained for up to 24 months after account inactivity. Records may be
            kept longer when required for legal or fraud-prevention obligations.
          </p>
        </div>

        <div className='rounded-xl border border-zinc-700 bg-zinc-900 p-3'>
          <h2 className='text-sm font-semibold text-zinc-100'>
            Action Items You Can Take Now
          </h2>
          <ul className='mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-300'>
            <li>
              Set a calendar reminder 3 days before renewal and confirm that auto-renewal
              is disabled if you do not want recurring charges.
            </li>
            <li>
              Limit optional profile details and review privacy/account settings to restrict
              third-party data sharing wherever available.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
