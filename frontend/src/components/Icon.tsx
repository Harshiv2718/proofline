type IconName = 'board' | 'meeting' | 'decision' | 'chart' | 'plus' | 'arrow' | 'chevron' | 'check' | 'close' | 'search' | 'download' | 'source' | 'clock' | 'calendar' | 'filter' | 'refresh' | 'external' | 'spark' | 'info';
const paths: Record<IconName, React.ReactNode> = {
  board: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M9 4v16M15 4v16" /></>,
  meeting: <><rect x="4" y="4" width="16" height="17" rx="3" /><path d="M8 2v4m8-4v4M4 9h16M8 13h3m-3 4h6" /></>,
  decision: <><path d="m5 12 4 4L19 6" /><path d="M20 12v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h8" /></>,
  chart: <><path d="M4 3v17h17M8 15v-4m5 4V7m5 8V4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4" /></>,
  source: <><path d="m9 8-4 4 4 4m6-8 4 4-4 4m-2-11-2 14" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 2v6m10-6v6M3 11h18" /></>,
  filter: <><path d="M4 6h16M7 12h10m-7 6h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M9 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4" /></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
};
export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
