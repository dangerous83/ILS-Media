// Generates web-sized brand assets in /public from the high-res originals in /assets.
import sharp from "sharp";

const jobs = [
  sharp("assets/ils-icon-white.png").resize(512, 512).png().toFile("public/ils-icon-white.png"),
  sharp("assets/ils-logo-white.png").resize({ width: 1200 }).png().toFile("public/ils-logo-white.png"),
  sharp("assets/ils-logo-blue.jpg").resize(512, 512, { fit: "cover" }).png().toFile("public/icon.png"),
  sharp("assets/ils-logo-blue.jpg").resize(180, 180, { fit: "cover" }).png().toFile("public/apple-icon.png"),
];
await Promise.all(jobs);
console.log("Assets written to /public");
