const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

function boot() {
  const app = express();
  app.use('/movies', require('../src/movieSite'));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}/movies`, server }));
  });
}

test('movies home exposes OTT navigation, hero artwork, and catalog cards', async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes('ARIA MOVIES'));
    assert.ok(html.includes('Dune: Part Two'));
    assert.ok(html.includes('movie-grid'));
    assert.ok(html.includes('image.tmdb.org/t/p/w500'));
    assert.ok(html.includes('this.src='));
    assert.ok(html.toLowerCase().includes('official availability'));
  } finally { server.close(); }
});

test('movies search and genre browse return filtered results', async () => {
  const { base, server } = await boot();
  try {
    const search = await (await fetch(`${base}/search?q=Inception`)).text();
    assert.ok(search.includes('Inception'));
    assert.ok(!search.includes('Howl’s Moving Castle'));
    const browse = await (await fetch(`${base}/browse?genre=Animation`)).text();
    assert.ok(browse.includes('Spider-Man: Across the Spider-Verse'));
    assert.ok(browse.includes('Howl’s Moving Castle'));
  } finally { server.close(); }
});

test('movie details provide official information link without inventing a stream', async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/title/inception`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes('Open title information'));
    assert.ok(html.toLowerCase().includes('official availability'));
    assert.ok(!html.includes('Download file'));
  } finally { server.close(); }
});

test('movies API returns stable curated metadata', async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/catalog`);
    const body = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(body.ok, true);
    assert.ok(body.titles.length >= 8);
    assert.ok(body.titles.some((movie) => movie.id === 'inception'));
  } finally { server.close(); }
});
