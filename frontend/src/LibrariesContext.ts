import { createContext, useContext } from "react";

import type { Library } from "./api";

export interface LibrariesContextValue {
  libraries: Library[];
  reload: () => void;
}

export const LibrariesContext = createContext<LibrariesContextValue>({
  libraries: [],
  reload: () => undefined,
});

export const useLibraries = (): LibrariesContextValue => useContext(LibrariesContext);
