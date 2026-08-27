import { notFound } from 'next/navigation';
import { asset, getApp, getApps, GITHUB } from '@/lib/catalog';

/**
 * A play page, so the shareable link is always a github.io one.
 *
 * The deployment host is ugly, unmemorable and not permanent - it changes if the app is
 * redeployed. Handing that URL to anyone makes it the address people bookmark and paste,
 * and then it rots. This route is the stable public address:
 *
 *   /apps/fabric-empires/play/
 *
 * ⚠️ Honest limitation: this is a STATIC site, so the deployment URL is still visible in
 * this page's HTML source. It is not a secret and cannot be made one here. What this does
 * achieve is that the address bar, every button, and anything anyone copies stays on
 * github.io - and that the underlying host can change without breaking a single link.
 */
export function generateStaticParams() {
  // Only apps with a public build. Everything else has nothing to frame.
  return getApps()
    .filter((a) => a.liveUrl)
    .map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const app = getApp(params.slug);
  if (!app) return {};
  return {
    title: `Play ${app.display} — Fabric Apps`,
    description: `${app.display} running live. ${app.description}`,
  };
}

export default function PlayPage({ params }: { params: { slug: string } }) {
  const app = getApp(params.slug);
  if (!app?.liveUrl) notFound();

  return (
    <main className="play">
      <div className="play-bar">
        <a href={asset(`/apps/${app.slug}/`)}>&larr; {app.display}</a>
        <span className="play-note">
          Running live on Microsoft Fabric. Nothing is installed on your machine.
        </span>
        <a href={`${GITHUB}/tree/main/${app.path}`} target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </div>
      <iframe
        className="play-frame"
        src={app.liveUrl}
        title={`${app.display} running live`}
        allow="autoplay; fullscreen; gamepad; clipboard-write"
        // The app is the owner's own deployment, not third-party content, so it is not
        // sandboxed: the game needs storage for saves and WebGL for rendering.
        loading="eager"
      />
    </main>
  );
}
