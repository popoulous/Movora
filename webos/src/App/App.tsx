import React, { useState } from "react";
import ThemeDecorator from "@enact/sandstone/ThemeDecorator";
import { DeviceProvider, useDevice } from "../context/DeviceContext";
import WelcomeView from "../views/WelcomeView";
import HomeView from "../views/HomeView";
import LibraryView from "../views/LibraryView";
import SeriesView from "../views/SeriesView";
import PlayerView from "../views/PlayerView";
import SettingsView from "../views/SettingsView";
import "../theme.css";

type Screen =
  | { id: "welcome" }
  | { id: "home" }
  | { id: "library"; libraryId: number }
  | { id: "series"; seriesId: number }
  | { id: "player"; episodeId: number }
  | { id: "settings" };

function AppInner(): React.JSX.Element {
  const { config } = useDevice();
  const [stack, setStack] = useState<Screen[]>(() =>
    config ? [{ id: "home" }] : [{ id: "welcome" }],
  );
  const screen = stack[stack.length - 1] ?? { id: "home" };

  // When the user unpairs, force back to welcome at render time (no effect needed).
  const activeScreen: Screen = !config && screen.id !== "welcome" ? { id: "welcome" } : screen;

  const push = (s: Screen): void => setStack((st) => [...st, s]);
  const replace = (s: Screen): void => setStack((st) => [...st.slice(0, -1), s]);
  const back = (): void => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
  const reset = (s: Screen): void => setStack([s]);

  switch (activeScreen.id) {
    case "welcome":
      return <WelcomeView onDone={() => reset({ id: "home" })} />;
    case "home":
      return (
        <HomeView
          onSeries={(id) => push({ id: "series", seriesId: id })}
          onPlay={(id) => push({ id: "player", episodeId: id })}
          onLibrary={(id) => push({ id: "library", libraryId: id })}
          onSettings={() => push({ id: "settings" })}
        />
      );
    case "library":
      return (
        <LibraryView
          libraryId={activeScreen.libraryId}
          onSeries={(id) => push({ id: "series", seriesId: id })}
          onPlay={(id) => push({ id: "player", episodeId: id })}
          onBack={back}
        />
      );
    case "series":
      return (
        <SeriesView
          seriesId={activeScreen.seriesId}
          onPlay={(id) => push({ id: "player", episodeId: id })}
          onBack={back}
        />
      );
    case "player":
      return (
        <PlayerView
          episodeId={activeScreen.episodeId}
          onBack={back}
          onNext={(id) => replace({ id: "player", episodeId: id })}
        />
      );
    case "settings":
      return <SettingsView onBack={back} />;
  }
}

function App(): React.JSX.Element {
  return (
    <DeviceProvider>
      <AppInner />
    </DeviceProvider>
  );
}

export default ThemeDecorator(App);
