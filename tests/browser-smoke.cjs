// Integration checks against a running Flask app using local API fixtures.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'amozon-browser-'));
const url = process.argv[2] || 'http://127.0.0.1:5000';
const browser = process.env.BROWSER_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(
  browser,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--user-data-dir=' + path.join(stage, 'chrome-profile-maintenance'),
    'about:blank',
  ],
  {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket;
(async () => {
  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(
      () => reject(new Error('Browser startup timed out: ' + log.slice(-1000))),
      15000,
    );
    chrome.on('error', reject);
    chrome.on('exit', (code) =>
      reject(new Error('Browser exited: ' + code + ' ' + log.slice(-1000))),
    );
    chrome.stderr.on('data', (data) => {
      log += data;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let serial = 0;
  const pending = new Map();
  const errors = [];
  const requests = [];
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const p = pending.get(message.id);
      pending.delete(message.id);
      message.error
        ? p.reject(new Error(JSON.stringify(message.error)))
        : p.resolve(message.result);
    }
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Runtime.exceptionThrown')
      errors.push(message.params.exceptionDetails.text);
  };
  function command(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, {
        resolve,
        reject,
      });
      socket.send(
        JSON.stringify({
          id,
          method,
          params,
          sessionId,
        }),
      );
    });
  }
  const { targetId } = await command('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId } = await command('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const page = (method, params) => command(method, params, sessionId);
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Page.bringToFront');
  async function evaluate(expression) {
    const response = await page('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
    return response.result.value;
  }
  async function wait(expression) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
      if (await evaluate(expression)) return;
      await sleep(70);
    }
    console.log(
      await evaluate(
        'JSON.stringify({text:document.body.innerText,calls:window.fi' +
          'xtureCalls,fetch:String(window.fetch)})',
      ),
    );
    console.log(errors);
    throw new Error('Timed out: ' + expression);
  }
  async function navigate(route) {
    await page('Page.navigate', {
      url: url + route,
    });
    await wait(
      "document.querySelector('#storefront') && " +
        "document.querySelector('#shoppers').getAttribute('aria-busy'" +
        ") === 'false'",
    );
  }
  const ready =
    "document.querySelector('#recommendations-content')?.getAttri" +
    "bute('aria-busy') === 'false' && " +
    "document.querySelector('#history-content')?.getAttribute('ar" +
    "ia-busy') === 'false'";
  async function select(user) {
    await evaluate(
      "document.querySelector('#user-picker').click(); " +
        "[...document.querySelectorAll('[data-shopper-id]')].find(opt" +
        'ion=>option.dataset.shopperId===' +
        `${JSON.stringify(user)}` +
        ').click()',
    );
    await wait(ready);
  }
  const ids = [
    'ae24aljoiqjoibv3ycrbis4ekx2a',
    'aeayitldccp4fwimhv7tgr67ysnq',
    'aeqwyrohwdka275azy6mrqlu33vq',
  ];
  const engines = ['collaborative', 'content_based', 'popular'];
  await page('Page.addScriptToEvaluateOnNewDocument', {
    source:
      '\n    (() => {\n      const originalFetch = ' +
      'window.fetch.bind(window);\n      const ids = ' +
      `${JSON.stringify(ids)}` +
      ';\n      const engines = ' +
      `${JSON.stringify(engines)}` +
      ';\n      const item = ' +
      "{parent_asin:'demo-product',item_title:'Sample " +
      "Software',main_category:'Software',avg_rating:4.2,num_review" +
      "s:7,price:12,description:'Sample product'};\n      " +
      'window.fixtureCalls = []; window.resolveStaleRequests = []; ' +
      'window.wakeAttempts = {}; window.fixtureAborted = [];\n     ' +
      ' window.fixtureMode = new ' +
      "URL(location.href).searchParams.get('fixture') || '';\n     " +
      ' window.fetch = (input, options = {}) => {\n        const ' +
      'url = new URL(input instanceof Request ? input.url : ' +
      'String(input), location.href);\n        if ' +
      "(!url.pathname.startsWith('/api/v1/')) return " +
      'originalFetch(input, options);\n        ' +
      'window.fixtureCalls.push(url.pathname);\n        if ' +
      "(window.fixtureMode === 'pending') return new " +
      'Promise((resolve,reject) => {\n          ' +
      "options.signal?.addEventListener('abort', () => " +
      '{window.fixtureAborted.push(url.pathname); reject(new ' +
      "DOMException('Cancelled','AbortError'));}, {once:true});\n  " +
      '      });\n        const user = ' +
      "url.pathname.split('/')[4];\n        const engine = " +
      "engines[ids.indexOf(user)] || 'popular';\n        let body, " +
      'status = 200;\n        const reviews = ' +
      "Array.from({length:window.fixtureMode === 'pages' ? 23 : " +
      "7}, (_,i) => ({review_id:'review-'+i,user_id:user || " +
      "'reviewer',parent_asin:item.parent_asin,review_rating:4,revi" +
      "ew_title:'Review '+i,review_text:'Sample " +
      "review.',review_date:'2023-01-01',verified_purchase:true,ite" +
      "m}));\n        if (window.fixtureMode === 'varied') " +
      'reviews.forEach((row,i) => {\n          row.item = i % 3 ' +
      "=== 0 ? null : {...item,item_title: i % 2 ? 'A much longer " +
      'software title to exercise wrapping across small and large ' +
      "cards' : item.item_title,num_reviews:i%2 ? 0 : " +
      '7,is_free:i%2===0};\n          if (i % 2) row.review_date = ' +
      'null;\n        });\n        if ' +
      "(url.pathname.endsWith('/history')) body = " +
      "{items:window.fixtureMode === 'empty' ? [] : " +
      "reviews,total_count:window.fixtureMode === 'empty' ? 0 : " +
      "reviews.length,page_count:window.fixtureMode === 'empty' ? " +
      '0 : 1};\n        else if ' +
      "(url.pathname.endsWith('/recommendations')) {\n          " +
      'body = {user_id:user,engine_used:engine,items:window.fixture' +
      "Mode === 'empty' ? [] : [item]};\n          if " +
      "(window.fixtureMode === 'failure') { status = 404; body = " +
      "{detail:'Unavailable'}; }\n        }\n        else if " +
      "(url.pathname.endsWith('/reviews')) { const page = " +
      "Number(url.searchParams.get('page')); body = " +
      '{items:reviews.slice((page-1)*10,page*10),total_count:review' +
      's.length,page_count:Math.ceil(reviews.length/10)}; }\n      ' +
      "  else if (url.pathname === '/api/v1/items/demo-product') " +
      "body = item;\n        else { status=404; body={detail:'Not " +
      "found'}; }\n        \n        " +
      'window.wakeAttempts[url.pathname] = ' +
      '(window.wakeAttempts[url.pathname] || 0) + 1;\n        if ' +
      "(window.fixtureMode === 'waking' && " +
      'window.wakeAttempts[url.pathname] === 1) ' +
      "{status=503;body={detail:'Loading'};}\n        const " +
      'response = new Response(JSON.stringify(body), ' +
      "{status,headers:{'Content-Type':'application/json'}});\n    " +
      "    if (window.fixtureMode === 'race' && user === ids[0]) " +
      'return new Promise(resolve => ' +
      'window.resolveStaleRequests.push(() => ' +
      'resolve(response)));\n        return ' +
      'Promise.resolve(response);\n      };\n    })();\n  ',
  });
  await page('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await navigate('/');
  await wait(ready);
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[0]);
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('[data-shopper-id]')].map(row=" +
        '>[row.dataset.shopperId,row.dataset.shopperLabel])',
    ),
    ids.map((id, i) => [id, 'Shopper ' + (i + 1)]),
  );
  assert.equal(
    await evaluate(
      "window.fixtureCalls.filter(path=>path.endsWith('/recommendat" + "ions')).length",
    ),
    1,
    'Default selection should request recommendations once',
  );
  assert.equal(
    await evaluate("window.fixtureCalls.filter(path=>path.endsWith('/history')).length"),
    1,
  );
  for (let i = 0; i < ids.length; i++) {
    await select(ids[i]);
    assert.equal(
      await evaluate("document.querySelector('#user-picker .account-name').textContent"),
      'Shopper ' + (i + 1),
    );
    assert.match(
      await evaluate("document.querySelector('#history-heading').textContent"),
      new RegExp('Shopper ' + (i + 1)),
    );
    assert.equal(
      await evaluate("document.querySelector('#recommendations-heading').textContent"),
      i === 2 ? 'Popular picks' : 'Recommended for Shopper ' + (i + 1),
    );
    assert.match(
      await evaluate("document.querySelector('#recommendations-content').textContent"),
      /Sample Software/,
    );
    const calls = await evaluate('window.fixtureCalls.length');
    await evaluate('document.querySelector(\'[data-history-page="1"]\').click()');
    assert.equal(
      await evaluate('window.fixtureCalls.length'),
      calls,
      'History pagination stays local',
    );
  }
  assert.equal(await evaluate("window.fixtureCalls.some(path=>path.includes('demo_user'))"), false);
  await navigate('/?user_id=' + ids[1]);
  await wait(ready);
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[1]);
  const productPath = await evaluate(
    "document.querySelector('#recommendations-content " + "[data-product]').getAttribute('href')",
  );
  await navigate(productPath);
  await wait(
    "document.querySelector('.detail-copy h1') && " + "document.querySelector('.review-card')",
  );
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[1]);
  assert.equal(
    await evaluate(
      "new URL(document.querySelector('#back-link').href).searchPar" + "ams.get('user_id')",
    ),
    ids[1],
  );
  await evaluate(
    "document.querySelector('#user-picker').click(); " +
      'document.querySelector(\'[data-shopper-id="' +
      `${ids[2]}` +
      '"]\').click()',
  );
  await wait(
    "location.pathname==='/' && " +
      "document.querySelector('#recommendations-heading')?.textCont" +
      "ent==='Popular picks'",
  );
  assert.equal(await evaluate("new URL(location.href).searchParams.get('user_id')"), ids[2]);
  await navigate('/product/demo-product/');
  await wait("document.querySelector('.detail-copy h1')");
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[0]);
  assert.equal(
    await evaluate(
      "new URL(document.querySelector('#back-link').href).searchPar" + "ams.get('user_id')",
    ),
    ids[0],
  );
  await navigate('/?user_id=another-shopper');
  await wait(ready);
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), 'another-shopper');
  assert.equal(
    await evaluate("document.querySelector('#user-picker .account-name').textContent"),
    'Selected shopper',
  );
  for (const width of [768, 375, 320]) {
    await page('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await navigate('/');
    await wait(ready);
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimat' + 'ionFrame(resolve)))',
    );
    assert.equal(
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
      true,
      'No overflow at ' + width,
    );
  }

  // One expanded drawer section at a time; closing resets every section.
  await navigate('/');
  await wait(ready);
  for (const closeMethod of ['button', 'escape', 'backdrop']) {
    await evaluate(
      "document.querySelector('#project-menu-toggle').click(); " +
        "document.querySelector('#about-project').open=true; " +
        "document.querySelector('#about-data').open=true",
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.project-nav details[open]').length"),
      1,
    );
    if (closeMethod === 'button')
      await evaluate("document.querySelector('#project-menu-close').click()");
    else if (closeMethod === 'escape') {
      await page('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
      await page('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Escape',
        code: 'Escape',
        windowsVirtualKeyCode: 27,
        nativeVirtualKeyCode: 27,
      });
    } else
      await evaluate(
        "document.querySelector('#project-menu').getAnimations().forE" +
          'ach(animation=>animation.finish()); ' +
          "document.querySelector('#project-menu').dispatchEvent(new " +
          "MouseEvent('click',{clientX:innerWidth-1,clientY:100,bubbles" +
          ':true}))',
      );
    await wait(
      "!document.querySelector('#project-menu').open && " +
        "document.querySelectorAll('.project-nav " +
        "details[open]').length===0",
    );
  }
  // Keyboard selection keeps the same accessible combobox behavior.
  await evaluate("document.querySelector('#user-picker').focus()");
  for (const key of ['Enter', 'End', 'Enter'])
    await page('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
    });
  await wait(ready);
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[2]);
  // Sliding the history never shifts the recommendation section vertically.
  await page('Emulation.setEmulatedMedia', {
    features: [
      {
        name: 'prefers-reduced-motion',
        value: 'no-preference',
      },
    ],
  });
  const carouselHeight = await evaluate(
    "document.querySelector('[data-history-carousel]').getBoundin" + 'gClientRect().height',
  );
  const recommendationTop = await evaluate(
    "document.querySelector('#recommendations').getBoundingClientRect().top",
  );
  await evaluate('document.querySelector(\'[data-history-page="1"]\').click()');
  assert.ok(
    Math.abs(
      (await evaluate(
        "document.querySelector('[data-history-carousel]').getBoundin" + 'gClientRect().height',
      )) - carouselHeight,
    ) < 1,
  );
  assert.ok(
    Math.abs(
      (await evaluate("document.querySelector('#recommendations').getBoundingClientRect().top")) -
        recommendationTop,
    ) < 1,
  );
  await evaluate(
    "document.querySelector('[data-history-carousel]').getAnimati" +
      'ons({subtree:true}).forEach(animation=>animation.finish())',
  );
  await navigate('/?fixture=pending');
  assert.equal(
    await evaluate("document.querySelector('#user-picker').value"),
    ids[0],
    'Picker renders even while API does not respond',
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('#history-content " +
        '.loading-message,#recommendations-content ' +
        ".loading-message')].map(element=>element.textContent)",
    ),
    ['Loading...', 'Loading...'],
  );
  await evaluate(
    "document.querySelector('#user-picker').click(); " +
      'document.querySelector(\'[data-shopper-id="' +
      `${ids[1]}` +
      '"]\').click()',
  );
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[1]);
  assert.equal(
    await evaluate("document.querySelector('#shoppers').getAttribute('aria-busy')"),
    'false',
  );
  assert.equal(await evaluate("window.fixtureCalls.some(path=>path.includes('demo_user'))"), false);
  await navigate('/?fixture=failure');
  await wait(ready);
  assert.match(
    await evaluate("document.querySelector('#recommendations-content').textContent"),
    /could not be completed/,
  );
  assert.equal(await evaluate("document.querySelectorAll('[data-shopper-id]').length"), 3);
  await evaluate("window.fixtureMode=''");
  await select(ids[1]);
  assert.equal(
    await evaluate("document.querySelector('#recommendations-heading').textContent"),
    'Recommended for Shopper 2',
  );

  // Previous shopper responses must never overwrite the newly selected shopper.
  await navigate('/?fixture=race');
  await evaluate(
    "document.querySelector('#user-picker').click(); " +
      'document.querySelector(\'[data-shopper-id="' +
      `${ids[1]}` +
      '"]\').click()',
  );
  await wait(ready);
  await evaluate('window.resolveStaleRequests.forEach(resolve=>resolve())');
  await evaluate('new Promise(resolve=>setTimeout(resolve,20))');
  assert.equal(
    await evaluate("document.querySelector('#recommendations-heading').textContent"),
    'Recommended for Shopper 2',
  );
  assert.match(
    await evaluate("document.querySelector('#history-heading').textContent"),
    /Shopper 2/,
  );
  // Empty results and real 404 handling retain their existing messages.
  await navigate('/?fixture=empty');
  await wait(ready);
  assert.match(
    await evaluate("document.querySelector('#history-content').textContent"),
    /No verified purchase reviews/,
  );
  assert.match(
    await evaluate("document.querySelector('#recommendations-content').textContent"),
    /No recommendations available/,
  );
  await navigate('/product/missing/');
  await wait(
    "document.querySelector('#details-content')?.getAttribute('ar" +
      "ia-busy')==='false' && " +
      "document.querySelector('#product-reviews-content')?.getAttri" +
      "bute('aria-busy')==='false'",
  );
  assert.match(
    await evaluate("document.querySelector('#details-content').textContent"),
    /Product not found/,
  );
  await navigate('/missing-page');
  assert.match(
    await evaluate("document.querySelector('#storefront').textContent"),
    /Page not found/,
  );
  // Product review pages retain their links, clamping, and shopper context.
  await navigate('/product/demo-product/?fixture=pages&user_id=' + ids[1] + '&page=999');
  await wait(
    "document.querySelector('#product-reviews-content')?.getAttri" + "bute('aria-busy')==='false'",
  );
  assert.equal(await evaluate("new URL(location.href).searchParams.get('page')"), '3');
  assert.equal(await evaluate("document.querySelectorAll('.review-card').length"), 3);
  assert.equal(
    await evaluate(
      "new URL(document.querySelector('[data-review-page]').href).s" + "earchParams.get('user_id')",
    ),
    ids[1],
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.detail-rating .star-rating > " + ".rating-star').length",
    ),
    5,
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('.detail-rating " +
        ".rating-star-fill')].map(star=>parseFloat(star.style.width))",
    ),
    [100, 100, 100, 100, 20],
  );
  // Temporary failures show wake-up feedback and then recover automatically.
  await navigate('/?fixture=waking');
  await wait(
    "document.querySelector('#recommendations-content')?.textCont" +
      "ent.includes('Waiting for the service')",
  );
  assert.equal(await evaluate("document.querySelectorAll('[data-shopper-id]').length"), 3);
  await wait(ready);
  assert.equal(
    await evaluate("document.querySelector('#recommendations-heading').textContent"),
    'Recommended for Shopper 1',
  );
  // Leaving a page cancels pending work; restoring it restarts fresh requests.
  await navigate('/?fixture=pending');
  await evaluate(
    "history.replaceState(null,'','/'); dispatchEvent(new " + "PageTransitionEvent('pagehide')); ",
  );
  assert.equal(await evaluate('window.fixtureAborted.length'), 2);
  await evaluate("dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}))");
  await wait(ready);
  assert.equal(await evaluate("document.querySelector('#user-picker').value"), ids[0]);
  // Desktop/mobile layouts and reduced motion keep carousel geometry stable.
  for (const width of [1440, 768, 375, 320]) {
    await page('Emulation.setDeviceMetricsOverride', {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 650,
    });
    await navigate('/?fixture=varied');
    await wait(ready);
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimat' +
        'ionFrame(()=>resolve(true))))',
    );
    const height = await evaluate(
      "document.querySelector('[data-history-carousel]').getBoundin" + 'gClientRect().height',
    );
    const count = await evaluate("document.querySelectorAll('.history-dot').length");
    for (let i = 0; i < count; i++) {
      await evaluate(
        'document.querySelector(\'[data-history-page="' +
          `${i}` +
          "\"]').click(); document.querySelector('[data-history-carouse" +
          "l]').getAnimations({subtree:true}).forEach(animation=>animat" +
          'ion.finish())',
      );
      assert.ok(
        Math.abs(
          (await evaluate(
            "document.querySelector('[data-history-carousel]').getBoundin" + 'gClientRect().height',
          )) - height,
        ) < 1,
      );
    }
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  }
  await page('Emulation.setEmulatedMedia', {
    features: [
      {
        name: 'prefers-reduced-motion',
        value: 'reduce',
      },
    ],
  });
  await evaluate('document.querySelector(\'[data-history-page="0"]\').click()');
  await evaluate(
    'new Promise(resolve=>requestAnimationFrame(()=>requestAnimat' +
      'ionFrame(()=>resolve(true))))',
  );
  assert.equal(
    await evaluate(
      "document.querySelector('[data-history-carousel]').getAnimati" + 'ons({subtree:true}).length',
    ),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Requests, cancellation, product review pagination, ' +
      'empty/404 states, transient recovery, drawer controls, ' +
      'fractional ratings, and responsive carousel. Existing ' +
      'checks: Fixed shopper IDs and labels, one initial request ' +
      'per section, all three recommendation scenarios, local ' +
      'history pagination, deep links, product shopper navigation, ' +
      'mobile layout, and usable picker during pending/failed API ' +
      'calls. No demo-user API requests.',
  );
  await command('Browser.close');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (socket) socket.close();
    chrome.kill();
    try {
      fs.rmSync(stage, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      /* A closing browser can still hold its temporary profile. */
    }
  });
