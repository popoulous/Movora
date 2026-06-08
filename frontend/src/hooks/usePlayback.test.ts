import { describe, expect, it } from "vitest";

import { type SubtitleTrack } from "../api";
import { subtitleLabels } from "./usePlayback";

function track(
  id: string,
  language: string | null,
  format: "ass" | "vtt",
  label = "",
): SubtitleTrack {
  return { id, language, format, label, url: "" };
}

describe("subtitleLabels", () => {
  it("returns an empty object for an empty track list", () => {
    expect(subtitleLabels([])).toEqual({});
  });

  it("uses the language name when the language is known", () => {
    const labels = subtitleLabels([track("1", "hu", "ass"), track("2", "en", "vtt")]);
    expect(labels["1"]).toBe("Magyar");
    expect(labels["2"]).toBe("English");
  });

  it("accepts three-letter ISO codes (hun / eng)", () => {
    const labels = subtitleLabels([track("1", "hun", "ass"), track("2", "eng", "vtt")]);
    expect(labels["1"]).toBe("Magyar");
    expect(labels["2"]).toBe("English");
  });

  it("uppercases unknown language codes", () => {
    expect(subtitleLabels([track("1", "zz", "ass")])["1"]).toBe("ZZ");
  });

  it("falls back to the format label when language is absent", () => {
    expect(subtitleLabels([track("1", null, "ass")])["1"]).toBe("(ASS)");
  });

  it("shows SRT (not VTT) for vtt-format tracks", () => {
    expect(subtitleLabels([track("1", null, "vtt")])["1"]).toBe("(SRT)");
  });

  it("disambiguates same-language tracks using their title", () => {
    const tracks = [
      track("1", "en", "ass", "Eng Full [SDH]"),
      track("2", "en", "vtt", "Eng Signs & Songs"),
    ];
    const labels = subtitleLabels(tracks);
    expect(labels["1"]).toBe("Eng Full [SDH]");
    expect(labels["2"]).toBe("Eng Signs & Songs");
  });

  it("falls back to 'Language (FORMAT)' when same-language tracks have generic titles", () => {
    const tracks = [
      track("1", "en", "ass", "embedded"),
      track("2", "en", "vtt", "external"),
    ];
    const labels = subtitleLabels(tracks);
    expect(labels["1"]).toBe("English (ASS)");
    expect(labels["2"]).toBe("English (SRT)");
  });

  it("treats a title that matches the language code as generic", () => {
    // e.g. label "EN" for an English track — not informative, use format
    const tracks = [
      track("1", "en", "ass", "EN"),
      track("2", "en", "vtt", "en"),
    ];
    const labels = subtitleLabels(tracks);
    expect(labels["1"]).toBe("English (ASS)");
    expect(labels["2"]).toBe("English (SRT)");
  });
});
