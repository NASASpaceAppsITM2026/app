export const appName = "Lunar Landing Site Navigator";

/**
 * Bootstrap: fetch pipeline artifacts and configure the science engine,
 * then start the app.  If artifacts are unavailable the app falls back
 * to mock data so the UI still works.
 */
async function bootstrap() {
  const configured = { ephemeris: false, masks: false };

  // Load ephemeris artifact
  try {
    const { configureEphemerisArtifact } = await import("core");
    const ephemeris = await fetch("/ephemeris_v1.json").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    configureEphemerisArtifact(ephemeris);
    configured.ephemeris = true;
  } catch (e) {
    console.warn("Failed to load ephemeris artifact — using mock data:", e);
  }

  // Load horizon masks artifact
  try {
    const { configureHorizonMasksArtifact } = await import("core");
    const masks = await fetch("/horizon_masks_v1.json").then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    configureHorizonMasksArtifact(masks);
    configured.masks = true;
  } catch (e) {
    console.warn("Failed to load horizon masks artifact — using mock data:", e);
  }

  // Expose configuration status for the app to read
  (window as unknown as Record<string, unknown>).__scienceConfigured = configured;

  // Start the app
  await import("./app");
}

if (typeof document !== "undefined") {
  bootstrap();
}
