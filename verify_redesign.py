import asyncio
import os
import sys
import time
import subprocess
from playwright.async_api import async_playwright

async def run_verification():
    out_dir = "/home/jules/verification/"
    os.makedirs(out_dir, exist_ok=True)

    # Remove existing accounts/sessions for clean test environment
    for f in ["data/dashboardAccounts.json", "data/dashboardSessions.json"]:
        if os.path.exists(f):
            try:
                os.remove(f)
            except Exception:
                pass

    # Start app on port 3099
    env = os.environ.copy()
    env["PORT"] = "3099"
    env["NODE_ENV"] = "test"

    proc = subprocess.Popen(["node", "src/index.js"], env=env)
    time.sleep(3) # allow startup

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)

            # 1. Desktop Viewport (1280x800)
            context_desktop = await browser.new_context(viewport={"width": 1280, "height": 800})
            page_d = await context_desktop.new_page()

            # Go to setup page and create owner account
            await page_d.goto("http://localhost:3099/dashboard/setup")
            await page_d.wait_for_selector("input[name='username']")

            await page_d.fill("input[name='username']", "owner")
            await page_d.fill("input[name='password']", "password123")
            await page_d.click("button[type='submit']")

            # Wait for redirection or dashboard load
            await page_d.wait_for_selector("#aria-workspace-root")

            await page_d.screenshot(path=os.path.join(out_dir, "desktop_home.png"), full_page=True)

            # Navigate to Pairing
            await page_d.goto("http://localhost:3099/dashboard?view=pairing")
            await page_d.wait_for_selector("#aria-pairing-code-form")
            await page_d.screenshot(path=os.path.join(out_dir, "desktop_pairing.png"), full_page=True)

            # Navigate to Connectors
            await page_d.goto("http://localhost:3099/dashboard?view=connectors")
            await page_d.wait_for_selector(".aria-table")
            await page_d.screenshot(path=os.path.join(out_dir, "desktop_connectors.png"), full_page=True)

            await context_desktop.close()

            # 2. Mobile Viewport (375x812 - iPhone X)
            context_mobile = await browser.new_context(viewport={"width": 375, "height": 812})
            page_m = await context_mobile.new_page()

            # Login on mobile
            await page_m.goto("http://localhost:3099/dashboard/login")
            await page_m.wait_for_selector("input[name='username']")
            await page_m.fill("input[name='username']", "owner")
            await page_m.fill("input[name='password']", "password123")
            await page_m.click("button[type='submit']")
            await page_m.wait_for_selector("#aria-workspace-root")

            # Home Mobile
            await page_m.screenshot(path=os.path.join(out_dir, "mobile_home.png"))

            # Pairing Mobile
            await page_m.goto("http://localhost:3099/dashboard?view=pairing")
            await page_m.wait_for_selector("#aria-pairing-code-form")
            await page_m.screenshot(path=os.path.join(out_dir, "mobile_pairing.png"))

            # Connectors Mobile (Cards)
            await page_m.goto("http://localhost:3099/dashboard?view=connectors")
            await page_m.wait_for_selector(".aria-mobile-cards-container")
            await page_m.screenshot(path=os.path.join(out_dir, "mobile_connectors.png"))

            await context_mobile.close()
            await browser.close()
            print("Verification screenshots captured successfully.")
    finally:
        proc.terminate()

if __name__ == "__main__":
    asyncio.run(run_verification())
