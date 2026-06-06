import { createContext, useContext } from "react";

import type { Job, Task } from "./api";

export interface ActivityValue {
  jobs: Job[];
  tasks: Task[];
  running: boolean;
  // Show activity immediately and poll faster for a while (call after starting work).
  refreshSoon: () => void;
}

export const ActivityContext = createContext<ActivityValue>({
  jobs: [],
  tasks: [],
  running: false,
  refreshSoon: () => undefined,
});

export function useActivity(): ActivityValue {
  return useContext(ActivityContext);
}
