const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const htmlPath = path.resolve(__dirname, '../reflection-guide.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 60000 });

  await new Promise(r => setTimeout(r, 3000));

  await page.pdf({
    path: path.resolve(__dirname, '../reflection-guide.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();
  console.log('PDF generated: docs/reflection-guide.pdf');
})();
