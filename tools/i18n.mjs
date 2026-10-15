import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index.html', 'privacy.html', 'support.html', 'legal.html'];
const langs = ['de', 'fr', 'it', 'es', 'ja', 'zh-Hans'];
const all = ['en', ...langs];
const names = { en: 'English', de: 'Deutsch', fr: 'Français', it: 'Italiano', es: 'Español', ja: '日本語', 'zh-Hans': '简体中文' };
const site = 'https://boomtown.info';
const play = 'https://play.google.com/store/apps/details?id=ch.bitspire.boomtown';
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
const ogLocales = { en: 'en_GB', de: 'de_DE', fr: 'fr_FR', it: 'it_IT', es: 'es_ES', ja: 'ja_JP', 'zh-Hans': 'zh_CN' };
const head = (lang, page) => [
  `<link rel="canonical" href="${url(lang, page)}">`,
  ...all.map((l) => `<link rel="alternate" hreflang="${l}" href="${url(l, page)}">`),
  `<link rel="alternate" hreflang="x-default" href="${url('en', page)}">`,
  ...(page === 'index.html' ? [
    `<link rel="alternate" type="text/markdown" href="${site}/index.md" title="Boomtown fact sheet (Markdown)">`,
    `<meta property="og:locale" content="${ogLocales[lang]}">`,
    ...all.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${ogLocales[l]}">`),
    ld(lang),
  ] : []),
].join('\n');

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

function ld(lang) {
  const d = dicts[lang];
  const org = { '@type': 'Organization', '@id': `${site}/#org`, name: 'BitSpire GmbH', url: 'https://bitspire.ch', email: 'apps@bitspire.ch' };
  const game = { '@type': 'VideoGame', '@id': `${site}/#game`, name: 'Boomtown: City Builder', alternateName: 'Boomtown', url: url(lang, 'index.html'), image: `${site}/media/og.jpg`, screenshot: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map((g) => `${site}/media/${g}.webp`), description: d ? d[meta] : meta, inLanguage: lang, genre: d ? d['@genre'] : ['City builder', 'Simulation', 'Strategy'], applicationCategory: 'GameApplication', applicationSubCategory: 'Simulation', gamePlatform: ['iOS', 'iPadOS', 'Android'], operatingSystem: 'iOS 15+, iPadOS 15+, Android 7.0+', playMode: 'SinglePlayer', isAccessibleForFree: false, author: { '@id': org['@id'] }, publisher: org, offers: [['4.99', 'USD'], ['4.99', 'EUR'], ['5.00', 'CHF']].map(([price, priceCurrency]) => ({ '@type': 'Offer', price, priceCurrency, url: play })) };
  const website = { '@type': 'WebSite', '@id': `${site}/#website`, name: 'Boomtown', url: `${site}/`, inLanguage: all, publisher: { '@id': org['@id'] } };
  return `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [website, game] })}</script>`;
}

const withBlocks = (html, lang, page) => html
  .replace(/<link rel="(canonical|alternate)"[^>]*>\n|<meta property="og:locale(:alternate)?"[^>]*>\n|<script type="application\/ld\+json">[\s\S]*?<\/script>\n/g, '')
  .replace('</head>', () => `${head(lang, page)}\n</head>`)
  .replace(/<label class="langs"[\s\S]*?<\/label>/g, () => switcher(lang, page));

const build = (lang, page) => {
  const d = dicts[lang];
  let html = read(page).replace(/<script id="root-redirect">[\s\S]*?<\/script>\n/, '');
  // One pass, longest key first: sequential replaceAll re-matched short keys inside earlier translations ("Supporto" → "Supportoo").
  const keys = new RegExp(entries(d).map(([k]) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  html = html.replace(keys, (k) => d[k]);
  html = rebase(html)
    .replace('<html lang="en">', `<html lang="${lang}">`)
    .replace(/(<meta property="og:url" content=")[^"]*"/, (m, p) => `${p}${url(lang, page)}"`);
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
