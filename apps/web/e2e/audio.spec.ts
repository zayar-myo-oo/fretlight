import { test, expect } from "@playwright/test";

test("recording uses the single live capture; replay, seek, export and history work", async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    (window as unknown as { captureCount: number }).captureCount = 0;
    navigator.mediaDevices.getUserMedia = (constraints) => { (window as unknown as { captureCount: number }).captureCount++; return original(constraints); };
  });
  await page.goto("/fretboard?mode=listen");
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByRole("button", { name: "Stop listening" })).toBeVisible();
  await page.getByRole("button", { name: "Record take", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop recording" })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator("audio")).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { captureCount: number }).captureCount)).toBe(1);
  await page.locator("audio").evaluate(async (element: HTMLAudioElement) => { await element.play(); });
  await expect.poll(() => page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime)).toBeGreaterThan(0);
  await page.locator("audio").evaluate((el: HTMLAudioElement) => { el.pause(); el.currentTime = 0; });
  await expect.poll(() => page.locator("audio").evaluate((el: HTMLAudioElement) => el.currentTime)).toBe(0);
  const audioDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export audio", exact: true }).click();
  expect((await audioDownload).suggestedFilename()).toMatch(/\.(webm|m4a|ogg)$/);
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export timeline JSON" }).click();
  expect((await jsonDownload).suggestedFilename()).toMatch(/\.json$/);
  await page.reload();
  await expect(page.getByLabel("Session history").locator("option")).toHaveCount(2);
  const value = await page.getByLabel("Session history").locator("option").nth(1).getAttribute("value");
  await page.getByLabel("Session history").selectOption(value!);
  await expect(page.locator("audio")).toBeVisible();
  await page.getByRole("button", { name: "Delete take" }).click();
  await expect(page.getByLabel("Session history").locator("option")).toHaveCount(1);
});

test("single notes use Worklet/Worker, switching input uses the new ID, off releases tracks", async ({ page }) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const w = window as unknown as { requests: MediaStreamConstraints[]; streams: MediaStream[] };
    w.requests = []; w.streams = [];
    navigator.mediaDevices.getUserMedia = async (constraints) => { w.requests.push(constraints!); const stream = await original(constraints); w.streams.push(stream); return stream; };
  });
  await page.goto("/fretboard?mode=listen");
  await page.getByRole("tab", { name: "Single notes", exact: true }).click();
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __hub: { currentSource: { diagnostics: { workerFrames: number } } } }).__hub.currentSource.diagnostics.workerFrames)).toBeGreaterThan(0);
  const picker = page.getByLabel("Device", { exact: true });
  const options = await picker.locator("option").evaluateAll((elements) => elements.map((el) => (el as HTMLOptionElement).value).filter((v) => v && v !== "default"));
  if (options.length) {
    await picker.selectOption(options[0]!);
    await expect.poll(() => page.evaluate(() => (window as unknown as { requests: MediaStreamConstraints[] }).requests.at(-1)?.audio)).toMatchObject({ deviceId: { exact: options[0] } });
    await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  }
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  expect(await page.evaluate(() => (window as unknown as { streams: MediaStream[] }).streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")))).toBe(true);
});

test("existing screens and narrow viewport remain usable", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/fretboard", "/fretboard?mode=analyze", "/tuner", "/settings", "/fretboard?mode=listen"]) {
    await page.goto(route); await expect(page.locator("h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: "../../../../outputs/fretlight-mobile.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("E2 traverses live Worker detection and recorded events replay on the fretboard", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("fretlight.session", JSON.stringify({ state: { instrumentId: "guitar-6", tuningId: "guitar-6-standard", fretCount: 22 }, version: 2 }));
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(); await ctx.resume();
      const destination = ctx.createMediaStreamDestination(), gain = ctx.createGain();
      const oscillator = ctx.createOscillator(); oscillator.type = "triangle"; oscillator.frequency.value = 82.40689;
      gain.gain.setValueAtTime(.0001, ctx.currentTime); gain.gain.setValueAtTime(.3, ctx.currentTime + .5);
      oscillator.connect(gain).connect(destination); oscillator.start();
      destination.stream.getTracks().forEach((track) => { const stop = track.stop.bind(track); track.stop = () => { stop(); void ctx.close(); }; });
      return destination.stream;
    };
  });
  await page.goto("/fretboard?mode=listen");
  await page.getByRole("tab", { name: "Single notes", exact: true }).click();
  await page.getByRole("switch").click();
  await page.getByRole("button", { name: "Record take", exact: true }).click();
  await expect(page.getByText(/E2 · 82\./)).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "Stop recording" }).click();
  await expect(page.locator("audio")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export timeline JSON" }).click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const timeline = JSON.parse(await readFile((await download.path())!, "utf8")) as { duration: number; events: { at: number; midi: number | null }[] };
  const note = timeline.events.find((event) => event.midi === 40);
  expect(note).toBeTruthy(); expect(note!.at).toBeGreaterThanOrEqual(0); expect(note!.at).toBeLessThanOrEqual(timeline.duration);
  await page.locator("audio").evaluate((element: HTMLAudioElement, at) => { element.currentTime = at; }, note!.at);
  await expect(page.getByText(/82\.\d Hz ·/)).toBeVisible();
});

test("changing listening mode finalizes the take and releases the input", async ({ page }) => {
  await page.goto("/fretboard?mode=listen");
  await page.getByRole("button", { name: "Start listening" }).click();
  await page.getByRole("button", { name: "Record take", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByRole("tab", { name: "Single notes", exact: true }).click();
  await expect(page.locator("audio")).toBeVisible();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Input changed, disconnected or interrupted")).toBeVisible();
});

test("permission denial leaves a clear error and no live capture", async ({ page }) => {
  await page.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Permission denied", "NotAllowedError"); }; });
  await page.goto("/fretboard?mode=listen");
  await page.getByRole("button", { name: "Start listening" }).click();
  await expect(page.getByText(/Microphone access was blocked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record take", exact: true })).toBeDisabled();
  await page.getByRole("tab", { name: "Single notes", exact: true }).click();
  await page.getByRole("switch").click();
  await expect(page.getByText("Permission denied", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "false");
});
