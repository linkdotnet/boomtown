import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index.html', 'privacy.html', 'support.html', 'legal.html'];
const langs = ['de', 'fr', 'it', 'es', 'ja', 'zh-Hans'];
const all = ['en', ...langs];
const names = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español', ja: '日本語', 'zh-Hans': '简体中文' };
const site = 'https://boomtown.info';
const read = (p) => readFileSync(join(root, p), 'utf8');
const dicts = Object.fromEntries(langs.map((l) => [l, JSON.parse(read(`i18n/${l}.json`))]));
const entries = (d) => Object.entries(d).filter(([k]) => !k.startsWith('@')).sort(([a], [b]) => b.length - a.length);
const meta = read('index.html').match(/<meta name="description" content="([^"]*)"/)[1];

const corpus = pages.map(read).join('\n');
const missing = langs.flatMap((l) => entries(dicts[l]).filter(([k]) => !corpus.includes(k)).map(([k]) => `${l}: ${k}`));
if (missing.length) {
  console.error(`Dictionary keys missing from English source:\n${missing.join('\n')}`);
  process.exit(1);
}

const dirOf = (l) => (l === 'en' ? '' : `${l}/`);
const url = (l, page) => `${site}/${dirOf(l)}${page === 'index.html' ? '' : page}`;
const hreflang = (page) => [...all.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l, page)}">`), `<link rel="alternate" hreflang="x-default" href="${url('en', page)}">`].join('\n');

const switcher = (lang, page) => {
  const options = all.map((l) => {
    const target = dirOf(l) + (page === 'index.html' ? '' : page);
    const rel = posix.relative(dirOf(lang) || '.', target || '.') || '.';
    return `<option value="${page === 'index.html' ? `${rel}/` : rel}" lang="${l}"${l === lang ? ' selected' : ''}>${names[l]}</option>`;
  }).join('');
  return `<label class="langs"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="8" cy="8" r="6.5"/><path d="M1.5 8h13M8 1.5c-2.2 2-2.2 11.5 0 13M8 1.5c2.2 2 2.2 11.5 0 13"/></svg><select aria-label="Language" onchange="try{localStorage.setItem('lang',this.options[this.selectedIndex].lang)}catch(e){}location.href=this.value">${options}</select></label>`;
};

const local = /^(\.\/|[a-z]+\.html)$/;
const fix = (u) => (/^(#|https?:|mailto:|data:|\/\/)/.test(u) || local.test(u) || u === '' ? u : `../${u}`);
const rebase = (html) => html.replace(/\b(src|href|srcset|imagesrcset|data-src|data-hd|data-poster|poster)="([^"]*)"/g, (m, attr, val) => {
  const v = attr.endsWith('srcset') ? val.split(',').map((c) => c.trim().replace(/^\S+/, fix)).join(', ') : fix(val);
  return `${attr}="${v}"`;
});

const ld = (lang, d) => {
  const org = { '@type': 'Organization', name: 'BitSpire GmbH', url: 'https://bitspire.ch' };
  const data = { '@context': 'https://schema.org', '@type': 'VideoGame', name: 'Boomtown', url: url(lang, 'index.html'), image: `${site}/media/og.jpg`, description: d[meta], inLanguage: lang, genre: d['@genre'], applicationCategory: 'GameApplication', gamePlatform: ['iOS', 'iPadOS', 'Android'], operatingSystem: ['iOS', 'iPadOS', 'Android'], author: org, publisher: org, offers: { '@type': 'Offer', price: '4.99', priceCurrency: 'USD' } };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
};

const withBlocks = (html, lang, page) => html
  .replace(/<link rel="alternate"[^>]*>\n/g, '')
  .replace('</head>', () => `${hreflang(page)}\n</head>`)
  .replace(/<label class="langs"[\s\S]*?<\/label>/g, () => switcher(lang, page));

const build = (lang, page) => {
  const d = dicts[lang];
  let html = read(page).replace(/<script id="root-redirect">[\s\S]*?<\/script>\n/, '');
  for (const [k, v] of entries(d)) html = html.replaceAll(k, () => v);
  html = rebase(html)
    .replace('<html lang="en">', `<html lang="${lang}">`)
    .replace(/(<link rel="canonical" href=")[^"]*"/, (m, p) => `${p}${url(lang, page)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, (m, p) => `${p}${url(lang, page)}"`);
  if (page === 'index.html') html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => ld(lang, d));
  if (page === 'privacy.html' || page === 'legal.html') html = html.replace('<main class="page">', (m) => `${m}\n  <p class="muted">${d['@note'].replaceAll('{en}', `../${page}`)}</p>`);
  return withBlocks(html, lang, page);
};

const sitemap = () => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${pages.flatMap((p) => all.map((l) => `  <url>
    <loc>${url(l, p)}</loc>
${[...all.map((a) => `    <xhtml:link rel="alternate" hreflang="${a}" href="${url(a, p)}"/>`), `    <xhtml:link rel="alternate" hreflang="x-default" href="${url('en', p)}"/>`].join('\n')}
  </url>`)).join('\n')}
</urlset>
`;

const write = (p, s) => {
  mkdirSync(dirname(join(root, p)), { recursive: true });
  writeFileSync(join(root, p), s);
};
for (const p of pages) write(p, withBlocks(read(p), 'en', p));
for (const l of langs) for (const p of pages) write(`${dirOf(l)}${p}`, build(l, p));
write('sitemap.xml', sitemap());
