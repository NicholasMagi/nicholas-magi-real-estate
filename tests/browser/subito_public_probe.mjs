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
      listingLinkCount: listingLinks.length,
      listingLinkSamples: listingLinks.slice(0, 5).map((a) => ({ text: a.text, href: a.href })),
      nextLinks: nextLinks.slice(0, 8),
      pageLinkSamples: anchors.filter((a) => /pagination|paginazione|page/i.test(a.parent)).slice(0, 12),
    };
  }, { status: response?.status() ?? null });
}

const report = {
  test: "public-browser-only; no login; no cookies imported; no proxy; no challenge bypass",
  searchUrl: SEARCH_URL,
  startedAt: new Date().toISOString(),
  pages: [],
  paginationFollowed: false,
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
    await page.screenshot({ path: `${OUT}/page-1.png`, fullPage: false }).catch(() => {});

    if (first.status === 200 && !first.challengeDetected && first.listingLinkCount > 0) {
      const next = first.nextLinks.find((a) => {
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
      } else {
        report.paginationLinkFound = null;
      }
    }

    const last = report.pages.at(-1);
    if (report.pages[0]?.status === 403 || report.pages[0]?.status === 429 || report.pages[0]?.challengeDetected) {
      report.outcome = "blocked_or_challenge";
    } else if (report.pages[0]?.status === 200 && report.pages[0]?.listingLinkCount > 0) {
      report.outcome = report.paginationFollowed
        ? (last?.status === 200 && last?.listingLinkCount > 0 && !last?.challengeDetected ? "first_and_second_page_readable" : "first_page_readable_second_page_not_readable")
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
