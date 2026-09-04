"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const parser = require("../src/content/recipe-parser.js");

test("finds the strongest Recipe node inside an @graph", () => {
  const value = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "Page" },
      {
        "@type": ["Thing", "Recipe"],
        name: "Test Soup",
        recipeIngredient: ["1 cup water", "2 carrots"],
        recipeInstructions: [
          { "@type": "HowToStep", text: "Heat the water." },
          { "@type": "HowToStep", text: "Add carrots." }
        ]
      }
    ]
  };

  assert.equal(parser.findBestRecipe([value]).name, "Test Soup");
});

test("normalizes nested instruction sections and recipe metadata", () => {
  const normalized = parser.normalizeRecipe({
    "@type": "Recipe",
    name: "Sectioned Bread",
    author: [{ name: "Test Cook" }],
    prepTime: "PT15M",
    cookTime: "PT1H5M",
    recipeYield: ["1 loaf"],
    recipeIngredient: ["2 cups flour", "1 cup water"],
    recipeInstructions: [
      {
        "@type": "HowToSection",
        name: "Dough",
        itemListElement: [
          { "@type": "HowToStep", text: "Mix the ingredients." },
          { "@type": "HowToStep", text: "Knead the dough." }
        ]
      }
    ]
  });

  assert.equal(normalized.author, "Test Cook");
  assert.equal(normalized.prepTime, "15 min");
  assert.equal(normalized.cookTime, "1 hr 5 min");
  assert.equal(normalized.instructions.length, 2);
  assert.equal(normalized.instructions[0].section, "Dough");
});

test("retains drink-specific additional properties", () => {
  const normalized = parser.normalizeRecipe({
    "@type": "Recipe",
    name: "Example Cocktail",
    recipeCategory: "Cocktail",
    recipeIngredient: ["2 oz spirit", "1 oz juice"],
    recipeInstructions: "Shake with ice.",
    glassware: "Coupe",
    garnish: "Citrus peel",
    additionalProperty: [
      { "@type": "PropertyValue", name: "ABV", value: "18%" }
    ]
  });

  assert.equal(normalized.isDrink, true);
  assert.equal(normalized.additional.Glassware, "Coupe");
  assert.equal(normalized.additional.Garnish, "Citrus peel");
  assert.equal(normalized.additional.ABV, "18%");
});

test("parses JSON-LD wrapped in HTML comments and a trailing semicolon", () => {
  const parsed = parser.parseJsonLdText("<!-- {\"@type\":\"Recipe\",\"name\":\"Pie\"} -->;");
  assert.equal(parsed.name, "Pie");
});

test("decodes markup and entities in recipe text", () => {
  assert.equal(parser.cleanText("Mix &amp; <strong>serve</strong>."), "Mix & serve.");
});
