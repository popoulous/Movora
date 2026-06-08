import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AuthProvider, useAuth } from "./AuthContext";
import { useSpatialNav } from "./hooks/useSpatialNav";
import { useTvMode } from "./hooks/useTvMode";
import { Layout } from "./components/Layout";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlayerPage } from "./pages/PlayerPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SeriesDetailPage } from "./pages/SeriesDetailPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";
import { TvPlayerPage } from "./pages/TvPlayerPage";

export function App(): JSX.Element {
  const tv = useTvMode();
  useEffect(() => {
    document.documentElement.classList.toggle("tv", tv);
  }, [tv]);
  useSpatialNav(tv);
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function PlayerRoute(): JSX.Element {
  const tv = useTvMode();
  return tv ? <TvPlayerPage /> : <PlayerPage />;
}

function AdminRoute({ children }: { children: JSX.Element }): JSX.Element {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return children;
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
        <Route path="watch/:episodeId" element={<PlayerRoute />} />
        <Route path="tasks" element={<AdminRoute><TasksPage /></AdminRoute>} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}
