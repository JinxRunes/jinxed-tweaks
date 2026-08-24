import assert from "node:assert/strict";
import test from "node:test";
import {__setLoadPolicyForTests} from "./client-load-policy.mjs";
import {normalizeMalformedExternalUrl, rewriteToCdn, toFilePickerCurrent} from "./core-cdn.mjs";

test.beforeEach(() => {
  __setLoadPolicyForTests("off");
});

test.afterEach(() => {
  __setLoadPolicyForTests(null);
});

test("malformed external URLs are recovered before CDN matching", () => {
  const expected = "https://www.dndbeyond.com/avatars/36256/905/Crick.png";
  assert.equal(
    normalizeMalformedExternalUrl("https:/www.dndbeyond.com/avatars/36256/905/Crick.png"),
    expected
  );
  assert.equal(
    normalizeMalformedExternalUrl(
      "https://play.jinx.gg/https%3A/www.dndbeyond.com/avatars/36256/905/Crick.png"
    ),
    expected
  );
  assert.equal(
    rewriteToCdn("https:/www.dndbeyond.com/avatars/36256/905/Crick.png"),
    expected
  );
});

test("valid CDN and relative asset behavior is unchanged", () => {
  assert.equal(
    rewriteToCdn("Assets/Worlds/map.webp"),
    "https://assets.jinx.gg/Assets/Worlds/map.webp?_r=20260802r3"
  );
  assert.equal(
    rewriteToCdn("Assets/Tokens/hero.webp"),
    "Assets/Tokens/hero.webp"
  );
  assert.equal(
    rewriteToCdn("https://play.jinx.gg/Assets/TokenRings/hero.webp?_jinxOrigin=1"),
    "https://play.jinx.gg/Assets/TokenRings/hero.webp?_jinxOrigin=1"
  );
  assert.equal(
    rewriteToCdn(
      "https://assets.jinx.gg/Assets/Worlds/Exandria/Dwendalian%20Empire/Dunrock%20Ascent/Gl_Templeoftheoracle_Interiors_Night.webp"
    ),
    "https://assets.jinx.gg/Assets/Worlds/Exandria/Dwendalian%20Empire/Dunrock%20Ascent/Gl_Templeoftheoracle_Interiors_Night.webp?_r=20260802r3"
  );
});

test("FilePicker current paths strip jinx hosts to relative Data paths", () => {
  assert.equal(
    toFilePickerCurrent(
      "https://assets.jinx.gg/Assets/Worlds/Exandria/Dwendalian%20Empire/map.webp?_r=20260802r3"
    ),
    "Assets/Worlds/Exandria/Dwendalian Empire/map.webp"
  );
  assert.equal(
    toFilePickerCurrent("https://play.jinx.gg/Assets/Worlds/map.webp?_jinxOrigin=1"),
    "Assets/Worlds/map.webp"
  );
  assert.equal(
    toFilePickerCurrent("Assets/Worlds/map.webp"),
    "Assets/Worlds/map.webp"
  );
  assert.equal(
    toFilePickerCurrent("https://cdn.example.com/other/map.webp"),
    "https://cdn.example.com/other/map.webp"
  );
});

test("throttled clients pin allowlisted media to origin", () => {
  __setLoadPolicyForTests("throttle");
  assert.equal(
    rewriteToCdn("Assets/Worlds/map.webp"),
    "https://play.jinx.gg/Assets/Worlds/map.webp?_jinxOrigin=1"
  );
  assert.equal(
    rewriteToCdn(
      "https://assets.jinx.gg/Assets/Worlds/Exandria/Dwendalian%20Empire/Dunrock%20Ascent/Gl_Templeoftheoracle_Interiors_Night.webp"
    ),
    "https://play.jinx.gg/Assets/Worlds/Exandria/Dwendalian%20Empire/Dunrock%20Ascent/Gl_Templeoftheoracle_Interiors_Night.webp?_jinxOrigin=1"
  );
  assert.equal(
    rewriteToCdn("Assets/Tokens/hero.webp"),
    "Assets/Tokens/hero.webp"
  );
});
