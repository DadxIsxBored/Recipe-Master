export default {
  sourceDir: ".",
  artifactsDir: "artifacts",
  ignoreFiles: [
    "artifacts/**",
    "docs/**",
    "tests/**",
    "package.json",
    "package-lock.json",
    "README.md",
    "web-ext-config.mjs",
    "GPT convo about extension.txt",
    "GPT convo about exxtention.txt"
  ],
  build: {
    filename: "recipe-master-{version}.zip"
  }
};
