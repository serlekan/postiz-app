#!/usr/bin/env node
// Safe Postiz importer: creates DRAFT posts only. Requires Node.js 22+.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const settings = {
  x: { __type: 'x', who_can_reply_post: 'everyone' },
  linkedin: { __type: 'linkedin', post_as_images_carousel: false },
};

export function validateBundle(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Expected a JSON object');
  if (input.status !== 'ready_for_review') throw Error('Editorial status must be ready_for_review');
  if (typeof input.date !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(input.date)) throw Error('Date needs an explicit timezone');
  const date = new Date(input.date);
  if (!Number.isFinite(date.getTime()) || date <= now) throw Error('Date must be a valid future timestamp');
  if (!['evergreen', 'news', 'industry', 'security', 'story'].includes(input.category)) throw Error('Invalid editorial category');
  if (!Array.isArray(input.sources) || input.sources.some(s => typeof s !== 'string' || !s.startsWith('https://'))) throw Error('Sources must be HTTPS URLs');
  if (input.category !== 'evergreen' && input.sources.length === 0) throw Error('Fact-based stories require source URLs');
  if (!Array.isArray(input.entries) || input.entries.length < 1 || input.entries.length > 2) throw Error('Expected one or two network entries');
  const found = new Set();
  const entries = input.entries.map(e => {
    if (!e || !Object.hasOwn(settings, e.network)) throw Error('Only X and LinkedIn are allowed');
    if (found.has(e.network)) throw Error('Network specified twice');
    found.add(e.network);
    const content = Array.isArray(e.content) ? e.content : [e.content];
    if (!content.length || content.length > 10 || content.some(s => typeof s !== 'string' || !s.trim())) throw Error('Content must have 1–10 nonempty segments');
    if (e.network === 'linkedin' && content.length !== 1) throw Error('LinkedIn requires one text segment');
    if (e.network === 'x' && content.some(s => Array.from(s).length > 280)) throw Error('An X segment exceeds conservative 280-character guard');
    if (e.network === 'linkedin' && Array.from(content[0]).length > 3000) throw Error('LinkedIn content exceeds 3000 characters');
    return { network: e.network, content: content.map(s => s.trim()) };
  });
  return { date: date.toISOString(), category: input.category, sources: input.sources, entries };
}

export function buildPayload(bundle, integrationIds) {
  return {
    type: 'draft', date: bundle.date, shortLink: false, tags: [],
    posts: bundle.entries.map(e => {
      if (!integrationIds[e.network]) throw Error('Missing connected integration for ' + e.network);
      return {
        integration: { id: integrationIds[e.network] },
        value: e.content.map(content => ({ content, image: [] })),
        settings: { ...settings[e.network] },
      };
    }),
  };
}

export function selectIntegrations(bundle, integrations, overrides = {}) {
  if (!Array.isArray(integrations)) throw Error('Postiz returned unexpected integrations data');
  const ids = {};
  for (const { network } of bundle.entries) {
    const list = integrations.filter(i => i && i.identifier === network && i.disabled !== true &&
      (!overrides[network] || overrides[network] === i.id));
    if (list.length !== 1) throw Error('Expected exactly one enabled ' + network + ' channel; set POSTIZ_' + network.toUpperCase() + '_INTEGRATION_ID if needed');
    ids[network] = list[0].id;
  }
  return ids;
}

export function endpoint(base, path) {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) throw Error('Invalid Postiz base URL');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw Error('HTTPS is required except on localhost');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/public\/v1$/, '') + '/public/v1/' + path;
  return url.toString();
}

export async function createDrafts(bundle, { base, key, fetcher = fetch, overrides = {} }) {
  if (!base || !key) throw Error('POSTIZ_BASE_URL and POSTIZ_API_KEY are required');
  const headers = { Authorization: key, 'Content-Type': 'application/json' };
  const get = await fetcher(endpoint(base, 'integrations'), { headers, signal: AbortSignal.timeout(15000) });
  if (!get.ok) throw Error('Integration lookup failed (HTTP ' + get.status + ')');
  const ids = selectIntegrations(bundle, await get.json(), overrides);
  const payload = buildPayload(bundle, ids);
  const post = await fetcher(endpoint(base, 'posts'), {
    method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
  });
  if (!post.ok) throw Error('Draft creation failed (HTTP ' + post.status + ')');
  return payload.posts.length;
}

async function main(args) {
  if (args.includes('--help')) {
    console.log('node scripts/serlekan/draft-import.mjs --file story.json [--apply]\nDefault: offline preview. --apply creates DRAFTS only.');
    return;
  }
  const index = args.indexOf('--file');
  if (index < 0 || !args[index + 1] || args.some(a => a.startsWith('--') && !['--apply', '--file'].includes(a))) throw Error('Expected --file path.json [--apply]');
  const bundle = validateBundle(JSON.parse(await readFile(args[index + 1], 'utf8')));
  if (!args.includes('--apply')) {
    const ids = Object.fromEntries(bundle.entries.map(e => [e.network, 'PREVIEW_' + e.network.toUpperCase()]));
    console.log(JSON.stringify({ category: bundle.category, sources: bundle.sources, payload: buildPayload(bundle, ids) }, null, 2));
    console.log('PREVIEW ONLY; no network requests');
    return;
  }
  const count = await createDrafts(bundle, {
    base: process.env.POSTIZ_BASE_URL, key: process.env.POSTIZ_API_KEY,
    overrides: { x: process.env.POSTIZ_X_INTEGRATION_ID, linkedin: process.env.POSTIZ_LINKEDIN_INTEGRATION_ID },
  });
  console.log('Created ' + count + ' drafts. No posts scheduled or published. Review in Postiz.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.message); process.exitCode = 1; });
}
