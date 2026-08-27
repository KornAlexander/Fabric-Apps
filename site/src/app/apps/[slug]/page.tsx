import { notFound } from 'next/navigation';
import { asset, getApp, getApps, GITHUB, renderReadme } from '@/lib/catalog';

export function generateStaticParams() {
  return getApps().map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const app = getApp(params.slug);
  if (!app) return {};
  return {
    title: `${app.display} — Fabric Apps`,
    description: app.description,
  };
}

export default function AppPage({ params }: { params: { slug: string } }) {
  const app = getApp(params.slug);
  if (!app) notFound();

  const html = renderReadme(app);

  return (
    <main>
      <section className="app-hero">
        <div className="wrap">
          <div className="crumb">
            <a href={asset('/')}>Fabric Apps</a> / {app.display}
          </div>
          <h1>{app.display}</h1>
          <p className="lead">{app.description}</p>

          <div className="badges" style={{ marginBottom: 18 }}>
            {app.wip && <span className="badge badge-wip">Work in progress</span>}
            {app.stack.map((s) => (
              <span className="badge" key={s}>{s}</span>
            ))}
          </div>

          <div className="btn-row">
            {/*
              A playable build beats any amount of description, so it leads. Only shown
              where the app declares one: most of these need a Fabric tenant, and a dead
              "try it" button is worse than none.
            */}
            {app.liveUrl && (
              <a
                className="btn btn-primary"
                href={app.liveUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                ▶ Try it live
              </a>
            )}
            <a
              className={app.liveUrl ? 'btn btn-ghost' : 'btn btn-primary'}
              href={`${GITHUB}/tree/main/${app.path}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Source and deploy guide
            </a>
            <a className="btn btn-ghost" href={asset('/')}>All apps</a>
          </div>

          {/*
            An upstream credit is not a footnote. Three of these apps are somebody else's
            work, and the website is the most public surface of the lot - so the credit sits
            above the demo, where a reader actually meets it.
          */}
          {app.upstream && (
            <div className="callout">
              <strong>This app is {app.upstream.name}&rsquo;s work.</strong>{' '}
              It is included here with credit, not instead of it. The app&rsquo;s README below
              explains what was rebuilt and what was added.
            </div>
          )}

          {(app.mp4 || app.gif) && (
            <figure className="media">
              {app.mp4 ? (
                // A muted, looping, inline video is a fraction of the size of the same GIF
                // and does not posterise to 128 colours. The GIF stays as the poster and
                // the fallback.
                <video
                  autoPlay
                  loop
                  muted
                  playsInline
                  preload="metadata"
                  poster={app.preview ?? undefined}
                >
                  <source src={app.mp4} type="video/mp4" />
                  {app.gif && <img src={app.gif} alt={`${app.display} demo`} />}
                </video>
              ) : (
                <img src={app.gif!} alt={`${app.display} demo`} loading="lazy" />
              )}
              <figcaption>Recorded from the app running locally.</figcaption>
            </figure>
          )}

          {!app.mp4 && !app.gif && app.preview && (
            <figure className="media">
              <img src={app.preview} alt={`${app.display} preview`} loading="lazy" />
            </figure>
          )}
        </div>
      </section>

      <section className="section">
        <div className="wrap">
          <article className="readme" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </section>
    </main>
  );
}
