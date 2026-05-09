import http from 'node:http';

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:3100';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  capture(response) {
    const setCookies = response.headers.getSetCookie?.() || [];
    for (const header of setCookies) {
      const first = header.split(';')[0];
      const eq = first.indexOf('=');
      if (eq > 0) this.cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
  }

  header() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.json) headers.set('content-type', 'application/json');
  if (options.cookieJar) {
    const cookie = options.cookieJar.header();
    if (cookie) headers.set('cookie', cookie);
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || (options.json ? 'POST' : 'GET'),
    headers,
    body: options.json ? JSON.stringify(options.json) : options.body,
    redirect: 'manual',
  });
  options.cookieJar?.capture(response);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data, text };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createAmazonFixtureServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== '/amazon-product') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html>
  <body>
    <span id="productTitle">Deterministic Test Item</span>
    <div id="corePrice_feature_div">
      <span class="a-price"><span class="a-offscreen">$42.17</span></span>
    </div>
  </body>
</html>`);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Fixture server did not expose a TCP port.'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/amazon-product`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

async function main() {
  const fixture = await createAmazonFixtureServer();
  const jar = new CookieJar();
  const suffix = Math.random().toString(36).slice(2, 8);
  const agentUsername = `quote_${suffix}`;
  const humanEmail = `quote+${suffix}@example.com`;
  const hasJlcPricingModel = Boolean(process.env.OTTOAUTH_JLCPCB_PRICE_MODEL_JSON);

  try {
    const agentRes = await request('/api/agents/create', {
      json: {
        username: agentUsername,
        callback_url: 'https://example.com/ottoauth/callback',
      },
    });
    assert(agentRes.response.ok, `Agent create failed: ${agentRes.text}`);
    const privateKey = agentRes.data.privateKey;
    const pairingKey = agentRes.data.pairingKey;
    assert(privateKey && pairingKey, 'Agent create response missing credentials.');

    const manualQuoteRes = await request('/v1/quotes', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        task: 'Quote one explicitly priced supplier order.',
        store: 'xometry',
        merchant: 'Manual Supplier',
        quote: {
          source: 'operator_pricing_model',
          source_label: 'Operator pricing model',
          confidence: 'exact',
          total_cents: 1234,
          currency: 'usd',
        },
      },
    });
    assert(manualQuoteRes.response.ok, `Manual quote failed: ${manualQuoteRes.text}`);
    assert(manualQuoteRes.data.quote.status === 'priced', `Expected priced manual quote, got ${manualQuoteRes.text}`);
    assert(manualQuoteRes.data.quote.total_cents === 1234, `Expected manual total 1234, got ${manualQuoteRes.text}`);

    const amazonQuoteRes = await request('/v1/quotes', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        task: 'Quote this direct Amazon product link.',
        store: 'amazon',
        url: fixture.url,
        url_policy: 'preferred',
      },
    });
    assert(amazonQuoteRes.response.ok, `Amazon quote failed: ${amazonQuoteRes.text}`);
    assert(amazonQuoteRes.data.quote.source === 'amazon_product_page_scrape', `Expected Amazon scrape source, got ${amazonQuoteRes.text}`);
    assert(amazonQuoteRes.data.quote.goods_cents === 4217, `Expected scraped Amazon price 4217, got ${amazonQuoteRes.text}`);
    assert(amazonQuoteRes.data.quote.product_title === 'Deterministic Test Item', `Expected scraped title, got ${amazonQuoteRes.text}`);

    const amazonSearchRes = await request('/v1/search', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        query: `Find this direct Amazon fixture product ${fixture.url}`,
        platform: 'amazon',
        url: fixture.url,
      },
    });
    assert(amazonSearchRes.response.ok, `Amazon search failed: ${amazonSearchRes.text}`);
    assert(Array.isArray(amazonSearchRes.data.offers), `Search response missing offers: ${amazonSearchRes.text}`);
    assert(amazonSearchRes.data.offers.length > 0, `Expected at least one search offer, got ${amazonSearchRes.text}`);
    assert(amazonSearchRes.data.offers[0].source === 'amazon_product_page_scrape', `Expected Amazon scrape offer, got ${amazonSearchRes.text}`);
    assert(amazonSearchRes.data.offers[0].estimated_total_cents === 4217, `Expected search offer total 4217, got ${amazonSearchRes.text}`);

    const mcmasterQuoteRes = await request('/v1/quotes', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        task: 'Quote McMaster part 91292A113.',
        store: 'mcmaster',
        part_number: '91292A113',
        quantity: 1,
      },
    });
    assert(mcmasterQuoteRes.response.ok, `McMaster quote failed: ${mcmasterQuoteRes.text}`);
    assert(mcmasterQuoteRes.data.quote.source === 'mcmaster_curated_catalog', `Expected McMaster catalog source, got ${mcmasterQuoteRes.text}`);
    assert(mcmasterQuoteRes.data.quote.total_cents === 687, `Expected McMaster 5% margin total 687, got ${mcmasterQuoteRes.text}`);

    const mcmasterSearchRes = await request('/v1/search', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        query: 'M3 x 10 socket head screw McMaster',
        platform: 'mcmaster',
      },
    });
    assert(mcmasterSearchRes.response.ok, `McMaster search failed: ${mcmasterSearchRes.text}`);
    assert(Array.isArray(mcmasterSearchRes.data.offers), `McMaster search response missing offers: ${mcmasterSearchRes.text}`);
    assert(mcmasterSearchRes.data.offers.some((offer) => offer.source === 'mcmaster_curated_catalog'), `Expected McMaster catalog offer, got ${mcmasterSearchRes.text}`);

    const digikeyQuoteRes = await request('/v1/quotes', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        task: 'Quote DigiKey LM358P op amp.',
        store: 'digikey',
        part_number: 'LM358P',
        quantity: 1,
      },
    });
    assert(digikeyQuoteRes.response.ok, `DigiKey quote failed: ${digikeyQuoteRes.text}`);
    assert(digikeyQuoteRes.data.quote.source === 'digikey_curated_catalog', `Expected DigiKey catalog source, got ${digikeyQuoteRes.text}`);
    assert(digikeyQuoteRes.data.quote.total_cents === 29, `Expected DigiKey 5% margin total 29, got ${digikeyQuoteRes.text}`);

    const digikeySearchRes = await request('/v1/search', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        query: 'DigiKey 10k 0805 resistor',
        platform: 'digikey',
        quantity: 100,
      },
    });
    assert(digikeySearchRes.response.ok, `DigiKey search failed: ${digikeySearchRes.text}`);
    assert(Array.isArray(digikeySearchRes.data.offers), `DigiKey search response missing offers: ${digikeySearchRes.text}`);
    assert(digikeySearchRes.data.offers.some((offer) => offer.source === 'digikey_curated_catalog'), `Expected DigiKey catalog offer, got ${digikeySearchRes.text}`);

    const jlcQuoteRes = await request('/v1/quotes', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        task: 'Order PCB fabrication from JLCPCB for the attached Gerbers.',
        store: 'jlcpcb',
        quantity: 2,
        board_area_cm2: 10,
        layers: 4,
      },
    });
    assert(jlcQuoteRes.response.ok, `JLC quote failed: ${jlcQuoteRes.text}`);
    if (hasJlcPricingModel) {
      assert(jlcQuoteRes.data.quote.status === 'estimated', `Expected estimated JLC quote with manual model, got ${jlcQuoteRes.text}`);
      assert(jlcQuoteRes.data.quote.source === 'jlcpcb_manual_pricing_model', `Expected JLC manual model source, got ${jlcQuoteRes.text}`);
      assert(jlcQuoteRes.data.quote.total_cents === 1190, `Expected JLC model total 1190, got ${jlcQuoteRes.text}`);
    } else {
      assert(jlcQuoteRes.data.quote.status === 'unavailable', `Expected unavailable JLC quote without manual model, got ${jlcQuoteRes.text}`);
      assert(jlcQuoteRes.data.quote.billing_mode === 'retroactive_after_fulfillment', `Expected retroactive JLC billing mode, got ${jlcQuoteRes.text}`);
    }

    const loginRes = await request('/api/auth/dev-login', {
      cookieJar: jar,
      json: {
        email: humanEmail,
        display_name: 'Quote Test',
      },
    });
    assert(loginRes.response.ok, `Dev login failed: ${loginRes.text}`);

    const pairAgentRes = await request('/api/human/pair-agent', {
      cookieJar: jar,
      json: { pairing_key: pairingKey },
    });
    assert(pairAgentRes.response.ok, `Pair agent failed: ${pairAgentRes.text}`);

    const orderRes = await request('/v1/orders', {
      headers: { authorization: `Bearer ${privateKey}` },
      json: {
        store: 'xometry',
        merchant: 'Manual Supplier',
        task: 'Buy the manually quoted verification item. This is a routing verification; do not complete a live purchase.',
        max_charge_cents: 2000,
        quote: {
          source_label: 'Operator pricing model',
          confidence: 'exact',
          total_cents: 1234,
          currency: 'usd',
        },
      },
    });
    assert(orderRes.response.ok, `Create order failed: ${orderRes.text}`);
    assert(orderRes.data.price_quote.total_cents === 1234, `Expected top-level order quote, got ${orderRes.text}`);
    assert(orderRes.data.order.quote.total_cents === 1234, `Expected stored order quote, got ${orderRes.text}`);
    assert(orderRes.data.order.payment.quoted_total_cents === 1234, `Expected quoted payment total, got ${orderRes.text}`);

    const statusRes = await request(`/v1/orders/${orderRes.data.order.id}`, {
      headers: { authorization: `Bearer ${privateKey}` },
      method: 'GET',
    });
    assert(statusRes.response.ok, `Order status failed: ${statusRes.text}`);
    assert(statusRes.data.order.quote.total_cents === 1234, `Expected status order quote, got ${statusRes.text}`);

    console.log(JSON.stringify({
      ok: true,
      baseUrl,
      amazon_fixture_url: fixture.url,
      order_id: orderRes.data.order.id,
      checked: [
        'manual quote endpoint',
        'Amazon non-browser HTML scrape quote',
        'supported-offer search direct URL quote',
        'McMaster curated catalog quote',
        'McMaster supported-offer catalog search',
        'DigiKey curated catalog quote',
        'DigiKey supported-offer catalog search',
        hasJlcPricingModel
          ? 'JLC manual pricing model estimate'
          : 'JLC unavailable/retroactive fallback',
        'canonical order stores non-browser quote',
        'order status returns stored quote',
      ],
    }, null, 2));
  } finally {
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
