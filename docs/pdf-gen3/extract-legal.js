// Extracts the rendered content of the legal pages so it can be typeset for
// review. Reads the live DOM rather than the JSX source, so what lands in the
// PDF is exactly what a user sees — no risk of paraphrasing or missing a
// conditionally-rendered block.
//
// Usage: node extract-legal.js [baseUrl]   (default http://localhost:3000)

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/+$/, '');
const PAGES = [
  { route: '/terms', title: 'Terms of Service' },
  { route: '/privacy-policy', title: 'Privacy Policy' },
];

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const out = [];

  for (const { route, title } of PAGES) {
    const page = await browser.newPage();
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle0', timeout: 90000 });
    await new Promise((r) => setTimeout(r, 2500));

    const doc = await page.evaluate(() => {
      const main = document.querySelector('main') || document.body;
      const blocks = [];

      const walk = (node) => {
        for (const el of node.children) {
          const tag = el.tagName.toLowerCase();
          const text = (el.innerText || '').trim();
          if (!text) continue;

          if (tag === 'h1') { blocks.push({ type: 'h1', text }); continue; }
          if (tag === 'h2') { blocks.push({ type: 'h2', text }); continue; }
          if (tag === 'h3') { blocks.push({ type: 'h3', text }); continue; }
          if (tag === 'ul' || tag === 'ol') {
            const items = [...el.querySelectorAll(':scope > li')]
              .map((li) => (li.innerText || '').trim())
              .filter(Boolean);
            if (items.length) blocks.push({ type: tag === 'ol' ? 'ol' : 'ul', items });
            continue;
          }
          if (tag === 'p') { blocks.push({ type: 'p', text }); continue; }

          // Leaf-ish div/span that holds real prose (this codebase styles a lot
          // of body copy as divs rather than <p>).
          const hasBlockChildren = [...el.children].some((c) =>
            ['div', 'p', 'ul', 'ol', 'section', 'h1', 'h2', 'h3'].includes(c.tagName.toLowerCase())
          );
          if (!hasBlockChildren) {
            blocks.push({ type: 'p', text });
            continue;
          }
          walk(el);
        }
      };

      walk(main);
      return blocks;
    });

    // Collapse duplicates that come from nested wrappers repeating inner text.
    const seen = new Set();
    const cleaned = [];
    for (const b of doc) {
      const key = b.type + '::' + (b.text || (b.items || []).join('|'));
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(b);
    }

    out.push({ route, title, blocks: cleaned });
    console.log(`${route}: ${cleaned.length} blocks`);
    await page.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'legal-content.json'), JSON.stringify(out, null, 2));
  console.log('wrote legal-content.json');
})();
