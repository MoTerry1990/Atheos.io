import { expect, test } from "@playwright/test";

/**
 * `/admin` must not appear in robots.txt.
 *
 * It answers 404 to everyone who is not an admin (§ 38). Naming it in a file
 * whose entire purpose is to be fetched by strangers would undo that in one
 * line — disallowing a path is advertising it.
 *
 * The check matches whole `Disallow:` values rather than doing a substring
 * search, because `/admin-preview` **is** listed and contains "/admin". The
 * first version of this test failed on exactly that, which is a good argument
 * for the stricter form.
 */
test("robots.txt does not name the admin surface", async ({ request }) => {
  const body = await (await request.get("/robots.txt")).text();

  const disallowed = body
    .split(/\r?\n/)
    .filter((line) => line.toLowerCase().startsWith("disallow:"))
    .map((line) => line.slice("disallow:".length).trim());

  expect(disallowed).not.toContain("/admin");
  expect(disallowed).not.toContain("/admin/");

  // The preview routes, by contrast, are expected to be listed.
  expect(disallowed).toContain("/admin-preview");
});
