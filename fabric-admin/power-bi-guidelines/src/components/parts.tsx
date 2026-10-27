/**
 * Small shared pieces of the views.
 *
 * Colour is never the only signal: every state also carries text. Red is the
 * pure semantic red and is reserved for errors and high-impact states.
 */
import type { ReactNode } from 'react';


type Tone = 'neutral' | 'info' | 'good' | 'warn' | 'alert';

const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 ring-gray-500/20',
  info: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  good: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  warn: 'bg-amber-50 text-amber-900 ring-amber-600/20',
  alert: 'bg-white text-[#FF0000] ring-[#FF0000]',
};

export function Pill({ tone = 'neutral', children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function Notice({ tone, children, action }: { tone: 'info' | 'warn' | 'alert'; children: ReactNode; action?: ReactNode }) {
  const style =
    tone === 'alert'
      ? 'border-l-4 border-[#FF0000] bg-white text-gray-900 ring-1 ring-gray-200'
      : tone === 'warn'
        ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-600/20 ring-inset'
        : 'bg-blue-50 text-blue-900 ring-1 ring-blue-600/20 ring-inset';
  return (
    <div role={tone === 'alert' ? 'alert' : 'status'} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl p-4 text-sm ${style}`}>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  primary,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  primary?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
        primary ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  );
}
