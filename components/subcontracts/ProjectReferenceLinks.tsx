import Link from 'next/link';
import { rsSystemProjectSearchUrl, sankeySvgProjectUrl } from '@/app/lib/subcontracts/links';

interface ProjectReferenceLinksProps {
  projectId: number;
  projectName: string;
  year: number;
  compact?: boolean;
}

const linkBaseStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  color: '#4a90d9',
  background: '#fff',
  textDecoration: 'none',
  flexShrink: 0,
} as const;

function RsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="14" width="18" viewBox="0 0 24 20" fill="none" aria-hidden="true">
      <text x="12" y="16" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="sans-serif" fill="#4a90d9">RS</text>
    </svg>
  );
}

function SankeyIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 -960 960 960" fill="#4a90d9" aria-hidden="true">
      <path d="M760-120q-39 0-70-22.5T647-200H440q-66 0-113-47t-47-113q0-66 47-113t113-47h80q33 0 56.5-23.5T600-600q0-33-23.5-56.5T520-680H313q-13 35-43.5 57.5T200-600q-50 0-85-35t-35-85q0-50 35-85t85-35q39 0 69.5 22.5T313-760h207q66 0 113 47t47 113q0 66-47 113t-113 47h-80q-33 0-56.5 23.5T360-360q0 33 23.5 56.5T440-280h207q13-35 43.5-57.5T760-360q50 0 85 35t35 85q0 50-35 85t-85 35ZM228.5-691.5Q240-703 240-720t-11.5-28.5Q217-760 200-760t-28.5 11.5Q160-737 160-720t11.5 28.5Q183-680 200-680t28.5-11.5Z"/>
    </svg>
  );
}

export function ProjectReferenceLinks({
  projectId,
  projectName,
  year,
  compact = false,
}: ProjectReferenceLinksProps) {
  const itemStyle = compact ? {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    color: '#4a90d9',
    textDecoration: 'none',
    flexShrink: 0,
  } : {
    ...linkBaseStyle,
    gap: 5,
    padding: '4px 7px',
    fontSize: 11,
    fontWeight: 700,
  };

  return (
    <div style={{ display: 'flex', gap: compact ? 2 : 6, flexWrap: compact ? 'nowrap' : 'wrap', alignItems: 'center' }}>
      <a
        href={rsSystemProjectSearchUrl(projectName, year)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="RSシステムで開く"
        title="RSシステムで開く"
        style={itemStyle}
      >
        <RsIcon />
        {!compact && <span>RSシステム</span>}
      </a>
      <Link
        href={sankeySvgProjectUrl(projectId, projectName, year)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="/sankey-svgでこの事業を表示"
        title="/sankey-svgでこの事業を表示"
        style={itemStyle}
      >
        <SankeyIcon />
        {!compact && <span>Sankey</span>}
      </Link>
    </div>
  );
}
