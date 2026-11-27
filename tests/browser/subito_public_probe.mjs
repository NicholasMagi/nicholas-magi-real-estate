import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const SEARCH_URL = "https://www.subito.it/annunci-marche/vendita/ville-singole-e-a-schiera/macerata/?advt=0%2C2&from=mysearches&order=datedesc";
const OUT = "artifacts/subito-public-probe";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function challengeLike(title, text, url) {
  return /captcha|verifica(?:re)? (?:che sei umano|la tua identità|di sicurezza)|non sei un robot|attività sospetta|access denied|accesso negato|controllo anti.?robot|security check/i.test(
    [title, text.slice(0, 3500), url].join("\n"),
  );
}

async function snapshot(page, response) {
  return await page.evaluate(({ status }) => {
    const body = document.body?.innerText || "";
    const anchors = [...document.querySelectorAll("a[href]")].map((a) => ({
      text: (a.innerText || a.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 90),
      href: a.href,
      rel: a.getAttribute("rel") || "",
      aria: a.getAttribute("aria-label") || "",
      title: a.getAttribute("title") || "",
      parent: ((a.parentElement?.className || "") + " " + (a.parentElement?.getAttribute("aria-label") || "")).toString().slice(0, 120),
    }));
    const listingLinks = anchors.filter((a) => {
      try {
        const u = new URL(a.href);
        return u.hostname === "www.subito.it" && /\.htm(?:$|[?#])/i.test(u.pathname + u.search);
      } catch { return false; }
    });
    const nextLinks = anchors.filter((a) =>
      /next|avanti|successiv/i.test([a.rel, a.aria, a.title, a.text, a.parent].join(" "))
      || (/^2$/.test(a.text) && /pagination|paginazione|page/i.test(a.parent))
    );
    return {
      status,
      title: document.title,
      url: location.href,
      bodyChars: body.length,
      bodyStart: body.slice(0, 850).replace(/\s+/g, " "),
      bodyEnd: body.slice(-1200).replace(/\s+/g, " "),
      searchState: (() => { try { const d = JSON.parse(document.querySelector("#__NEXT_DATA__")?.textContent || "null"); const st = d?.props?.pageProps?.initialState; return st ? { page: st.search?.page ?? null, searchKeys: Object.keys(st.search || {}), totalItems: st.search?.total ?? st.search?.totalCount ?? null, pageItems: st.items?.originalList?.length ?? null } : null; } catch { return null; } })(),
      listingLinkCount: listingLinks.length,
      listingLinkSamples: listingLinks.slice(0, 5).map((a) => ({ text: a.text, href: a.href })),
      nextLinks: nextLinks.slice(0, 8),
      pageLinkSamples: anchors.filter((a) => /pagination|paginazione|page/i.test(a.parent)).slice(0, 12),
      buttons: [...document.querySelectorAll("button")].map((b) => ({ text: (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 80), aria: b.getAttribute("aria-label") || "", title: b.getAttribute("title") || "", parent: (b.parentElement?.className || "").toString().slice(0, 100) })).slice(-30),
    };
  }, { status: response?.status() ?? null });
}

const report = {
  test: "public-browser-only; no login; no cookies imported; no proxy; no challenge bypass",
  searchUrl: SEARCH_URL,
  startedAt: new Date().toISOString(),
  pages: [],
  paginationFollowed: false,
  paginationThirdFollowed: false,
  outcome: "not_started",
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    locale: "it-IT",
    timezoneId: "Europe/Rome",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(45000);
  let response = null;
  try {
    response = await page.goto(SEARCH_URL, { waitUntil: "domcontentloaded" });
    await wait(4500);
    let first = await snapshot(page, response);
    first.challengeDetected = challengeLike(first.title, first.bodyStart, first.url);
    report.pages.push(first);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await wait(1800);
    const bottom = await snapshot(page, response);
    bottom.challengeDetected = challengeLike(bottom.title, bottom.bodyEnd, bottom.url);
    report.bottomOfFirstPage = bottom;
    await page.screenshot({ path: `${OUT}/page-1-bottom.png`, fullPage: false }).catch(() => {});
    await page.screenshot({ path: `${OUT}/page-1.png`, fullPage: false }).catch(() => {});

    if (first.status === 200 && !first.challengeDetected && first.listingLinkCount > 0) {
      const pageTwoButton = page.locator('button[aria-label="Andare a pagina 2"]');
      const pageTwoCount = await pageTwoButton.count();
      if (pageTwoCount > 0) {
        report.paginationMethod = "normal click on Subito button Andare a pagina 2";
        await pageTwoButton.first().click({ timeout: 8000 });
        await wait(3500);
        const second = await snapshot(page, null);
        second.clientSideNavigation = true;
        second.pageChanged = (second.searchState?.page != null && first.searchState?.page != null && second.searchState.page !== first.searchState.page) || JSON.stringify(second.listingLinkSamples) !== JSON.stringify(first.listingLinkSamples);
        second.challengeDetected = challengeLike(second.title, second.bodyStart, second.url);
        report.pages.push(second);
        report.paginationFollowed = true;
        await page.screenshot({ path: `${OUT}/page-2.png`, fullPage: false }).catch(() => {});
        const pageThreeButton = page.locator('button[aria-label="Andare a pagina 3"]');
        if (await pageThreeButton.count() > 0 && !second.challengeDetected && second.listingLinkCount > 0) {
          await pageThreeButton.first().click({ timeout: 8000 });
          await wait(3500);
          const third = await snapshot(page, null);
          third.clientSideNavigation = true;
          third.pageChanged = (third.searchState?.page != null && second.searchState?.page != null && third.searchState.page !== second.searchState.page) || JSON.stringify(third.listingLinkSamples) !== JSON.stringify(second.listingLinkSamples);
          third.challengeDetected = challengeLike(third.title, third.bodyStart, third.url);
          report.pages.push(third);
          report.paginationThirdFollowed = true;
          await page.screenshot({ path: `${OUT}/page-3.png`, fullPage: false }).catch(() => {});
        }
      }
      const next = report.paginationFollowed ? null : bottom.nextLinks.find((a) => {
        try {
          const u = new URL(a.href);
          return u.origin === "https://www.subito.it" && u.href !== first.url;
        } catch { return false; }
      });
      if (next) {
        report.paginationLinkFound = next.href;
        response = await page.goto(next.href, { waitUntil: "domcontentloaded" });
        await wait(3500);
        const second = await snapshot(page, response);
        second.challengeDetected = challengeLike(second.title, second.bodyStart, second.url);
        report.pages.push(second);
        report.paginationFollowed = true;
        await page.screenshot({ path: `${OUT}/page-2.png`, fullPage: false }).catch(() => {});
      } else if (!report.paginationFollowed) {
        report.paginationLinkFound = null;
      }
    }

    report.filtersPreserved = report.pages.map((p) => ({ pageUrl: p.url, privateFilterAdvt: (() => { try { return new URL(p.url).searchParams.get("advt"); } catch { return null; } })(), preserved: (() => { try { return new URL(p.url).searchParams.get("advt") === "0,2"; } catch { return false; } })() }));
    const last = report.pages.at(-1);
    if (report.pages[0]?.status === 403 || report.pages[0]?.status === 429 || report.pages[0]?.challengeDetected) {
      report.outcome = "blocked_or_challenge";
    } else if (report.pages[0]?.status === 200 && report.pages[0]?.listingLinkCount > 0) {
      report.outcome = report.paginationThirdFollowed
        ? (last?.listingLinkCount > 0 && !last?.challengeDetected && last?.pageChanged ? "first_second_and_third_pages_readable" : "first_two_pages_readable_third_page_not_readable")
        : report.paginationFollowed
        ? (last?.listingLinkCount > 0 && !last?.challengeDetected && last?.pageChanged ? "first_and_second_page_readable" : "first_page_readable_second_page_not_readable")
        : "first_page_readable_pagination_link_not_identified";
    } else {
      report.outcome = "page_loaded_but_no_listing_links_detected";
    }
  } catch (error) {
    report.outcome = "navigation_error";
    report.navigationError = String(error).slice(0, 700);
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
