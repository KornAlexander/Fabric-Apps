/**
 * Ship the application bundle compressed.
 *
 * ⚠️ WHY THIS EXISTS: Fabric static hosting sets no `content-encoding` on
 * anything. Measured against the deployed app with an explicit
 * `Accept-Encoding: gzip, deflate, br` request header: the reply carried no
 * `content-encoding` at all and 1 488 357 bytes of JavaScript crossed the wire
 * verbatim. That one file is larger than everything else the app downloads put
 * together. Compressed it is 414 KB - a 1 039 KB saving, bigger than the entire
 * data-compression win.
 *
 * The baked data files solve the same problem by asking for the `.gz`
 * themselves (src/data/fetchBaked.ts). A `<script src>` cannot: the browser
 * will not inflate a body the server never labelled. So the build replaces the
 * script tag with a small inline loader that fetches, inflates, and evaluates
 * the bundle from a blob URL.
 *
 * ⚠️ THE UNCOMPRESSED BUNDLE STILL SHIPS AND EVERY FAILURE PATH FALLS BACK TO
 * IT - a missing `.gz`, a browser without DecompressionStream, a truncated
 * body, anything thrown along the way. The worst case is exactly the behaviour
 * we have today. An optimisation must never be the reason a demo goes dark.
 *
 * ⚠️ Two things were checked in the built bundle before choosing a blob URL,
 * because both would have broken it:
 *   - `import.meta.url` - zero occurrences. A blob module sees a `blob:` URL
 *     as its own location, so any code locating a sibling asset that way would
 *     have looked in the wrong place.
 *   - MapLibre's web worker - built from an inlined source string via
 *     `URL.createObjectURL`, so it does not depend on the script's own URL.
 * Relative `fetch()` calls are safe regardless: they resolve against
 * `document.baseURI`, not against the module that made them.
 */

/** Vite emits exactly one module script for this app. */
const SCRIPT_TAG =
  /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="([^"]+)")[^>]*>\s*<\/script>/g

/**
 * The loader, as source text for an inline `<script>`.
 *
 * Deliberately ES5 and deliberately tiny: it runs before anything else exists,
 * on whatever browser walked in, and its whole job is to be less fragile than
 * the thing it is loading.
 *
 * `chars` is the exact length of the decoded bundle in UTF-16 code units. It is
 * an integrity check, not a heuristic - a truncated or half-written body fails
 * it and takes the fallback instead of running a half a program.
 */
export function bootScript(src, chars) {
  if (!src) throw new Error('bootScript: no bundle source')
  if (!Number.isInteger(chars) || chars <= 0) {
    throw new Error(`bootScript: implausible length ${chars}`)
  }
  const S = JSON.stringify(src)
  return (
    `(function(){var S=${S},N=${chars},done=false;` +
    // The original tag, recreated. Everything falls back to this.
    `function plain(){if(done)return;done=true;` +
    `var s=document.createElement("script");s.type="module";` +
    `s.crossOrigin="anonymous";s.src=S;document.head.appendChild(s);}` +
    `function run(c){if(done)return;done=true;` +
    `var s=document.createElement("script");s.type="module";` +
    `s.src=URL.createObjectURL(new Blob([c],{type:"text/javascript"}));` +
    `document.head.appendChild(s);}` +
    `try{` +
    `if(typeof DecompressionStream!=="function"||typeof fetch!=="function"` +
    `||typeof Blob!=="function"||typeof Response!=="function"){plain();return;}` +
    `fetch(S+".gz").then(function(r){` +
    `if(!r.ok)throw new Error("gz "+r.status);return r.arrayBuffer();})` +
    `.then(function(b){var h=new Uint8Array(b,0,2);` +
    // No gzip magic means somebody already inflated it: either the server
    // answered the .gz with its contents expanded, or it sent
    // content-encoding: gzip and the browser undid it on the way in. Both
    // leave us holding the module source, which is what we wanted anyway.
    `if(h[0]!==31||h[1]!==139)return new TextDecoder().decode(b);` +
    `var d=new DecompressionStream("gzip"),w=d.writable.getWriter();` +
    `w.write(new Uint8Array(b));w.close();` +
    `return new Response(d.readable).text();})` +
    `.then(function(c){if(c.length!==N)` +
    `throw new Error("length "+c.length+" expected "+N);run(c);})` +
    `.catch(plain);` +
    `}catch(e){plain();}` +
    `})();`
  )
}

/**
 * Swap the module script tag for the inline loader.
 *
 * Throws rather than returning the html unchanged: a silent no-op here would
 * ship a build that quietly lost the optimisation, and the only symptom would
 * be a number nobody looks at.
 */
export function rewriteHtml(html, chars) {
  const found = [...html.matchAll(SCRIPT_TAG)]
  if (found.length === 0) {
    throw new Error('no <script type="module"> found in index.html')
  }
  if (found.length > 1) {
    // The loader handles one entry point. Several would mean vite started
    // code-splitting the entry, and loading only the first would break the app.
    throw new Error(`expected 1 module script, found ${found.length}`)
  }
  const [tag, src] = [found[0][0], found[0][1]]
  return { html: html.replace(tag, `<script>${bootScript(src, chars)}</script>`), src }
}
