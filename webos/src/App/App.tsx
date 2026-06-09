import React, { useState } from "react";
import ThemeDecorator from "@enact/sandstone/ThemeDecorator";
import { DeviceProvider, useDevice } from "../context/DeviceContext";
import WelcomeView from "../views/WelcomeView";
import HomeView from "../views/HomeView";
import SeriesView from "../views/SeriesView";
import PlayerView from "../views/PlayerView";
import SettingsView from "../views/SettingsView";

type Screen =
  | { id: "welcome" }
  | { id: "home" }
  | { id: "series"; seriesId: number }
  | { id: "player"; episodeId: number }
  | { id: "settings" };

function AppInner(): React.JSX.Element {
  const { config } = useDevice();
  const [screen, setScreen] = useState<Screen>(config ? { id: "home" } : { id: "welcome" });

  // When the user unpairs, force back to welcome at render time (no effect needed).
  const activeScreen: Screen = !config && screen.id !== "welcome" ? { id: "welcome" } : screen;

  function nav(s: Screen): void {
    setScreen(s);
  }

  switch (activeScreen.id) {
    case "welcome":
      return <WelcomeView onDone={() => nav({ id: "home" })} />;
    case "home":
      return (
        <HomeView
          onSeries={(id) => nav({ id: "series", seriesId: id })}
          onSettings={() => nav({ id: "settings" })}
        />
      );
    case "series":
      return (
        <SeriesView
          seriesId={activeScreen.seriesId}
          onPlay={(id) => nav({ id: "player", episodeId: id })}
          onBack={() => nav({ id: "home" })}
        />
      );
    case "player":
      return (
        <PlayerView
          episodeId={activeScreen.episodeId}
          onBack={() => nav({ id: "home" })}
          onNext={(id) => nav({ id: "player", episodeId: id })}
        />
      );
    case "settings":
      return <SettingsView onBack={() => nav({ id: "home" })} />;
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
