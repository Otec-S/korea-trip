import { test, expect, Page } from "@playwright/test";

const CITIES = ["seoul", "gyeongju", "ulsan", "busan"] as const;

// Photos come from assets/photos/photos.js (window.TRIP_PHOTOS), built by tools/build_photos.py
async function manifest(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(() => (window as any).TRIP_PHOTOS);
}

// Every photo from the city folders (window.TRIP_ALL_PHOTOS) goes to the "all photos" galleries
async function allPhotos(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(() => (window as any).TRIP_ALL_PHOTOS);
}

test.describe("trip report", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("each city has its own gallery with every photo from the city folder", async ({ page }) => {
    const data = await allPhotos(page);
    for (const city of CITIES) {
      // Seoul photos are split between the first visit and the last days (#finish)
      const imgs = page.locator(`.gallery[data-city="${city}"] img`);
      await expect(imgs, city).toHaveCount(data[city].length);
      expect(data[city].length, city).toBeGreaterThanOrEqual(12);
      await expect(page.locator(`#${city} .gallery img`).first(), city).toBeAttached();
    }
    await expect(page.locator("#finish .gallery img").first()).toBeAttached();
  });

  test("city galleries are collapsed until opened", async ({ page }) => {
    const blocks = page.locator("details.all-photos");
    await expect(blocks).toHaveCount(5);
    for (const open of await blocks.evaluateAll((els) => els.map((e) => (e as HTMLDetailsElement).open))) {
      expect(open).toBe(false);
    }
    const first = page.locator("#seoul details.all-photos");
    await expect(first.locator(".gallery img").first()).toBeHidden();
    await first.locator("summary").click();
    await expect(first.locator(".gallery img").first()).toBeVisible();
  });

  test("trip in numbers counts our photos from the manifest", async ({ page }) => {
    const data = await manifest(page);
    const total = Object.values(data).reduce((n, list) => n + list.length, 0);
    await expect(page.locator('[data-stat="photos"]')).toHaveText(String(total));
  });

  test("hero shows a cover photo for every city that links to its section", async ({ page }) => {
    const tiles = page.locator(".hero .cover a");
    await expect(tiles).toHaveCount(4);
    expect(await tiles.evaluateAll((els) => els.map((e) => e.getAttribute("href")))).toEqual(
      CITIES.map((c) => `#${c}`),
    );
    await expect(tiles.locator("img")).toHaveCount(4);
  });

  test("short impressions teaser near the top links to the full section", async ({ page }) => {
    const teaser = page.locator("#teaser");
    await expect(teaser.locator("li")).toHaveCount(5);
    await expect(teaser.locator('a[href="#impressions"]')).toHaveCount(1);
    const teaserTop = await teaser.evaluate((e) => e.getBoundingClientRect().top + scrollY);
    const seoulTop = await page.locator("#seoul").evaluate((e) => e.getBoundingClientRect().top + scrollY);
    expect(teaserTop).toBeLessThan(seoulTop);
  });

  test("'more' button opens the whole day in the viewer and stays inside that day", async ({ page }) => {
    const data = (await manifest(page)) as Record<string, { day: string | null }[]>;
    const date = "2026-10-30";
    const total = Object.values(data).flat().filter((p) => p.day === date).length;
    await page.locator(`.day[data-date="${date}"] .more`).click();
    const box = page.locator(".lightbox");
    await expect(box).toBeVisible();
    const cap = box.locator(".lb-cap");
    for (let n = 0; n < total + 1; n++) {
      await expect(cap).toContainText("30.10");
      await expect(cap).toContainText(`/ ${total}`);
      await page.keyboard.press("ArrowRight");
    }
  });

  test("share preview tags point to an absolute cover image", async ({ page }) => {
    const meta = (sel: string) => page.locator(sel).getAttribute("content");
    expect(await meta('meta[name="description"]')).toBeTruthy();
    expect(await meta('meta[property="og:title"]')).toBeTruthy();
    expect(await meta('meta[property="og:description"]')).toBeTruthy();
    const img = await meta('meta[property="og:image"]');
    expect(img).toMatch(/^https:\/\/.+\.jpg$/);
    const local = new URL(img!).pathname.replace(/^\/korea-trip/, "");
    const res = await page.request.get(local);
    expect(res.status()).toBe(200);
  });

  test("city navigation stays on screen while scrolling", async ({ page }) => {
    const nav = page.locator("nav.jump");
    await page.locator("#busan").scrollIntoViewIfNeeded();
    await expect(nav).toBeInViewport();
    await expect(nav.locator('a[aria-current="true"]')).toHaveAttribute("href", "#busan");
  });

  test("days show our own photos taken that day", async ({ page }) => {
    const day = page.locator('.day[data-date="2026-10-29"]');
    await expect(day).toHaveCount(1);
    const photos = day.locator(".day-photos img");
    expect(await photos.count()).toBeGreaterThanOrEqual(3);
    for (const src of await photos.evaluateAll((els) => els.map((e) => e.getAttribute("src")))) {
      expect(src).toMatch(/^assets\/photos\//);
    }
  });

  test("day strips are picked by hand and only hold photos taken that day", async ({ page }) => {
    const data = (await manifest(page)) as Record<string, { src: string; day: string | null }[]>;
    const days = page.locator(".day");
    for (let n = 0; n < (await days.count()); n++) {
      const day = days.nth(n);
      const date = await day.getAttribute("data-date");
      const strip = day.locator(".day-photos");
      if ((await strip.count()) === 0) continue;
      const refs = ((await strip.getAttribute("data-pick")) || "").split(",").filter(Boolean);
      expect(refs.length, `${date} has data-pick`).toBeGreaterThan(0);
      await expect(strip.locator("img"), `${date} renders all picks`).toHaveCount(refs.length);
      for (const ref of refs) {
        // picks name the photo file, so rebuilding the photo list cannot shift them
        const [city, name] = ref.split(":");
        expect(name, `${date} ${ref}`).not.toMatch(/^\d+$/);
        const photo = (data[city] as { src: string; day: string | null }[]).find((p) => p.src.endsWith(`/${name}.webp`));
        expect(photo, `${date} ${ref} exists`).toBeTruthy();
        expect(photo!.day, `${date} ${ref}`).toBe(date);
      }
    }
  });

  test("impressions section is filled", async ({ page }) => {
    const items = page.locator("#impressions li");
    expect(await items.count()).toBeGreaterThanOrEqual(10);
  });

  test("every image on the page loads", async ({ page }) => {
    const broken = await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      imgs.forEach((img) => (img.loading = "eager"));
      await Promise.all(imgs.map((img) => img.decode().catch(() => undefined)));
      return imgs.filter((img) => !img.complete || img.naturalWidth === 0).map((img) => img.src);
    });
    expect(broken).toEqual([]);
  });

  test("lightbox opens, pages with arrows and closes", async ({ page }) => {
    await page.locator("#seoul details.all-photos summary").click();
    await page.locator("#seoul .gallery img").first().click();
    const box = page.locator(".lightbox");
    await expect(box).toBeVisible();
    const big = box.locator("img");
    // the thumbnail shows first, then the full-size photo replaces it
    await expect(big).toHaveAttribute("src", /(?<!-t)\.webp$/);
    const first = await big.getAttribute("src");
    await page.keyboard.press("ArrowRight");
    await expect(big).not.toHaveAttribute("src", first!);
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
  });
});

test("no console errors or broken local requests", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    // network failures are checked by URL below; the console text has no URL to filter on
    if (m.type() === "error" && !/^Failed to load resource/.test(m.text())) problems.push(m.text());
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith("http://localhost")) problems.push(`failed ${r.url()}`);
  });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("response", (r) => {
    if (r.url().startsWith("http://localhost") && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);
  // external fonts may be unreachable offline; only our own errors count
  expect(problems.filter((p) => !/fonts\.(googleapis|gstatic)/.test(p))).toEqual([]);
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("no horizontal scroll", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
  test("first screen already has photos", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero .cover img").first()).toBeInViewport();
  });
});

// Real finger gestures on a phone: CDP touch events go through the browser's own scrolling and click logic
test.describe("mobile viewer", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  async function swipe(page: Page, from: [number, number], to: [number, number]) {
    const cdp = await page.context().newCDPSession(page);
    const steps = 8;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
    for (let s = 1; s <= steps; s++) {
      const x = from[0] + ((to[0] - from[0]) * s) / steps;
      const y = from[1] + ((to[1] - from[1]) * s) / steps;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(300);
  }

  test("big city photo opens the same photo in the viewer", async ({ page }) => {
    await page.goto("/");
    for (const city of CITIES) {
      const btn = page.locator(`#${city} .scene button.zoom`);
      const src = await btn.locator("img").getAttribute("src");
      await btn.tap();
      await expect(page.locator(".lightbox img")).toHaveAttribute("src", src!);
      await page.keyboard.press("Escape");
    }
  });

  test("swiping pages photos without scrolling the page behind", async ({ page }) => {
    await page.goto("/");
    await page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom').first().tap();
    const cap = page.locator(".lightbox .lb-cap");
    await expect(cap).toContainText("1 / ");
    const y0 = await page.evaluate(() => scrollY);
    // a diagonal left swipe, like a real thumb makes
    await swipe(page, [320, 500], [80, 380]);
    await expect(cap).toContainText("2 / ");
    expect(await page.evaluate(() => scrollY)).toBe(y0);
  });

  test("a mostly vertical drag does not page photos", async ({ page }) => {
    await page.goto("/");
    await page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom').first().tap();
    const cap = page.locator(".lightbox .lb-cap");
    await swipe(page, [200, 650], [150, 250]);
    await expect(cap).toContainText("1 / ");
  });

  test("after swiping and closing, tapping a photo opens exactly that photo", async ({ page }) => {
    await page.goto("/");
    const strip = page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom');
    await strip.first().tap();
    for (let n = 0; n < 3; n++) await swipe(page, [320, 420], [60, 400]);
    await page.locator(".lightbox .lb-close").tap();
    await expect(page.locator(".lightbox")).toBeHidden();
    const target = page.locator('.day[data-date="2026-11-03"] .day-photos button.zoom').nth(1);
    const want = await page.evaluate((el) => {
      const b = el as HTMLElement;
      return (window as any).TRIP_PHOTOS[b.dataset.city!][Number(b.dataset.i)].src;
    }, await target.elementHandle());
    await target.tap();
    await expect(page.locator(".lightbox img")).toHaveAttribute("src", want);
  });

  test("on a slow network the viewer never shows the previous photo", async ({ page }) => {
    await page.goto("/");
    const strip = page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom');
    const big = page.locator(".lightbox img");
    await strip.first().tap();
    const first = await big.getAttribute("src");
    await page.keyboard.press("Escape");
    // full-size photos now take 3 s, thumbnails stay fast
    await page.route(/\/assets\/photos\/.*(?<!-t)\.webp$/, async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await strip.nth(2).tap();
    await page.waitForTimeout(300);
    const shown = await big.evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
    expect(shown).not.toContain(first!);
    expect(shown).toMatch(/-t\.webp$/);
  });

  test("the phone's Back button closes the viewer and stays on the page", async ({ page }) => {
    await page.goto("/");
    const url = page.url();
    await page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom').first().tap();
    await expect(page.locator(".lightbox")).toBeVisible();
    await page.goBack();
    await expect(page.locator(".lightbox")).toBeHidden();
    expect(page.url()).toBe(url);
    // closing with the cross leaves no extra history entry behind
    await page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom').first().tap();
    await page.locator(".lightbox .lb-close").tap();
    await expect(page.locator(".lightbox")).toBeHidden();
    const len = await page.evaluate(() => history.length);
    await page.locator('.day[data-date="2026-10-29"] .day-photos button.zoom').first().tap();
    await page.locator(".lightbox .lb-close").tap();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => history.length)).toBe(len);
  });

  test("big city photos load lazily and offer a small version for phones", async ({ page }) => {
    await page.goto("/");
    const imgs = page.locator(".scene img.cityph");
    await expect(imgs).toHaveCount(4);
    for (const img of await imgs.all()) {
      await expect(img).toHaveAttribute("loading", "lazy");
      await expect(img).toHaveAttribute("srcset", /-t\.webp 480w/);
      await expect(img).toHaveAttribute("sizes", /.+/);
    }
  });
});
