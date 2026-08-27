import type { Metadata } from 'next';
import { asset, GITHUB } from '@/lib/catalog';
import './globals.css';

export const metadata: Metadata = {
  title: 'Fabric Apps — 3D twins, live maps, games and admin tools on Microsoft Fabric',
  description:
    'Fifteen open-source Fabric Apps: photoreal 3D terrain twins, real-time transport maps, ' +
    'games, and tools that administer the data platform itself. Every app deployable to your own tenant.',
  openGraph: {
    title: 'Fabric Apps',
    description: 'Fifteen open-source Fabric Apps, deployable to your own tenant.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <a className="brand" href={asset('/')}>
              Fabric<span>Apps</span>
            </a>
            <nav className="nav">
              <a href={`${asset('/')}#gallery`}>Gallery</a>
              <a className="hide-sm" href={`${asset('/')}#deploy`}>Deploy</a>
              <a className="hide-sm" href={`${asset('/')}#build`}>How they are built</a>
              <a href={GITHUB} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            </nav>
          </div>
        </header>

        {children}

        <footer className="site-footer">
          <div className="wrap">
            <p style={{ margin: '0 0 8px' }}>
              Built by <a href="https://www.linkedin.com/in/alexanderkorn/" target="_blank" rel="noopener noreferrer">Alexander Korn</a>.
              Source on <a href={GITHUB} target="_blank" rel="noopener noreferrer">GitHub</a>.
              This site is generated from that repository, so it cannot drift from the apps.
            </p>
            <p style={{ margin: 0 }}>
              The geospatial apps use open government data. Each app names its sources and reproduces the
              attribution its licence requires.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
