#!/usr/bin/env node
// GSC Query Script for animam.ai (apex + wordpress.animam.ai + docs)
// Usage: node scripts/gsc-query.mjs <command> [options]
// Service account: claude-code@snappy-vim-454116-r8 (shared, added to GSC).
//
// SITE_URL defaults to the apex domain property; override per call, e.g.:
//   GSC_SITE="sc-domain:animam.ai" node scripts/gsc-query.mjs pages
//   GSC_SITE="https://wordpress.animam.ai/" GSC_ORIGIN="https://wordpress.animam.ai" node scripts/gsc-query.mjs pages
// Run `sites` first to see the exact properties this account can read.

import { google } from 'googleapis';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Configuration ──────────────────────────────────────────────────────────
const SITE_URL = process.env.GSC_SITE || 'sc-domain:agenthill.lol';
const SITE_ORIGIN = process.env.GSC_ORIGIN || 'https://agenthill.lol';
const KEY_PATH = process.env.GSC_KEY || resolve(process.env.HOME || process.env.USERPROFILE, 'Documents/snappy-vim-454116-r8-9dac14973100.json');

// ─── Auth ───────────────────────────────────────────────────────────────────
const key = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
const auth = new google.auth.GoogleAuth({
  credentials: key,
  scopes: [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/webmasters',
    'openid',
  ],
});
const searchconsole = google.searchconsole({ version: 'v1', auth });

// ─── CLI Parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const command = args[0];

function getArg(name, defaultVal) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return defaultVal;
  return args[idx + 1];
}

const days = parseInt(getArg('days', '28'), 10);
const limit = parseInt(getArg('limit', '25'), 10);
const pageFilter = getArg('page', null);
const queryFilter = getArg('query', null);
const strategy = getArg('strategy', 'mobile');

function dateStr(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split('T')[0];
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function runSites() {
  const res = await searchconsole.sites.list();
  const sites = res.data.siteEntry || [];
  if (!sites.length) { console.log('No properties accessible to this service account.'); return; }
  console.log(`\nProperties accessible to ${key.client_email}\n`);
  for (const s of sites) {
    console.log(`${(s.permissionLevel || '').padEnd(22)} ${s.siteUrl}`);
  }
}

async function runQueries() {
  const dimensionFilterGroups = [];
  if (queryFilter) dimensionFilterGroups.push({ filters: [{ dimension: 'query', operator: 'contains', expression: queryFilter }] });
  if (pageFilter) dimensionFilterGroups.push({ filters: [{ dimension: 'page', operator: 'contains', expression: pageFilter }] });

  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: { startDate: dateStr(days), endDate: dateStr(1), dimensions: ['query'], rowLimit: limit, dimensionFilterGroups },
  });
  const rows = res.data.rows || [];
  console.log(`\n[${SITE_URL}] Top queries (last ${days} days) — ${rows.length} results\n`);
  if (!rows.length) { console.log('No data found.'); return; }
  console.log('Query'.padEnd(60) + 'Clicks'.padStart(8) + 'Impr'.padStart(8) + 'CTR'.padStart(8) + 'Pos'.padStart(8));
  console.log('-'.repeat(92));
  for (const r of rows) {
    console.log(
      r.keys[0].substring(0, 58).padEnd(60) +
      String(r.clicks).padStart(8) + String(r.impressions).padStart(8) +
      `${(r.ctr * 100).toFixed(1)}%`.padStart(8) + r.position.toFixed(1).padStart(8)
    );
  }
}

async function runPages() {
  const dimensionFilterGroups = [];
  if (pageFilter) dimensionFilterGroups.push({ filters: [{ dimension: 'page', operator: 'contains', expression: pageFilter }] });
  if (queryFilter) dimensionFilterGroups.push({ filters: [{ dimension: 'query', operator: 'contains', expression: queryFilter }] });

  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: { startDate: dateStr(days), endDate: dateStr(1), dimensions: ['page'], rowLimit: limit, dimensionFilterGroups },
  });
  const rows = res.data.rows || [];
  console.log(`\n[${SITE_URL}] Top pages (last ${days} days) — ${rows.length} results\n`);
  if (!rows.length) { console.log('No data found.'); return; }
  console.log('Page'.padEnd(72) + 'Clicks'.padStart(8) + 'Impr'.padStart(8) + 'CTR'.padStart(8) + 'Pos'.padStart(8));
  console.log('-'.repeat(104));
  for (const r of rows) {
    console.log(
      r.keys[0].replace(SITE_ORIGIN, '').substring(0, 70).padEnd(72) +
      String(r.clicks).padStart(8) + String(r.impressions).padStart(8) +
      `${(r.ctr * 100).toFixed(1)}%`.padStart(8) + r.position.toFixed(1).padStart(8)
    );
  }
}

async function runInspect() {
  const url = pageFilter;
  if (!url) { console.error('Usage: inspect --page "https://animam.ai/page"'); process.exit(1); }
  const fullUrl = url.startsWith('http') ? url : `${SITE_ORIGIN}${url}`;
  const res = await searchconsole.urlInspection.index.inspect({ requestBody: { inspectionUrl: fullUrl, siteUrl: SITE_URL } });
  const result = res.data.inspectionResult;
  const idx = result.indexStatusResult || {};
  const mob = result.mobileUsabilityResult || {};
  const rich = result.richResultsResult || {};

  console.log(`\nURL Inspection: ${fullUrl}\n`);
  console.log('-- Indexation --');
  console.log(`  Verdict:              ${idx.verdict || 'N/A'}`);
  console.log(`  Coverage state:       ${idx.coverageState || 'N/A'}`);
  console.log(`  Crawled as:           ${idx.crawledAs || 'N/A'}`);
  console.log(`  Robots.txt state:     ${idx.robotsTxtState || 'N/A'}`);
  console.log(`  Indexation:           ${idx.indexingState || 'N/A'}`);
  console.log(`  Page fetch:           ${idx.pageFetchState || 'N/A'}`);
  console.log(`  Canonical (declared): ${idx.userCanonical || 'N/A'}`);
  console.log(`  Canonical (Google):   ${idx.googleCanonical || 'N/A'}`);
  console.log(`  Last crawl:           ${idx.lastCrawlTime || 'N/A'}`);
  if (idx.referringUrls && idx.referringUrls.length > 0) console.log(`  Inbound links:        ${idx.referringUrls.join(', ')}`);
  if (idx.sitemap && idx.sitemap.length > 0) console.log(`  Sitemaps:             ${idx.sitemap.join(', ')}`);

  console.log('\n-- Mobile Usability --');
  console.log(`  Verdict:              ${mob.verdict || 'N/A'}`);
  if (mob.issues) {
    for (const issue of mob.issues) console.log(`  [WARN] ${issue.issueType}: ${issue.severity}`);
  }

  console.log('\n-- Rich Results --');
  console.log(`  Verdict:              ${rich.verdict || 'N/A'}`);
  if (rich.detectedItems) {
    for (const item of rich.detectedItems) {
      console.log(`  Type: ${item.richResultType}`);
      if (item.items) {
        for (const sub of item.items) {
          console.log(`    ${sub.name || 'item'}: ${sub.issues ? sub.issues.map(i => i.issueMessage).join(', ') : 'OK'}`);
        }
      }
    }
  }
}

async function runIndexation() {
  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: { startDate: dateStr(days), endDate: dateStr(1), dimensions: ['page'], rowLimit: limit },
  });
  const rows = res.data.rows || [];
  if (!rows.length) { console.log('No pages found.'); return; }

  console.log(`\n[${SITE_URL}] Indexation audit — checking ${rows.length} pages\n`);
  console.log('Status'.padEnd(8) + 'Verdict'.padEnd(10) + 'Coverage'.padEnd(40) + 'Page');
  console.log('-'.repeat(120));

  for (const r of rows) {
    const url = r.keys[0];
    try {
      const inspRes = await searchconsole.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl: SITE_URL } });
      const idx = inspRes.data.inspectionResult.indexStatusResult || {};
      const verdict = idx.verdict || 'UNKNOWN';
      const coverage = idx.coverageState || 'N/A';
      const tag = verdict === 'PASS' ? '[OK]' : verdict === 'NEUTRAL' ? '[WARN]' : '[FAIL]';
      console.log(tag.padEnd(8) + verdict.padEnd(10) + coverage.substring(0, 38).padEnd(40) + url.replace(SITE_ORIGIN, ''));
    } catch (err) {
      console.log('[ERR]'.padEnd(8) + 'ERROR'.padEnd(10) + 'API error'.padEnd(40) + url.replace(SITE_ORIGIN, ''));
    }
  }
}

async function runVitals() {
  const url = pageFilter ? (pageFilter.startsWith('http') ? pageFilter : `${SITE_ORIGIN}${pageFilter}`) : SITE_ORIGIN;
  console.log(`\n[${SITE_URL}] Core Web Vitals — ${url} (${strategy})\n`);

  try {
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy.toUpperCase()}&category=PERFORMANCE`;

    const response = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${accessToken.token || accessToken}` },
    });
    if (!response.ok) throw new Error(`PSI API error: ${response.status} ${await response.text()}`);

    const data = await response.json();
    const lhr = data.lighthouseResult;
    const audits = lhr.audits;

    const score = lhr.categories.performance.score * 100;
    const lcp = audits['largest-contentful-paint'];
    const cls = audits['cumulative-layout-shift'];
    const tbt = audits['total-blocking-time'];
    const fcp = audits['first-contentful-paint'];
    const si = audits['speed-index'];

    const tag = (s) => (s >= 0.9 ? '[OK]' : s >= 0.5 ? '[WARN]' : '[POOR]');
    console.log(`Performance Score: ${score.toFixed(0)}/100 ${tag(score / 100)}\n`);
    console.log('Metric'.padEnd(35) + 'Value'.padStart(12) + '  Status');
    console.log('-'.repeat(60));

    const metrics = [
      { name: 'Largest Contentful Paint (LCP)', value: lcp.displayValue, score: lcp.score },
      { name: 'Cumulative Layout Shift (CLS)', value: cls.displayValue, score: cls.score },
      { name: 'Total Blocking Time (TBT)', value: tbt.displayValue, score: tbt.score },
      { name: 'First Contentful Paint (FCP)', value: fcp.displayValue, score: fcp.score },
      { name: 'Speed Index', value: si.displayValue, score: si.score },
    ];
    for (const m of metrics) {
      console.log(`${m.name.padEnd(35)}${(m.value || 'N/A').padStart(12)}  ${tag(m.score)}`);
    }

    const opportunities = Object.values(audits)
      .filter(a => a.details?.type === 'opportunity' && a.score !== null && a.score < 0.9)
      .sort((a, b) => (a.score || 0) - (b.score || 0))
      .slice(0, 5);
    if (opportunities.length) {
      console.log('\nTop Opportunities:');
      for (const opp of opportunities) console.log(`  -> ${opp.title}: ${opp.displayValue || ''}`);
    }
  } catch (err) {
    console.error('Vitals error:', err.message);
  }
}

async function runRichResults() {
  const res = await searchconsole.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: { startDate: dateStr(days), endDate: dateStr(1), dimensions: ['page'], rowLimit: limit },
  });
  const rows = res.data.rows || [];
  if (!rows.length) { console.log('No pages found.'); return; }

  console.log(`\n[${SITE_URL}] Rich Results audit — checking ${rows.length} pages\n`);

  let found = 0;
  for (const r of rows) {
    const url = r.keys[0];
    try {
      const inspRes = await searchconsole.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl: SITE_URL } });
      const rich = inspRes.data.inspectionResult.richResultsResult || {};
      if (rich.detectedItems && rich.detectedItems.length > 0) {
        found++;
        console.log(`${url.replace(SITE_ORIGIN, '')}`);
        for (const item of rich.detectedItems) {
          const hasIssues = item.items?.some(i => i.issues?.length > 0);
          console.log(`   ${hasIssues ? '[WARN]' : '[OK]  '} ${item.richResultType}`);
          if (hasIssues) {
            for (const sub of item.items) {
              if (sub.issues?.length) {
                for (const issue of sub.issues) console.log(`      [FAIL] ${issue.issueMessage}`);
              }
            }
          }
        }
      }
    } catch (err) {
      // skip pages that error on inspection
    }
  }
  if (!found) console.log('No structured data detected on the inspected pages.');
}


// ─── Sitemaps ───────────────────────────────────────────────────────────────
// Submitting the sitemap is the one thing a brand-new property needs, and the
// one Google actually acts on. IndexNow does not reach Google; this does.
async function runSitemaps() {
  const sitemap = getArg('sitemap', `${SITE_ORIGIN}/sitemap.xml`);
  if (args.includes('--submit')) {
    await searchconsole.sitemaps.submit({ siteUrl: SITE_URL, feedpath: sitemap });
    console.log(`
Submitted ${sitemap} to ${SITE_URL}
`);
  }
  const { data } = await searchconsole.sitemaps.list({ siteUrl: SITE_URL });
  const list = data.sitemap || [];
  if (!list.length) {
    console.log(`
[${SITE_URL}] No sitemap submitted yet. Run: node scripts/gsc-query.mjs sitemaps --submit
`);
    return;
  }
  console.log(`
[${SITE_URL}] Sitemaps
`);
  console.log('Path'.padEnd(50) + 'Submitted'.padEnd(22) + 'Last read'.padEnd(22) + 'URLs'.padStart(8) + '  Errors  Warnings');
  console.log('-'.repeat(118));
  for (const s of list) {
    const urls = (s.contents || []).reduce((n, c) => n + Number(c.submitted || 0), 0);
    console.log(
      String(s.path || '').replace(SITE_ORIGIN, '').substring(0, 48).padEnd(50) +
      String(s.lastSubmitted || '—').substring(0, 19).padEnd(22) +
      String(s.lastDownloaded || 'never read').substring(0, 19).padEnd(22) +
      String(urls).padStart(8) +
      String(s.errors ?? 0).padStart(8) + String(s.warnings ?? 0).padStart(10),
    );
  }
  console.log('');
}

// ─── Main ───────────────────────────────────────────────────────────────────
const commands = {
  sites: runSites,
  queries: runQueries,
  pages: runPages,
  inspect: runInspect,
  indexation: runIndexation,
  vitals: runVitals,
  richresults: runRichResults,
  sitemaps: runSitemaps,
};

if (!command || !commands[command]) {
  console.log(`
GSC Query Tool — agenthill.lol

Commands:
  sites         List properties accessible to the service account
  queries       Top search queries
  pages         Top pages by traffic
  inspect       URL inspection (--page required): index + mobile + rich results
  indexation    Indexation status of top pages
  vitals        Core Web Vitals (PageSpeed Insights)
  richresults   Rich results audit on top pages
  sitemaps      List sitemaps; --submit to submit one (--sitemap URL to override)

Options:
  --days N      Lookback period (default: 28)
  --limit N     Max results (default: 25)
  --page URL    Filter by / inspect a page URL
  --query STR   Filter by query keyword
  --strategy    mobile|desktop (for vitals, default: mobile)

Env:
  GSC_SITE      GSC property (default: sc-domain:agenthill.lol)
  GSC_ORIGIN    Origin for inspect/pages (default: https://agenthill.lol)
  GSC_KEY       Path to service account JSON key
`);
  process.exit(0);
}

commands[command]().catch(err => {
  console.error('Error:', err.message);
  if (err.code === 403) console.error('-> Add the service account in GSC Settings > Users for this property');
  if (err.code === 401) console.error('-> Enable Search Console API in GCP Console');
  process.exit(1);
});
