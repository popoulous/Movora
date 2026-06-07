import { Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "./AuthContext";
import { Layout } from "./components/Layout";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlayerPage } from "./pages/PlayerPage";
import { SeriesDetailPage } from "./pages/SeriesDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";

export function App(): JSX.Element {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate(): JSX.Element {
  const { loading, authenticated } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-neutral-600">…</div>
    );
  }
  if (!authenticated) {
    return <AuthPage />;
  }
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="library/:id" element={<LibraryPage />} />
        <Route path="series/:id" element={<SeriesDetailPage />} />
        <Route path="watch/:episodeId" element={<PlayerPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
