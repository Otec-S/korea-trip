import { test, expect, Page } from "@playwright/test";

const CITIES = ["seoul", "gyeongju", "ulsan", "busan"] as const;

// Photos come from assets/photos/photos.js (window.TRIP_PHOTOS), built by tools/build_photos.py
async function manifest(page: Page): Promise<Record<string, unknown[]>> {
  return page.evaluate(() => (window as any).TRIP_PHOTOS);
}

test.describe("trip report", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("each city has its own gallery with every selected photo", async ({ page }) => {
    const data = await manifest(page);
    for (const city of CITIES) {
      const imgs = page.locator(`#${city} .gallery img`);
      await expect(imgs, city).toHaveCount(data[city].length);
      expect(data[city].length, city).toBeGreaterThanOrEqual(12);
    }
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
});
