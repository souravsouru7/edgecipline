const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const htmlPath = path.resolve(__dirname, '../edgecipline-b2b-institution-business-plan.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0', timeout: 60000 });

  await new Promise(r => setTimeout(r, 2000));

  await page.pdf({
    path: path.resolve(__dirname, '../edgecipline-b2b-institution-business-plan.pdf'),
    format: 'A4',
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();
  console.log('PDF generated: docs/edgecipline-b2b-institution-business-plan.pdf');
})();
