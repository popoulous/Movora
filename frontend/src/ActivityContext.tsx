import { createContext, useContext } from "react";

import type { Task } from "./api";

export interface ActivityValue {
  tasks: Task[];
  running: boolean;
  // Show activity immediately and poll faster for a while (call after starting work).
  refreshSoon: () => void;
}

export const ActivityContext = createContext<ActivityValue>({
  tasks: [],
  running: false,
  refreshSoon: () => undefined,
});

export function useActivity(): ActivityValue {
  return useContext(ActivityContext);
}
