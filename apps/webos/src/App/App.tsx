/* eslint-disable react/jsx-no-bind -- inline handlers are idiomatic for this list-heavy TV UI */
import React, { useState } from "react";
import ThemeDecorator from "@enact/sandstone/ThemeDecorator";
import { I18nProvider } from "../i18n";
import { DeviceProvider, useDevice } from "../context/DeviceContext";
import WelcomeView from "../views/WelcomeView";
import HomeView from "../views/HomeView";
import LibraryView from "../views/LibraryView";
import SeriesView from "../views/SeriesView";
import PlayerView from "../views/PlayerView";
import SettingsView from "../views/SettingsView";
import CapabilityView from "../views/CapabilityView";
import SplashScreen from "../components/SplashScreen";
import "../theme.css";

type Screen =
  | { id: "welcome" }
  | { id: "home" }
  | { id: "library"; libraryId: number }
  | { id: "series"; seriesId: number }
  | { id: "player"; episodeId: number }
  | { id: "settings" }
  | { id: "capability" };

function AppInner(): React.JSX.Element {
  const { config } = useDevice();
  const [stack, setStack] = useState<Screen[]>(() =>
    config ? [{ id: "home" }] : [{ id: "welcome" }],
  );
  const [splashDone, setSplashDone] = useState(false);
  const screen = stack[stack.length - 1] ?? { id: "home" };

  // When the user unpairs, force back to welcome at render time (no effect needed).
  const activeScreen: Screen = !config && screen.id !== "welcome" ? { id: "welcome" } : screen;

  const push = (s: Screen): void => setStack((st) => [...st, s]);
  const replace = (s: Screen): void => setStack((st) => [...st.slice(0, -1), s]);
  const back = (): void => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st));
  const reset = (s: Screen): void => setStack([s]);

  const renderScreen = (): React.JSX.Element => {
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
            onLibrary={(id) => replace({ id: "library", libraryId: id })}
            onHome={() => reset({ id: "home" })}
            onSettings={() => push({ id: "settings" })}
            onBack={back}
          />
        );
      case "series":
        return (
          <SeriesView
            seriesId={activeScreen.seriesId}
            onPlay={(id) => push({ id: "player", episodeId: id })}
            onSeries={(id) => push({ id: "series", seriesId: id })}
            onLibrary={(id) => push({ id: "library", libraryId: id })}
            onHome={() => reset({ id: "home" })}
            onSettings={() => push({ id: "settings" })}
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
        return <SettingsView onBack={back} onCapability={() => push({ id: "capability" })} />;
      case "capability":
        return <CapabilityView onBack={back} />;
    }
  };

  return (
    <>
      {renderScreen()}
      {!splashDone && (
        <SplashScreen serverUrl={config?.serverUrl ?? null} onDone={() => setSplashDone(true)} />
      )}
    </>
  );
}

function App(): React.JSX.Element {
  return (
    <I18nProvider>
      <DeviceProvider>
        <AppInner />
      </DeviceProvider>
    </I18nProvider>
  );
}

export default ThemeDecorator(App);
