import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1080, height: 1920 },
  recordVideo: { dir: '/home/claude/recording', size: { width: 1080, height: 1920 } },
});
const page = await context.newPage();

await page.goto('http://localhost:8930/demo-schools/', { waitUntil: 'networkidle' });

// Inject AFTER load, once <head> definitely exists — the earlier
// addInitScript approach ran before <head> was parsed and silently failed.
await page.addStyleTag({ content: 'button { display: none !important; }' });

// Confirm it actually took effect before committing to the full recording.
const hidden = await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  return Array.from(btns).every(b => getComputedStyle(b).display === 'none');
});
console.log('buttons hidden:', hidden, '| count:', await page.evaluate(() => document.querySelectorAll('button').length));

await page.waitForTimeout(76000);

await context.close();
await browser.close();
console.log('recording complete');
