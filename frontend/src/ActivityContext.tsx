import { createContext, useContext } from "react";

import type { Job } from "./api";

export interface ActivityValue {
  jobs: Job[];
  running: boolean;
  // Show activity immediately and poll faster for a while (call after starting work).
  refreshSoon: () => void;
}

export const ActivityContext = createContext<ActivityValue>({
  jobs: [],
  running: false,
  refreshSoon: () => undefined,
});

export function useActivity(): ActivityValue {
  return useContext(ActivityContext);
}
