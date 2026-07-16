# Vendored libraries

Pinned, self-contained browser builds served statically by the relay. No build
step — update by re-downloading a pinned version and updating this table.

| File | Library | Version | License | Source URL |
| --- | --- | --- | --- | --- |
| `xterm.js` | @xterm/xterm | 6.0.0 | MIT | https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/lib/xterm.min.js |
| `xterm.css` | @xterm/xterm | 6.0.0 | MIT | https://cdn.jsdelivr.net/npm/@xterm/xterm@6.0.0/css/xterm.css |
| `addon-fit.js` | @xterm/addon-fit | 0.11.0 | MIT | https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.11.0/lib/addon-fit.min.js |
| `marked.min.js` | marked | 18.0.6 | MIT | https://cdn.jsdelivr.net/npm/marked@18.0.6/lib/marked.umd.min.js |
| `highlight.min.js` | highlight.js (common-languages build) | 11.11.1 | BSD-3-Clause | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/highlight.min.js |
| `github-dark.min.css` | highlight.js GitHub Dark theme | 11.11.1 | BSD-3-Clause | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.11.1/styles/github-dark.min.css |

Notes:

- `marked.min.js` is the UMD build minified by jsDelivr (marked ≥18 no longer
  publishes a prebuilt `marked.min.js`); it exposes `window.marked.parse()`.
- `highlight.min.js` is the official "common languages" bundle; it exposes
  `window.hljs`. Bundled languages: bash, c, cpp, csharp, css, diff, go,
  graphql, ini, java, javascript, json, kotlin, less, lua, makefile, markdown,
  objectivec, perl, php, plaintext, python, r, ruby, rust, scss, shell, sql,
  swift, typescript, vbnet, wasm, xml, yaml.
