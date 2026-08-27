import { asset, byCategory, getApps, GITHUB } from '@/lib/catalog';

export default function Home() {
  const apps = getApps();
  const groups = byCategory();
  const withDemo = apps.filter((a) => a.gif || a.mp4).length;

  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <h1>Fabric Apps that do more than show a chart.</h1>
          <p className="lead">
            Photoreal 3D terrain twins, live transport maps, a flood reconstructed from open
            government data, and a few games to prove there is no UI ceiling. All of them run
            inside Microsoft Fabric, signed in with your Fabric identity, reading Lakehouse,
            Eventhouse or Direct Lake.
          </p>
          <div className="btn-row">
            <a className="btn btn-primary" href="#gallery">Browse the gallery</a>
            <a className="btn btn-ghost" href={GITHUB} target="_blank" rel="noopener noreferrer">
              View the source
            </a>
          </div>
          <div className="hero-stats">
            <div className="stat"><strong>{apps.length}</strong><span>apps, all open source</span></div>
            <div className="stat"><strong>{groups.length}</strong><span>categories</span></div>
            <div className="stat"><strong>{withDemo}</strong><span>with a live demo clip</span></div>
            <div className="stat"><strong>0</strong><span>API keys required to try one</span></div>
          </div>
        </div>
      </section>

      <section className="section" id="gallery">
        <div className="wrap">
          <h2>The gallery</h2>
          <p className="sub">
            Every card is generated from that app&rsquo;s own <code>package.json</code> and README in
            the repository. Add an app, push it, and it appears here.
          </p>

          {groups.map(({ category, apps: list }) => (
            <div key={category.id}>
              <div className="cat-head">
                <span className="icon">{category.icon}</span>
                <h3>{category.title}</h3>
              </div>
              <p className="cat-blurb">{category.blurb}</p>
              <div className="grid">
                {list.map((app) => (
                  <a className="card" key={app.slug} href={asset(`/apps/${app.slug}/`)}>
                    <div className="shot">
                      {app.preview ? (
                        <img src={app.preview} alt={`${app.display} preview`} loading="lazy" />
                      ) : (
                        <div className="noshot">No preview yet</div>
                      )}
                    </div>
                    <div className="body">
                      <h4>{app.display}</h4>
                      <p>{app.description}</p>
                      <div className="badges">
                        {app.wip && <span className="badge badge-wip">Work in progress</span>}
                        {(app.gif || app.mp4) && <span className="badge">Demo</span>}
                        {app.stack.slice(0, 3).map((s) => (
                          <span className="badge" key={s}>{s}</span>
                        ))}
                        {app.upstream && (
                          <span className="badge badge-credit">by {app.upstream.name}</span>
                        )}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="section section-alt" id="deploy">
        <div className="wrap">
          <h2>Run one in your own tenant</h2>
          <p className="sub">
            Nothing here is a hosted demo you can only look at. Each app carries its own README with
            the full deploy path, and every one of them builds and runs locally first.
          </p>
          <pre>{`git clone ${GITHUB.replace('https://', 'https://')}.git
cd Fabric-Apps/industry/helsinki-public-transport
npm install
npm run dev`}</pre>
          <p className="sub" style={{ marginTop: 22 }}>
            The geospatial apps rebuild their own terrain from open data rather than shipping it, so a
            clone stays small. Each of those has a documented pipeline, usually one command.
          </p>
        </div>
      </section>

      <section className="section" id="build">
        <div className="wrap">
          <h2>How they are built</h2>
          <p className="sub">Three things are true of every app in this repository.</p>
          <div className="grid">
            <div className="card"><div className="body">
              <h4>Your identity, not a secret</h4>
              <p>
                Apps sign in with the Fabric identity of the person using them. No service principal,
                no shared key in a config file. Where an app queries Kusto, it does so as the signed-in
                user, so row-level security actually means something.
              </p>
            </div></div>
            <div className="card"><div className="body">
              <h4>Open data, properly attributed</h4>
              <p>
                Terrain, buildings, orthophotos, vehicle feeds and weather records all come from open
                government sources. Each app reproduces the attribution its licence prescribes, verbatim,
                and streams from the publisher rather than redistributing a copy.
              </p>
            </div></div>
            <div className="card"><div className="body">
              <h4>Checked before it ships</h4>
              <p>
                The repository gates itself: no tenant identifiers, no customer names, no broken links,
                a media budget, and a rule that a post about an app must name that app&rsquo;s original
                author. The site you are reading is generated from the same source.
              </p>
            </div></div>
          </div>
        </div>
      </section>
    </main>
  );
}
