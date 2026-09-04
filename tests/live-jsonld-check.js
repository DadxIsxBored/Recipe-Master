"use strict";

const parser = require("../src/content/recipe-parser.js");

const urls = process.argv.slice(2);
const targets = urls.length ? urls : [
  "https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/",
  "https://www.recipetineats.com/chicken-stroganoff/",
  "https://sallysbakingaddiction.com/chewy-chocolate-chip-cookies/",
  "https://www.budgetbytes.com/chicken-noodle-soup/",
  "https://www.bbcgoodfood.com/recipes/classic-scones-jam-clotted-cream",
  "https://www.seriouseats.com/foolproof-pan-pizza-recipe",
  "https://www.loveandlemons.com/brownies-recipe/",
  "https://www.foodnetwork.com/recipes/classic-deviled-eggs-recipe-1911032",
  "https://www.liquor.com/recipes/manhattan-2/",
  "https://mindfulmocktail.com/margarita-mocktail-recipe/"
];

function extractJsonLd(html) {
  const values = [];
  const pattern = /<script\b[^>]*\btype\s*=\s*(?:["']application\/(?:ld\+json|json\+ld)["']|application\/(?:ld\+json|json\+ld))[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const value = parser.parseJsonLdText(match[1]);
    if (value) {
      values.push(value);
    }
  }
  return values;
}

async function check(url) {
  const response = await fetch(url, {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  const jsonLd = extractJsonLd(html);
  const recipeNodes = [];
  for (const value of jsonLd) {
    parser.findRecipeNodes(value, recipeNodes);
  }
  const recipeNode = parser.findBestRecipe(jsonLd);
  const recipe = parser.normalizeRecipe(recipeNode, { source: "json-ld", url });
  if (!recipe || recipe.ingredients.length < 2 || recipe.instructions.length < 1) {
    const summary = recipeNodes.map((node) => ({
      ingredients: parser.asArray(node.recipeIngredient || node.ingredients).length,
      instructions: parser.flattenInstructions(node.recipeInstructions).length,
      name: parser.cleanText(node.name),
      properties: Object.keys(node).sort()
    }));
    throw new Error(`No complete Schema.org Recipe payload found; scripts=${jsonLd.length}; recipes=${JSON.stringify(summary)}`);
  }
  return {
    host: new URL(url).hostname,
    ingredients: recipe.ingredients.length,
    instructions: recipe.instructions.length,
    name: recipe.name
  };
}

async function main() {
  let passed = 0;
  for (const url of targets) {
    try {
      const result = await check(url);
      passed += 1;
      process.stdout.write(`PASS ${result.host} | ${result.ingredients} ingredients | ${result.instructions} instructions | ${result.name}\n`);
    } catch (error) {
      process.stdout.write(`SKIP ${new URL(url).hostname} | ${error.message}\n`);
    }
  }

  process.stdout.write(`Live JSON-LD coverage: ${passed}/${targets.length}\n`);
  if (passed < Math.ceil(targets.length / 2)) {
    process.exitCode = 1;
  }
}

main();
