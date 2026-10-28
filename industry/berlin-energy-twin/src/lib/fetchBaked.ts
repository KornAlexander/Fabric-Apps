/**
 * Fetching the baked data files.
 *
 * ⚠️ FABRIC STATIC HOSTING SERVES EVERYTHING UNCOMPRESSED. Measured on the
 * deployed app: `content-encoding` is absent and `encodedBodySize` equals
 * `decodedBodySize` for every asset, so `network.json` crosses the wire at its
 * full **746 KB** and takes ~1.4 s. Gzipped it is **165 KB** — 78 % smaller.
 *
 * The response headers are not ours to set, so the compression is done at build
 * time (`tools/gzip_data.mjs`) and undone here with `DecompressionStream`.
 *
 * ⚠️ ALWAYS FALLS BACK TO THE PLAIN FILE. Both are deployed. If the browser has
 * no `DecompressionStream`, or the `.gz` is missing, or anything at all goes
 * wrong, the original request is made instead — a demo must not go dark because
 * of an optimisation.
 */

/** Is the browser able to inflate a gzip stream for us? */
export function canInflate(): boolean {
  return typeof globalThis.DecompressionStream === 'function'
}

/**
 * Loads already started, so the same file is never fetched twice.
 *
 * ⚠️ Keyed on the path, and deliberately NOT cleared on failure: a rejected
 * entry is removed so a retry can happen, but a successful one is kept for the
 * life of the page. The baked files never change under a running app.
 */
const inFlight = new Map<string, Promise<unknown>>()

/**
 * Start loading the baked files before anything asks for them.
 *
 * ⚠️ WHY: the sign-in gate must establish a session before the app renders, and
 * the app only then asks for its data — so on a COLD load the two run one after
 * the other. Measured: first contentful paint went 1 248 ms → 2 952 ms when the
 * gate landed. Overlapping the token exchange with the download gives that time
 * back.
 *
 * ⚠️ This leaks nothing. These files sit on the same static host and are
 * already downloadable by anyone with the URL, signed in or not; the gate has
 * never been what protects them.
 */
export function prefetchBaked(paths: readonly string[]): void {
  for (const p of paths) {
    // Errors here are irrelevant: whoever really needs the file will ask again
    // and get a proper error then. An unhandled rejection would be noise.
    void fetchBakedJson(p).catch(() => undefined)
  }
}

export async function fetchBakedJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const started = inFlight.get(path)
  // ⚠️ An abort signal must not cancel a load someone else is waiting on, so a
  // caller with a signal that is already aborted is rejected rather than
  // handed the shared promise.
  if (started) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return started as Promise<T>
  }
  const load = loadOnce<T>(path, signal)
  inFlight.set(path, load)
  void load.catch(() => inFlight.delete(path))
  return load
}

async function loadOnce<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (canInflate()) {
    try {
      const res = await fetch(`${path}.gz`, { signal })
      // A missing .gz on a SPA host answers 200 with index.html, so check the
      // shape of the answer and not merely `res.ok`.
      if (res.ok && res.body && !isHtml(res)) {
        // ⚠️ THREE SERVERS, THREE BEHAVIOURS, AND ONLY ONE NEEDS US.
        //  1. Serves the gzip bytes verbatim  -> we must inflate (the win).
        //  2. Sets `content-encoding: gzip`   -> the BROWSER already inflated;
        //     inflating again would fail.
        //  3. Inflates it itself and serves plain JSON -> measured: `vite
        //     preview` does exactly this, answering 764 251 bytes of JSON for a
        //     164 KB `.gz`. Inflating that throws.
        // Keeping a clone means cases 2 and 3 cost no extra request.
        const spare = res.clone()
        if (res.headers.get('content-encoding') === 'gzip') {
          return (await res.json()) as T
        }
        try {
          const stream = res.body.pipeThrough(new DecompressionStream('gzip'))
          return (await new Response(stream).json()) as T
        } catch {
          return (await spare.json()) as T
        }
      }
    } catch (err) {
      // An aborted load is the caller changing their mind, not a failure of
      // compression - do not retry it as an uncompressed fetch.
      if (isAbort(err)) throw err
    }
  }
  return (await (await fetchFile(path, signal)).json()) as T
}

/**
 * A plain fetch that only resolves for a real file. Fabric answers a missing
 * file with 200 and index.html, which `arrayBuffer()` would hand over as
 * building geometry (review 2026-10-28), so HTML counts as missing.
 */
export async function fetchFile(path: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(path, { signal })
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
  if (isHtml(res)) throw new Error(`${path}: HTML instead of the file`)
  return res
}

function isHtml(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').includes('text/html')
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
