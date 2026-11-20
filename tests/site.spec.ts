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
    const data = (await manifest(page)) as Record<string, { day: string | null }[]>;
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
        const [city, i] = ref.split(":");
        expect(data[city][Number(i)].day, `${date} ${ref}`).toBe(date);
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
    const first = await big.getAttribute("src");
    expect(first).toMatch(/\.webp$/);
    expect(first).not.toMatch(/-t\.webp$/);
    await page.keyboard.press("ArrowRight");
    await expect(big).not.toHaveAttribute("src", first!);
    await page.keyboard.press("Escape");
    await expect(box).toBeHidden();
  });
});

test("no console errors or broken local requests", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
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
