import { render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { cardTitle, type CardSeries, SeriesCard } from "./SeriesCard";

const t = ((key: string) => key) as unknown as TFunction;

const base: CardSeries = {
  id: 1,
  title: "Railgun",
  display_title: "A Certain Railgun",
  year: 2009,
  score: 83,
  cover_image_url: null,
  episode_count: 24,
  watch_percent: 40,
  normalized: true,
};

describe("cardTitle", () => {
  it("prefers the display title, falling back to the raw title", () => {
    expect(cardTitle(base)).toBe("A Certain Railgun");
    expect(cardTitle({ ...base, display_title: null })).toBe("Railgun");
  });
});

describe("SeriesCard", () => {
  it("renders the title, year and score", () => {
    render(<SeriesCard series={base} onClick={() => undefined} t={t} />);
    expect(screen.getAllByText("A Certain Railgun").length).toBeGreaterThan(0);
    expect(screen.getByText("2009")).toBeInTheDocument();
    expect(screen.getByText("8.3")).toBeInTheDocument(); // score / 10
  });
});
