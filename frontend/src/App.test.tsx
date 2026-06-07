import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import "./i18n";
import { App } from "./App";

vi.mock("./api", () => ({
  api: {
    authStatus: vi
      .fn()
      .mockResolvedValue({ authenticated: false, needs_setup: false, user: null }),
    setup: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

describe("auth gate", () => {
  it("shows the login screen while unauthenticated", async () => {
    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    // The login screen is the only place the "Movora" wordmark appears pre-auth.
    const heading = await waitFor(() => screen.getByText("Movora"));
    expect(heading.tagName).toBe("H1");
  });
});
