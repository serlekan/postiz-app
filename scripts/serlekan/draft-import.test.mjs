import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBundle, buildPayload, selectIntegrations, endpoint, createDrafts } from './draft-import.mjs';

const example = () => ({
  status: 'ready_for_review', category: 'news', date: '2030-11-06T18:00:00+01:00',
  sources: ['https://example.com/research'],
  entries: [{ network: 'x', content: ['A documented finding', 'A useful takeaway'] },
            { network: 'linkedin', content: 'A separate, professional interpretation' }],
});

test('validates a complete, time-zoned, sourced editorial bundle', () => {
  const result = validateBundle(example(), new Date('2026-11-04'));
  assert.equal(result.entries.length, 2);
  assert.equal(result.date, '2030-11-06T17:00:00.000Z');
});

test('rejects missing evidence, stale dates, duplicates and long X segments', () => {
  for (const change of [
    b => { b.sources = []; },
    b => { b.date = '2020-01-01T10:00:00Z'; },
    b => { b.date = '2030-11-06T18:00:00'; },
    b => { b.entries[1].network = 'x'; },
    b => { b.entries[0].content = 'x'.repeat(281); },
    b => { b.status = 'unreviewed'; },
  ]) { const input = example(); change(input); assert.throws(() => validateBundle(input, new Date('2026-11-04'))); }
});

test('payloads are draft-only, with different copy and settings per channel', () => {
  const payload = buildPayload(validateBundle(example(), new Date('2026-11-04')), { x: 'x1', linkedin: 'li1' });
  assert.equal(payload.type, 'draft');
  assert.equal(payload.posts[0].settings.__type, 'x');
  assert.equal(payload.posts[1].settings.__type, 'linkedin');
  assert.notEqual(payload.posts[0].value[0].content, payload.posts[1].value[0].content);
  assert.ok(!JSON.stringify(payload).includes('example.com/research')); // sources stay internal
});

test('refuses ambiguous or disabled account connections', () => {
  const bundle = validateBundle(example(), new Date('2026-11-04'));
  const channels = [{ id: 'x1', identifier: 'x' }, { id: 'x2', identifier: 'x' }, { id: 'li1', identifier: 'linkedin', disabled: true }];
  assert.throws(() => selectIntegrations(bundle, channels));
  assert.deepEqual(selectIntegrations(bundle, [...channels, { id: 'li2', identifier: 'linkedin' }], { x: 'x1' }), { x: 'x1', linkedin: 'li2' });
});

test('API URLs enforce HTTPS outside localhost', () => {
  assert.equal(endpoint('https://p.example.com/public/v1', 'posts'), 'https://p.example.com/public/v1/posts');
  assert.equal(endpoint('http://localhost:3000', 'posts'), 'http://localhost:3000/public/v1/posts');
  assert.throws(() => endpoint('http://p.example.com', 'posts'));
  assert.throws(() => endpoint('https://user:password@p.example.com', 'posts'));
});

test('mock API receives only a draft request and no publish operation', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, json: async () => [
      { id: 'x1', identifier: 'x' }, { id: 'li1', identifier: 'linkedin' },
    ] };
  };
  const count = await createDrafts(validateBundle(example(), new Date('2026-11-04')), {
    base: 'https://p.example.com', key: 'example-secret', fetcher,
  });
  assert.equal(count, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(JSON.parse(calls[1].options.body).type, 'draft');
  assert.equal(calls[1].options.headers.Authorization, 'example-secret');
});

test('failed requests do not expose the API key', async () => {
  await assert.rejects(createDrafts(validateBundle(example(), new Date('2026-11-04')), {
    base: 'https://p.example.com', key: 'example-secret',
    fetcher: async () => ({ ok: false, status: 401 }),
  }), err => !err.message.includes('example-secret') && err.message.includes('401'));
});
