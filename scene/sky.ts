// The sky over Tokyo: the physical atmosphere with Tokyo's autumn air, its aerial perspective, and the city's night glow.
// (From ThreeRT's games/tokyo, where the measured references are noted.)
import { Color, type DirectionalLight, SkyAtmosphere } from "@threert/scene";

/**
 * The sky over the city by day: the atmosphere with Tokyo's autumn air, Mie (aerosols) at 10x the clean-air default,
 * a visual range near 70 km (Koschmieder, 3.9 / extinction at 550 nm), and its aerial perspective, so the land beyond
 * the area and the far city fade into the sky at the horizon.
 */
export function tokyoSky(sun: DirectionalLight, o: ConstructorParameters<typeof SkyAtmosphere>[0] = {}): SkyAtmosphere {
  const sky = new SkyAtmosphere({ sun, aerialPerspective: 1, ...NIGHT_GLOW, ...o });
  sky.mieScale = 10;
  return sky;
}

/**
 * Tokyo's night sky: the city's light scattered back down by the air (light pollution), which the atmosphere alone does
 * not give once the sun has set. Added above the horizon by day too, where it is lost in the daylight.
 * - At the zenith 27 mcd/m², 16.5 mag/arcsec²: Tokyo's clear-night zenith, measured from Sumida in the winter of
 *   2010-11 (a camera; JpGU 2012 G01-P01). Berlin's centre reads 6-11 mcd/m² (Jechow et al. 2017, 2022).
 * - The light dome: brighter toward the horizon, 0.26 cd/m² more at it, falling to 1/e by 3.5 degrees up. Shaped on
 *   photographs of the Shinjuku skyline at night (Wikimedia Commons: Shinjuku20040421.jpg, public domain; Shinjuku night
 *   skyline.jpg, 2005): the sky at 1, 7 and 15 degrees reads 7.3 : 1.95 : 1, just above the lit horizon about 7x the top
 *   of the frame.
 * - Colours from the 2004 photograph, white-balanced on its office windows: a violet-blue zenith (the city's light
 *   scattered by the air, Rayleigh's blue), a warm dome at the horizon (the lights themselves, through the haze).
 */
export const NIGHT_GLOW = {
  glow: new Color().setRGB(1.05, 0.95, 1.39),
  glowIntensity: 0.027,
  horizonGlow: new Color().setRGB(1.28, 0.93, 0.86),
  horizonGlowIntensity: 0.26,
  horizonGlowHeight: 3.5 * (Math.PI / 180),
};
