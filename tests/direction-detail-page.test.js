'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');

const app = require('../app');

describe('direction-detail template integrity', () => {
  test('has valid title/header tags and period labels', () => {
    const htmlPath = path.join(__dirname, '..', 'public', 'direction-detail.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.match(html, /<title>\s*방향\s*상세\s*분석\s*<\/title>/);
    assert.ok(html.includes('<h2 id="directionName"'));
    assert.ok(html.includes('</h2>'));
    assert.ok(html.includes('id="backBtn"'));
    assert.ok(html.includes('data-period="1d">1일</button>'));
    assert.ok(html.includes('data-period="1w">1주</button>'));
    assert.ok(html.includes('data-period="1m">1달</button>'));
    assert.ok(html.includes('data-period="1y">1년</button>'));

    assert.equal(/[^<]\/title>/.test(html), false);
    assert.equal(/[^<]\/h2>/.test(html), false);
  });
});

describe('direction-detail static route smoke', () => {
  test('GET /direction-detail.html returns 200 html', async () => {
    const res = await request(app).get('/direction-detail.html');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /text\/html/i);
    assert.match(res.text, /id="backBtn"/);
  });

  test('GET /js/direction-detail.js returns 200 javascript', async () => {
    const res = await request(app).get('/js/direction-detail.js?v=2');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] || '', /javascript/i);
  });
});
