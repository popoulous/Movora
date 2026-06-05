import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const en = {
  nav: {
    home: "Home",
    libraries: "Libraries",
    settings: "Settings",
    addLibrary: "Add library",
    noLibraries: "No libraries yet — add one with +",
  },
  topbar: { activity: "Activity", language: "Language" },
  home: {
    welcome: "Welcome to Movora",
    subtitle: "Pick a library from the sidebar, or add one with + to browse your folders.",
  },
  settings: {
    title: "Settings",
    subtitle: "Language, account and server settings will live here.",
  },
  library: {
    defaultName: "Library",
    seriesCount: "{{count}} series",
    scan: "Scan",
    fetchMetadata: "Fetch metadata",
    settings: "Library settings",
    noSeries: "No series yet — run a Scan.",
    scanning: "Scanning…",
    fetching: "Fetching metadata…",
  },
  folder: {
    title: "Add library",
    up: "Up",
    thisPc: "This PC",
    noSubfolders: "No sub-folders here",
    name: "Library name",
    add: "Add this folder",
    pickFirst: "Open a folder first, then add it.",
  },
  librarySettings: {
    title: "Library settings",
    name: "Name",
    type: "Type",
    folderNote: "Folder: {{path}} — delete and re-add to change it.",
    delete: "Delete library",
    confirmDelete: "Confirm delete",
    save: "Save",
  },
  series: {
    back: "Back",
    episodes: "{{count}} episodes",
    season: "Season {{number}}",
    untitled: "(untitled)",
    play: "Play",
    loading: "Loading…",
    tabOverview: "Overview",
    tabEpisodes: "Episodes",
    details: "Details",
    scoreLabel: "Score",
    yearLabel: "Year",
    episodesLabel: "Episodes",
    genresLabel: "Genres",
    noSynopsis: "No synopsis available.",
    rating: "Rating",
    aired: "Aired",
    format: "Format",
    perEp: "Per ep",
  },
  activity: {
    title: "Recent activity",
    empty: "No recent activity",
    scan: "Scan",
    enrich: "Metadata",
  },
};

const hu: typeof en = {
  nav: {
    home: "Főoldal",
    libraries: "Könyvtárak",
    settings: "Beállítások",
    addLibrary: "Könyvtár hozzáadása",
    noLibraries: "Még nincs könyvtár — adj hozzá a + gombbal",
  },
  topbar: { activity: "Folyamatok", language: "Nyelv" },
  home: {
    welcome: "Üdv a Movorában",
    subtitle:
      "Válassz könyvtárat a bal oldalon, vagy adj hozzá egyet a + gombbal a mappáid böngészéséhez.",
  },
  settings: {
    title: "Beállítások",
    subtitle: "Itt lesznek a nyelvi, fiók- és szerverbeállítások.",
  },
  library: {
    defaultName: "Könyvtár",
    seriesCount: "{{count}} sorozat",
    scan: "Szkennelés",
    fetchMetadata: "Metaadat lekérése",
    settings: "Könyvtár beállításai",
    noSeries: "Még nincs sorozat — futtass szkennelést.",
    scanning: "Szkennelés…",
    fetching: "Metaadat lekérése…",
  },
  folder: {
    title: "Könyvtár hozzáadása",
    up: "Vissza",
    thisPc: "Ez a gép",
    noSubfolders: "Nincs almappa",
    name: "Könyvtár neve",
    add: "Mappa hozzáadása",
    pickFirst: "Előbb nyiss meg egy mappát, aztán add hozzá.",
  },
  librarySettings: {
    title: "Könyvtár beállításai",
    name: "Név",
    type: "Típus",
    folderNote: "Mappa: {{path}} — cseréhez töröld és add hozzá újra.",
    delete: "Könyvtár törlése",
    confirmDelete: "Törlés megerősítése",
    save: "Mentés",
  },
  series: {
    back: "Vissza",
    episodes: "{{count}} epizód",
    season: "{{number}}. évad",
    untitled: "(névtelen)",
    play: "Lejátszás",
    loading: "Betöltés…",
    tabOverview: "Áttekintés",
    tabEpisodes: "Epizódok",
    details: "Részletek",
    scoreLabel: "Pontszám",
    yearLabel: "Év",
    episodesLabel: "Epizódok",
    genresLabel: "Műfajok",
    noSynopsis: "Nincs elérhető leírás.",
    rating: "Értékelés",
    aired: "Sugárzás",
    format: "Formátum",
    perEp: "Epizódonként",
  },
  activity: {
    title: "Friss tevékenység",
    empty: "Nincs friss tevékenység",
    scan: "Szkennelés",
    enrich: "Metaadat",
  },
};

const stored = localStorage.getItem("movora.lang");

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hu: { translation: hu } },
  lng: stored ?? (navigator.language.startsWith("hu") ? "hu" : "en"),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
