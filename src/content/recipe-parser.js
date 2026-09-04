(function registerRecipeMasterParser(root) {
  "use strict";

  const HTML_ENTITIES = Object.freeze({
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\""
  });

  function decodeEntities(value) {
    if (!value || !value.includes("&")) {
      return value;
    }

    return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
      if (entity[0] === "#") {
        const radix = entity[1].toLowerCase() === "x" ? 16 : 10;
        const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
        const point = Number.parseInt(digits, radix);
        return Number.isFinite(point) ? String.fromCodePoint(point) : match;
      }

      return HTML_ENTITIES[entity.toLowerCase()] || match;
    });
  }

  function cleanText(value) {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "object") {
      value = value.text || value.name || value.value || value["@value"] || "";
    }

    return decodeEntities(String(value))
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, " ")
      .replace(/[\t\r ]+/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function asArray(value) {
    if (value === null || value === undefined || value === "") {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }

  function uniqueText(values) {
    const seen = new Set();
    const result = [];

    for (const value of values) {
      const text = cleanText(value);
      const key = text.toLocaleLowerCase();
      if (!text || seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push(text);
    }

    return result;
  }

  function hasType(node, expectedType) {
    if (!node || typeof node !== "object") {
      return false;
    }

    return asArray(node["@type"]).some((type) => {
      const normalized = cleanText(type).split(/[\/#]/).pop();
      return normalized && normalized.toLowerCase() === expectedType.toLowerCase();
    });
  }

  function findRecipeNodes(value, found = [], seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) {
      return found;
    }

    seen.add(value);
    if (hasType(value, "Recipe")) {
      found.push(value);
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        findRecipeNodes(item, found, seen);
      }
      return found;
    }

    for (const nested of Object.values(value)) {
      if (nested && typeof nested === "object") {
        findRecipeNodes(nested, found, seen);
      }
    }

    return found;
  }

  function parseJsonLdText(text) {
    let source = String(text || "")
      .replace(/^\uFEFF/, "")
      .replace(/^\s*<!--/, "")
      .replace(/-->\s*$/, "")
      .trim()
      .replace(/;\s*$/, "");

    if (!source) {
      return null;
    }

    try {
      return JSON.parse(source);
    } catch (_error) {
      const objectStart = source.indexOf("{");
      const arrayStart = source.indexOf("[");
      const starts = [objectStart, arrayStart].filter((position) => position >= 0);
      const start = starts.length ? Math.min(...starts) : -1;
      const end = Math.max(source.lastIndexOf("}"), source.lastIndexOf("]"));
      if (start < 0 || end <= start) {
        return null;
      }

      try {
        return JSON.parse(source.slice(start, end + 1));
      } catch (_nestedError) {
        return null;
      }
    }
  }

  function recipeScore(recipe) {
    if (!recipe || typeof recipe !== "object") {
      return 0;
    }

    return (
      (cleanText(recipe.name) ? 5 : 0) +
      Math.min(asArray(recipe.recipeIngredient || recipe.ingredients).length, 20) * 2 +
      Math.min(flattenInstructions(recipe.recipeInstructions).length, 20) * 3 +
      (recipe.image ? 1 : 0) +
      (recipe.recipeYield ? 1 : 0)
    );
  }

  function findBestRecipe(values) {
    const recipes = [];
    for (const value of asArray(values)) {
      findRecipeNodes(value, recipes);
    }
    recipes.sort((left, right) => recipeScore(right) - recipeScore(left));
    return recipes[0] || null;
  }

  function splitInstructionText(value) {
    const text = cleanText(value);
    if (!text) {
      return [];
    }

    const lines = text
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:step\s*)?\d+[.)\-:]?\s*/i, "").trim())
      .filter(Boolean);

    return lines.length > 1 ? lines : [text];
  }

  function flattenInstructions(value, section = "", output = []) {
    for (const item of asArray(value)) {
      if (typeof item === "string") {
        for (const line of splitInstructionText(item)) {
          output.push({ section: cleanText(section), text: line });
        }
        continue;
      }

      if (!item || typeof item !== "object") {
        continue;
      }

      const type = asArray(item["@type"]).map(cleanText);
      const isSection = type.some((entry) => /HowToSection$/i.test(entry));
      const childItems = item.itemListElement || item.steps;
      if (isSection || childItems) {
        flattenInstructions(childItems, cleanText(item.name) || section, output);
        continue;
      }

      const text = cleanText(item.text || item.description || item.name);
      if (text) {
        output.push({ section: cleanText(section), text });
      }
    }

    return output;
  }

  function parseDuration(value) {
    const source = cleanText(value);
    if (!source) {
      return "";
    }

    const match = source.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
    if (!match) {
      return source;
    }

    const parts = [];
    const labels = ["day", "hr", "min", "sec"];
    for (let index = 1; index <= 4; index += 1) {
      if (!match[index]) {
        continue;
      }
      const amount = Number(match[index]);
      const label = labels[index - 1];
      parts.push(`${amount} ${label}${label === "day" && amount !== 1 ? "s" : ""}`);
    }

    return parts.join(" ");
  }

  function readImage(value) {
    for (const image of asArray(value)) {
      if (typeof image === "string" && image.trim()) {
        return image.trim();
      }
      if (image && typeof image === "object") {
        const url = image.url || image.contentUrl || image.thumbnailUrl;
        if (typeof url === "string" && url.trim()) {
          return url.trim();
        }
      }
    }
    return "";
  }

  function readAuthor(value) {
    return uniqueText(asArray(value).map((author) => {
      if (typeof author === "string") {
        return author;
      }
      return author && (author.name || author.alternateName);
    })).join(", ");
  }

  function readYield(value) {
    return uniqueText(asArray(value)).join(", ");
  }

  function readUrl(value, fallbackUrl) {
    for (const candidate of asArray(value)) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
      if (candidate && typeof candidate === "object") {
        const url = candidate["@id"] || candidate.url;
        if (typeof url === "string" && url.trim()) {
          return url.trim();
        }
      }
    }
    return fallbackUrl || "";
  }

  function readNutrition(value) {
    if (!value || typeof value !== "object") {
      return {};
    }

    const fields = {
      calories: "Calories",
      carbohydrateContent: "Carbohydrates",
      cholesterolContent: "Cholesterol",
      fatContent: "Fat",
      fiberContent: "Fiber",
      proteinContent: "Protein",
      saturatedFatContent: "Saturated fat",
      servingSize: "Serving size",
      sodiumContent: "Sodium",
      sugarContent: "Sugar"
    };
    const nutrition = {};
    for (const [key, label] of Object.entries(fields)) {
      const text = cleanText(value[key]);
      if (text) {
        nutrition[label] = text;
      }
    }
    return nutrition;
  }

  function readAdditionalFields(recipe) {
    const fields = {};
    const direct = {
      alcoholContent: "ABV",
      garnish: "Garnish",
      glass: "Glassware",
      glassware: "Glassware",
      technique: "Technique"
    };

    for (const [property, label] of Object.entries(direct)) {
      const text = readYield(recipe[property]);
      if (text) {
        fields[label] = text;
      }
    }

    for (const property of asArray(recipe.additionalProperty)) {
      if (!property || typeof property !== "object") {
        continue;
      }
      const name = cleanText(property.name || property.propertyID);
      const value = cleanText(property.value || property.description);
      if (name && value && /abv|alcohol|garnish|glass|ice|technique|method/i.test(name)) {
        fields[name] = value;
      }
    }

    const tools = uniqueText([
      ...asArray(recipe.tool),
      ...asArray(recipe.supply)
    ]);
    if (tools.length) {
      fields.Equipment = tools.join(", ");
    }

    return fields;
  }

  function classifyDrink(recipe) {
    const searchable = [
      recipe.name,
      recipe.description,
      ...asArray(recipe.recipeCategory),
      ...asArray(recipe.keywords)
    ].map(cleanText).join(" ");
    return /\b(?:cocktail|mocktail|drink|beverage|smoothie|shake|coffee|tea|lemonade|punch|martini|margarita|highball)\b/i.test(searchable);
  }

  function normalizeRecipe(recipe, context = {}) {
    if (!recipe || typeof recipe !== "object") {
      return null;
    }

    const ingredients = uniqueText(asArray(recipe.recipeIngredient || recipe.ingredients));
    const instructions = flattenInstructions(recipe.recipeInstructions);
    const normalized = {
      source: context.source || "json-ld",
      name: cleanText(recipe.name || recipe.headline || context.title) || "Recipe",
      description: cleanText(recipe.description),
      author: readAuthor(recipe.author || recipe.creator),
      image: readImage(recipe.image || recipe.thumbnailUrl),
      url: readUrl(recipe.url || recipe.mainEntityOfPage || recipe["@id"], context.url),
      yield: readYield(recipe.recipeYield),
      category: readYield(recipe.recipeCategory),
      cuisine: readYield(recipe.recipeCuisine),
      prepTime: parseDuration(recipe.prepTime),
      cookTime: parseDuration(recipe.cookTime),
      totalTime: parseDuration(recipe.totalTime),
      ingredients,
      instructions,
      nutrition: readNutrition(recipe.nutrition),
      additional: readAdditionalFields(recipe),
      isDrink: classifyDrink(recipe)
    };

    return normalized;
  }

  function queryUniqueText(scope, selectors) {
    const elements = [];
    const seenElements = new Set();
    for (const selector of selectors) {
      let matches = [];
      try {
        matches = scope.querySelectorAll(selector);
      } catch (_error) {
        continue;
      }
      for (const element of matches) {
        if (!seenElements.has(element)) {
          seenElements.add(element);
          elements.push(element);
        }
      }
    }

    return uniqueText(elements.map((element) => element.getAttribute("content") || element.textContent));
  }

  function extractDomRecipe(doc, rules, card = null) {
    if (!doc || !rules) {
      return null;
    }

    const scope = card || doc;
    const ingredients = queryUniqueText(scope, rules.ingredientSelectors || []);
    const instructionText = queryUniqueText(scope, rules.instructionSelectors || []);
    if (ingredients.length < 2 || instructionText.length < 1) {
      return null;
    }

    const nameElement = scope.querySelector("[itemprop='name'], .wprm-recipe-name, .tasty-recipes-title, h1, h2") || doc.querySelector("h1");
    const imageElement = scope.querySelector("[itemprop='image'], img") || doc.querySelector("meta[property='og:image']");
    const image = imageElement
      ? imageElement.getAttribute("content") || imageElement.currentSrc || imageElement.src || ""
      : "";
    const yieldElement = scope.querySelector("[itemprop='recipeYield'], .wprm-recipe-servings, [class*='servings']");

    return {
      source: "dom",
      name: cleanText(nameElement && nameElement.textContent) || cleanText(doc.title) || "Recipe",
      description: "",
      author: cleanText((scope.querySelector("[itemprop='author']") || {}).textContent),
      image,
      url: doc.location ? doc.location.href : "",
      yield: cleanText(yieldElement && yieldElement.textContent),
      category: "",
      cuisine: "",
      prepTime: cleanText((scope.querySelector("[itemprop='prepTime']") || {}).textContent),
      cookTime: cleanText((scope.querySelector("[itemprop='cookTime']") || {}).textContent),
      totalTime: cleanText((scope.querySelector("[itemprop='totalTime']") || {}).textContent),
      ingredients,
      instructions: instructionText.map((text) => ({ section: "", text })),
      nutrition: {},
      additional: {},
      isDrink: /\b(?:cocktail|mocktail|drink|beverage|smoothie|shake|coffee|tea|lemonade|punch|martini|margarita|highball)\b/i.test(`${doc.title} ${nameElement ? nameElement.textContent : ""}`)
    };
  }

  function extractJsonLd(doc) {
    if (!doc || !doc.querySelectorAll) {
      return null;
    }

    const values = [];
    for (const script of doc.querySelectorAll("script[type='application/ld+json'], script[type='application/json+ld']")) {
      const parsed = parseJsonLdText(script.textContent);
      if (parsed) {
        values.push(parsed);
      }
    }

    const recipe = findBestRecipe(values);
    return recipe
      ? normalizeRecipe(recipe, {
          source: "json-ld",
          title: doc.title,
          url: doc.location ? doc.location.href : ""
        })
      : null;
  }

  function extractFromDocument(doc, rules, card = null) {
    return extractJsonLd(doc) || extractDomRecipe(doc, rules, card);
  }

  const api = Object.freeze({
    asArray,
    cleanText,
    extractDomRecipe,
    extractFromDocument,
    extractJsonLd,
    findBestRecipe,
    findRecipeNodes,
    flattenInstructions,
    hasType,
    normalizeRecipe,
    parseDuration,
    parseJsonLdText,
    recipeScore,
    uniqueText
  });

  root.RecipeMasterParser = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
