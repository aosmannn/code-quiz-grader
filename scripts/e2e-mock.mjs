import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:43127";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByText("Demo mode — no API key needed").waitFor();

  await page.getByRole("button", { name: /Load sample program/i }).click();
  await page.getByText("grade_book.py").first().waitFor();

  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.getByText("How many questions in total?").waitFor();
  await page.getByRole("button", { name: "5", exact: true }).click();
  await page.getByRole("button", { name: /^Continue/ }).click();

  await page.getByText("Choose the question mix").waitFor();
  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: /Generate demo quiz/i }).click();

  await page.getByText("Answer all questions").waitFor({ timeout: 15000 });
  await page.getByText("demo quiz").waitFor();

  const mcRadios = page.locator('input[type="radio"][value="A"]');
  const mcCount = await mcRadios.count();
  for (let i = 0; i < mcCount; i++) {
    await mcRadios.nth(i).check();
  }

  const areas = page.locator("textarea");
  const faCount = await areas.count();
  for (let i = 0; i < faCount; i++) {
    await areas
      .nth(i)
      .fill(
        "GradeBook stores scores; add_score validates 0–100 and average divides the sum by length.",
      );
  }

  await page.getByRole("button", { name: /Submit answers/i }).click();
  await page.getByText("Your results").waitFor({ timeout: 15000 });
  await page.getByText("Demo grading", { exact: true }).first().waitFor();
  await page.getByText("Total score").waitFor();

  await page.getByRole("button", { name: /Start over/i }).click();
  await page.getByText("Upload program files").waitFor();

  if (errors.length) throw new Error("page errors: " + errors.join("; "));

  console.log(
    JSON.stringify(
      { ok: true, base: BASE, mcAnswered: mcCount, faAnswered: faCount },
      null,
      2,
    ),
  );
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
